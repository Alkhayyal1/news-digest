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

// Decide whether an item is sports content (it goes to the sports sections).
// Purely financial/development stories about sports entities are economy/business news instead.
// `hinted`: the source itself is a sports feed.
export function sportsCheck({ title, summary, categories = [], sourcePrefix = '', hinted = false }) {
  const norm = normalizeArabic(`${title} ${summary}`);
  const cats = normalizeArabic(`${categories.join(' ')} ${sourcePrefix}`);
  const sportsCategory = hinted || /(^| )(رياضه|رياضي|الرياضه|sport|sports|football|كره)( |$)/.test(cats);
  const sports = new Set(hits(norm, 'sports_hard'));
  const transfer = hits(norm, 'transfer').length > 0;
  const finance = new Set(hits(norm, 'finance'));
  const sportsScore = sports.size + (sportsCategory ? 2 : 0);
  if (sportsScore < 2) return { sports: false, sportsFinance: false };
  // Transfers, results and player news are sports news even if they mention money.
  if (transfer) return { sports: true, sportsFinance: false };
  if (finance.size >= 2 && finance.size >= sports.size - 1) return { sports: false, sportsFinance: true };
  return { sports: true, sportsFinance: false };
}

// Feed/section categories published by the source itself are a strong, cheap signal.
const CATEGORY_HINTS = [
  [/(^| )(اقتصاد|الاقتصاد|اقتصادي|مال واعمال|اعمال|economy|business|markets?)( |$)/, { saudi: 'sa_economy', world: 'w_economy' }],
  [/(^| )(تقنيه|التقنيه|تكنولوجيا|علوم وتكنولوجيا|technology|tech)( |$)/, { world: 'w_tech' }],
  [/(^| )(صحه|الصحه|health)( |$)/, { world: 'w_health' }],
  [/(^| )(علوم|science)( |$)/, { world: 'w_science' }],
  [/(^| )(طاقه|الطاقه|نفط|energy)( |$)/, { world: 'w_energy' }],
  [/(^| )(سياسه|السياسه|politics)( |$)/, { saudi: 'sa_politics', world: 'w_politics' }],
  [/(^| )(ثقافه|ثقافي|الثقافه|فنون|ثقافه وفن|فن|منوعات|ترفيه|يوميات الشرق|مشاهير|entertainment|celebrity)( |$)/, { saudi: 'sa_culture', world: 'w_entertainment' }],
  [/(^| )(بيئي|بيئه|البيئه|طقس|مناخ|climate)( |$)/, { saudi: 'sa_climate', world: 'w_climate' }],
  [/(^| )(سيارات|autos?)( |$)/, { world: 'w_auto' }],
  [/(^| )(تعليم|التعليم|تعليمي)( |$)/, { saudi: 'sa_education' }],
  [/(^| )(سياحه|سياحي|سفر|طيران)( |$)/, { saudi: 'sa_travel' }],
  [/(^| )(زراعه|زراعي)( |$)/, { saudi: 'sa_food' }],
];
// Lifestyle/society pages are not news and are left out of bulletins.
const SOFT_CATEGORIES = /(^| )(الناس|المراه|لايف ستايل|lifestyle)( |$)/;
const SPORTS_SECTIONS = new Set(['sa_sports', 'w_sports']);
const FIELD_KEYS = new Set(SECTIONS.filter((s) => s.group === 'fields').map((s) => s.key));
// Topic evidence: forms of one word count once ("الصحه" + "صحه"), a specific phrase counts double.
function fieldWeight(found) {
  return found.filter((t) => !found.some((o) => o !== t && o.includes(t))).reduce((n, t) => n + (t.includes(' ') ? 2 : 1), 0);
}
const LIGHT_SECTIONS = new Set(['sa_sports', 'w_sports', 'w_entertainment']);

export function classify({ title, summary = '', categories = [], source = {}, sourcePrefix = '' }) {
  const text = `${title} ${summary}`;
  const norm = normalizeArabic(text);
  const sport = sportsCheck({ title, summary, categories, sourcePrefix, hinted: SPORTS_SECTIONS.has(source.section_hint) });
  const catNorm = normalizeArabic(categories.join(' | '));
  const excluded = !sport.sports && SOFT_CATEGORIES.test(catNorm);
  const entities = extractEntities(text);

  const saudiHits = hits(norm, 'saudi').length + entities.filter((e) => e.kind === 'company').length;
  let scope = source.default_scope || null;
  if (!scope || scope === 'auto') scope = saudiHits >= 1 ? 'saudi' : 'world';
  // A Saudi source covering foreign news stays "world" unless the text is about the Kingdom.
  if (source.default_scope === 'saudi' && saudiHits === 0 && ['w_politics', 'w_economy', 'w_tech', 'w_ai', 'w_science', 'w_health', 'w_energy'].reduce((n, k) => n + hits(norm, k).length, 0) >= 2) scope = 'world';
  // Sports: Saudi league, clubs and national team are Saudi news wherever they are published.
  if (sport.sports) scope = saudiHits + hits(norm, 'saudi_sports').length > 0 ? 'saudi' : 'world';

  const keys = SECTIONS.filter((s) => s.scope === scope).map((s) => s.key);
  const score = Object.fromEntries(keys.map((k) => [k, FIELD_KEYS.has(k) ? fieldWeight(hits(norm, k)) : hits(norm, k).length]));
  if (source.section_hint && score[source.section_hint] !== undefined) score[source.section_hint] += 1.5;
  for (const [re, map] of CATEGORY_HINTS) if (re.test(catNorm) && map[scope] && score[map[scope]] !== undefined) score[map[scope]] += 1.5;
  // A topic section needs real evidence: one passing word ("سيارة إسعاف", "حرائق") is not a car or climate story.
  // A feed dedicated to that topic is evidence enough.
  for (const k of FIELD_KEYS) if (score[k] !== undefined && score[k] < 2 && source.section_hint !== k) score[k] = 0;
  if (scope === 'saudi') {
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
  if (sport.sports) section = scope === 'saudi' ? 'sa_sports' : 'w_sports';
  // World politics is split by region so the regional news readers follow most is not buried.
  if (section === 'w_politics' && hits(norm, 'mideast').length) section = 'w_mideast';
  const secondary = sport.sports ? [] : keys.filter((k) => k !== section && score[k] >= 2 && score[k] >= best * 0.6);

  let contentType = 'news';
  if (hits(normalizeArabic(title), 'analysis').length || /\/(opinion|authors|articles\/authors|analysis|columns?)\//i.test(source.item_link || '')) contentType = 'analysis';
  else if (hits(normalizeArabic(title), 'statement').length && /[«"“:]/.test(title)) contentType = 'statement';

  const breakingHits = hits(norm, 'breaking').length;
  const tags = [];
  if (sport.sportsFinance) tags.push('اقتصاد الرياضة');
  for (const k of secondary) tags.push(SECTIONS.find((s) => s.key === k).name);
  for (const e of entities.filter((x) => x.kind !== 'name').slice(0, 5)) tags.push(e.label);

  const importanceBase = (source.is_official ? 2 : 0) + Math.min(2, breakingHits) + (scope === 'saudi' ? 1 : 0) + (best >= 3 ? 1 : 0);
  return {
    excluded,
    excludeReason: excluded ? 'منوعات (ليست خبرًا)' : '',
    scope,
    section,
    secondary,
    contentType,
    entities,
    tags: [...new Set(tags)],
    // sports and entertainment have their own sections; they do not compete for "الأهم"
    importanceBase: LIGHT_SECTIONS.has(section) ? Math.max(0, importanceBase - 1) : importanceBase,
  };
}
