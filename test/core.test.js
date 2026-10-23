import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, parseSpaNextData, splitSpaPrefix } from '../src/core/feeds.js';
import { normalizeArabic, tokenize } from '../src/core/arabic.js';
import { classify } from '../src/core/classify.js';
import { SECTIONS } from '../src/core/lexicon.js';
import { extractNumbers, stripHtml } from '../src/core/text.js';
import { isDirectArticleUrl } from '../src/core/url.js';

test('RSS, Atom and SPA page parsing', () => {
  const r = parseFeed(`<rss><channel><item><title><![CDATA[عنوان &amp; تجربة]]></title><link>https://x.test/a/1?utm_source=rss</link>
    <pubDate>Fri, 23 Oct 2026 00:03:14 +0300</pubDate><description><![CDATA[<p>نص <b>عريض</b></p><script>alert(1)</script>]]></description><category>اقتصاد</category></item></channel></rss>`);
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'عنوان & تجربة');
  assert.equal(r[0].summary, 'نص عريض');
  assert.equal(r[0].publishedAt, Date.parse('2026-10-22T21:03:14Z'));
  assert.deepEqual(r[0].categories, ['اقتصاد']);
  const atom = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom title</title><link rel="alternate" href="https://y.test/p/2"/><id>tag:y,2</id><updated>2026-10-22T10:00:00Z</updated><summary>s</summary></entry></feed>`);
  assert.equal(atom[0].link, 'https://y.test/p/2');
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { mainNews: [{ uuid: 'N2700001', locale: 'ar', title: 'اقتصادي / إطلاق برنامج', published_at: 1792671747, content: null }, { uuid: 'N2700002', locale: 'en', title: 'x', published_at: 1792671747 }] } } })}</script>`;
  const spa = parseSpaNextData(html);
  assert.equal(spa.length, 1);
  assert.equal(spa[0].link, 'https://www.spa.gov.sa/N2700001');
  assert.equal(spa[0].publishedAt, 1792671747000);
  assert.deepEqual(splitSpaPrefix(spa[0].title), { prefix: 'اقتصادي', title: 'إطلاق برنامج' });
  assert.equal(stripHtml('a‮b'), 'ab', 'bidi override characters are removed');
});

test('Arabic normalization is for matching only', () => {
  assert.equal(normalizeArabic('إِنَّ الأُمَّةَ ـــ مُؤسَّسة'), 'ان الامه موسسه');
  assert.equal(normalizeArabic('٢٠٢٦ و ١٫٥'), '2026 و 1.5');
  const [t1, t2] = tokenize('السعودية والسعودية');
  assert.equal(t1, t2, 'clitic prefixes collapse to the same token');
});

test('numbers and direct links', () => {
  assert.deepEqual(extractNumbers('بقيمة ٥ مليارات ريال ونمو 3.5% في 2026').sort(), ['3.5%', '5bn'].sort());
  assert.equal(isDirectArticleUrl('https://www.okaz.com.sa/'), false);
  assert.equal(isDirectArticleUrl('https://x.test/search?q=oil'), false);
  assert.equal(isDirectArticleUrl('https://www.spa.gov.sa/N2707791'), true);
});

test('stock-market sections are gone; market news is classified as Saudi economy', () => {
  assert.ok(!SECTIONS.some((s) => s.key === 'sa_market' || s.key === 'sa_companies'));
  const c = classify({ title: 'مؤشر تاسي يرتفع 50 نقطة بسيولة 6 مليارات ريال', summary: 'ارتفع مؤشر السوق الرئيسية في تداول السعودية بدعم من أسهم البنوك.' });
  assert.equal(c.scope, 'saudi');
  assert.equal(c.section, 'sa_economy');
  const r = classify({ title: 'أرامكو السعودية تعلن صافي الربح للربع الثالث', summary: 'أعلنت أرامكو النتائج المالية للربع الثالث.' });
  assert.equal(r.section, 'sa_economy');
});