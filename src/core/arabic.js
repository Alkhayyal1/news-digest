// Arabic text normalization for MATCHING ONLY. Display text is always kept as-is.
// This module is pure (no Node imports) so it can be unit-tested anywhere.

const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_INDIC = '۰۱۲۳۴۵۶۷۸۹';

export function normalizeDigits(s) {
  return String(s ?? '').replace(/[٠-٩۰-۹]/g, (d) => {
    const i = ARABIC_INDIC.indexOf(d);
    return String(i >= 0 ? i : PERSIAN_INDIC.indexOf(d));
  }).replace(/٫/g, '.').replace(/٬/g, ',');
}

export function normalizeArabic(input) {
  let s = normalizeDigits(String(input ?? '')).normalize('NFKC');
  s = s.replace(TASHKEEL, '').replace(TATWEEL, '');
  s = s.replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/گ/g, 'ك')
    .replace(/ی/g, 'ي')
    .replace(/ک/g, 'ك');
  s = s.toLowerCase();
  // punctuation -> space (keep digits, letters, % and decimal points inside numbers)
  s = s.replace(/[«»"“”‘’'`´()\[\]{}<>|\\/:;!?؟،,؛…\-–—_*#@^~=+&]/g, ' ');
  s = s.replace(/\.(?!\d)/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

const STOP = new Set(`في من على الى إلى عن مع هذا هذه ذلك تلك التي الذي الذين اللذين ان أن إن او أو ثم قد لقد كان كانت يكون تكون بعد قبل خلال حول بين عند منذ حتى لدى كل كما لكن بل لا لم لن ما ماذا هل اي أي وقال قال قالت وقالت اليوم امس أمس غدا عام العام اكثر أكثر اقل أقل ايضا أيضا وفق وفقا عبر ضمن نحو اول أول هو هي هم نحن انه أنه انها أنها له لها لهم به بها فيه فيها عليه عليها منه منها
the a an of to in on for and or with by from at as is are was were be been it its this that these those after before over about into than new says said will has have had not but`.split(/\s+/).map((w) => normalizeArabic(w)));

// Light stemming: strip common clitic prefixes and a few suffixes. Deliberately conservative
// (we prefer false negatives in matching over merging different events).
export function lightStem(tok) {
  let t = tok;
  if (/^[a-z0-9.%]+$/.test(t)) return t.replace(/'s$/, '').replace(/(ies)$/, 'y').replace(/([^s])s$/, '$1');
  if (t.length > 4) t = t.replace(/^(وال|بال|كال|فال|لل)/, '');
  if (t.length > 3) t = t.replace(/^ال/, '');
  if (t.length > 4) t = t.replace(/(ات|ون|ين|ها|هم|يه|يا)$/, '');
  if (t.length > 3) t = t.replace(/[هي]$/, '');
  return t;
}

export function tokenize(text, { stem = true, keepStop = false } = {}) {
  const n = normalizeArabic(text);
  if (!n) return [];
  const out = [];
  for (const raw of n.split(' ')) {
    if (!raw) continue;
    if (!keepStop && STOP.has(raw)) continue;
    const t = stem ? lightStem(raw) : raw;
    if (t.length < 2 && !/\d/.test(t)) continue;
    out.push(t);
  }
  return out;
}

// Text used for the full-text index: normalized words plus their stems, so a query for
// "السعودية" also finds "والسعودية" and "سعودي".
export function indexText(...parts) {
  const words = normalizeArabic(parts.filter(Boolean).join(' ')).split(' ').filter(Boolean);
  const extra = [];
  for (const w of words) {
    const st = lightStem(w);
    if (st && st !== w) extra.push(st);
  }
  return words.concat(extra).join(' ');
}

export function hasArabic(s) {
  return /[؀-ۿ]/.test(String(s ?? ''));
}
