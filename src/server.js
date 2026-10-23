import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { join, dirname, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, assertProductionConfig } from './config.js';
import { openDb, J } from './db.js';
import { runUpdate, tick, startScheduler, lockInfo, recoverAfterRestart } from './runner.js';
import { getBulletin } from './bulletin.js';
import { status, publicSources, eventDetail, companyDetail, companiesList, latestBulletin, bulletinList, adminOverview } from './views.js';
import { searchEvents } from './search.js';
import { splitItem, mergeEvents, dismissReview } from './admin.js';
import { SECTIONS } from './core/lexicon.js';
import { canonicalizeUrl, hostOf, hostAllowed } from './core/url.js';
import { aiAvailable } from './ai.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function readJson(req, max = 100_000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > max) throw new HttpError(413, 'الطلب كبير جدًا');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON غير صالح');
  }
}

// ---- admin session: HMAC-signed cookie, HttpOnly, SameSite=Strict ----
const adminEnabled = () => assertProductionConfig().length === 0;
function sign(v) {
  return createHmac('sha256', config.sessionSecret).update(v).digest('base64url');
}
function makeSession() {
  const exp = Date.now() + 12 * 3600_000;
  const v = `admin.${exp}.${randomBytes(8).toString('hex')}`;
  return `${v}.${sign(v)}`;
}
function isAdmin(req) {
  if (!adminEnabled()) return false;
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)nd_admin=([^;]+)/);
  if (!m) return false;
  const parts = m[1].split('.');
  if (parts.length !== 4) return false;
  const v = parts.slice(0, 3).join('.');
  const a = Buffer.from(sign(v));
  const b = Buffer.from(parts[3]);
  return a.length === b.length && timingSafeEqual(a, b) && Number(parts[1]) > Date.now();
}
function safeEqual(a, b) {
  const x = createHmac('sha256', 'cmp').update(String(a)).digest();
  const y = createHmac('sha256', 'cmp').update(String(b)).digest();
  return timingSafeEqual(x, y);
}
const loginAttempts = new Map();
const manualByIp = new Map();
const clientIp = (req) => String(req.headers['fly-client-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

const num = (v) => (v === '' || v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : NaN);

export function createApp(db, { fetchImpl } = {}) {
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, ...opts });

  route('GET', '/api/status', () => status(db));
  route('GET', '/api/sections', () => SECTIONS);
  route('GET', '/api/sources', () => publicSources(db).map(({ key, name, enabled, is_official, health }) => ({ key, name, enabled, is_official, health })));
  route('GET', '/api/bulletins/latest', () => latestBulletin(db));
  route('GET', '/api/bulletins', (req, p, q) => bulletinList(db, Math.max(1, parseInt(q.get('page'), 10) || 1), q.get('empty') === '1'));
  route('GET', '/api/bulletins/:id', (req, p) => getBulletin(db, +p.id) || Promise.reject(new HttpError(404, 'النشرة غير موجودة')));
  route('GET', '/api/events/:id', (req, p) => eventDetail(db, +p.id) || Promise.reject(new HttpError(404, 'الخبر غير موجود')));
  route('GET', '/api/search', (req, p, q) => searchEvents(db, Object.fromEntries(q)));
  route('GET', '/api/companies', () => companiesList(db));
  route('GET', '/api/companies/:symbol', (req, p) => companyDetail(db, p.symbol) || Promise.reject(new HttpError(404, 'الشركة غير موجودة')));

  // Public manual refresh: rate-limited, and refused while another run holds the lock.
  route('POST', '/api/refresh', (req) => {
    const now = Date.now();
    if (lockInfo(db, now)) throw new HttpError(409, 'يوجد تحديث قيد التشغيل الآن.');
    const last = db.prepare("SELECT MAX(started_at) t FROM runs WHERE status != 'skipped_locked'").get().t || 0;
    const gap = config.manualMinGapMinutes * 60_000;
    if (now - last < gap) throw new HttpError(429, `آخر تحديث بدأ قبل أقل من ${config.manualMinGapMinutes} دقيقة. حاول لاحقًا.`);
    const ip = clientIp(req);
    if (now - (manualByIp.get(ip) || 0) < gap) throw new HttpError(429, 'طلبت تحديثًا مؤخرًا.');
    manualByIp.set(ip, now);
    runUpdate(db, { kind: 'manual', fetchImpl }).catch((e) => console.error('[manual] run error', e));
    return { started: true };
  });

  // External scheduler hook (for hosts that may sleep): same idempotent tick as the timer.
  route('POST', '/api/cron', async (req) => {
    if (!config.cronSecret || !safeEqual(req.headers['x-cron-secret'] || '', config.cronSecret)) throw new HttpError(401, 'unauthorized');
    return tick(db, { fetchImpl, trigger: 'external' });
  });

  // ---- admin ----
  route('POST', '/api/admin/login', async (req, p, q, res) => {
    if (!adminEnabled()) throw new HttpError(503, 'لوحة الإدارة معطلة: اضبط ADMIN_PASSWORD وSESSION_SECRET في متغيرات البيئة.');
    const ip = clientIp(req);
    const a = loginAttempts.get(ip) || { n: 0, t: 0 };
    if (a.n >= 5 && Date.now() - a.t < 15 * 60_000) throw new HttpError(429, 'محاولات كثيرة، حاول بعد 15 دقيقة.');
    const body = await readJson(req);
    if (!safeEqual(body.password || '', config.adminPassword)) {
      loginAttempts.set(ip, { n: a.n + 1, t: Date.now() });
      throw new HttpError(401, 'كلمة المرور غير صحيحة');
    }
    loginAttempts.delete(ip);
    const secure = (req.headers['x-forwarded-proto'] || '').includes('https') || config.publicBaseUrl.startsWith('https') ? '; Secure' : '';
    res.setHeader('set-cookie', `nd_admin=${makeSession()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`);
    return { ok: true };
  });
  route('POST', '/api/admin/logout', (req, p, q, res) => {
    res.setHeader('set-cookie', 'nd_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return { ok: true };
  });
  route('GET', '/api/admin/me', (req) => ({ admin: isAdmin(req), enabled: adminEnabled() }));
  route('GET', '/api/admin/overview', () => adminOverview(db), { admin: true });
  route('POST', '/api/admin/run', () => {
    if (lockInfo(db)) throw new HttpError(409, 'يوجد تحديث قيد التشغيل الآن.');
    runUpdate(db, { kind: 'manual', fetchImpl }).catch((e) => console.error('[admin] run error', e));
    return { started: true };
  }, { admin: true });
  route('PATCH', '/api/admin/sources/:id', async (req, p) => {
    const s = db.prepare('SELECT * FROM sources WHERE id = ?').get(+p.id);
    if (!s) throw new HttpError(404, 'غير موجود');
    const b = await readJson(req);
    const next = { ...s, allowed_hosts: J(s.allowed_hosts, []) };
    for (const k of ['name', 'notes', 'link_pattern', 'section_hint']) if (k in b) next[k] = b[k] === '' ? null : String(b[k]).slice(0, 500);
    if ('enabled' in b) next.enabled = b.enabled ? 1 : 0;
    if ('is_official' in b) next.is_official = b.is_official ? 1 : 0;
    if ('default_scope' in b && ['saudi', 'world', 'auto'].includes(b.default_scope)) next.default_scope = b.default_scope;
    if ('allowed_hosts' in b) next.allowed_hosts = (Array.isArray(b.allowed_hosts) ? b.allowed_hosts : String(b.allowed_hosts).split(',')).map((h) => String(h).trim().toLowerCase()).filter((h) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h));
    if ('url' in b) {
      const u = canonicalizeUrl(b.url);
      if (!u) throw new HttpError(400, 'رابط غير صالح');
      next.url = String(b.url).trim();
    }
    if (!hostAllowed(hostOf(next.url), next.allowed_hosts)) throw new HttpError(400, 'مضيف رابط المصدر يجب أن يكون ضمن المضيفين المسموح بهم');
    if (next.link_pattern) {
      try { new RegExp(next.link_pattern); } catch { throw new HttpError(400, 'نمط الروابط غير صالح'); }
    }
    db.prepare('UPDATE sources SET name = ?, url = ?, notes = ?, link_pattern = ?, section_hint = ?, enabled = ?, is_official = ?, default_scope = ?, allowed_hosts = ?, updated_at = ? WHERE id = ?').run(
      next.name, next.url, next.notes, next.link_pattern, next.section_hint, next.enabled, next.is_official, next.default_scope, JSON.stringify(next.allowed_hosts), Date.now(), s.id);
    return { ok: true };
  }, { admin: true });
  route('POST', '/api/admin/sources', async (req) => {
    const b = await readJson(req);
    const key = String(b.key || '').trim();
    if (!/^[a-z0-9_]{2,40}$/.test(key)) throw new HttpError(400, 'مفتاح غير صالح (أحرف إنجليزية صغيرة وأرقام و_)');
    if (!['rss', 'html_list'].includes(b.type)) throw new HttpError(400, 'النوع يجب أن يكون rss أو html_list');
    const url = String(b.url || '').trim();
    if (!canonicalizeUrl(url)) throw new HttpError(400, 'رابط غير صالح');
    const hosts = [hostOf(url).replace(/^www\./, '')];
    const now = Date.now();
    db.prepare(`INSERT INTO sources (key, name, url, type, language, default_scope, section_hint, is_official, enabled, allowed_hosts, link_pattern, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`).run(key, String(b.name || key).slice(0, 200), url, b.type, b.language === 'en' ? 'en' : 'ar',
      ['saudi', 'world', 'auto'].includes(b.default_scope) ? b.default_scope : 'auto', b.section_hint || null, b.is_official ? 1 : 0, JSON.stringify(hosts), b.link_pattern || null, b.notes || null, now, now);
    return { ok: true, note: 'أُضيف المصدر معطّلًا؛ فعّله بعد التحقق.' };
  }, { admin: true });
  route('POST', '/api/admin/split', async (req) => splitItem(db, +(await readJson(req)).itemId), { admin: true });
  route('POST', '/api/admin/merge', async (req) => {
    const b = await readJson(req);
    return mergeEvents(db, +b.intoId, +b.fromId);
  }, { admin: true });
  route('POST', '/api/admin/reviews/:id/dismiss', (req, p) => {
    dismissReview(db, +p.id);
    return { ok: true };
  }, { admin: true });
  route('POST', '/api/admin/events/:id/hide', async (req, p) => {
    const b = await readJson(req);
    db.prepare('UPDATE events SET hidden = ? WHERE id = ? AND merged_into IS NULL').run(b.hidden ? 1 : 0, +p.id);
    return { ok: true };
  }, { admin: true });
  route('POST', '/api/admin/financials', async (req) => {
    const b = await readJson(req);
    if (!db.prepare('SELECT 1 FROM companies WHERE symbol = ?').get(String(b.symbol))) throw new HttpError(400, 'رمز غير معروف');
    if (!/^\d{4}-(Q[1-4]|H[12]|FY)$/.test(String(b.period))) throw new HttpError(400, 'الفترة بصيغة 2026-Q2 أو 2026-FY');
    const src = canonicalizeUrl(b.source_url);
    if (!src) throw new HttpError(400, 'رابط الإفصاح الأصلي مطلوب');
    const fields = ['revenue', 'gross_profit', 'operating_profit', 'net_profit', 'non_recurring', 'total_debt', 'cash', 'equity', 'operating_cash_flow', 'capex', 'dps', 'shares_outstanding'];
    const vals = fields.map((f) => num(b[f]));
    if (vals.some((v) => Number.isNaN(v))) throw new HttpError(400, 'قيمة رقمية غير صالحة');
    db.prepare(`INSERT INTO financial_reports (symbol, period, period_end, currency, unit, ${fields.join(', ')}, source_url, disclosed_at, notes, created_at)
      VALUES (?, ?, ?, 'SAR', 'million', ${fields.map(() => '?').join(', ')}, ?, ?, ?, ?)
      ON CONFLICT(symbol, period) DO UPDATE SET ${fields.map((f) => `${f} = excluded.${f}`).join(', ')}, period_end = excluded.period_end, source_url = excluded.source_url, disclosed_at = excluded.disclosed_at, notes = excluded.notes`).run(
      String(b.symbol), String(b.period), b.period_end || null, ...vals, src, b.disclosed_at || null, b.notes ? String(b.notes).slice(0, 500) : null, Date.now());
    return { ok: true };
  }, { admin: true });
  route('POST', '/api/admin/prices', async (req) => {
    const b = await readJson(req);
    const price = num(b.price);
    if (!db.prepare('SELECT 1 FROM companies WHERE symbol = ?').get(String(b.symbol))) throw new HttpError(400, 'رمز غير معروف');
    if (!(price > 0)) throw new HttpError(400, 'سعر غير صالح');
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(b.as_of))) throw new HttpError(400, 'تاريخ السعر مطلوب بصيغة YYYY-MM-DD');
    const src = canonicalizeUrl(b.source_url);
    if (!src) throw new HttpError(400, 'رابط مصدر السعر مطلوب');
    db.prepare('INSERT INTO prices (symbol, price, as_of, source_url, note) VALUES (?, ?, ?, ?, ?) ON CONFLICT(symbol, as_of) DO UPDATE SET price = excluded.price, source_url = excluded.source_url, note = excluded.note').run(
      String(b.symbol), price, String(b.as_of).slice(0, 16), src, b.note ? String(b.note).slice(0, 200) : 'سعر إغلاق (ليس لحظيًا)');
    return { ok: true };
  }, { admin: true });

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://local');
    const path = url.pathname;
    try {
      if (path.startsWith('/api/')) {
        for (const r of routes) {
          if (r.method !== req.method) continue;
          const m = path.match(r.re);
          if (!m) continue;
          if (r.admin) {
            if (!isAdmin(req)) throw new HttpError(401, 'يلزم تسجيل الدخول للإدارة');
            if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'fetch') throw new HttpError(403, 'طلب مرفوض');
          }
          const out = await r.handler(req, m.groups || {}, url.searchParams, res);
          return send(res, 200, out ?? { ok: true });
        }
        throw new HttpError(404, 'غير موجود');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'غير مسموح');
      let file = path === '/' ? '/index.html' : path === '/admin' ? '/admin.html' : path;
      file = normalize(file).replace(/^([/\\])+/, '');
      if (file.includes('..')) throw new HttpError(400, 'bad path');
      let body;
      try {
        body = await readFile(join(PUBLIC_DIR, file));
      } catch {
        throw new HttpError(404, 'غير موجود');
      }
      res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=300' });
      return res.end(req.method === 'HEAD' ? undefined : body);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      return send(res, status, { error: status === 500 ? 'خطأ داخلي' : e.message });
    }
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const db = openDb(config.dbPath);
  const interrupted = recoverAfterRestart(db);
  if (interrupted) console.warn(`[server] marked ${interrupted} interrupted run(s) as failed`);
  const problems = assertProductionConfig();
  for (const p of problems) console.warn('[config]', p);
  if (!aiAvailable()) console.warn('[config] ANTHROPIC_API_KEY not set: running in limited mode (no AI summaries).');
  const server = createServer(createApp(db));
  server.listen(config.port, () => console.log(`[server] listening on :${config.port}`));
  if (config.schedulerEnabled) startScheduler(db);
  const shutdown = () => {
    server.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
