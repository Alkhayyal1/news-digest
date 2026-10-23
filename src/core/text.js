// Text helpers: entity decoding, HTML stripping, safe truncation. Pure module.
// Imported content is untrusted: we only ever keep plain text from it.

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·',
  zwnj: '‌', zwj: '‍', lrm: '', rlm: '', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£',
};

export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
      try {
        return String.fromCodePoint(code);
      } catch {
        return '';
      }
    }
    const v = NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

export function stripHtml(html) {
  let s = String(html ?? '');
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  s = s.replace(/<(script|style|iframe|noscript|svg|figure|figcaption)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n');
  s = s.replace(/<[^>]*>/g, ' ');
  s = decodeEntities(s);
  // a second pass: some feeds double-encode markup
  if (/<[a-z][^>]*>/i.test(s)) s = s.replace(/<[^>]*>/g, ' ');
  // control chars and bidi overrides are dropped (could be used to spoof display)
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F‪-‮⁦-⁩]/g, '');
  return s.replace(/[ \t\r\f\v]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

export function cleanText(s, max = 0) {
  const t = stripHtml(s).replace(/\s+/g, ' ').trim();
  return max ? truncate(t, max) : t;
}

export function truncate(s, max) {
  const t = String(s ?? '');
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim() + '…';
}

// First N sentences (Arabic or Latin punctuation). Used by the no-AI fallback summary.
export function firstSentences(s, n = 2, max = 320) {
  const t = cleanText(s);
  const parts = t.split(/(?<=[.!؟?])\s+/).filter(Boolean);
  return truncate(parts.slice(0, n).join(' '), max);
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Numbers with optional unit, normalized, used to detect "different amount" updates.
export function extractNumbers(text) {
  const t = String(text ?? '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/(\d),(\d{3})/g, '$1$2');
  const out = new Set();
  const re = /(\d+(?:\.\d+)?)\s*(%|٪|في المئة|بالمئة|بالمائة|percent|مليار|مليون|ألف|الف|billion|million|bn|mn|m\b|ريال|دولار|riyals?|dollars?|\$|نقطة|points?|برميل|barrels?)?/gi;
  let m;
  while ((m = re.exec(t))) {
    const n = m[1];
    if (/^(19|20)\d\d$/.test(n) && !m[2]) continue; // years are not "amounts"
    if (n.length === 1 && !m[2]) continue; // lone digits are noise ("3 people")
    let unit = (m[2] || '').toLowerCase();
    if (/^(%|٪|في المئة|بالمئة|بالمائة|percent)$/.test(unit)) unit = '%';
    else if (/^(مليار|billion|bn)$/.test(unit)) unit = 'bn';
    else if (/^(مليون|million|mn|m)$/.test(unit)) unit = 'mn';
    else if (/^(ألف|الف)$/.test(unit)) unit = 'k';
    else if (/^(ريال|riyals?|riyal)$/.test(unit)) unit = 'sar';
    else if (/^(دولار|dollars?|\$)$/.test(unit)) unit = 'usd';
    else if (/^(نقطة|points?)$/.test(unit)) unit = 'pt';
    else if (/^(برميل|barrels?)$/.test(unit)) unit = 'bbl';
    out.add(String(parseFloat(n)) + unit);
  }
  return [...out];
}
