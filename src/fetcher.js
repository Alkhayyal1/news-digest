// Outbound HTTP with an allow-list: every request (and every redirect hop) must target a host
// allowed for that source. Bodies are size-capped and decoded as text only.
import { config } from './config.js';
import { hostAllowed } from './core/url.js';

export class FetchError extends Error {
  constructor(message, { status = null, retryable = false } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function safeFetchText(url, { allowedHosts, fetchImpl = globalThis.fetch, timeoutMs = config.fetchTimeoutMs, maxBytes = config.fetchMaxBytes, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchOnce(url, { allowedHosts, fetchImpl, timeoutMs, maxBytes });
    } catch (e) {
      lastErr = e;
      if (!(e instanceof FetchError) || !e.retryable || attempt === retries) break;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastErr;
}

async function fetchOnce(startUrl, { allowedHosts, fetchImpl, timeoutMs, maxBytes }) {
  let url = startUrl;
  for (let hop = 0; hop < 6; hop++) {
    let u;
    try {
      u = new URL(url);
    } catch {
      throw new FetchError(`رابط غير صالح: ${url}`);
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new FetchError(`بروتوكول غير مسموح: ${u.protocol}`);
    if (!hostAllowed(u.hostname, allowedHosts)) throw new FetchError(`المضيف غير مسموح لهذا المصدر: ${u.hostname}`);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(u.toString(), {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'user-agent': config.userAgent, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5', 'accept-language': 'ar,en;q=0.8' },
      });
    } catch (e) {
      clearTimeout(timer);
      throw new FetchError(e.name === 'AbortError' ? 'انتهت مهلة الاتصال' : `تعذر الاتصال: ${e.message}`, { retryable: true });
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      clearTimeout(timer);
      url = new URL(res.headers.get('location'), u).toString();
      continue;
    }
    try {
      if (!res.ok) throw new FetchError(`HTTP ${res.status}`, { status: res.status, retryable: res.status >= 500 || res.status === 429 });
      const body = await readCapped(res, maxBytes);
      return { url: u.toString(), status: res.status, contentType: res.headers.get('content-type') || '', text: decode(body, res.headers.get('content-type')) };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new FetchError('تحويلات كثيرة');
}

async function readCapped(res, maxBytes) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new FetchError('حجم الاستجابة يتجاوز الحد');
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {}
      throw new FetchError('حجم الاستجابة يتجاوز الحد');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function decode(bytes, contentType) {
  let charset = (String(contentType || '').match(/charset=([\w-]+)/i) || [])[1];
  if (!charset) {
    const head = new TextDecoder('latin1').decode(bytes.slice(0, 300));
    charset = (head.match(/encoding=["']([\w-]+)["']/i) || [])[1] || 'utf-8';
  }
  try {
    return new TextDecoder(charset.toLowerCase(), { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}
