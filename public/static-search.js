// In-browser search for the static (GitHub Pages) build. Same semantics as the server search:
// unified events, Arabic normalization + light stemming, AND then OR fallback, filters, sorting.
import { normalizeArabic, lightStem } from './core/arabic.js';

const PAGE = 20;
const shardCache = new Map();

async function loadShard(month) {
  if (!shardCache.has(month)) shardCache.set(month, fetch(`data/search/${month}.json`).then((r) => (r.ok ? r.json() : [])));
  return shardCache.get(month);
}

const riyadhMonth = (ms) => new Date(ms + 3 * 3600_000).toISOString().slice(0, 7);

// Which monthly shards to load: those overlapping the date filter, else the last 3 months
// (or everything when `all=1`).
async function shardsFor(f) {
  const manifest = await fetch('data/search/manifest.json').then((r) => (r.ok ? r.json() : []));
  let months = manifest.map((m) => m.month);
  const from = f.from ? riyadhMonth(+f.from) : null;
  const to = f.to ? riyadhMonth(+f.to) : null;
  if (from || to) months = months.filter((m) => (!from || m >= from) && (!to || m <= to));
  else if (f.all !== '1') months = months.slice(0, 3);
  return { months, limited: !from && !to && f.all !== '1' && manifest.length > 3, totalMonths: manifest.length };
}

function matcher(q) {
  const terms = normalizeArabic(q).split(' ').filter((w) => w.length >= 2 || /\d/.test(w)).slice(0, 8);
  return terms.map((w) => {
    const st = lightStem(w);
    const forms = [w, st].filter((x, i, a) => x && x.length >= 2 && a.indexOf(x) === i);
    return (text) => {
      for (const tok of text.split(' ')) if (forms.some((f) => tok.startsWith(f))) return true;
      return false;
    };
  });
}

export async function searchStatic(f) {
  const { months, limited, totalMonths } = await shardsFor(f);
  let rows = (await Promise.all(months.map(loadShard))).flat();
  rows = rows.filter((e) =>
    (!f.from || (e.o ?? e.f) >= +f.from) && (!f.to || (e.o ?? e.f) <= +f.to)
    && (!f.scope || e.sc === f.scope) && (!f.section || e.se === f.section)
    && (!f.type || (f.type === 'update' ? e.uc > 0 : e.ty === f.type))
    && (!f.source || e.src.includes(f.source)) && (!f.company || e.co.includes(f.company)));
  const q = String(f.q || '').trim();
  let scored = rows.map((e) => ({ e, score: 0 }));
  if (q) {
    const m = matcher(q);
    const score = (e, mode) => {
      let s = 0;
      let hit = 0;
      for (const t of m) {
        const inTitle = t(e.kt);
        const inBody = inTitle || t(e.kb);
        if (inBody) hit++;
        s += inTitle ? 3 : inBody ? 1 : 0;
      }
      return mode === 'AND' ? (hit === m.length ? s : 0) : s;
    };
    for (const mode of ['AND', 'OR']) {
      scored = rows.map((e) => ({ e, score: score(e, mode) })).filter((x) => x.score > 0);
      if (scored.length) break;
    }
  }
  const latest = f.sort === 'latest' || !q;
  scored.sort((a, b) => (latest ? 0 : b.score - a.score) || b.e.u - a.e.u);
  const page = Math.max(1, parseInt(f.page, 10) || 1);
  const total = scored.length;
  return {
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE)),
    limited,
    totalMonths,
    results: scored.slice((page - 1) * PAGE, page * PAGE).map(({ e }) => ({
      id: e.id, title: e.t, summary: e.s, scope: e.sc, section: e.se, content_type: e.ty, occurred_at: e.o, first_seen_at: e.f, last_update_at: e.u,
      ai_status: e.ai, source_count: e.n, update_count: e.uc,
    })),
  };
}
