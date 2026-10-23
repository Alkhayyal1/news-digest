import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, addSource, rss, fakeFetch, H } from './helpers.js';
import { runUpdate } from '../src/runner.js';
import { processItem } from '../src/ingest.js';
import { enrichPending } from '../src/enrich.js';
import { validate, unsupportedNumbers } from '../src/ai.js';
import { config } from '../src/config.js';
import { searchEvents } from '../src/search.js';
import { buildBulletin, getBulletin } from '../src/bulletin.js';
import { sportsCheck, classify } from '../src/core/classify.js';

const NOW = Date.parse('2026-10-22T12:00:00+03:00');

test('a broken source is logged and the run continues with the others', async () => {
  const db = freshDb();
  addSource(db, 'good', { url: 'https://good.test/feed' });
  addSource(db, 'down', { url: 'https://down.test/feed' });
  addSource(db, 'html', { url: 'https://html.test/feed' });
  const fetchImpl = fakeFetch({
    'https://good.test/feed': rss([{ title: 'هيئة السوق المالية تعتمد قواعد جديدة للإدراج', link: 'https://good.test/a/1', published: NOW - H, summary: 'اعتمدت هيئة السوق المالية قواعد جديدة.' }]),
    'https://down.test/feed': { status: 503 },
    'https://html.test/feed': { status: 403, body: 'Forbidden' },
  });
  const r = await runUpdate(db, { kind: 'manual', fetchImpl, now: () => NOW });
  assert.equal(r.status, 'partial');
  assert.equal(r.stats.ingest.sourcesOk, 1);
  assert.equal(r.stats.ingest.sourcesFailed, 2);
  const down = db.prepare("SELECT last_error, consecutive_failures FROM sources WHERE key = 'down'").get();
  assert.match(down.last_error, /503/);
  assert.equal(down.consecutive_failures, 1);
  assert.match(r.bulletin.note, /2 من 3/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM fetch_logs WHERE ok = 0').get().n, 2);
});

test('summarization service failure falls back to explicit limited mode without invented content', async () => {
  const db = freshDb();
  const a = addSource(db, 'a');
  config.anthropicApiKey = 'test-key-not-real';
  try {
    processItem(db, a, { title: 'Federal Reserve holds interest rates steady', summary: 'The Federal Reserve left its benchmark rate unchanged at its meeting.', link: 'https://a.test/fed/1', publishedAt: NOW - H }, { now: NOW });
    const failing = async () => {
      throw new Error('503 overloaded');
    };
    const st = await enrichPending(db, { now: NOW, enrich: failing });
    assert.equal(st.failed, 1);
    const e = db.prepare('SELECT title, why, ai_status FROM events').get();
    assert.equal(e.ai_status, 'failed');
    assert.equal(e.why, null, 'no generated "why it matters" without the service');
    assert.equal(e.title, 'Federal Reserve holds interest rates steady', 'original title kept, flagged in UI');

    // AI output with an invented number is rejected field-by-field
    const ok = async (batch) => ({
      model: 'test',
      results: new Map(batch.map((ev) => [ev.id, validate({ title_ar: 'الاحتياطي الفيدرالي يثبت أسعار الفائدة', summary_ar: 'أبقى الاحتياطي الفيدرالي سعر الفائدة عند 4.5% وفق بيانه.', why_ar: 'قد يؤثر القرار على تكلفة الاقتراض.', section: 'w_economy', content_type: 'news', tags: ['الفائدة'], verification: 'single_source', research_note: 'none', facts: ['أبقى البنك سعر الفائدة دون تغيير'] }, ev)])),
    });
    db.prepare("UPDATE events SET ai_status = 'pending'").run();
    const st2 = await enrichPending(db, { now: NOW, enrich: ok });
    assert.equal(st2.failed, 1, 'summary contained 4.5% which is not in the evidence -> rejected');
    assert.deepEqual(unsupportedNumbers('ارتفع 3.2% إلى 25 مليار', 'rose 3.2% to $25 billion'), []);
    assert.deepEqual(unsupportedNumbers('ارتفع 7.5%', 'rose 3.2%'), ['7.5%']);
  } finally {
    config.anthropicApiKey = '';
  }
});

test('sports content is excluded; purely financial sports-business news is kept as economy', () => {
  assert.equal(sportsCheck({ title: 'الهلال يفوز على النصر في دوري روشن', summary: 'حقق الهلال فوزًا مثيرًا في المباراة.' }).excluded, true);
  assert.equal(sportsCheck({ title: 'انتقال اللاعب إلى النادي بصفقة 100 مليون ريال', summary: 'وقع اللاعب عقدًا مع النادي في سوق الانتقالات.' }).excluded, true);
  assert.equal(sportsCheck({ title: 'Real Madrid beat Barcelona in La Liga', summary: 'The striker scored twice in the football match.' }).excluded, true);
  const biz = sportsCheck({ title: 'صندوق الاستثمارات العامة يستحوذ على حصة في نادي الهلال ضمن مشروع الخصخصة', summary: 'تشمل الصفقة استثمارات بقيمة مليار ريال وطرح حصص للاستثمار في النادي.' });
  assert.equal(biz.excluded, false);
  assert.equal(biz.sportsFinance, true);
  const c = classify({ title: 'صندوق الاستثمارات العامة يستحوذ على حصة في نادي الهلال ضمن مشروع الخصخصة', summary: 'تشمل الصفقة استثمارات بقيمة مليار ريال وطرح حصص للاستثمار في النادي السعودي.' });
  assert.equal(c.section, 'sa_economy');
  // "الهلال الأحمر" (Red Crescent) is not sports
  assert.equal(sportsCheck({ title: 'الهلال الأحمر يباشر حادثًا مروريًا في الرياض', summary: 'باشرت فرق الهلال الأحمر السعودي الحادث.' }).excluded, false);
  // the excluded item is stored for audit but never becomes an event
  const db = freshDb();
  const a = addSource(db, 'a');
  const r = processItem(db, a, { title: 'الهلال يفوز على النصر في دوري روشن', summary: 'حقق الهلال فوزًا في المباراة.', link: 'https://a.test/s/1', publishedAt: NOW }, { now: NOW });
  assert.equal(r.excluded, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM events').get().n, 0);
});

test('Arabic search with spelling variants, filters, and retrieval of old bulletins', () => {
  const db = freshDb();
  const a = addSource(db, 'a', { scope: 'saudi' });
  const b = addSource(db, 'b', { scope: 'world' });
  processItem(db, a, { title: 'أرامكو السعودية تعلن توزيعات أرباح للربع الثالث', summary: 'أعلنت شركة أرامكو السعودية توزيعات نقدية على المساهمين.', link: 'https://a.test/1', publishedAt: NOW - 30 * 24 * H }, { now: NOW - 30 * 24 * H + H });
  const old = buildBulletin(db, { slotKey: 'old', now: NOW - 30 * 24 * H + 2 * H });
  processItem(db, b, { title: 'منظمة الصحة العالمية تحذر من انتشار الإنفلونزا', summary: 'حذرت منظمة الصحة العالمية من موسم إنفلونزا شديد.', link: 'https://b.test/2', publishedAt: NOW - H }, { now: NOW });
  processItem(db, a, { title: 'وزارة الصحة تطلق حملة التطعيم ضد الانفلونزا في المملكة', summary: 'أطلقت وزارة الصحة السعودية حملة تطعيم موسمية.', link: 'https://a.test/3', publishedAt: NOW - 2 * H }, { now: NOW });

  // hamza / taa marbuta / "ال" variants
  assert.equal(searchEvents(db, { q: 'ارامكو' }).total, 1);
  assert.equal(searchEvents(db, { q: 'توزيعات الارباح' }).total, 1);
  assert.equal(searchEvents(db, { q: 'الإنفلونزا' }).total, 2);
  assert.equal(searchEvents(db, { q: 'انفلونزا', scope: 'saudi' }).total, 1);
  assert.equal(searchEvents(db, { q: 'انفلونزا', scope: 'world' }).total, 1);
  assert.equal(searchEvents(db, { q: '2222' }).total, 1, 'search by ticker symbol');
  assert.equal(searchEvents(db, { source: 'b' }).total, 1);
  assert.equal(searchEvents(db, { from: NOW - 3 * H, to: NOW }).total, 2, 'date filter');
  const latest = searchEvents(db, { q: 'الصحة', sort: 'latest' });
  assert.ok(latest.results.length >= 1);
  // the month-old bulletin is still retrievable exactly as published
  const ob = getBulletin(db, old.bulletin.id);
  assert.equal(ob.items.length, 1);
  assert.match(ob.items[0].snapshot.title, /أرامكو/);
});
