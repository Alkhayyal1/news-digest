import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, parseSpaNextData, splitSpaPrefix } from '../src/core/feeds.js';
import { normalizeArabic, tokenize } from '../src/core/arabic.js';
import { analyzeCompany } from '../src/core/finance.js';
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

test('company analysis computes only what the disclosed data supports', () => {
  const base = { source_url: 'https://example.test/disclosure', shares_outstanding: 100 };
  const empty = analyzeCompany([], null);
  assert.equal(empty.latest, null);
  const a = analyzeCompany([
    { ...base, period: '2026-Q2', revenue: 1200, gross_profit: 400, operating_profit: 300, net_profit: 220, non_recurring: 20, total_debt: 500, cash: 200, equity: 1000, operating_cash_flow: 260, capex: -60, dps: 0.5 },
    { ...base, period: '2025-Q2', revenue: 1000, net_profit: 200, operating_profit: 250 },
    { ...base, period: '2026-Q1', revenue: 1100, net_profit: 210 },
  ], null);
  assert.equal(Math.round(a.metrics.revenue_yoy_pct), 20);
  assert.equal(Math.round(a.metrics.net_profit_qoq_pct * 10) / 10, 4.8);
  assert.equal(a.metrics.recurring_net_profit, 200);
  assert.equal(a.metrics.free_cash_flow, 200);
  assert.equal(a.metrics.net_debt, 300);
  assert.equal(a.valuation.pe_ttm, null, 'no valuation without a dated price');
  assert.ok(a.notes.some((n) => n.includes('سعر')));
  assert.ok(a.notes.some((n) => n.includes('أربعة أرباع')));
  const withPrice = analyzeCompany([
    { ...base, period: '2026-Q2', net_profit: 25 }, { ...base, period: '2026-Q1', net_profit: 25 }, { ...base, period: '2025-Q4', net_profit: 25 }, { ...base, period: '2025-Q3', net_profit: 25 },
  ], { price: 20, as_of: '2026-10-20', source_url: 'https://example.test/price' });
  assert.equal(withPrice.valuation.market_cap, 2000);
  assert.equal(withPrice.valuation.pe_ttm, 20);
});
