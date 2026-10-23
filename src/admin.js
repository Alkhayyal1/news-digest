// Admin operations: undo a wrong merge (split), merge missed duplicates, review queue.
import { tx, J } from './db.js';
import { features, packFeatures, unpackFeatures, mergeFeatures } from './core/dedup.js';
import { classify } from './core/classify.js';
import { firstSentences } from './core/text.js';
import { logMerge, refreshSearch } from './ingest.js';
import { aiAvailable } from './ai.js';

function rebuildEventFeatures(db, eventId) {
  const items = db.prepare('SELECT features_json FROM items WHERE event_id = ? AND excluded = 0 AND features_json IS NOT NULL').all(eventId);
  if (!items.length) return;
  let f = unpackFeatures(items[0].features_json);
  for (const it of items.slice(1)) f = mergeFeatures(f, unpackFeatures(it.features_json));
  db.prepare('UPDATE events SET features_json = ? WHERE id = ?').run(packFeatures(f), eventId);
}

// Moves one item out of its event into a new event of its own.
export function splitItem(db, itemId, now = Date.now()) {
  return tx(db, () => {
    const it = db.prepare('SELECT i.*, s.is_official, s.default_scope, s.section_hint FROM items i JOIN sources s ON s.id = i.source_id WHERE i.id = ?').get(itemId);
    if (!it || !it.event_id) throw new Error('العنصر غير مرتبط بحدث');
    const oldEvent = it.event_id;
    const others = db.prepare('SELECT COUNT(*) n FROM items WHERE event_id = ? AND id != ?').get(oldEvent, itemId).n;
    if (others === 0) throw new Error('هذا هو العنصر الوحيد في الحدث');
    const c = classify({ title: it.title, summary: it.summary || '', categories: J(it.categories_json, []), source: it });
    const f = it.features_json ? unpackFeatures(it.features_json) : features({ title: it.title, summary: it.summary, entities: c.entities, publishedAt: it.published_at });
    const r = db.prepare(`INSERT INTO events (title, summary, scope, section, secondary_json, content_type, tags_json, verification, occurred_at, first_seen_at, last_update_at, updated_at, importance, primary_item_id, features_json, ai_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      it.title, it.summary ? firstSentences(it.summary, 2, 220) : null, c.scope, c.section, JSON.stringify(c.secondary), c.contentType, JSON.stringify(c.tags),
      it.is_official ? 'official' : 'single_source', it.published_at, it.fetched_at, it.fetched_at, now, c.importanceBase, itemId, packFeatures(f), aiAvailable() ? 'pending' : 'fallback');
    const newEvent = Number(r.lastInsertRowid);
    db.prepare("UPDATE items SET event_id = ?, relation = 'origin' WHERE id = ?").run(newEvent, itemId);
    db.prepare('UPDATE event_updates SET event_id = ? WHERE item_id = ?').run(newEvent, itemId);
    const ins = db.prepare('INSERT OR IGNORE INTO event_entities (event_id, entity_id, label, kind, symbol) VALUES (?, ?, ?, ?, ?)');
    for (const e of c.entities) ins.run(newEvent, e.id, e.label, e.kind, e.symbol ?? null);
    db.prepare('UPDATE merge_log SET reverted_at = ? WHERE item_id = ? AND event_id = ? AND reverted_at IS NULL').run(now, itemId, oldEvent);
    logMerge(db, itemId, newEvent, 'split', {}, `فصل يدوي من الحدث ${oldEvent}`, now, 'admin');
    const ev = db.prepare('SELECT primary_item_id FROM events WHERE id = ?').get(oldEvent);
    if (ev.primary_item_id === itemId) {
      const p = db.prepare('SELECT id FROM items WHERE event_id = ? ORDER BY id LIMIT 1').get(oldEvent);
      db.prepare('UPDATE events SET primary_item_id = ? WHERE id = ?').run(p.id, oldEvent);
    }
    rebuildEventFeatures(db, oldEvent);
    refreshSearch(db, oldEvent);
    refreshSearch(db, newEvent);
    return { newEventId: newEvent };
  });
}

// Merges event `fromId` into event `intoId` (missed duplicate). Bulletin snapshots stay as published.
export function mergeEvents(db, intoId, fromId, now = Date.now()) {
  if (intoId === fromId) throw new Error('نفس الحدث');
  return tx(db, () => {
    const a = db.prepare('SELECT id FROM events WHERE id = ? AND hidden = 0').get(intoId);
    const b = db.prepare('SELECT id, occurred_at FROM events WHERE id = ? AND hidden = 0').get(fromId);
    if (!a || !b) throw new Error('حدث غير موجود');
    const items = db.prepare('SELECT id FROM items WHERE event_id = ?').all(fromId);
    db.prepare("UPDATE items SET event_id = ?, relation = 'same' WHERE event_id = ?").run(intoId, fromId);
    db.prepare('UPDATE event_updates SET event_id = ? WHERE event_id = ?').run(intoId, fromId);
    db.prepare('INSERT OR IGNORE INTO event_entities (event_id, entity_id, label, kind, symbol) SELECT ?, entity_id, label, kind, symbol FROM event_entities WHERE event_id = ?').run(intoId, fromId);
    db.prepare('UPDATE events SET hidden = 1, merged_into = ?, updated_at = ? WHERE id = ?').run(intoId, now, fromId);
    db.prepare('UPDATE events SET occurred_at = MIN(COALESCE(occurred_at, ?), COALESCE(?, occurred_at)), updated_at = ? WHERE id = ?').run(b.occurred_at, b.occurred_at, now, intoId);
    for (const it of items) logMerge(db, it.id, intoId, 'manual_merge', {}, `دمج يدوي للحدث ${fromId}`, now, 'admin');
    db.prepare("UPDATE review_candidates SET status = 'merged' WHERE (event_id = ? AND candidate_event_id = ?) OR (event_id = ? AND candidate_event_id = ?)").run(fromId, intoId, intoId, fromId);
    if (db.hasFts) db.prepare('DELETE FROM events_fts WHERE event_id = ?').run(fromId);
    else db.prepare('DELETE FROM events_search WHERE event_id = ?').run(fromId);
    rebuildEventFeatures(db, intoId);
    refreshSearch(db, intoId);
    return { ok: true };
  });
}

export function dismissReview(db, id) {
  db.prepare("UPDATE review_candidates SET status = 'dismissed' WHERE id = ?").run(id);
}
