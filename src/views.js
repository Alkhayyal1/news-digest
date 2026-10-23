// Read models shared by the HTTP server and the static site builder.
import { config } from './config.js';
import { getSetting, J } from './db.js';
import { scheduleStatus, lockInfo } from './runner.js';
import { getBulletin, eventSnapshot } from './bulletin.js';
import { analyzeCompany } from './core/finance.js';
import { aiAvailable } from './ai.js';

export function publicSources(db) {
  return db.prepare('SELECT id, key, name, url, type, language, is_official, enabled, notes, last_fetch_at, last_success_at, last_error, consecutive_failures FROM sources ORDER BY enabled DESC, is_official DESC, id').all()
    .map((s) => ({ ...s, health: !s.enabled ? 'disabled' : s.consecutive_failures > 0 ? 'failing' : s.last_success_at ? 'ok' : 'pending' }));
}

export function status(db, now = Date.now()) {
  const lastRun = db.prepare("SELECT id, kind, status, started_at, finished_at, error, stats_json FROM runs WHERE status != 'skipped_locked' ORDER BY id DESC LIMIT 1").get();
  const latestPublished = db.prepare("SELECT id, created_at, title FROM bulletins WHERE status = 'published' ORDER BY created_at DESC LIMIT 1").get();
  const latestAny = db.prepare('SELECT id, created_at, status, note FROM bulletins ORDER BY created_at DESC LIMIT 1').get();
  const st = J(lastRun?.stats_json, {});
  return {
    now,
    lastSuccessAt: Number(getSetting(db, 'last_success_at', 0)) || null,
    schedule: scheduleStatus(db, now),
    schedulerEnabled: config.schedulerEnabled,
    running: Boolean(lockInfo(db, now)),
    lastRun: lastRun ? { id: lastRun.id, kind: lastRun.kind, status: lastRun.status, started_at: lastRun.started_at, finished_at: lastRun.finished_at, sourcesOk: st.ingest?.sourcesOk ?? null, sourcesFailed: st.ingest?.sourcesFailed ?? null, failed: st.ingest?.failed ?? [], aiMode: st.ai?.mode ?? null, aiFailed: st.ai?.failed ?? 0 } : null,
    latestPublished: latestPublished || null,
    latestAny: latestAny || null,
    aiMode: aiAvailable() ? 'ai' : 'fallback',
    sources: publicSources(db),
  };
}

export function eventDetail(db, id) {
  const snap = eventSnapshot(db, id);
  if (!snap) return null;
  const e = db.prepare('SELECT hidden, merged_into FROM events WHERE id = ?').get(id);
  const timeline = db.prepare(`SELECT i.id, s.name AS source, s.is_official, i.url, i.title, i.published_at, i.fetched_at, i.relation,
      (SELECT reason FROM merge_log m WHERE m.item_id = i.id AND m.reverted_at IS NULL ORDER BY m.id DESC LIMIT 1) AS merge_reason,
      (SELECT score FROM merge_log m WHERE m.item_id = i.id AND m.reverted_at IS NULL ORDER BY m.id DESC LIMIT 1) AS merge_score
      FROM items i JOIN sources s ON s.id = i.source_id WHERE i.event_id = ? AND i.excluded = 0 ORDER BY COALESCE(i.published_at, i.fetched_at)`).all(id);
  const bulletins = db.prepare('SELECT b.id, b.title, b.created_at, bi.kind FROM bulletin_items bi JOIN bulletins b ON b.id = bi.bulletin_id WHERE bi.event_id = ? ORDER BY b.created_at').all(id);
  return { ...snap, hidden: !!e.hidden, merged_into: e.merged_into, timeline, bulletins };
}

export function companiesList(db) {
  return db.prepare(`SELECT c.symbol, c.name, c.sector, (SELECT COUNT(*) FROM financial_reports f WHERE f.symbol = c.symbol) AS reports,
      (SELECT COUNT(*) FROM event_entities x JOIN events e ON e.id = x.event_id WHERE x.symbol = c.symbol AND e.hidden = 0) AS events FROM companies c ORDER BY c.sector, c.symbol`).all();
}

export function companyDetail(db, symbol) {
  const co = db.prepare('SELECT * FROM companies WHERE symbol = ?').get(symbol);
  if (!co) return null;
  const reports = db.prepare('SELECT * FROM financial_reports WHERE symbol = ? ORDER BY period DESC').all(symbol);
  const price = db.prepare('SELECT * FROM prices WHERE symbol = ? ORDER BY as_of DESC LIMIT 1').get(symbol) || null;
  const peers = db.prepare('SELECT symbol FROM companies WHERE sector = ? AND symbol != ?').all(co.sector, symbol).map((p) => {
    const r = db.prepare('SELECT * FROM financial_reports WHERE symbol = ?').all(p.symbol);
    const pr = db.prepare('SELECT * FROM prices WHERE symbol = ? ORDER BY as_of DESC LIMIT 1').get(p.symbol) || null;
    if (!r.length) return null;
    const a = analyzeCompany(r, pr);
    return { symbol: p.symbol, pe_ttm: a.valuation?.pe_ttm ?? null, net_margin_pct: a.metrics?.net_margin_pct ?? null };
  }).filter(Boolean);
  const analysis = analyzeCompany(reports, price, { sectorPeers: peers });
  const events = db.prepare(`SELECT e.id, e.title, e.section, e.occurred_at, e.first_seen_at FROM events e JOIN event_entities x ON x.event_id = e.id
      WHERE x.symbol = ? AND e.hidden = 0 ORDER BY e.last_update_at DESC LIMIT 30`).all(symbol);
  return { company: { ...co, aliases: J(co.aliases_json, []) }, reports, price, analysis, events };
}

export function latestBulletin(db) {
  const b = db.prepare("SELECT id FROM bulletins WHERE status = 'published' ORDER BY created_at DESC LIMIT 1").get();
  const newerEmpty = b ? db.prepare("SELECT id, created_at, note FROM bulletins WHERE status = 'empty' AND created_at > (SELECT created_at FROM bulletins WHERE id = ?) ORDER BY created_at DESC LIMIT 1").get(b.id) : null;
  return { bulletin: b ? getBulletin(db, b.id) : null, newerEmpty: newerEmpty || null };
}

export const BULLETINS_PER_PAGE = 30;
export function bulletinList(db, page = 1, includeEmpty = false) {
  const where = includeEmpty ? '' : "WHERE status = 'published'";
  const total = db.prepare(`SELECT COUNT(*) n FROM bulletins ${where}`).get().n;
  const rows = db.prepare(`SELECT id, title, created_at, period_from, period_to, status, event_count, note FROM bulletins ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(BULLETINS_PER_PAGE, (page - 1) * BULLETINS_PER_PAGE);
  return { total, page, pages: Math.max(1, Math.ceil(total / BULLETINS_PER_PAGE)), bulletins: rows };
}

export function adminOverview(db) {
  return {
    runs: db.prepare('SELECT id, kind, slot_index, planned_at, started_at, finished_at, status, error, stats_json, bulletin_id FROM runs ORDER BY id DESC LIMIT 40').all().map((r) => ({ ...r, stats: J(r.stats_json), stats_json: undefined })),
    slots: db.prepare('SELECT * FROM schedule_slots ORDER BY slot_index DESC LIMIT 20').all(),
    fetchLogs: db.prepare('SELECT f.*, s.name FROM fetch_logs f JOIN sources s ON s.id = f.source_id ORDER BY f.id DESC LIMIT 120').all(),
    sources: db.prepare('SELECT * FROM sources ORDER BY id').all().map((s) => ({ ...s, allowed_hosts: J(s.allowed_hosts, []) })),
    reviews: db.prepare(`SELECT r.*, a.title AS event_title, b.title AS candidate_title, i.title AS item_title FROM review_candidates r
        JOIN events a ON a.id = r.event_id JOIN events b ON b.id = r.candidate_event_id JOIN items i ON i.id = r.item_id
        WHERE r.status = 'open' AND a.hidden = 0 AND b.hidden = 0 ORDER BY r.score DESC LIMIT 100`).all(),
    merges: db.prepare(`SELECT m.*, i.title AS item_title, s.name AS source, e.title AS event_title FROM merge_log m JOIN items i ON i.id = m.item_id
        JOIN sources s ON s.id = i.source_id JOIN events e ON e.id = m.event_id WHERE m.reverted_at IS NULL AND m.relation IN ('same', 'update', 'repost', 'manual_merge') ORDER BY m.id DESC LIMIT 150`).all(),
    excluded: db.prepare('SELECT i.id, i.title, i.url, i.exclude_reason, s.name AS source, i.fetched_at FROM items i JOIN sources s ON s.id = i.source_id WHERE i.excluded = 1 ORDER BY i.id DESC LIMIT 60').all(),
    schedule: scheduleStatus(db),
    config: { intervalHours: config.intervalHours, overlapHours: config.overlapHours, aiMode: aiAvailable() ? 'ai' : 'fallback', aiModel: aiAvailable() ? config.aiModel : null, schedulerEnabled: config.schedulerEnabled },
  };
}
