// Boots the real backend in the browser against local copies of real feeds (dev/.fixtures,
// downloaded with curl). Used to check parsing/classification/dedup on real data and to preview
// the UI without Node. DEV ONLY.
import { files } from '/dev/harness/shims.js';

export async function boot({ engine = 'fts5' } = {}) {
  globalThis.__SQL = await initSqlJs({ locateFile: (f) => globalThis.__SQLJS + f });
  files.set('/migrations/001_init.sql', '/migrations/002_remove_stock_sections.sql', await (await fetch('/migrations/001_init.sql')).text());
  const map = await (await fetch('/dev/.fixtures/map.json')).json();
  const fetchImpl = async (url) => {
    const f = map[url];
    if (!f) return new Response('not found', { status: 404 });
    const r = await fetch('/dev/.fixtures/' + f);
    return new Response(await r.arrayBuffer(), { status: 200, headers: { 'content-type': url.includes('spa.gov.sa') ? 'text/html; charset=utf-8' : 'application/xml; charset=utf-8' } });
  };
  const { openDb } = await import('/src/db.js');
  const { runUpdate } = await import('/src/runner.js');
  const db = openDb(':memory:');
  return { db, fetchImpl, runUpdate };
}
