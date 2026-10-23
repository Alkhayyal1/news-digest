// Rule-based classifier: scope, primary section, sports exclusion, content type, entities,
// importance. Used always (AI output, when available, can only refine within allowed values).
import { normalizeArabic } from './arabic.js';
import { LEX, COMPANIES, ORGS, SECTIONS } from './lexicon.js';

const NLEX = Object.fromEntries(Object.entries(LEX).map(([k, arr]) => [k, [...new Set(arr.map((w) => normalizeArabic(w)).filter(Boolean))]]));

const ENTITY_DICT = [
  ...COMPANIES.map((c) => ({ id: 'co:' + c.symbol, label: c.name, kind: 'company', symbol: c.symbol, terms: c.genericName ? c.aliases : [c.name, ...c.aliases] })),
  ...ORGS.map(([label, aliases]) => ({ id: 'org:' + normalizeArabic(label), label, kind: 'org', terms: [label, ...aliases] })),
].map((e) => ({ ...e, terms: [...new Set(e.terms.map((t) => normalizeArabic(t)).filter((t) => t.length >= 2))] }));

// whole-word containment on normalized text, allowing Arabic clitic prefixes (و ب ل ف ك ال)
function contains(norm, term) {
  if (!term) return false;
  let from = 0;
  for (;;) {
    const i = norm.indexOf(term, from);
    if (i < 0) return false;
    const before = norm.slice(Math.max(0, i - 3), i);
    const after = norm[i + term.length];
    const okBefore = i === 0 || norm[i - 1] === ' ' || /(^| )(و|ب|ل|ف|ك|وب|ول|وال|بال|لل|فال|ال)$/.test(before);
    // whole word only: "الرياض" must not match "الرياضه" (sport)
    const okAfter = after === undefined || after === ' ';
    if (okBefore && okAfter) return true;
    from = i + 1;
  }
}

export function hits(norm, key) {
  const found = [];
  for (const w of NLEX[key] || []) if (contains(norm, w)) found.push(w);
  return found;
}

export function extractEntities(text) {
  const norm = normalizeArabic(text);
  const out = [];
  for (const e of ENTITY_DICT) {
    if (e.terms.some((t) => contains(norm, t))) out.push({ id: e.id, label: e.label, kind: e.kind, symbol: e.symbol || null });
  }
  // Ticker mentions such as "(2222)" or "رمز 1120"
  const re = /(?:\(|رمز\s*|ticker\s*)(\d{4})\)?/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const co = COMPANIES.find((c) => c.symbol === m[1]);
    if (co && !out.some((x) => x.id === 'co:' + co.symbol)) out.push({ id: 'co:' + co.symbol, label: co.name, kind: 'company', symbol: co.symbol });
  }
  // Latin proper nouns (for English sources): runs of Capitalized Words
  const latin = String(text || '').match(/\b([A-Z][a-zA-Z&.-]+(?:\s+[A-Z][a-zA-Z&.-]+){0,3})\b/g) || [];
  const STOPCAP = new Set(['The', 'A', 'An', 'In', 'On', 'At', 'For', 'And', 'But', 'This', 'That', 'It', 'He', 'She', 'They', 'We', 'Its', 'New', 'After', 'Why', 'How', 'What', 'When']);
  for (const l of latin) {
    if (STOPCAP.has(l) || l.length < 3) continue;
    const id = 'name:' + l.toLowerCase();
    if (!out.some((x) => x.id === id) && !ENTITY_DICT.some((e) => e.terms.includes(normalizeArabic(l)))) out.push({ id, label: l, kind: 'name', symbol: null });
  }
  return out.slice(0, 20);
}

// Decide whether an item is sports content that must be excluded.
// Purely financial/development stories about sports entities are kept (and classified as economy).
export function sportsCheck({ title, summary, categories = [], sourcePrefix = '' }) {
  const norm = normalizeArabic(`${title} ${summary}`);
  const cats = normalizeArabic(`${categories.join(' ')} ${sourcePrefix}`);
  const sportsCategory = /(^| )(رياضه|رياضي|الرياضه|sport|sports|football|كره)( |$)/.test(cats);
  const sports = new Set(hits(norm, 'sports_hard'));
  const transfer = hits(norm, 'transfer').length > 0;
  const finance = new Set(hits(norm, 'finance'));
  const sportsScore = sports.size + (sportsCategory ? 2 : 0);
  if (sportsScore < 2) return { excluded: false, sportsFinance: false, reason: '' };
  // Transfers, results and player news are always excluded even if they mention money.
  if (transfer) return { excluded: true, sportsFinance: false, reason: 'انتقالات/لاعبين' };
  if (finance.size >= 2 && finance.size >= sports.size - 1) return { excluded: false, sportsFinance: true, reason: 'اقتصادي مرتبط بالرياضة' };
  return { excluded: true, sportsFinance: false, reason: 'محتوى رياضي' };
}

// Feed/section categories published by the source itself are a strong, cheap signal.
const CATEGORY_HINTS = [
  [/(^| )(اقتصاد|الاقتصاد|اقتصادي|مال واعمال|اعمال|economy|business|markets?)( |$)/, { saudi: 'sa_economy', world: 'w_economy' }],
  [/(^| )(تقنيه|التقنيه|تكنولوجيا|علوم وتكنولوجيا|technology|tech)( |$)/, { world: 'w_tech' }],
  [/(^| )(صحه|الصحه|علوم|science|health)( |$)/, { world: 'w_science' }],
  [/(^| )(طاقه|الطاقه|نفط|energy)( |$)/, { world: 'w_energy' }],
  [/(^| )(سياسه|السياسه|politics)( |$)/, { saudi: 'sa_politics', world: 'w_politics' }],
];
// Non-news sections (lifestyle, celebrities, society pages) are left out of bulletins.
const SOFT_CATEGORIES = /(^| )(منوعات|يوميات الشرق|مشاهير|الناس|المراه|لايف ستايل|lifestyle|entertainment|celebrity)( |$)/;

export function classify({ title, summary = '', categories = [], source = {}, sourcePrefix = '' }) {
  const text = `${title} ${summary}`;
  const norm = normalizeArabic(text);
  const sport = sportsCheck({ title, summary, categories, sourcePrefix });
  const catNorm = normalizeArabic(categories.join(' | '));
  if (!sport.excluded && SOFT_CATEGORIES.test(catNorm)) Object.assign(sport, { excluded: true, reason: 'منوعات (ليست خبرًا)' });
  const entities = extractEntities(text);

  const saudiHits = hits(norm, 'saudi').length + entities.filter((e) => e.kind === 'company').length;
  let scope = source.default_scope || null;
  if (!scope || scope === 'auto') scope = saudiHits >= 1 ? 'saudi' : 'world';
  // A Saudi source covering foreign news stays "world" unless the text is about the Kingdom.
  if (source.default_scope === 'saudi' && saudiHits === 0 && hits(norm, 'w_politics').length + hits(norm, 'w_economy').length + hits(norm, 'w_tech').length + hits(norm, 'w_science').length + hits(norm, 'w_energy').length >= 2) scope = 'world';

  const keys = SECTIONS.filter((s) => s.scope === scope).map((s) => s.key);
  const score = Object.fromEntries(keys.map((k) => [k, hits(norm, k).length]));
  if (source.section_hint && score[source.section_hint] !== undefined) score[source.section_hint] += 1.5;
  for (const [re, map] of CATEGORY_HINTS) if (re.test(catNorm) && map[scope] && score[map[scope]] !== undefined) score[map[scope]] += 1.5;
  if (scope === 'saudi') {
    const companies = entities.filter((e) => e.kind === 'company');
    if (companies.length && score.sa_companies > 0) score.sa_companies += 2;
    if (score.sa_market > 0 && score.sa_companies > 0 && !companies.length) score.sa_market += 1;
    if (sport.sportsFinance) score.sa_economy += 3;
  } else if (sport.sportsFinance) {
    score.w_business += 3;
  }
  const fallback = scope === 'saudi' ? 'sa_local' : 'w_politics';
  let section = fallback;
  let best = 0;
  for (const k of keys) {
    if (score[k] > best) {
      best = score[k];
      section = k;
    }
  }
  const secondary = keys.filter((k) => k !== section && score[k] >= 2 && score[k] >= best * 0.6);

  let contentType = 'news';
  if (hits(normalizeArabic(title), 'analysis').length || /\/(opinion|authors|articles\/authors|analysis|columns?)\//i.test(source.item_link || '')) contentType = 'analysis';
  else if (hits(normalizeArabic(title), 'statement').length && /[«"“:]/.test(title)) contentType = 'statement';

  const breakingHits = hits(norm, 'breaking').length;
  const tags = [];
  if (sport.sportsFinance) tags.push('اقتصاد الرياضة');
  for (const k of secondary) tags.push(SECTIONS.find((s) => s.key === k).name);
  for (const e of entities.filter((x) => x.kind !== 'name').slice(0, 5)) tags.push(e.label);

  return {
    excluded: sport.excluded,
    excludeReason: sport.reason,
    scope,
    section,
    secondary,
    contentType,
    entities,
    tags: [...new Set(tags)],
    importanceBase: (source.is_official ? 2 : 0) + Math.min(2, breakingHits) + (scope === 'saudi' ? 1 : 0) + (best >= 3 ? 1 : 0),
  };
}
