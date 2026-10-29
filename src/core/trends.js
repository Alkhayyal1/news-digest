// "ترند": topics many independent sources are covering at the same time. Pure module.
// A topic is a word or a two-word phrase from the headlines (normalized + lightly stemmed) that
// appears in several distinct events from several distinct sources. No AI, no invented labels:
// the label is the topic's most common spelling in the headlines themselves.
import { normalizeArabic, tokenize } from './arabic.js';

// News verbs and filler that appear in every bulletin and say nothing about the topic.
const GENERIC = new Set(tokenize(`يعلن اعلن تعلن اعلنت اعلنوا قال يقول تقول قالت اكد يؤكد تؤكد اكدت بحث يبحث تبحث يبحثان
  مسؤول مسؤولون رئيس الرئيس وزير الوزير وزيره وزراء الحكومه حكومه دوله الدول البلاد العالم عالمي عالميه دولي دوليه
  جديد جديده الجديد الجديده اول الاول الاولى اخر الاخير بعد قبل خلال ضد بين عن مع اكثر اقل الف الاف مليون ملايين مليار مليارات دولار ريال يورو نسبه
  سنه سنوات شهر اشهر اسبوع ايام يوم ساعه ساعات دقيقه عاجل فيديو صور صوره شاهد كيف لماذا ماذا متى اين هل
  يطالب تطالب يدعو تدعو دعا يحذر تحذر حذر يكشف تكشف كشف يتوقع توقع يبدا تبدا بدء اطلاق يطلق تطلق اطلق يرفع ترفع يخفض تخفض
  مقتل قتلى اصابه شخص اشخاص بشان حول وسط امام رغم عبر لدى نحو اثر جراء بسبب ضمن تقرير مصادر مصدر وكاله
  الاحد الاثنين الثلاثاء الاربعاء الخميس الجمعه السبت صباح مساء الليله اليوم امس غدا مباشر تغطيه`).filter(Boolean));

// Adjectives name a topic only inside a phrase ("المركزي الأوروبي"), never alone ("الأوروبي").
const NOT_ALONE = new Set(tokenize(`العربيه العربي عربيه الاميركي الامريكي الاميركيه الامريكيه الفرنسي الفرنسيه البريطاني البريطانيه
  الالماني الالمانيه الاوروبي الاوروبيه الروسي الروسيه الصيني الصينيه الدولي الدوليه الوطني الوطنيه المركزي الرسمي الرسميه`).filter(Boolean));

function wordsOf(text) {
  const out = [];
  for (const raw of String(text || '').split(/\s+/)) {
    const surface = raw.replace(/[^\p{L}\p{N}]/gu, '');
    const n = normalizeArabic(surface);
    const st = n && !/\d/.test(n) ? tokenize(n)[0] : null;
    out.push(st && st.length >= 3 && !GENERIC.has(st) ? { st, surface, alone: !NOT_ALONE.has(st) } : null);
  }
  return out;
}

const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';

// events: [{ id, title, n (distinct sources), sources: [source ids], texts: [headlines] }]
export function computeTrends(events, { limit = 10, minEvents = 3, minSources = 3 } = {}) {
  const terms = new Map();
  for (const e of events) {
    const seen = new Set();
    for (const text of e.texts) {
      const w = wordsOf(text);
      for (let i = 0; i < w.length; i++) {
        if (!w[i]) continue;
        const grams = w[i].alone ? [[w[i].st, w[i].surface]] : [];
        if (w[i + 1]) grams.push([`${w[i].st} ${w[i + 1].st}`, `${w[i].surface} ${w[i + 1].surface}`]);
        for (const [key, surface] of grams) {
          let t = terms.get(key);
          if (!t) terms.set(key, (t = { key, bigram: key.includes(' '), events: new Set(), sources: new Set(), surface: new Map() }));
          t.surface.set(surface, (t.surface.get(surface) || 0) + 1);
          if (seen.has(key)) continue;
          seen.add(key);
          t.events.add(e.id);
          for (const s of e.sources) t.sources.add(s);
        }
      }
    }
  }
  const score = (t) => (t.sources.size * 2 + t.events.size) * (t.bigram ? 1.15 : 1);
  const candidates = [...terms.values()].filter((t) => t.events.size >= minEvents && t.sources.size >= minSources).sort((a, b) => score(b) - score(a));
  const chosen = [];
  for (let t of candidates) {
    // a phrase that carries most of a word's stories names the topic better ("الذكاء الاصطناعي", not "الذكاء")
    if (!t.bigram) {
      const word = t.key;
      const phrase = candidates.find((b) => b.bigram && b.key.split(' ').includes(word) && b.events.size >= 0.7 * t.events.size);
      if (phrase) t = phrase;
    }
    if (chosen.includes(t)) continue;
    // one topic once: skip a term whose stories are mostly those of a topic already chosen
    const dup = chosen.some((c) => {
      let shared = 0;
      for (const id of t.events) if (c.events.has(id)) shared++;
      return shared / Math.min(t.events.size, c.events.size) >= 0.6;
    });
    if (dup) continue;
    chosen.push(t);
    if (chosen.length >= limit) break;
  }
  const byId = new Map(events.map((e) => [e.id, e]));
  return chosen.map((t) => ({
    label: top(t.surface),
    events: t.events.size,
    sources: t.sources.size,
    items: [...t.events].map((id) => byId.get(id)).sort((a, b) => b.n - a.n).slice(0, 4).map((e) => ({ id: e.id, title: e.title, n: e.n, section: e.section })),
  }));
}
