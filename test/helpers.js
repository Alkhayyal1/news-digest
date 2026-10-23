// Test helpers. All feed content here is synthetic TEST DATA, used only inside tests.
import { openDb } from '../src/db.js';
import { config } from '../src/config.js';

config.anthropicApiKey = ''; // tests never call the real AI service
export const H = 3600_000;

export function freshDb(path = ':memory:') {
  const db = openDb(path);
  // isolate tests from the seeded real source list: disable all, add test sources
  db.prepare('UPDATE sources SET enabled = 0').run();
  return db;
}

export function addSource(db, key, { url = `https://${key}.test/feed.xml`, scope = 'auto', official = 0, hint = null, type = 'rss' } = {}) {
  const host = new URL(url).hostname;
  db.prepare(`INSERT INTO sources (key, name, url, type, language, default_scope, section_hint, is_official, enabled, allowed_hosts, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'ar', ?, ?, ?, 1, ?, 0, 0)`).run(key, `مصدر ${key}`, url, type, scope, hint, official, JSON.stringify([host]));
  return db.prepare('SELECT * FROM sources WHERE key = ?').get(key);
}

const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
export function rss(items) {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>test</title>${items.map((i) => `<item>
    <title><![CDATA[${i.title}]]></title><link>${x(i.link)}</link><guid>${x(i.guid || i.link)}</guid>
    ${i.published ? `<pubDate>${new Date(i.published).toUTCString()}</pubDate>` : ''}
    <description><![CDATA[${i.summary || ''}]]></description>${(i.categories || []).map((c) => `<category>${x(c)}</category>`).join('')}</item>`).join('')}</channel></rss>`;
}

// fetchImpl backed by a map of url -> body | Error | {status}; supports a delay to test overlap.
export function fakeFetch(routes, { delayMs = 0 } = {}) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const r = typeof routes === 'function' ? routes(url) : routes[url];
    if (r === undefined) return new Response('not found', { status: 404 });
    if (r instanceof Error) throw r;
    if (r && typeof r === 'object' && r.status) return new Response(r.body || '', { status: r.status, headers: r.headers || {} });
    return new Response(r, { status: 200, headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
  };
  fn.calls = calls;
  return fn;
}
