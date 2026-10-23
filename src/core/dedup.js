// Event matching ("is this the same story?") and substantive-update detection.
// Design priority: never lose a distinct event. Ambiguous pairs stay separate and are recorded
// as "possible duplicates" for admin review. Pure module.
import { normalizeArabic, tokenize } from './arabic.js';
import { extractNumbers } from './text.js';
import { COUNTRIES } from './lexicon.js';

export const HOUR = 3600_000;

export const THRESHOLDS = {
  same: 0.5, // combined score at/above this -> same event
  sameCloseTitle: 0.44, // lower bar when headlines are close (titleSim >= 0.5), near in time, no number conflict
  review: 0.26, // [review, same) -> kept separate, flagged for admin review
  maxHoursApart: 96, // beyond this only near-identical titles are merged
  updateMinHours: 2, // an "update" must come at least this long after the last substantive change
};

const DECISION_WORDS = ['اعلن', 'اعلنت', 'قرر', 'قررت', 'اقر', 'اقرت', 'وافق', 'وافقت', 'اعتمد', 'اعتمدت', 'رفع', 'خفض', 'ثبت', 'وقع', 'وقعت', 'فاز', 'اطلق', 'اطلقت', 'نتيجه', 'نتائج', 'حكم', 'الغاء', 'تعليق', 'approved', 'announced', 'decided', 'raised', 'cut', 'signed', 'ruled', 'cancelled', 'suspended', 'confirmed', 'results'];
const DECISION_N = DECISION_WORDS.map((w) => normalizeArabic(w));

function trigrams(s) {
  const t = normalizeArabic(s).replace(/\s+/g, ' ');
  const out = new Set();
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  return out;
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [s, l] = a.size < b.size ? [a, b] : [b, a];
  for (const x of s) if (l.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// overlap coefficient: robust when one text is much shorter than the other
export function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [s, l] = a.size < b.size ? [a, b] : [b, a];
  for (const x of s) if (l.has(x)) inter++;
  return inter / s.size;
}

const COUNTRY_FORMS = COUNTRIES.map(([id, forms]) => [id, forms.map((f) => normalizeArabic(f))]);
// Countries named in a headline (whole words, clitics و/ب/ل/ف allowed).
export function titleActors(title) {
  const n = ' ' + normalizeArabic(title) + ' ';
  const out = new Set();
  for (const [id, forms] of COUNTRY_FORMS) {
    if (forms.some((f) => new RegExp(`[ ](?:[وبلف])?`+ f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + `[ ]`).test(n))) out.add(id);
  }
  return out;
}

export function features({ title, summary = '', entities = [], publishedAt = null, extraKey = '' }) {
  const body = `${title} ${String(summary).slice(0, 600)} ${extraKey}`;
  return {
    titleTri: trigrams(title),
    titleTok: new Set(tokenize(title)),
    tokens: new Set(tokenize(body)),
    numbers: new Set(extractNumbers(`${title} ${summary}`)),
    entities: new Set(entities.map((e) => (typeof e === 'string' ? e : e.id))),
    companies: new Set(entities.filter((e) => typeof e !== 'string' && e.kind === 'company').map((e) => e.id)),
    decisions: new Set(DECISION_N.filter((w) => normalizeArabic(body).includes(w))),
    actors: titleActors(title),
    t: publishedAt,
  };
}

// Serializable form for DB storage, and back.
export function packFeatures(f) {
  return JSON.stringify({ titleTri: [...f.titleTri], titleTok: [...f.titleTok], tokens: [...f.tokens], numbers: [...f.numbers], entities: [...f.entities], companies: [...f.companies], decisions: [...f.decisions], actors: [...(f.actors || [])], t: f.t });
}
export function unpackFeatures(s) {
  const o = typeof s === 'string' ? JSON.parse(s) : s;
  return { titleTri: new Set(o.titleTri), titleTok: new Set(o.titleTok), tokens: new Set(o.tokens), numbers: new Set(o.numbers), entities: new Set(o.entities), companies: new Set(o.companies || []), decisions: new Set(o.decisions || []), actors: new Set(o.actors || []), t: o.t };
}

function unitOf(n) {
  return n.replace(/^[\d.]+/, '');
}
const UNIT_AR = { bn: ' مليار', mn: ' مليون', k: ' ألف', '%': '%', sar: ' ريال', usd: ' دولار', pt: ' نقطة', bbl: ' برميل' };
function readable(n) {
  const u = unitOf(n);
  return n.slice(0, n.length - u.length) + (UNIT_AR[u] ?? '');
}

// Values in `a` (new item) whose unit the event `b` already reports, but with a value the event
// has never seen (e.g. event says "5 مليار", item says "7 مليار"). Order matters.
function numberConflict(a, b) {
  const unitsB = new Set([...b].map(unitOf).filter(Boolean));
  return [...a].filter((n) => unitOf(n) && unitsB.has(unitOf(n)) && !b.has(n));
}

// Weighted overlap / Jaccard: `w(token)` is an IDF-style weight so that very common words
// ("السعودية", "الأمم المتحدة") count little and distinctive words count a lot.
const ONE = () => 1;
function wsum(set, w) {
  let s = 0;
  for (const x of set) s += w(x);
  return s;
}
export function wOverlap(a, b, w = ONE) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += w(x);
  return inter / Math.min(wsum(a, w), wsum(b, w));
}
export function wJaccard(a, b, w = ONE) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += w(x);
  return inter / (wsum(a, w) + wsum(b, w) - inter);
}

export function compare(a, b, w = ONE) {
  const titleSim = Math.max(jaccard(a.titleTri, b.titleTri), 0.95 * wOverlap(a.titleTok, b.titleTok, w) * (Math.min(a.titleTok.size, b.titleTok.size) >= 3 ? 1 : 0.5));
  const textSim = Math.max(wJaccard(a.tokens, b.tokens, w), 0.85 * wOverlap(a.tokens, b.tokens, w) * (Math.min(a.tokens.size, b.tokens.size) >= 6 ? 1 : 0.4));
  const entitySim = a.entities.size && b.entities.size ? jaccard(a.entities, b.entities) : 0;
  // the same specific figure (e.g. "36%", "25 مليار") on both sides is strong evidence
  const sharedNumbers = [...a.numbers].filter((x) => unitOf(x) && b.numbers.has(x)).length;
  const score = Math.min(1, 0.5 * titleSim + 0.4 * textSim + 0.1 * entitySim + Math.min(0.12, 0.08 * sharedNumbers));
  const hours = a.t && b.t ? Math.abs(a.t - b.t) / HOUR : null;
  const conflicts = numberConflict(a.numbers, b.numbers);
  const sharedCompany = [...a.companies].some((c) => b.companies.has(c));
  const aOnly = [...(a.actors || [])].filter((x) => !(b.actors || new Set()).has(x));
  const bOnly = [...(b.actors || [])].filter((x) => !(a.actors || new Set()).has(x));
  const differentActors = aOnly.length > 0 && bOnly.length > 0;
  return { score, titleSim, textSim, entitySim, sharedNumbers, hours, conflicts, sharedCompany, differentActors };
}
// Decide relation of a new item `n` to an existing event `e` (features aggregated over its items).
// Returns { relation: 'same' | 'update' | 'different' | 'review', ...metrics, reason }
// `e` is the most similar single item of the event (similarity is measured item-to-item so a growing
// event does not become a magnet); `union` holds all the event's numbers/decisions for update detection.
export function decide(n, e, { lastSubstantiveAt = null, union = e, w = ONE } = {}) {
  const c = compare(n, e, w);
  c.conflicts = numberConflict(n.numbers, union.numbers);
  const r = (relation, reason) => ({ relation, reason, ...c, score: Math.round(c.score * 1000) / 1000 });

  if (c.hours !== null && c.hours > THRESHOLDS.maxHoursApart) {
    if (c.titleSim >= 0.85) return r('same', 'عنوان شبه مطابق لحدث قديم (إعادة نشر)');
    return r('different', 'فارق زمني كبير');
  }
  // Each headline names a country the other does not (e.g. "مصر تدين" vs "قطر تدين") -> different statements.
  if (c.differentActors) return r(c.score >= THRESHOLDS.review ? 'review' : 'different', 'جهات فاعلة مختلفة في العنوان');
  // Different companies named on each side (e.g. two banks' results) -> never the same event.
  if (n.companies.size && e.companies.size && !c.sharedCompany) return r(c.score >= THRESHOLDS.review ? 'review' : 'different', 'شركات مختلفة');
  // Same company, but the texts are not about the same thing -> must NOT merge.
  if (c.sharedCompany && c.titleSim < 0.35 && c.textSim < 0.3) return r(c.score >= THRESHOLDS.review ? 'review' : 'different', 'نفس الشركة لكن موضوع مختلف');

  let same = c.score >= THRESHOLDS.same;
  // Close headlines with solid overall similarity, published close together.
  if (!same && c.score >= THRESHOLDS.sameCloseTitle && c.titleSim >= 0.5 && (c.hours === null || c.hours <= 36) && c.conflicts.length === 0) same = true;
  // Same story whose figures changed (e.g. amount revised): strong title + text overlap.
  if (!same && c.conflicts.length && c.titleSim >= 0.5 && c.textSim >= 0.4) same = true;
  if (!same) return r(c.score >= THRESHOLDS.review ? 'review' : 'different', c.score >= THRESHOLDS.review ? 'تشابه جزئي يحتاج مراجعة' : 'غير متشابه');

  // Same story. Is it a substantive development?
  const newNumbers = [...n.numbers].filter((x) => !union.numbers.has(x) && unitOf(x));
  const newDecisions = [...n.decisions].filter((x) => !union.decisions.has(x));
  const late = n.t && lastSubstantiveAt ? (n.t - lastSubstantiveAt) / HOUR >= THRESHOLDS.updateMinHours : false;
  if (late && (c.conflicts.length || newDecisions.length || newNumbers.length >= 1)) {
    const what = [];
    if (c.conflicts.length) {
      const units = new Set(c.conflicts.map(unitOf));
      const before = [...union.numbers].filter((x) => units.has(unitOf(x)));
      what.push(`رقم جديد: ${c.conflicts.map(readable).join('، ')} (سابقًا: ${before.map(readable).join('، ')})`);
    } else if (newNumbers.length) what.push('أرقام جديدة: ' + newNumbers.map(readable).join('، '));
    if (newDecisions.length) what.push('إعلان أو قرار جديد');
    return { ...r('update', 'تطور جوهري'), changed: what.join(' — ') };
  }
  return r('same', c.titleSim >= 0.6 ? 'عنوان متقارب' : 'تشابه في المحتوى والكيانات');
}

// Best match of item `n` against an event given its items' features.
export function decideEvent(n, itemFeatures, union, opts = {}) {
  let best = null;
  for (const f of itemFeatures) {
    const s = compare(n, f, opts.w).score;
    if (!best || s > best.s) best = { f, s };
  }
  return decide(n, best ? best.f : union, { ...opts, union });
}

// Merge item features into event features (event = union, capped to keep it focused).
export function mergeFeatures(e, n) {
  const cap = (set, max) => new Set([...set].slice(-max));
  return {
    titleTri: e.titleTri.size >= n.titleTri.size ? e.titleTri : n.titleTri,
    titleTok: cap(new Set([...e.titleTok, ...n.titleTok]), 40),
    tokens: cap(new Set([...e.tokens, ...n.tokens]), 200),
    numbers: new Set([...e.numbers, ...n.numbers]),
    entities: new Set([...e.entities, ...n.entities]),
    companies: new Set([...e.companies, ...n.companies]),
    decisions: new Set([...e.decisions, ...n.decisions]),
    t: Math.min(e.t || Infinity, n.t || Infinity) === Infinity ? null : Math.min(e.t || Infinity, n.t || Infinity),
  };
}

// Content fingerprint for "same article republished" detection (normalized title + lead).
export function contentHash(title, summary) {
  const s = normalizeArabic(`${title} ${String(summary).slice(0, 300)}`);
  // FNV-1a 64-bit as hex (two 32-bit halves); deterministic and dependency-free
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

