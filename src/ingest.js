// Ingestion pipeline: fetch sources -> parse -> canonicalize -> exact dedup (DB unique keys) ->
// republish detection (content hash) -> classify / sports exclusion -> event matching.
import { config } from './config.js';
import { tx, J, getSetting, setSetting } from './db.js';
import { safeFetchText } from './fetcher.js';
import { parseFeed, parseSpaNextData, parseSpaArticle, splitSpaPrefix, parseLinkList } from './core/feeds.js';
import { canonicalizeUrl, urlKey, isDirectArticleUrl, hostAllowed, hostOf } from './core/url.js';
import { classify } from './core/classify.js';
import { features, packFeatures, unpackFeatures, decideEvent, mergeFeatures, contentHash, HOUR } from './core/dedup.js';
import { firstSentences, cleanText, truncate } from './core/text.js';
import { hasArabic, indexText } from './core/arabic.js';
import { aiAvailable } from './ai.js';

const DAY = 24 * HOUR;

// IDF weights for matching, cached per DB handle and updated incrementally.
const dfCache = new WeakMap();
function dfState(db) {
  let s = dfCache.get(db);
  if (!s) {
    s = { map: new Map(db.prepare('SELECT token, df FROM token_df').all().map((r) => [r.token, r.df])), n: Number(getSetting(db, 'df_docs', 0)) };
    dfCache.set(db, s);
  }
  return s;
}
function addDocument(db, tokens) {
  const s = dfState(db);
  const up = db.prepare('INSERT INTO token_df (token, df) VALUES (?, 1) ON CONFLICT(token) DO UPDATE SET df = df + 1');
  for (const t of tokens) {
    up.run(t);
    s.map.set(t, (s.map.get(t) || 0) + 1);
  }
  s.n += 1;
  setSetting(db, 'df_docs', s.n);
}
export function idfWeight(db) {
  const s = dfState(db);
  return (t) => Math.log((s.n + 1) / ((s.map.get(t) || 0) + 1)) + 1;
}

export async function fetchSource(source, { fetchImpl } = {}) {
  const allowedHosts = J(source.allowed_hosts, []);
  const res = await safeFetchText(source.url, { allowedHosts, fetchImpl });
  let items;
  if (source.type === 'rss') items = parseFeed(res.text);
  else if (source.type === 'spa') items = parseSpaNextData(res.text);
  else if (source.type === 'html_list') items = parseLinkList(res.text, res.url, source.link_pattern || '^$');
  else items = [];
  if (!items.length && !/<(rss|feed|rdf|html)/i.test(res.text)) throw Object.assign(new Error('الاستجابة ليست خلاصة صالحة'), { status: res.status });
  return { status: res.status, items, allowedHosts };
}

export async function ingestAll(db, { runId, now = Date.now(), fetchImpl } = {}) {
  const sources = db.prepare('SELECT * FROM sources WHERE enabled = 1 ORDER BY id').all();
  const stats = { sources: sources.length, sourcesOk: 0, sourcesFailed: 0, failed: [], found: 0, new: 0, dupExact: 0, reposts: 0, excludedSports: 0, stale: 0, old: 0, noDirectLink: 0, newEvents: 0, merged: 0, updates: 0, review: 0 };
  const queue = [...sources];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const s = queue.shift();
      await ingestSource(db, s, { runId, now, fetchImpl, stats });
    }
  });
  await Promise.all(workers);
  return stats;
}

async function ingestSource(db, source, { runId, now, fetchImpl, stats }) {
  const startedAt = Date.now();
  const log = db.prepare('INSERT INTO fetch_logs (run_id, source_id, started_at) VALUES (?, ?, ?)').run(runId ?? null, source.id, startedAt);
  const logId = Number(log.lastInsertRowid);
  try {
    const { status, items, allowedHosts } = await fetchSource(source, { fetchImpl });
    // Fetch window: since last success minus an overlap, to catch late-published items.
    const base = source.last_success_at ?? now - config.firstRunLookbackHours * HOUR;
    const cutoff = base - config.overlapHours * HOUR;
    let found = 0;
    let added = 0;
    const spaDetails = [];
    for (const raw of items) {
      found++;
      if (raw.publishedAt && raw.publishedAt < cutoff) {
        stats.old++;
        continue;
      }
      if (source.type === 'spa') {
        const { prefix, title } = splitSpaPrefix(raw.title);
        raw.title = title;
        raw.categories = prefix ? [prefix] : [];
      }
      const r = processItem(db, source, raw, { now, stats, allowedHosts });
      if (r.inserted) added++;
      if (r.inserted && source.type === 'spa' && r.eventId && spaDetails.length < 25) spaDetails.push({ itemId: r.itemId, url: r.url });
    }
    // SPA home page has no body text; fetch the statement page for summarization context.
    for (const d of spaDetails) {
      try {
        const res = await safeFetchText(d.url, { allowedHosts, fetchImpl, retries: 0 });
        const art = parseSpaArticle(res.text);
        if (art?.content) {
          const text = truncate(art.content.replace(/^[^\n]{0,80}?واس\s*/, ''), 2000);
          db.prepare('UPDATE items SET summary = ? WHERE id = ?').run(text, d.itemId);
          const ev = db.prepare('SELECT e.id, e.ai_status FROM events e JOIN items i ON i.event_id = e.id WHERE i.id = ? AND e.primary_item_id = i.id').get(d.itemId);
          if (ev && ev.ai_status !== 'done') db.prepare('UPDATE events SET summary = ? WHERE id = ?').run(firstSentences(text, 2, 220), ev.id);
        }
      } catch {
        // detail page is optional context; the item itself is already stored
      }
    }
    stats.found += found;
    stats.new += added;
    stats.sourcesOk++;
    db.prepare('UPDATE fetch_logs SET finished_at = ?, ok = 1, http_status = ?, items_found = ?, items_new = ? WHERE id = ?').run(Date.now(), status, found, added, logId);
    db.prepare('UPDATE sources SET last_fetch_at = ?, last_success_at = ?, last_error = NULL, consecutive_failures = 0, updated_at = ? WHERE id = ?').run(now, now, Date.now(), source.id);
  } catch (e) {
    stats.sourcesFailed++;
    stats.failed.push({ key: source.key, name: source.name, error: String(e.message || e) });
    db.prepare('UPDATE fetch_logs SET finished_at = ?, ok = 0, http_status = ?, error = ? WHERE id = ?').run(Date.now(), e.status ?? null, String(e.message || e).slice(0, 500), logId);
    db.prepare('UPDATE sources SET last_fetch_at = ?, last_error = ?, consecutive_failures = consecutive_failures + 1, updated_at = ? WHERE id = ?').run(now, String(e.message || e).slice(0, 500), Date.now(), source.id);
  }
}

// Processes one feed entry. Synchronous and transactional: safe to re-run (unique keys).
export function processItem(db, source, raw, { now = Date.now(), stats = {}, allowedHosts = null } = {}) {
  const bump = (k) => (stats[k] = (stats[k] || 0) + 1);
  const title = cleanText(raw.title);
  if (!title) return { inserted: false };
  const url = canonicalizeUrl(raw.link, source.url);
  const hosts = allowedHosts || J(source.allowed_hosts, []);
  if (!url || !isDirectArticleUrl(url) || (hosts.length && !hostAllowed(hostOf(url), hosts))) {
    bump('noDirectLink');
    return { inserted: false };
  }
  const key = urlKey(url);
  const guid = String(raw.guid || url).slice(0, 500);
  const summary = cleanText(raw.summary || '', 2500);
  const publishedAt = raw.publishedAt && raw.publishedAt <= now + 2 * HOUR ? raw.publishedAt : raw.publishedAt ? now : null;
  const hash = contentHash(title, summary);

  return tx(db, () => {
    // 1) exact duplicates: same source entry or same canonical URL (any tracking variant)
    const exact = db.prepare('SELECT id FROM items WHERE (source_id = ? AND guid = ?) OR url_key = ?').get(source.id, guid, key);
    if (exact) {
      bump('dupExact');
      return { inserted: false, duplicateOf: exact.id };
    }
    const insertItem = (fields) => {
      const r = db.prepare(`INSERT INTO items (source_id, guid, url, url_key, title, summary, lang, categories_json, published_at, fetched_at, content_hash, event_id, relation, excluded, exclude_reason, features_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        source.id, guid, url, key, title, summary, hasArabic(title) ? 'ar' : 'en', JSON.stringify(raw.categories || []), publishedAt, now, hash,
        fields.eventId ?? null, fields.relation ?? null, fields.excluded ? 1 : 0, fields.excludeReason ?? null, fields.features ?? null);
      return Number(r.lastInsertRowid);
    };

    // 2) republished copy of an article we already have (same normalized title + lead)
    const twin = db.prepare('SELECT id, event_id, excluded, exclude_reason FROM items WHERE content_hash = ? ORDER BY id LIMIT 1').get(hash);
    if (twin) {
      const itemId = insertItem({ eventId: twin.event_id, relation: 'repost', excluded: twin.excluded, excludeReason: twin.exclude_reason });
      if (twin.event_id) logMerge(db, itemId, twin.event_id, 'repost', { score: 1, titleSim: 1, textSim: 1, entitySim: 1 }, 'نفس النص منشور مسبقًا (إعادة نشر)', now);
      bump('reposts');
      return { inserted: true, itemId, eventId: twin.event_id, relation: 'repost', url };
    }

    // 3) classification and sports exclusion
    const c = classify({ title, summary, categories: raw.categories || [], source: { ...source, item_link: url }, sourcePrefix: (raw.categories || [])[0] || '' });
    if (c.excluded) {
      const itemId = insertItem({ excluded: true, excludeReason: c.excludeReason });
      bump('excludedSports');
      return { inserted: true, itemId, excluded: true, url };
    }
    const f = features({ title, summary, entities: c.entities, publishedAt: publishedAt ?? now });
    const fJson = packFeatures(f);

    // 4) stale: first seen now but published long ago -> archived, never presented as new
    if (publishedAt && now - publishedAt > config.maxItemAgeHours * HOUR) {
      const itemId = insertItem({ relation: 'stale', features: fJson });
      bump('stale');
      return { inserted: true, itemId, stale: true, url };
    }

    // 5) event matching against recent events (IDF-weighted, item-to-item)
    addDocument(db, f.tokens);
    const w = idfWeight(db);
    const t0 = (publishedAt ?? now) - 7 * DAY;
    const candidates = db.prepare('SELECT id, features_json, last_update_at, scope FROM events WHERE last_update_at >= ? AND hidden = 0 ORDER BY last_update_at DESC LIMIT 600').all(t0);
    let best = null;
    const reviews = [];
    const itemsOf = db.prepare('SELECT features_json FROM items WHERE event_id = ? AND excluded = 0 AND features_json IS NOT NULL ORDER BY id DESC LIMIT 12');
    for (const ev of candidates) {
      const ef = unpackFeatures(ev.features_json);
      const quick = [...f.titleTok].some((t) => ef.tokens.has(t)) || [...f.entities].some((x) => ef.entities.has(x));
      if (!quick) continue;
      const itemFeatures = itemsOf.all(ev.id).map((r) => unpackFeatures(r.features_json));
      const d = decideEvent(f, itemFeatures, ef, { lastSubstantiveAt: ev.last_update_at, w });
      if (d.relation === 'review') reviews.push({ ev, d });
      if ((d.relation === 'same' || d.relation === 'update') && (!best || d.score > best.d.score)) best = { ev, d, ef };
    }

    if (best) {
      const relation = best.d.relation;
      const itemId = insertItem({ eventId: best.ev.id, relation, features: fJson });
      const merged = mergeFeatures(best.ef, f);
      const srcCount = db.prepare('SELECT COUNT(DISTINCT source_id) n FROM items WHERE event_id = ? AND excluded = 0').get(best.ev.id).n;
      const importanceAdd = relation === 'update' ? 0.5 : 0;
      db.prepare(`UPDATE events SET features_json = ?, updated_at = ?, importance = MAX(importance, ?) + ?,
          verification = CASE WHEN verification = 'single_source' AND ? >= 2 THEN 'multi_source' ELSE verification END,
          occurred_at = CASE WHEN occurred_at IS NULL OR (? IS NOT NULL AND ? < occurred_at) THEN ? ELSE occurred_at END
          ${relation === 'update' ? ', last_update_at = ?' : ''}
          WHERE id = ?`).run(
        packFeatures(merged), now, c.importanceBase + Math.min(3, srcCount - 1), importanceAdd, srcCount, publishedAt, publishedAt, publishedAt,
        ...(relation === 'update' ? [now] : []), best.ev.id);
      if (relation === 'update') {
        db.prepare('INSERT INTO event_updates (event_id, item_id, created_at, changed, title) VALUES (?, ?, ?, ?, ?)').run(best.ev.id, itemId, now, best.d.changed || 'تطور جديد', title);
        bump('updates');
      } else bump('merged');
      addEntities(db, best.ev.id, c.entities);
      logMerge(db, itemId, best.ev.id, relation, best.d, best.d.reason, now);
      refreshSearch(db, best.ev.id);
      return { inserted: true, itemId, eventId: best.ev.id, relation, url };
    }

    // 6) new event
    const itemId = insertItem({ relation: 'origin', features: fJson });
    const ev = db.prepare(`INSERT INTO events (title, summary, why, scope, section, secondary_json, content_type, tags_json, verification, occurred_at, first_seen_at, last_update_at, updated_at, importance, primary_item_id, features_json, ai_status)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      title, summary ? firstSentences(summary, 2, 220) : null, c.scope, c.section, JSON.stringify(c.secondary), c.contentType, JSON.stringify(c.tags),
      source.is_official ? 'official' : 'single_source', publishedAt, now, now, now, c.importanceBase, itemId, fJson, aiAvailable() ? 'pending' : 'fallback');
    const eventId = Number(ev.lastInsertRowid);
    db.prepare('UPDATE items SET event_id = ? WHERE id = ?').run(eventId, itemId);
    addEntities(db, eventId, c.entities);
    for (const r of reviews.slice(0, 3)) {
      db.prepare('INSERT OR IGNORE INTO review_candidates (item_id, event_id, candidate_event_id, score, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(itemId, eventId, r.ev.id, r.d.score, r.d.reason, now);
      bump('review');
    }
    refreshSearch(db, eventId);
    bump('newEvents');
    return { inserted: true, itemId, eventId, relation: 'origin', url };
  });
}

function addEntities(db, eventId, entities) {
  const st = db.prepare('INSERT OR IGNORE INTO event_entities (event_id, entity_id, label, kind, symbol) VALUES (?, ?, ?, ?, ?)');
  for (const e of entities) st.run(eventId, e.id, e.label, e.kind, e.symbol ?? null);
}

export function logMerge(db, itemId, eventId, relation, d, reason, now = Date.now(), actor = 'system') {
  db.prepare('INSERT INTO merge_log (item_id, event_id, relation, score, title_sim, text_sim, entity_sim, reason, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    itemId, eventId, relation, round(d.score), round(d.titleSim), round(d.textSim), round(d.entitySim), reason || null, actor, now);
}
const round = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

// Search index row for an event: normalized + stemmed text of all its items and metadata.
export function refreshSearch(db, eventId) {
  const e = db.prepare('SELECT id, title, summary, why, tags_json FROM events WHERE id = ?').get(eventId);
  if (!e) return;
  const items = db.prepare('SELECT title, summary FROM items WHERE event_id = ? AND excluded = 0 LIMIT 12').all(eventId);
  const ents = db.prepare('SELECT label, symbol FROM event_entities WHERE event_id = ?').all(eventId);
  const title = indexText(e.title, ...items.map((i) => i.title));
  const body = indexText(e.summary, e.why, ...items.map((i) => String(i.summary || '').slice(0, 600)));
  const tags = indexText(...J(e.tags_json, []));
  const entities = indexText(...ents.map((x) => `${x.label} ${x.symbol || ''}`));
  if (db.hasFts) {
    db.prepare('DELETE FROM events_fts WHERE event_id = ?').run(eventId);
    db.prepare('INSERT INTO events_fts (title, body, tags, entities, event_id) VALUES (?, ?, ?, ?, ?)').run(title, body, tags, entities, eventId);
  } else {
    db.prepare('INSERT OR REPLACE INTO events_search (event_id, title, body, tags, entities) VALUES (?, ?, ?, ?, ?)').run(eventId, title, body, tags, entities);
  }
}
