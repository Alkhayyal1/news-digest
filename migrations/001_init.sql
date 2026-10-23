-- All timestamps are UTC epoch milliseconds. Display converts to Asia/Riyadh.

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE sources (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('rss', 'spa', 'html_list')),
  language TEXT NOT NULL DEFAULT 'ar',
  default_scope TEXT NOT NULL DEFAULT 'auto' CHECK (default_scope IN ('saudi', 'world', 'auto')),
  section_hint TEXT,
  is_official INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  allowed_hosts TEXT NOT NULL DEFAULT '[]',
  link_pattern TEXT,
  notes TEXT,
  last_fetch_at INTEGER,
  last_success_at INTEGER,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('scheduled', 'manual', 'catchup', 'external')),
  slot_index INTEGER,
  planned_at INTEGER,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  attempt INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  stats_json TEXT,
  bulletin_id INTEGER
);
CREATE INDEX runs_started ON runs (started_at DESC);

CREATE TABLE schedule_slots (
  slot_index INTEGER PRIMARY KEY,
  planned_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('done', 'merged', 'failed', 'retrying')),
  run_id INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE locks (
  name TEXT PRIMARY KEY,
  holder TEXT,
  acquired_at INTEGER,
  expires_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE fetch_logs (
  id INTEGER PRIMARY KEY,
  run_id INTEGER,
  source_id INTEGER NOT NULL REFERENCES sources (id),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  ok INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  items_found INTEGER NOT NULL DEFAULT 0,
  items_new INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX fetch_logs_source ON fetch_logs (source_id, started_at DESC);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  why TEXT,
  facts_json TEXT,
  scope TEXT NOT NULL,
  section TEXT NOT NULL,
  secondary_json TEXT NOT NULL DEFAULT '[]',
  content_type TEXT NOT NULL DEFAULT 'news',
  tags_json TEXT NOT NULL DEFAULT '[]',
  verification TEXT NOT NULL DEFAULT 'single_source',
  research_note TEXT,
  occurred_at INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_update_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  importance REAL NOT NULL DEFAULT 0,
  primary_item_id INTEGER,
  features_json TEXT NOT NULL,
  ai_status TEXT NOT NULL DEFAULT 'pending',
  ai_model TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  merged_into INTEGER
);
CREATE INDEX events_seen ON events (first_seen_at DESC);
CREATE INDEX events_update ON events (last_update_at DESC);
CREATE INDEX events_section ON events (section, last_update_at DESC);

CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES sources (id),
  guid TEXT NOT NULL,
  url TEXT NOT NULL,
  url_key TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  lang TEXT,
  categories_json TEXT,
  published_at INTEGER,
  fetched_at INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  event_id INTEGER REFERENCES events (id),
  relation TEXT,
  excluded INTEGER NOT NULL DEFAULT 0,
  exclude_reason TEXT,
  features_json TEXT,
  UNIQUE (source_id, guid),
  UNIQUE (url_key)
);
CREATE INDEX items_event ON items (event_id);
CREATE INDEX items_hash ON items (content_hash);
CREATE INDEX items_pub ON items (published_at DESC);

CREATE TABLE event_updates (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events (id),
  item_id INTEGER REFERENCES items (id),
  created_at INTEGER NOT NULL,
  changed TEXT NOT NULL,
  title TEXT
);
CREATE INDEX event_updates_event ON event_updates (event_id, created_at);

CREATE TABLE event_entities (
  event_id INTEGER NOT NULL REFERENCES events (id),
  entity_id TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  symbol TEXT,
  PRIMARY KEY (event_id, entity_id)
);
CREATE INDEX event_entities_entity ON event_entities (entity_id);
CREATE INDEX event_entities_symbol ON event_entities (symbol);

CREATE TABLE merge_log (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items (id),
  event_id INTEGER NOT NULL REFERENCES events (id),
  relation TEXT NOT NULL,
  score REAL,
  title_sim REAL,
  text_sim REAL,
  entity_sim REAL,
  reason TEXT,
  actor TEXT NOT NULL DEFAULT 'system',
  created_at INTEGER NOT NULL,
  reverted_at INTEGER
);
CREATE INDEX merge_log_event ON merge_log (event_id);

CREATE TABLE review_candidates (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items (id),
  event_id INTEGER NOT NULL REFERENCES events (id),
  candidate_event_id INTEGER NOT NULL REFERENCES events (id),
  score REAL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  UNIQUE (item_id, candidate_event_id)
);

CREATE TABLE bulletins (
  id INTEGER PRIMARY KEY,
  slot_key TEXT NOT NULL UNIQUE,
  run_id INTEGER,
  created_at INTEGER NOT NULL,
  period_from INTEGER,
  period_to INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('published', 'empty')),
  title TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  note TEXT
);
CREATE INDEX bulletins_created ON bulletins (created_at DESC);

CREATE TABLE bulletin_items (
  bulletin_id INTEGER NOT NULL REFERENCES bulletins (id),
  event_id INTEGER NOT NULL REFERENCES events (id),
  section TEXT NOT NULL,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('new', 'update')),
  highlight TEXT,
  snapshot_json TEXT NOT NULL,
  PRIMARY KEY (bulletin_id, event_id)
);
CREATE INDEX bulletin_items_event ON bulletin_items (event_id);

-- Document frequency of matching tokens, for IDF weighting in event matching.
CREATE TABLE token_df (
  token TEXT PRIMARY KEY,
  df INTEGER NOT NULL
);

CREATE TABLE companies (
  symbol TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sector TEXT,
  aliases_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE financial_reports (
  id INTEGER PRIMARY KEY,
  symbol TEXT NOT NULL REFERENCES companies (symbol),
  period TEXT NOT NULL,
  period_end TEXT,
  currency TEXT NOT NULL DEFAULT 'SAR',
  unit TEXT NOT NULL DEFAULT 'million',
  revenue REAL, gross_profit REAL, operating_profit REAL, net_profit REAL, non_recurring REAL,
  total_debt REAL, cash REAL, equity REAL, operating_cash_flow REAL, capex REAL,
  dps REAL, shares_outstanding REAL,
  source_url TEXT NOT NULL,
  disclosed_at TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (symbol, period)
);

CREATE TABLE prices (
  id INTEGER PRIMARY KEY,
  symbol TEXT NOT NULL REFERENCES companies (symbol),
  price REAL NOT NULL,
  as_of TEXT NOT NULL,
  source_url TEXT NOT NULL,
  note TEXT,
  UNIQUE (symbol, as_of)
);
