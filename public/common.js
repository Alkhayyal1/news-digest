// Shared browser helpers. All imported text is inserted via escaping (esc) — never as raw HTML.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtFull = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
const fmtShort = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { timeZone: 'Asia/Riyadh', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
export const fmt = (ms) => (ms ? fmtFull.format(new Date(ms)) : '—');
export const fmtS = (ms) => (ms ? fmtShort.format(new Date(ms)) : '—');

export function ago(ms, now = Date.now()) {
  if (!ms) return '';
  const m = Math.round((now - ms) / 60000);
  if (m < 1) return 'الآن';
  if (m < 60) return `قبل ${m} دقيقة`;
  const h = Math.round(m / 60);
  if (h < 48) return `قبل ${h} ساعة`;
  return `قبل ${Math.round(h / 24)} يوم`;
}
export function until(ms, now = Date.now()) {
  const m = Math.round((ms - now) / 60000);
  if (m <= 0) return 'مستحق الآن';
  if (m < 60) return `بعد ${m} دقيقة`;
  return `بعد ${Math.floor(m / 60)} س ${m % 60} د`;
}

// Static build (GitHub Pages): no server; API paths map to prebuilt JSON files.
export const STATIC = !!document.querySelector('meta[name="static-mode"]');

async function staticApi(path) {
  const [p, qs] = path.split('?');
  const q = new URLSearchParams(qs || '');
  const get = async (file, notFound) => {
    const r = await fetch(file);
    if (!r.ok) throw Object.assign(new Error(notFound || `HTTP ${r.status}`), { status: r.status });
    return r.json();
  };
  let m;
  if (p === '/api/status') return get('data/status.json');
  if (p === '/api/sections') return get('data/sections.json');
  if (p === '/api/sources') return get('data/sources.json');
  if (p === '/api/bulletins/latest') return get('data/bulletins/latest.json');
  if (p === '/api/bulletins') return get(`data/bulletins/list-${q.get('empty') === '1' ? 'all' : 'pub'}-${Math.max(1, parseInt(q.get('page'), 10) || 1)}.json`, 'لا توجد صفحة بهذا الرقم');
  if ((m = p.match(/^\/api\/bulletins\/(\d+)$/))) return get(`data/bulletins/${m[1]}.json`, 'النشرة غير موجودة');
  if ((m = p.match(/^\/api\/events\/(\d+)$/))) return get(`data/events/${m[1]}.json`, 'تفاصيل هذا الحدث غير منشورة (الصفحات التفصيلية متاحة للأحداث الحديثة؛ الأقدم يظهر في النشرات والبحث).');
  if (p === '/api/search') return (await import('./static-search.js')).searchStatic(Object.fromEntries(q));
  if (p === '/api/admin/me') return { admin: true, enabled: true, static: true };
  if (p === '/api/admin/overview') return get('data/admin.json');
  throw new Error('هذه العملية غير متاحة في النسخة الثابتة');
}

export async function api(path, opts = {}) {
  if (STATIC) return staticApi(path);
  const res = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch', ...(opts.headers || {}) }, credentials: 'same-origin' });
  let body = null;
  try {
    body = await res.json();
  } catch {}
  if (!res.ok) throw Object.assign(new Error(body?.error || `HTTP ${res.status}`), { status: res.status });
  return body;
}

export const TYPE = { news: 'خبر', analysis: 'تحليل', statement: 'تصريح', update: 'تحديث جوهري' };
export const VERIFY = {
  official: 'جهة رسمية',
  confirmed: 'مؤكد من أكثر من مصدر',
  multi_source: 'عدة مصادر',
  single_source: 'مصدر واحد',
  preliminary: 'معلومات أولية',
  conflicting: 'روايات متضاربة',
};
export const RESEARCH = { peer_reviewed: 'بحث محكّم', preprint: 'بحث أولي غير محكّم', animal: 'دراسة على الحيوانات', human: 'دراسة على البشر', lab: 'دراسة مخبرية' };
export const HEALTH = { ok: 'يعمل', failing: 'متعطل', disabled: 'معطّل', pending: 'لم يُجلب بعد' };

export const isArabic = (s) => /[؀-ۿ]/.test(String(s || ''));
