import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { freshDb, addSource, H } from './helpers.js';
import { processItem } from '../src/ingest.js';
import { buildBulletin } from '../src/bulletin.js';
import { buildSite } from '../src/static/build.js';
import { applyOverrides, applyFinancials } from '../src/config-files.js';

const NOW = Date.parse('2026-10-22T12:00:00+03:00');

test('static build writes every file the UI needs, and in-browser search works on it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nd-site-'));
  try {
    const db = freshDb();
    const a = addSource(db, 'a', { scope: 'saudi' });
    const b = addSource(db, 'b', { scope: 'world' });
    const r1 = processItem(db, a, { title: 'أرامكو السعودية تعلن توزيعات أرباح للربع الثالث', summary: 'أعلنت أرامكو السعودية توزيعات نقدية.', link: 'https://a.test/1', publishedAt: NOW - H }, { now: NOW });
    processItem(db, b, { title: 'منظمة الصحة العالمية تحذر من انتشار الإنفلونزا', summary: 'حذرت المنظمة من موسم إنفلونزا شديد.', link: 'https://b.test/2', publishedAt: NOW - 2 * H }, { now: NOW });
    const { bulletin } = buildBulletin(db, { slotKey: 's1', now: NOW + H });
    const out = join(dir, 'site');
    const stats = buildSite(db, out, { now: NOW + H });
    for (const f of ['index.html', 'app.js', 'common.js', 'static-search.js', 'core/arabic.js', '.nojekyll', 'data/status.json', 'data/sections.json', 'data/bulletins/latest.json',
      `data/bulletins/${bulletin.id}.json`, 'data/bulletins/list-pub-1.json', 'data/bulletins/list-all-1.json', `data/events/${r1.eventId}.json`, 'data/companies.json', 'data/companies/2222.json', 'data/search/manifest.json', 'data/admin.json']) {
      assert.ok(existsSync(join(out, f)), `missing ${f}`);
    }
    assert.match(readFileSync(join(out, 'index.html'), 'utf8'), /name="static-mode"/);
    assert.equal(stats.events, 2);
    const status = JSON.parse(readFileSync(join(out, 'data/status.json'), 'utf8'));
    assert.equal(status.static, true);
    const admin = readFileSync(join(out, 'data/admin.json'), 'utf8');
    assert.doesNotMatch(admin, /ANTHROPIC|ADMIN_PASSWORD|SESSION_SECRET/);

    // run the browser search module against the built files
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const p = join(out, String(url));
      return existsSync(p) ? new Response(readFileSync(p)) : new Response('', { status: 404 });
    };
    try {
      const { searchStatic } = await import(pathToFileURL(join(out, 'static-search.js')).href);
      assert.equal((await searchStatic({ q: 'ارامكو' })).total, 1);
      assert.equal((await searchStatic({ q: 'الإنفلونزا', scope: 'world' })).total, 1);
      assert.equal((await searchStatic({ company: '2222' })).total, 1);
      assert.equal((await searchStatic({ q: 'توزيعات الارباح' })).results[0].id, r1.eventId);
      assert.equal((await searchStatic({ q: 'كلمةغيرموجودة' })).total, 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repository config files: overrides apply once, financials need a source link', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nd-cfg-'));
  try {
    const db = freshDb();
    const [a, b] = ['a', 'b'].map((k) => addSource(db, k));
    const e1 = processItem(db, a, { title: 'مجلس الوزراء يوافق على نظام الاستثمار الجديد', summary: 'وافق مجلس الوزراء على نظام الاستثمار الجديد لتحسين بيئة الأعمال.', link: 'https://a.test/1', publishedAt: NOW }, { now: NOW });
    const e2 = processItem(db, b, { title: 'افتتاح مركز ثقافي جديد في جدة', summary: 'افتتح مركز ثقافي جديد.', link: 'https://b.test/2', publishedAt: NOW }, { now: NOW });
    const ov = join(dir, 'overrides.json');
    writeFileSync(ov, JSON.stringify({ merge: [[e1.eventId, e2.eventId]], hide: [] }));
    applyOverrides(db, ov, NOW);
    assert.equal(db.prepare('SELECT merged_into FROM events WHERE id = ?').get(e2.eventId).merged_into, e1.eventId);
    const log2 = applyOverrides(db, ov, NOW);
    assert.equal(log2.length, 0, 'already-applied operations are not repeated');

    const fin = join(dir, 'financials.json');
    writeFileSync(fin, JSON.stringify({ reports: [
      { symbol: '2222', period: '2026-Q2', net_profit: 100, source_url: 'https://example.test/disclosure' },
      { symbol: '2222', period: '2026-Q1', net_profit: 90 },
    ], prices: [{ symbol: '2222', price: 25, as_of: '2026-10-20' }] }));
    const log = applyFinancials(db, fin, NOW);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM financial_reports').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM prices').get().n, 0);
    assert.equal(log.length, 2, 'rejected rows are reported');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
