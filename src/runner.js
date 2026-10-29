// One update run (scheduled, catch-up, manual or external trigger), guarded by a DB lease lock
// so two runs can never overlap, even across processes sharing the same database.
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { getSetting, setSetting, tx } from './db.js';
import { ingestAll } from './ingest.js';
import { enrichPending } from './enrich.js';
import { buildBulletin } from './bulletin.js';
import { duePlan, retryDelayMs, slotTime, slotIndexAt } from './core/schedule.js';

const LOCK = 'update';
const LEASE_MS = 20 * 60_000;

export function acquireLock(db, holder, now = Date.now(), lease = LEASE_MS) {
  db.prepare('INSERT OR IGNORE INTO locks (name, holder, acquired_at, expires_at) VALUES (?, NULL, NULL, 0)').run(LOCK);
  const r = db.prepare('UPDATE locks SET holder = ?, acquired_at = ?, expires_at = ? WHERE name = ? AND (expires_at < ? OR holder IS NULL)').run(holder, now, now + lease, LOCK, now);
  return r.changes === 1;
}
export function renewLock(db, holder, now = Date.now()) {
  db.prepare('UPDATE locks SET expires_at = ? WHERE name = ? AND holder = ?').run(now + LEASE_MS, LOCK, holder);
}
export function releaseLock(db, holder) {
  db.prepare('UPDATE locks SET holder = NULL, expires_at = 0 WHERE name = ? AND holder = ?').run(LOCK, holder);
}
export function lockInfo(db, now = Date.now()) {
  const r = db.prepare('SELECT holder, acquired_at, expires_at FROM locks WHERE name = ?').get(LOCK);
  return r && r.holder && r.expires_at > now ? r : null;
}

export async function runUpdate(db, { kind = 'manual', slotIndex = null, plannedAt = null, slotKey = null, fetchImpl, enrich, now = () => Date.now() } = {}) {
  const holder = `${kind}:${randomUUID()}`;
  const startedAt = now();
  if (!acquireLock(db, holder, startedAt)) {
    const r = db.prepare("INSERT INTO runs (kind, slot_index, planned_at, started_at, finished_at, status, error) VALUES (?, ?, ?, ?, ?, 'skipped_locked', ?)").run(
      kind, slotIndex, plannedAt, startedAt, startedAt, 'تحديث آخر قيد التشغيل');
    return { status: 'skipped_locked', runId: Number(r.lastInsertRowid) };
  }
  const run = db.prepare("INSERT INTO runs (kind, slot_index, planned_at, started_at, status) VALUES (?, ?, ?, ?, 'running')").run(kind, slotIndex, plannedAt, startedAt);
  const runId = Number(run.lastInsertRowid);
  const heartbeat = setInterval(() => renewLock(db, holder), 60_000);
  heartbeat.unref?.();
  try {
    const ingest = await ingestAll(db, { runId, now: startedAt, fetchImpl });
    const ai = await enrichPending(db, { now: startedAt, ...(enrich ? { enrich } : {}) });
    let status;
    let bulletin = null;
    if (ingest.sources > 0 && ingest.sourcesOk === 0) {
      status = 'failed'; // keep the last good bulletin; never publish an empty one on fetch failure
    } else {
      const note = ingest.sourcesFailed ? `تعذر الوصول إلى ${ingest.sourcesFailed} من ${ingest.sources} مصادر في هذا التحديث.` : null;
      // Keyed by the slot's planned time, not its index: indexes restart when the schedule's
      // anchor changes, and an old "slot:1" bulletin must never swallow a new slot's bulletin.
      const key = slotKey || (plannedAt != null ? `slot-at:${plannedAt}` : `${kind}:${runId}`);
      const b = buildBulletin(db, { slotKey: key, runId, now: now(), note });
      bulletin = b.bulletin;
      status = bulletin.status === 'empty' ? 'no_news' : ingest.sourcesFailed ? 'partial' : 'success';
      setSetting(db, 'last_success_at', String(now()));
    }
    db.prepare('UPDATE runs SET finished_at = ?, status = ?, stats_json = ?, bulletin_id = ?, error = ? WHERE id = ?').run(
      now(), status, JSON.stringify({ ingest, ai }), bulletin?.id ?? null, status === 'failed' ? 'فشل الجلب من جميع المصادر' : null, runId);
    return { status, runId, bulletin, stats: { ingest, ai } };
  } catch (e) {
    db.prepare("UPDATE runs SET finished_at = ?, status = 'failed', error = ? WHERE id = ?").run(now(), String(e.stack || e).slice(0, 2000), runId);
    return { status: 'failed', runId, error: String(e.message || e) };
  } finally {
    clearInterval(heartbeat);
    releaseLock(db, holder);
  }
}

// After a crash/restart: runs left "running" were interrupted. The app runs as a single
// instance on one SQLite volume, so a lock held at boot belongs to a dead process.
export function recoverAfterRestart(db, now = Date.now()) {
  const r = db.prepare("UPDATE runs SET status = 'failed', finished_at = ?, error = 'انقطع التشغيل بسبب إعادة تشغيل الخادم' WHERE status = 'running'").run(now);
  db.prepare('UPDATE locks SET holder = NULL, expires_at = 0').run();
  return r.changes;
}

// ---- Scheduler (fixed interval from a persisted anchor) ----

export function getAnchor(db, now = Date.now()) {
  let a = getSetting(db, 'schedule_anchor');
  // A configured anchor/interval (e.g. fixed daily times: 07:00 every 12 h) replaces the stored
  // grid when it changes. Slot bookkeeping is reset and the current slot is marked done, so the
  // switch itself never starts an off-schedule run.
  const configured = config.scheduleAnchor ? Date.parse(config.scheduleAnchor) : NaN;
  const key = `${configured}|${config.intervalHours}`;
  if (Number.isFinite(configured) && getSetting(db, 'schedule_key') !== key) {
    a = String(configured);
    tx(db, () => {
      setSetting(db, 'schedule_anchor', a);
      setSetting(db, 'schedule_key', key);
      db.prepare('DELETE FROM schedule_slots').run();
      const k = slotIndexAt(configured, intervalMs(), now);
      if (k >= 0) db.prepare("INSERT INTO schedule_slots (slot_index, planned_at, status, attempts, updated_at) VALUES (?, ?, 'merged', 0, ?)").run(k, slotTime(configured, intervalMs(), k), now);
    });
  }
  if (!a) {
    const fromEnv = config.scheduleAnchor ? Date.parse(config.scheduleAnchor) : NaN;
    a = String(Number.isFinite(fromEnv) ? fromEnv : now);
    setSetting(db, 'schedule_anchor', a);
  }
  return Number(a);
}
export const intervalMs = () => config.intervalHours * 3600_000;

export function lastDoneSlot(db) {
  const r = db.prepare("SELECT MAX(slot_index) k FROM schedule_slots WHERE status IN ('done', 'merged', 'failed')").get();
  return r.k ?? -1;
}

export function scheduleStatus(db, now = Date.now()) {
  const anchor = getAnchor(db, now);
  const plan = duePlan(anchor, intervalMs(), now, lastDoneSlot(db));
  const retry = db.prepare("SELECT slot_index, next_retry_at, attempts FROM schedule_slots WHERE status = 'retrying' ORDER BY slot_index DESC LIMIT 1").get();
  return { anchor, intervalHours: config.intervalHours, nextRunAt: retry ? retry.next_retry_at : plan.due ? now : plan.next, due: plan.due, retry: retry || null };
}

// Called every minute by the in-process timer, and by POST /api/cron for external schedulers.
// Safe to call any number of times: slot bookkeeping + lock make it idempotent.
export async function tick(db, { now = () => Date.now(), fetchImpl, enrich, trigger = 'scheduled' } = {}) {
  const t = now();
  if (lockInfo(db, t)) return { action: 'busy' };
  const anchor = getAnchor(db, t);
  const I = intervalMs();
  const retrying = db.prepare("SELECT * FROM schedule_slots WHERE status = 'retrying' ORDER BY slot_index DESC LIMIT 1").get();
  const plan = duePlan(anchor, I, t, lastDoneSlot(db));
  let slot;
  let attempts = 0;
  if (plan.due && (!retrying || plan.slot > retrying.slot_index)) {
    slot = plan.slot;
    // missed slots (server was down) are recorded as merged into this catch-up run
    tx(db, () => {
      for (const k of plan.missed) {
        db.prepare("INSERT OR IGNORE INTO schedule_slots (slot_index, planned_at, status, updated_at) VALUES (?, ?, 'merged', ?)").run(k, slotTime(anchor, I, k), t);
      }
      if (retrying) db.prepare("UPDATE schedule_slots SET status = 'merged', updated_at = ? WHERE slot_index = ?").run(t, retrying.slot_index);
    });
  } else if (retrying && retrying.next_retry_at <= t) {
    slot = retrying.slot_index;
    attempts = retrying.attempts;
  } else {
    return { action: 'idle', next: retrying ? retrying.next_retry_at : plan.next };
  }
  const kind = trigger === 'external' ? 'external' : plan.catchUp ? 'catchup' : 'scheduled';
  const res = await runUpdate(db, { kind, slotIndex: slot, plannedAt: slotTime(anchor, I, slot), fetchImpl, enrich, now });
  if (res.status === 'skipped_locked') return { action: 'busy' };
  attempts += 1;
  const ok = res.status !== 'failed';
  const status = ok ? 'done' : attempts >= 4 ? 'failed' : 'retrying';
  db.prepare(`INSERT INTO schedule_slots (slot_index, planned_at, status, run_id, attempts, next_retry_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slot_index) DO UPDATE SET status = excluded.status, run_id = excluded.run_id, attempts = excluded.attempts, next_retry_at = excluded.next_retry_at, updated_at = excluded.updated_at`).run(
    slot, slotTime(anchor, I, slot), status, res.runId, attempts, status === 'retrying' ? now() + retryDelayMs(attempts - 1) : null, now());
  return { action: 'ran', slot, status: res.status, runId: res.runId, catchUp: plan.catchUp && plan.slot === slot };
}

export function startScheduler(db) {
  let running = false;
  const loop = async () => {
    if (running) return;
    running = true;
    try {
      const r = await tick(db);
      if (r.action === 'ran') console.log(`[scheduler] slot ${r.slot}: ${r.status}`);
    } catch (e) {
      console.error('[scheduler] tick error', e);
    } finally {
      running = false;
    }
  };
  setTimeout(loop, 5_000);
  const timer = setInterval(loop, 60_000);
  return () => clearInterval(timer);
}
