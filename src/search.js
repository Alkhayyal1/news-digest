// Arabic search over unified events (never raw per-source copies).
import { normalizeArabic, lightStem } from './core/arabic.js';
import { J } from './db.js';

export function buildFtsQuery(q, mode = 'AND') {
  const words = normalizeArabic(q).split(' ').filter((w) => w.length >= 2 || /\d/.test(w)).slice(0, 8);
  if (!words.length) return null;
  const parts = words.map((w) => {
    const st = lightStem(w);
    const a = `"${w.replace(/"/g, '')}"*`;
    return st && st !== w && st.length >= 2 ? `(${a} OR "${st.replace(/"/g, '')}"*)` : a;
  });
  return parts.join(` ${mode} `);
}

// filters: { q, from, to (epoch ms), scope, section, source (key), company (symbol), type, sort: 'relevance'|'latest', page }
export function searchEvents(db, f = {}) {
  const where = ['e.hidden = 0'];
  const params = [];
  if (f.from) { where.push('COALESCE(e.occurred_at, e.first_seen_at) >= ?'); params.push(+f.from); }
  if (f.to) { where.push('COALESCE(e.occurred_at, e.first_seen_at) <= ?'); params.push(+f.to); }
  if (f.scope === 'saudi' || f.scope === 'world') { where.push('e.scope = ?'); params.push(f.scope); }
  if (f.section) { where.push('e.section = ?'); params.push(String(f.section)); }
  if (f.type) {
    if (f.type === 'update') where.push('EXISTS (SELECT 1 FROM event_updates u WHERE u.event_id = e.id)');
    else { where.push('e.content_type = ?'); params.push(String(f.type)); }
  }
  if (f.source) { where.push('EXISTS (SELECT 1 FROM items i JOIN sources s ON s.id = i.source_id WHERE i.event_id = e.id AND s.key = ?)'); params.push(String(f.source)); }
  if (f.company) { where.push('EXISTS (SELECT 1 FROM event_entities x WHERE x.event_id = e.id AND x.symbol = ?)'); params.push(String(f.company)); }
  const limit = 20;
  const offset = Math.max(0, (parseInt(f.page, 10) || 1) - 1) * limit;
  const sortLatest = f.sort === 'latest' || !f.q;

  let rows = [];
  let total = 0;
  if (f.q && String(f.q).trim()) {
    for (const mode of ['AND', 'OR']) {
      const fq = buildFtsQuery(f.q, mode);
      if (!fq) break;
      if (db.hasFts) {
        const base = `FROM events_fts JOIN events e ON e.id = events_fts.event_id WHERE events_fts MATCH ? AND ${where.join(' AND ')}`;
        total = db.prepare(`SELECT COUNT(*) n ${base}`).get(fq, ...params).n;
        rows = db.prepare(`SELECT e.*, bm25(events_fts, 10.0, 3.0, 4.0, 6.0, 0.0) AS rank ${base} ORDER BY ${sortLatest ? 'e.last_update_at DESC' : 'rank'} LIMIT ? OFFSET ?`).all(fq, ...params, limit, offset);
      } else {
        const words = normalizeArabic(f.q).split(' ').filter(Boolean);
        const like = words.map(() => "(s.title || ' ' || s.body || ' ' || s.tags || ' ' || s.entities) LIKE ?");
        const base = `FROM events_search s JOIN events e ON e.id = s.event_id WHERE (${like.join(mode === 'AND' ? ' AND ' : ' OR ')}) AND ${where.join(' AND ')}`;
        const lp = words.map((w) => `%${w}%`);
        total = db.prepare(`SELECT COUNT(*) n ${base}`).get(...lp, ...params).n;
        rows = db.prepare(`SELECT e.* ${base} ORDER BY e.last_update_at DESC LIMIT ? OFFSET ?`).all(...lp, ...params, limit, offset);
      }
      if (total > 0) break;
    }
  } else {
    total = db.prepare(`SELECT COUNT(*) n FROM events e WHERE ${where.join(' AND ')}`).get(...params).n;
    rows = db.prepare(`SELECT e.* FROM events e WHERE ${where.join(' AND ')} ORDER BY e.last_update_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  }
  return {
    total,
    page: Math.floor(offset / limit) + 1,
    pages: Math.max(1, Math.ceil(total / limit)),
    results: rows.map((e) => ({
      id: e.id,
      title: e.title,
      summary: e.summary,
      scope: e.scope,
      section: e.section,
      content_type: e.content_type,
      tags: J(e.tags_json, []),
      occurred_at: e.occurred_at,
      first_seen_at: e.first_seen_at,
      last_update_at: e.last_update_at,
      ai_status: e.ai_status,
      source_count: db.prepare('SELECT COUNT(DISTINCT source_id) n FROM items WHERE event_id = ? AND excluded = 0').get(e.id).n,
      update_count: db.prepare('SELECT COUNT(*) n FROM event_updates WHERE event_id = ?').get(e.id).n,
    })),
  };
}
