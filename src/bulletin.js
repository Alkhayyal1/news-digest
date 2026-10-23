// Bulletins: a frozen snapshot of the events that are new (or substantively updated) since the
// previous bulletin. Idempotent per slot_key. Never recycles old events.
import { tx, J } from './db.js';
import { SECTIONS } from './core/lexicon.js';
import { formatRiyadh } from './core/schedule.js';
import { HOUR } from './core/dedup.js';

const BREAKING_WINDOW_H = 3; // "عاجل" only if the event happened within this window
const HIGHLIGHT_WINDOW_H = 12; // "مهم" highlights limited to recent events
const HIGHLIGHT_MIN_IMPORTANCE = 3;

export function eventSnapshot(db, eventId) {
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!e) return null;
  const sources = db.prepare(`SELECT i.id AS item_id, s.name AS source, s.is_official, i.url, i.title, i.published_at, i.fetched_at, i.relation
      FROM items i JOIN sources s ON s.id = i.source_id WHERE i.event_id = ? AND i.excluded = 0 ORDER BY (i.id = ?) DESC, s.is_official DESC, i.published_at`).all(eventId, e.primary_item_id);
  const updates = db.prepare('SELECT created_at, changed, title FROM event_updates WHERE event_id = ? ORDER BY created_at').all(eventId);
  const entities = db.prepare('SELECT entity_id, label, kind, symbol FROM event_entities WHERE event_id = ?').all(eventId);
  return {
    id: e.id,
    title: e.title,
    summary: e.summary,
    why: e.why,
    facts: J(e.facts_json, []),
    scope: e.scope,
    section: e.section,
    secondary: J(e.secondary_json, []),
    content_type: e.content_type,
    tags: J(e.tags_json, []),
    verification: e.verification,
    research_note: e.research_note,
    occurred_at: e.occurred_at,
    first_seen_at: e.first_seen_at,
    last_update_at: e.last_update_at,
    importance: e.importance,
    ai_status: e.ai_status,
    title_is_original: e.ai_status !== 'done',
    primary: sources[0] || null,
    sources,
    updates,
    entities,
  };
}

export function buildBulletin(db, { slotKey, runId = null, now = Date.now(), note = null }) {
  return tx(db, () => {
    const existing = db.prepare('SELECT * FROM bulletins WHERE slot_key = ?').get(slotKey);
    if (existing) return { bulletin: existing, created: false };

    const prev = db.prepare('SELECT period_to FROM bulletins ORDER BY period_to DESC LIMIT 1').get();
    const from = prev ? prev.period_to : 0;
    const fresh = db.prepare(`SELECT id, importance, occurred_at, first_seen_at, section FROM events
        WHERE first_seen_at > ? AND first_seen_at <= ? AND hidden = 0
        AND NOT EXISTS (SELECT 1 FROM bulletin_items bi WHERE bi.event_id = events.id)`).all(from, now);
    const updated = db.prepare(`SELECT DISTINCT e.id, e.importance, e.occurred_at, e.first_seen_at, e.section FROM events e
        JOIN event_updates u ON u.event_id = e.id
        WHERE u.created_at > ? AND u.created_at <= ? AND e.first_seen_at <= ? AND e.hidden = 0`).all(from, now, from);

    const title = `نشرة ${formatRiyadh(now)}`;
    const rows = [...fresh.map((e) => ({ ...e, kind: 'new' })), ...updated.filter((u) => !fresh.some((f) => f.id === u.id)).map((e) => ({ ...e, kind: 'update' }))];
    if (!rows.length) {
      const r = db.prepare('INSERT INTO bulletins (slot_key, run_id, created_at, period_from, period_to, status, title, event_count, note) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)').run(
        slotKey, runId, now, from || null, now, 'empty', title, note || 'لا توجد أخبار جديدة مهمة منذ النشرة السابقة.');
      return { bulletin: db.prepare('SELECT * FROM bulletins WHERE id = ?').get(Number(r.lastInsertRowid)), created: true };
    }

    const r = db.prepare('INSERT INTO bulletins (slot_key, run_id, created_at, period_from, period_to, status, title, event_count, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      slotKey, runId, now, from || null, now, 'published', title, rows.length, note);
    const bulletinId = Number(r.lastInsertRowid);

    // Highlights point to the event inside its section: no duplicate card is created.
    // Ranked by importance plus independent coverage; at most 2 per section so one story's
    // reactions do not fill the whole box.
    const highlightIds = new Map();
    const srcCount = db.prepare('SELECT COUNT(DISTINCT source_id) n FROM items WHERE event_id = ? AND excluded = 0');
    const rank = (x) => x.importance + 0.5 * (srcCount.get(x.id).n - 1);
    const perSection = new Map();
    // A single-source item needs a higher score: an official feature story alone is not "important".
    const recent = rows.filter((x) => (x.occurred_at ?? x.first_seen_at) >= now - HIGHLIGHT_WINDOW_H * HOUR && x.importance >= HIGHLIGHT_MIN_IMPORTANCE
        && (srcCount.get(x.id).n >= 2 || x.importance >= HIGHLIGHT_MIN_IMPORTANCE + 1))
      .sort((a, b) => rank(b) - rank(a))
      .filter((x) => {
        const n = perSection.get(x.section) || 0;
        if (n >= 2) return false;
        perSection.set(x.section, n + 1);
        return true;
      })
      .slice(0, 6);
    for (const x of recent) {
      const t = x.occurred_at ?? x.first_seen_at;
      highlightIds.set(x.id, now - t <= BREAKING_WINDOW_H * HOUR && x.importance >= 4 ? 'عاجل' : 'مهم');
    }

    const order = SECTIONS.map((s) => s.key);
    rows.sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section) || b.importance - a.importance || (b.occurred_at ?? 0) - (a.occurred_at ?? 0));
    const ins = db.prepare('INSERT INTO bulletin_items (bulletin_id, event_id, section, position, kind, highlight, snapshot_json) VALUES (?, ?, ?, ?, ?, ?, ?)');
    rows.forEach((x, i) => ins.run(bulletinId, x.id, x.section, i, x.kind, highlightIds.get(x.id) || null, JSON.stringify(eventSnapshot(db, x.id))));
    return { bulletin: db.prepare('SELECT * FROM bulletins WHERE id = ?').get(bulletinId), created: true };
  });
}

export function getBulletin(db, id) {
  const b = db.prepare('SELECT * FROM bulletins WHERE id = ?').get(id);
  if (!b) return null;
  const items = db.prepare('SELECT event_id, section, position, kind, highlight, snapshot_json FROM bulletin_items WHERE bulletin_id = ? ORDER BY position').all(id)
    .map((r) => ({ event_id: r.event_id, section: r.section, kind: r.kind, highlight: r.highlight, snapshot: J(r.snapshot_json) }));
  // Later developments for each event (after this bulletin) are linked, not merged into the snapshot.
  for (const it of items) {
    it.later_updates = db.prepare('SELECT COUNT(*) n FROM event_updates WHERE event_id = ? AND created_at > ?').get(it.event_id, b.created_at).n;
  }
  return { ...b, items };
}
