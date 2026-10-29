import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freshDb, addSource, rss, fakeFetch, H } from './helpers.js';
import { openDb, setSetting } from '../src/db.js';
import { tick, runUpdate, getAnchor, recoverAfterRestart } from '../src/runner.js';
import { duePlan, slotTime, SEVEN_HOURS } from '../src/core/schedule.js';
import { config } from '../src/config.js';

const ANCHOR = Date.parse('2026-10-22T20:00:00+03:00'); // 8 pm Riyadh

test('fixed 7-hour gaps across midnight (no cron-style reset)', () => {
  const slots = Array.from({ length: 8 }, (_, k) => slotTime(ANCHOR, SEVEN_HOURS, k));
  for (let i = 1; i < slots.length; i++) assert.equal(slots[i] - slots[i - 1], SEVEN_HOURS);
  const riyadhHour = (ms) => new Date(ms + 3 * H).getUTCHours();
  assert.deepEqual(slots.slice(0, 5).map(riyadhHour), [20, 3, 10, 17, 0]); // crosses midnight twice, never resets
  // a cron "0 */7 * * *" would fire at 21:00 then 00:00 (3h gap): we must not behave like that
  assert.equal(duePlan(ANCHOR, SEVEN_HOURS, ANCHOR + 7 * H - 1, 0).due, false);
  assert.equal(duePlan(ANCHOR, SEVEN_HOURS, ANCHOR + 7 * H, 0).due, true);
});

function feedFor(now) {
  return rss([{ title: `وزارة الصحة تطلق خدمة رقمية جديدة رقم ${now}`, link: `https://a.test/n/${now}`, published: now - 10 * 60_000, summary: 'أطلقت وزارة الصحة خدمة رقمية جديدة.' }]);
}

test('schedule survives a server restart; outage is caught up in ONE run without duplicate bulletins', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nd-'));
  const path = join(dir, 'news.db');
  try {
    let db = freshDb(path);
    addSource(db, 'a', { url: 'https://a.test/feed' });
    setSetting(db, 'schedule_anchor', String(ANCHOR));
    let clock = ANCHOR + 60_000;
    const fetchImpl = fakeFetch(() => feedFor(clock));
    let r = await tick(db, { now: () => clock, fetchImpl });
    assert.equal(r.action, 'ran');
    assert.equal(r.slot, 0);
    clock = ANCHOR + 2 * H;
    assert.equal((await tick(db, { now: () => clock, fetchImpl })).action, 'idle');
    db.close();

    // restart (new process opens the same DB): anchor and slot bookkeeping persist
    db = openDb(path);
    recoverAfterRestart(db);
    assert.equal(getAnchor(db), ANCHOR);
    clock = ANCHOR + 6 * H;
    assert.equal((await tick(db, { now: () => clock, fetchImpl })).action, 'idle');
    clock = ANCHOR + 7 * H + 30_000; // after midnight Riyadh (03:00)
    r = await tick(db, { now: () => clock, fetchImpl });
    assert.equal(r.slot, 1);

    // server down for ~30 hours: slots 2,3,4 missed, now in slot 5
    clock = ANCHOR + 35 * H + 5 * 60_000;
    r = await tick(db, { now: () => clock, fetchImpl });
    assert.equal(r.action, 'ran');
    assert.equal(r.slot, 5);
    const merged = db.prepare("SELECT slot_index FROM schedule_slots WHERE status = 'merged' ORDER BY slot_index").all().map((x) => x.slot_index);
    assert.deepEqual(merged, [2, 3, 4]);
    assert.equal(db.prepare("SELECT kind FROM runs ORDER BY id DESC LIMIT 1").get().kind, 'catchup');
    const before = db.prepare('SELECT COUNT(*) n FROM bulletins').get().n;
    assert.equal(before, 3, 'one bulletin per executed run (slots 0, 1, catch-up 5)');
    // calling again (e.g. external cron + timer) is idempotent
    assert.equal((await tick(db, { now: () => clock + 60_000, fetchImpl })).action, 'idle');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM bulletins').get().n, before);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('manual and scheduled update at the same time: only one runs', async () => {
  const db = freshDb();
  addSource(db, 'a', { url: 'https://a.test/feed' });
  setSetting(db, 'schedule_anchor', String(ANCHOR));
  const clock = ANCHOR + 60_000;
  const fetchImpl = fakeFetch(() => feedFor(clock), { delayMs: 30 });
  const [m, s] = await Promise.all([runUpdate(db, { kind: 'manual', fetchImpl, now: () => clock }), tick(db, { now: () => clock, fetchImpl })]);
  assert.notEqual(m.status, 'skipped_locked');
  assert.equal(s.action, 'busy');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM runs WHERE status NOT IN ('skipped_locked')").get().n, 1);
  // the scheduled slot still runs once the lock is free
  const later = await tick(db, { now: () => clock + 60_000, fetchImpl });
  assert.equal(later.action, 'ran');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM items').get().n, 1, 'no duplicate items from the second run');
});

test('failed run is retried with backoff and does not replace the last good bulletin', async () => {
  const db = freshDb();
  addSource(db, 'a', { url: 'https://a.test/feed' });
  setSetting(db, 'schedule_anchor', String(ANCHOR));
  let clock = ANCHOR + 60_000;
  let up = true;
  const fetchImpl = fakeFetch(() => (up ? feedFor(clock) : new Error('ECONNRESET')));
  await tick(db, { now: () => clock, fetchImpl });
  const good = db.prepare("SELECT id FROM bulletins WHERE status = 'published'").get();
  assert.ok(good);
  up = false;
  clock = ANCHOR + 7 * H + 60_000;
  const r = await tick(db, { now: () => clock, fetchImpl });
  assert.equal(r.status, 'failed');
  const slot = db.prepare('SELECT * FROM schedule_slots WHERE slot_index = 1').get();
  assert.equal(slot.status, 'retrying');
  assert.ok(slot.next_retry_at > clock);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bulletins').get().n, 1, 'no empty bulletin on fetch failure');
  assert.equal((await tick(db, { now: () => clock + 60_000, fetchImpl })).action, 'idle', 'waits for backoff');
  up = true;
  clock = slot.next_retry_at + 1000;
  const r2 = await tick(db, { now: () => clock, fetchImpl });
  assert.equal(r2.action, 'ran');
  assert.equal(db.prepare('SELECT status, attempts FROM schedule_slots WHERE slot_index = 1').get().status, 'done');
});

test('switching to fixed daily times (07:00 and 19:00 Riyadh) causes no off-schedule run', async () => {
  const db = freshDb();
  addSource(db, 'a', { url: 'https://a.test/feed' });
  setSetting(db, 'schedule_anchor', String(ANCHOR));
  let clock = ANCHOR + 60_000;
  // a different story each run: near-identical headlines would (correctly) merge as one story
  const stories = ['وزارة الصحة تطلق خدمة رقمية جديدة للمواعيد', 'هيئة الطيران المدني تعلن قواعد جديدة لحقوق المسافرين', 'وزارة التعليم تفتح باب القبول في برنامج الابتعاث',
    'أمانة الرياض تفتتح حدائق عامة في أحياء الشمال', 'هيئة الغذاء والدواء تحذر من منتج تجميل مغشوش', 'وزارة الثقافة تطلق مهرجانا للفنون التراثية في الأحساء'];
  let n = 0;
  const fetchImpl = fakeFetch(() => {
    const title = stories[n++ % stories.length];
    return rss([{ title, link: `https://a.test/s/${n}`, published: clock - 10 * 60_000, summary: title }]);
  });
  await tick(db, { now: () => clock, fetchImpl });
  // old 7-hour grid also ran slots 1 and 2: their bulletins must not block the new grid's slots
  for (const k of [1, 2]) {
    clock = ANCHOR + k * 7 * H + 60_000;
    assert.equal((await tick(db, { now: () => clock, fetchImpl })).action, 'ran');
  }
  const bulletins = () => db.prepare("SELECT COUNT(*) n FROM bulletins WHERE status = 'published'").get().n;
  const saved = { anchor: config.scheduleAnchor, hours: config.intervalHours };
  config.scheduleAnchor = '2026-10-28T07:00:00+03:00';
  config.intervalHours = 12;
  try {
    clock = Date.parse('2026-10-28T16:00:00+03:00');
    assert.equal((await tick(db, { now: () => clock, fetchImpl })).action, 'idle', 'the switch itself does not run an update');
    assert.equal(getAnchor(db, clock), Date.parse('2026-10-28T07:00:00+03:00'));
    const before = bulletins();
    clock = Date.parse('2026-10-28T19:01:00+03:00');
    assert.equal((await tick(db, { now: () => clock, fetchImpl })).action, 'ran', '19:00 bulletin');
    assert.equal(bulletins(), before + 1, 'the 19:00 run publishes a new bulletin');
    clock = Date.parse('2026-10-29T06:59:00+03:00');
    assert.equal((await tick(db, { now: () => clock, fetchImpl })).action, 'idle');
    clock = Date.parse('2026-10-29T07:02:00+03:00');
    assert.equal((await tick(db, { now: () => clock, fetchImpl })).action, 'ran', '07:00 bulletin');
    assert.equal(bulletins(), before + 2, 'the 07:00 run publishes a new bulletin');
  } finally {
    config.scheduleAnchor = saved.anchor;
    config.intervalHours = saved.hours;
  }
});