import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, addSource, H } from './helpers.js';
import { processItem } from '../src/ingest.js';
import { canonicalizeUrl, urlKey } from '../src/core/url.js';
import { buildBulletin } from '../src/bulletin.js';

const T0 = Date.parse('2026-10-22T09:00:00+03:00');

test('same link with different tracking formats is imported once', () => {
  const db = freshDb();
  const a = addSource(db, 'a', { url: 'https://www.a-news.test/rss' });
  const variants = [
    'https://www.a-news.test/news/2026/10/22/budget-123?utm_source=twitter&utm_medium=social',
    'http://a-news.test/news/2026/10/22/budget-123/?fbclid=XYZ#comments',
    'https://m.a-news.test/news/2026/10/22/budget-123?gclid=1&utm_campaign=x',
    'https://www.a-news.test/news/2026/10/22/budget-123/amp',
  ];
  const keys = new Set(variants.map((v) => urlKey(v)));
  assert.equal(keys.size, 1, 'all variants map to one dedup key');
  assert.equal(canonicalizeUrl(variants[0]), 'https://www.a-news.test/news/2026/10/22/budget-123');
  let inserted = 0;
  variants.forEach((link, i) => {
    const r = processItem(db, a, { title: 'وزارة المالية تعلن الميزانية العامة للدولة', link, guid: `g-${i}`, summary: 'أعلنت وزارة المالية تفاصيل الميزانية.', publishedAt: T0 }, { now: T0 + H });
    if (r.inserted) inserted++;
  });
  assert.equal(inserted, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM items').get().n, 1);
  // identity params are preserved
  assert.notEqual(urlKey('https://x.test/article?id=1'), urlKey('https://x.test/article?id=2'));
});

test('one story with different headlines from several sources becomes one event', () => {
  const db = freshDb();
  const [a, b, c] = ['a', 'b', 'c'].map((k) => addSource(db, k));
  const stories = [
    [a, 'مجلس الوزراء يوافق على نظام الاستثمار الجديد', 'وافق مجلس الوزراء في جلسته اليوم برئاسة ولي العهد على نظام الاستثمار الجديد الذي يهدف إلى تحسين بيئة الأعمال وجذب الاستثمارات الأجنبية.'],
    [b, 'السعودية: إقرار نظام جديد للاستثمار في جلسة مجلس الوزراء', 'أقر مجلس الوزراء السعودي خلال جلسته برئاسة ولي العهد نظام الاستثمار الجديد بهدف تحسين بيئة الأعمال وجذب الاستثمار الأجنبي.'],
    [c, 'ولي العهد يرأس جلسة مجلس الوزراء والموافقة على نظام الاستثمار', 'ترأس ولي العهد جلسة مجلس الوزراء التي شهدت الموافقة على نظام الاستثمار الجديد لتحسين بيئة الأعمال.'],
  ];
  const ids = stories.map(([s, title, summary], i) => processItem(db, s, { title, summary, link: `https://${s.key}.test/n/${i + 1}`, publishedAt: T0 + i * 20 * 60_000 }, { now: T0 + H }).eventId);
  assert.equal(new Set(ids).size, 1, `expected one event, got ${ids}`);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM events').get().n, 1);
  const log = db.prepare("SELECT relation, score, reason FROM merge_log WHERE relation = 'same'").all();
  assert.equal(log.length, 2);
  for (const l of log) assert.ok(l.score > 0 && l.reason, 'merge reason and score are stored');
  const ev = db.prepare('SELECT verification FROM events').get();
  assert.equal(ev.verification, 'multi_source');
});

test('old article re-published (identical text, new URL/date) does not come back as new', () => {
  const db = freshDb();
  const [a, b] = ['a', 'b'].map((k) => addSource(db, k));
  const title = 'هيئة الإحصاء: التضخم في المملكة يسجل 2.1% خلال سبتمبر';
  const summary = 'أظهرت بيانات الهيئة العامة للإحصاء أن معدل التضخم السنوي في المملكة بلغ 2.1% في سبتمبر مدفوعًا بارتفاع أسعار السكن.';
  const first = processItem(db, a, { title, summary, link: 'https://a.test/x/1', publishedAt: T0 }, { now: T0 + H });
  const b1 = buildBulletin(db, { slotKey: 's1', now: T0 + 2 * H });
  assert.equal(b1.bulletin.event_count, 1);
  // three days later another source republishes the same text with a fresh date
  const later = T0 + 72 * H;
  const again = processItem(db, b, { title, summary, link: 'https://b.test/y/99', publishedAt: later }, { now: later });
  assert.equal(again.relation, 'repost');
  assert.equal(again.eventId, first.eventId);
  const b2 = buildBulletin(db, { slotKey: 's2', now: later + H });
  assert.equal(b2.bulletin.status, 'empty', 'no recycled news in the next bulletin');
  // an article first seen now but published long ago is archived as stale, never "new"
  const stale = processItem(db, b, { title: 'افتتاح مركز ثقافي جديد في جدة', summary: 'تم افتتاح مركز ثقافي.', link: 'https://b.test/old/5', publishedAt: later - 10 * 24 * H }, { now: later + 2 * H });
  assert.equal(stale.stale, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM events').get().n, 1);
});

test('substantive development becomes a linked update, not a new event or a silent merge', () => {
  const db = freshDb();
  const [a, b] = ['a', 'b'].map((k) => addSource(db, k));
  const e1 = processItem(db, a, {
    title: 'وزارة البلديات والإسكان تطلق مشروع إسكان شمال الرياض بقيمة 5 مليارات ريال',
    summary: 'أطلقت وزارة البلديات والإسكان مشروع إسكان شمال الرياض بقيمة 5 مليارات ريال لتوفير وحدات سكنية.',
    link: 'https://a.test/h/1', publishedAt: T0,
  }, { now: T0 + H });
  buildBulletin(db, { slotKey: 's1', now: T0 + 2 * H });
  const e2 = processItem(db, b, {
    title: 'رفع قيمة مشروع إسكان شمال الرياض إلى 7 مليارات ريال',
    summary: 'أعلنت وزارة البلديات والإسكان رفع قيمة مشروع إسكان شمال الرياض إلى 7 مليارات ريال بعد اعتماد مرحلة ثانية من الوحدات السكنية.',
    link: 'https://b.test/h/2', publishedAt: T0 + 10 * H,
  }, { now: T0 + 11 * H });
  assert.equal(e2.eventId, e1.eventId, 'linked to the same event');
  assert.equal(e2.relation, 'update');
  const u = db.prepare('SELECT changed FROM event_updates WHERE event_id = ?').get(e1.eventId);
  assert.match(u.changed, /7/);
  const b2 = buildBulletin(db, { slotKey: 's2', now: T0 + 12 * H });
  assert.equal(b2.bulletin.event_count, 1);
  assert.equal(db.prepare('SELECT kind FROM bulletin_items WHERE bulletin_id = ?').get(b2.bulletin.id).kind, 'update');

  // a mere extra source / rewording later on is NOT a reason to republish
  processItem(db, a, {
    title: 'مشروع إسكان شمال الرياض بقيمة 7 مليارات ريال',
    summary: 'رفع قيمة مشروع إسكان شمال الرياض إلى 7 مليارات ريال وفق وزارة البلديات والإسكان.',
    link: 'https://a.test/h/3', publishedAt: T0 + 13 * H,
  }, { now: T0 + 13.5 * H });
  const b3 = buildBulletin(db, { slotKey: 's3', now: T0 + 19 * H });
  assert.equal(b3.bulletin.status, 'empty');
});

test('two different events about the same company are not merged', () => {
  const db = freshDb();
  const [a, b] = ['a', 'b'].map((k) => addSource(db, k));
  const r1 = processItem(db, a, { title: 'أرامكو تعلن نتائج الربع الثالث وصافي الربح 25 مليار ريال', summary: 'أعلنت أرامكو السعودية نتائجها المالية للربع الثالث وبلغ صافي الربح 25 مليار ريال.', link: 'https://a.test/c/1', publishedAt: T0 }, { now: T0 + H });
  const r2 = processItem(db, b, { title: 'أرامكو توقع اتفاقية لتطوير حقل غاز الجافورة مع شركة دولية', summary: 'وقعت أرامكو اتفاقية مع شركة دولية لتطوير مرافق في حقل الجافورة للغاز غير التقليدي.', link: 'https://b.test/c/2', publishedAt: T0 + 2 * H }, { now: T0 + 3 * H });
  assert.notEqual(r1.eventId, r2.eventId);
  const ents = db.prepare("SELECT COUNT(*) n FROM event_entities WHERE symbol = '2222'").get().n;
  assert.equal(ents, 2, 'both events are linked to the company');
  // same template, different companies (quarterly results season)
  const r3 = processItem(db, a, { title: 'مصرف الراجحي: صافي الربح 5 مليارات ريال في الربع الثالث', summary: 'أعلن مصرف الراجحي ارتفاع صافي الربح للربع الثالث إلى 5 مليارات ريال.', link: 'https://a.test/c/3', publishedAt: T0 + 4 * H }, { now: T0 + 5 * H });
  const r4 = processItem(db, b, { title: 'البنك الأهلي السعودي: صافي الربح 6 مليارات ريال في الربع الثالث', summary: 'أعلن البنك الأهلي السعودي ارتفاع صافي الربح للربع الثالث إلى 6 مليارات ريال.', link: 'https://b.test/c/4', publishedAt: T0 + 4.5 * H }, { now: T0 + 5 * H });
  assert.notEqual(r3.eventId, r4.eventId, 'different banks must not merge');
  // near-identical headlines, different actors: separate statements
  const r5 = processItem(db, a, { title: 'مصر تدين استهداف مطار الملك فهد الدولي في السعودية', summary: 'أدانت مصر بشدة استهداف مطار الملك فهد الدولي بالدمام.', link: 'https://a.test/d/5', publishedAt: T0 + 6 * H }, { now: T0 + 7 * H });
  const r6 = processItem(db, b, { title: 'قطر تدين استهداف مطار الملك فهد الدولي في السعودية', summary: 'أدانت قطر بشدة استهداف مطار الملك فهد الدولي بالدمام.', link: 'https://b.test/d/6', publishedAt: T0 + 6.5 * H }, { now: T0 + 7 * H });
  assert.notEqual(r5.eventId, r6.eventId, 'different countries’ statements must not merge');
  const rev = db.prepare('SELECT reason FROM review_candidates WHERE event_id = ?').get(r6.eventId);
  assert.ok(rev, 'the near-duplicate pair is queued for admin review');
});
