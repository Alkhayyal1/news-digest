// Applies AI enrichment to pending events. On any failure the event keeps its rule-based
// content (original title + short source excerpt) and is marked so the UI says so.
import { config } from './config.js';
import { J } from './db.js';
import { aiAvailable, enrichBatch } from './ai.js';
import { features, unpackFeatures, mergeFeatures, packFeatures } from './core/dedup.js';
import { refreshSearch } from './ingest.js';

export async function enrichPending(db, { now = Date.now(), enrich = enrichBatch } = {}) {
  const stats = { attempted: 0, done: 0, failed: 0, rejectedFields: 0, mode: aiAvailable() ? 'ai' : 'fallback', errors: [] };
  if (!aiAvailable() && enrich === enrichBatch) {
    db.prepare("UPDATE events SET ai_status = 'fallback' WHERE ai_status = 'pending'").run();
    return stats;
  }
  const pending = db.prepare(`SELECT id, scope, section FROM events WHERE (ai_status = 'pending' OR (ai_status = 'failed' AND first_seen_at > ?)) AND hidden = 0
    ORDER BY importance DESC, first_seen_at DESC LIMIT ?`).all(now - 24 * 3600_000, config.aiMaxEventsPerRun);
  for (let i = 0; i < pending.length; i += config.aiBatchSize) {
    const batch = pending.slice(i, i + config.aiBatchSize).map((e) => ({
      ...e,
      items: db.prepare('SELECT s.name AS source, i.title, i.summary, i.published_at FROM items i JOIN sources s ON s.id = i.source_id WHERE i.event_id = ? AND i.excluded = 0 ORDER BY s.is_official DESC, i.published_at LIMIT 4').all(e.id),
    }));
    stats.attempted += batch.length;
    try {
      const { results, model } = await enrich(batch);
      for (const ev of batch) {
        const r = results.get(ev.id);
        if (!r || !r.title || !r.summary) {
          db.prepare("UPDATE events SET ai_status = 'failed' WHERE id = ?").run(ev.id);
          stats.failed++;
          if (r?.problems?.length) stats.rejectedFields += r.problems.length;
          continue;
        }
        stats.rejectedFields += r.problems.length;
        const cur = db.prepare('SELECT features_json, tags_json, content_type, verification FROM events WHERE id = ?').get(ev.id);
        // add the Arabic title to the matching features so later coverage in other languages links up
        const merged = mergeFeatures(unpackFeatures(cur.features_json), features({ title: r.title, summary: r.summary }));
        const tags = [...new Set([...J(cur.tags_json, []), ...r.tags])].slice(0, 8);
        const verification = cur.verification === 'official' && r.verification !== 'conflicting' ? 'official' : r.verification || cur.verification;
        db.prepare(`UPDATE events SET title = ?, summary = ?, why = ?, facts_json = ?, section = ?, content_type = ?, tags_json = ?, verification = ?, research_note = ?,
            features_json = ?, ai_status = 'done', ai_model = ?, updated_at = ? WHERE id = ?`).run(
          r.title, r.summary, r.why, JSON.stringify(r.facts), r.section, cur.content_type === 'analysis' ? 'analysis' : r.contentType || cur.content_type, JSON.stringify(tags), verification, r.researchNote,
          packFeatures(merged), model, now, ev.id);
        refreshSearch(db, ev.id);
        stats.done++;
      }
    } catch (e) {
      for (const ev of batch) db.prepare("UPDATE events SET ai_status = 'failed' WHERE id = ?").run(ev.id);
      stats.failed += batch.length;
      stats.errors.push(String(e.message || e).slice(0, 300));
    }
  }
  return stats;
}
