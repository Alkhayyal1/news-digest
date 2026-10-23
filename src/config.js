// All configuration comes from environment variables (see .env.example). Secrets never leave
// the server: nothing here is sent to the browser except non-secret display values.
const env = process.env;
const int = (v, d) => (v === undefined || v === '' ? d : parseInt(v, 10));

export const config = {
  port: int(env.PORT, 8080),
  dbPath: env.DB_PATH || './data/news.db',
  publicBaseUrl: env.PUBLIC_BASE_URL || '',
  adminPassword: env.ADMIN_PASSWORD || '',
  sessionSecret: env.SESSION_SECRET || '',
  cronSecret: env.CRON_SECRET || '',
  schedulerEnabled: env.SCHEDULER_ENABLED !== 'false',
  scheduleAnchor: env.SCHEDULE_ANCHOR || '', // ISO time; first slot. Saved to DB on first boot.
  intervalHours: int(env.INTERVAL_HOURS, 7),
  overlapHours: int(env.FETCH_OVERLAP_HOURS, 6),
  firstRunLookbackHours: int(env.FIRST_RUN_LOOKBACK_HOURS, 36),
  maxItemAgeHours: int(env.MAX_ITEM_AGE_HOURS, 72),
  manualMinGapMinutes: int(env.MANUAL_MIN_GAP_MINUTES, 15),
  fetchTimeoutMs: int(env.FETCH_TIMEOUT_MS, 20000),
  fetchMaxBytes: int(env.FETCH_MAX_BYTES, 6 * 1024 * 1024),
  userAgent: env.FETCH_USER_AGENT || 'SaudiNewsDigest/1.0 (+news aggregator; contact: admin)',
  anthropicApiKey: env.ANTHROPIC_API_KEY || '',
  aiModel: env.AI_MODEL || 'claude-opus-5-5',
  aiEffort: env.AI_EFFORT || 'low',
  aiMaxEventsPerRun: int(env.AI_MAX_EVENTS_PER_RUN, 60),
  aiBatchSize: int(env.AI_BATCH_SIZE, 8),
};

export function assertProductionConfig() {
  const problems = [];
  if (!config.adminPassword || config.adminPassword.length < 12) problems.push('ADMIN_PASSWORD missing or shorter than 12 characters (admin panel disabled)');
  if (!config.sessionSecret || config.sessionSecret.length < 32) problems.push('SESSION_SECRET missing or shorter than 32 characters (admin panel disabled)');
  return problems;
}
