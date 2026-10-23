// Static site builder (GitHub Pages mode): copies the UI and writes every API response the UI
// needs as a JSON file under data/. Search runs in the browser over monthly index shards.
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTIONS } from '../core/lexicon.js';
import { indexText, normalizeArabic } from '../core/arabic.js';
import { getBulletin } from '../bulletin.js';
import { J } from '../db.js';
import { status, publicSources, eventDetail, companiesList, companyDetail, latestBulletin, bulletinList, adminOverview } from '../views.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC_FILES = ['index.html', 'admin.html', 'styles.css', 'app.js', 'admin.js', 'common.js', 'theme.js', 'favicon.svg', 'static-search.js'];
const EVENT_PAGES_DAYS = 120; // full event pages are published for recent events; older ones live in bulletins + search

const riyadhMonth = (ms) => new Date(ms + 3 * 3600_000).toISOString().slice(0, 7);

export function buildSite(db, outDir, { now = Date.now() } = {}) {
  rmSync(outDir, { recursive: true, force: true });
  const out = (rel, data) => {
    const p = join(outDir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data));
  };
  const stats = { files: 0, events: 0, bulletins: 0, shards: 0 };
  const count = () => stats.files++;

  // ---- UI ----
  for (const f of PUBLIC_FILES) {
    const src = join(ROOT, 'public', f);
    if (f.endsWith('.html')) out(f, readFileSync(src, 'utf8').replace('</head>', '  <meta name="static-mode" content="1">\n</head>'));
    else {
      mkdirSync(outDir, { recursive: true });
      copyFileSync(src, join(outDir, f));
    }
    count();
  }
  mkdirSync(join(outDir, 'core'), { recursive: true });
  copyFileSync(join(ROOT, 'src', 'core', 'arabic.js'), join(outDir, 'core', 'arabic.js'));
  out('.nojekyll', '');
  out('package.json', '{"type":"module"}\n'); // lets the copied ES modules also load under Node (tests)

  // ---- simple endpoints ----
  const repo = process.env.GITHUB_REPOSITORY;
  const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
  out('data/status.json', { ...status(db, now), static: true, builtAt: now, actionsUrl: repo ? `${server}/${repo}/actions/workflows/update.yml` : null, repoUrl: repo ? `${server}/${repo}` : null });
  out('data/sections.json', SECTIONS);
  out('data/sources.json', publicSources(db).map(({ key, name, enabled, is_official, health }) => ({ key, name, enabled, is_official, health })));
  out('data/companies.json', companiesList(db));
  for (const c of db.prepare('SELECT symbol FROM companies').all()) {
    out(`data/companies/${c.symbol}.json`, companyDetail(db, c.symbol));
    count();
  }
  out('data/admin.json', { ...adminOverview(db), configLog: J(db.prepare("SELECT value FROM settings WHERE key = 'config_log'").get()?.value) });
  stats.files += 6;

  // ---- bulletins ----
  out('data/bulletins/latest.json', latestBulletin(db));
  for (const b of db.prepare('SELECT id FROM bulletins').all()) {
    out(`data/bulletins/${b.id}.json`, getBulletin(db, b.id));
    stats.bulletins++;
  }
  for (const empty of [false, true]) {
    const first = bulletinList(db, 1, empty);
    for (let p = 1; p <= first.pages; p++) out(`data/bulletins/list-${empty ? 'all' : 'pub'}-${p}.json`, p === 1 ? first : bulletinList(db, p, empty));
  }

  // ---- events (recent full pages; merged ones become redirects) ----
  const recent = db.prepare('SELECT id, hidden, merged_into FROM events WHERE last_update_at >= ?').all(now - EVENT_PAGES_DAYS * 24 * 3600_000);
  for (const e of recent) {
    if (e.merged_into) out(`data/events/${e.id}.json`, { id: e.id, merged_into: e.merged_into });
    else if (!e.hidden) out(`data/events/${e.id}.json`, eventDetail(db, e.id));
    else continue;
    stats.events++;
  }

  // ---- search index, one shard per month (Riyadh time) ----
  const srcKeys = db.prepare('SELECT DISTINCT s.key FROM items i JOIN sources s ON s.id = i.source_id WHERE i.event_id = ? AND i.excluded = 0');
  const ents = db.prepare('SELECT label, symbol FROM event_entities WHERE event_id = ?');
  const upd = db.prepare('SELECT COUNT(*) n FROM event_updates WHERE event_id = ?');
  const shards = new Map();
  for (const e of db.prepare('SELECT id, title, summary, scope, section, content_type, tags_json, occurred_at, first_seen_at, last_update_at, ai_status FROM events WHERE hidden = 0').all()) {
    const keys = srcKeys.all(e.id).map((r) => r.key);
    const en = ents.all(e.id);
    const tags = J(e.tags_json, []);
    const uniq = (s) => [...new Set(s.split(' ').filter(Boolean))].join(' ');
    const entry = {
      id: e.id,
      t: e.title,
      s: e.summary ? String(e.summary).slice(0, 140) : '',
      sc: e.scope,
      se: e.section,
      ty: e.content_type,
      src: keys,
      co: en.filter((x) => x.symbol).map((x) => x.symbol),
      o: e.occurred_at,
      f: e.first_seen_at,
      u: e.last_update_at,
      n: keys.length,
      uc: upd.get(e.id).n,
      ai: e.ai_status,
      kt: uniq(indexText(e.title)),
      kb: uniq(indexText(String(e.summary || '').slice(0, 300), tags.join(' '), en.map((x) => `${x.label} ${x.symbol || ''}`).join(' '), normalizeArabic(keys.join(' ')))),
    };
    const m = riyadhMonth(e.occurred_at ?? e.first_seen_at);
    if (!shards.has(m)) shards.set(m, []);
    shards.get(m).push(entry);
  }
  const manifest = [...shards.keys()].sort().reverse().map((m) => ({ month: m, count: shards.get(m).length }));
  for (const [m, list] of shards) out(`data/search/${m}.json`, list);
  out('data/search/manifest.json', manifest);
  stats.shards = shards.size;
  return stats;
}
