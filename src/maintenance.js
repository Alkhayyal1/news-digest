// Retention, so the database stays small when it is stored as a single file between runs.
// Dedup keys (url_key, guid, content_hash) are never removed: old items must keep blocking duplicates.
const DAY = 24 * 3600_000;

export function prune(db, now = Date.now()) {
  const r = {};
  r.excludedTrimmed = db.prepare('UPDATE items SET summary = NULL, features_json = NULL, categories_json = NULL WHERE excluded = 1 AND fetched_at < ? AND (summary IS NOT NULL OR features_json IS NOT NULL)').run(now - 7 * DAY).changes;
  // matching only looks back 7 days; keep 14 for safety
  r.itemFeaturesDropped = db.prepare('UPDATE items SET features_json = NULL WHERE fetched_at < ? AND features_json IS NOT NULL').run(now - 14 * DAY).changes;
  r.itemSummariesTrimmed = db.prepare('UPDATE items SET summary = substr(summary, 1, 300) WHERE fetched_at < ? AND length(summary) > 300').run(now - 14 * DAY).changes;
  r.eventFeaturesDropped = db.prepare(`UPDATE events SET features_json = '{}' WHERE last_update_at < ? AND features_json != '{}'`).run(now - 21 * DAY).changes;
  r.fetchLogsDeleted = db.prepare('DELETE FROM fetch_logs WHERE started_at < ?').run(now - 30 * DAY).changes;
  return r;
}

// Make the database a single self-contained file before it is uploaded.
export function compact(db) {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.exec('VACUUM');
}
