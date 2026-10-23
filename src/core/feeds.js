// Feed parsers (RSS 2.0, RSS 1.0/RDF, Atom) and the SPA (Saudi Press Agency) page parser.
// Tolerant regex-based parsing: feeds in the wild are often not well-formed XML. Pure module.
import { decodeEntities, cleanText } from './text.js';

function unwrap(s) {
  if (s == null) return '';
  const str = String(s).trim();
  const cdata = str.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1] : decodeEntities(str.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
}

function tag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  const m = block.match(re);
  return m ? unwrap(m[1]) : '';
}

function tags(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(block))) out.push(unwrap(m[1]));
  return out;
}

function attr(tagText, name) {
  const m = tagText.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : '';
}

export function parseDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  let t = Date.parse(str);
  if (Number.isNaN(t)) {
    // "Fri, 23 Oct 2026 00:03:14 +0300" variants with odd zones like "AST"/"KSA"
    const fixed = str.replace(/\b(AST|KSA)\b/i, '+0300').replace(/\bGMT([+-]\d{4})\b/, '$1');
    t = Date.parse(fixed);
  }
  return Number.isNaN(t) ? null : t;
}

export function parseFeed(xml) {
  const src = String(xml || '');
  const items = [];
  const isAtom = /<feed[\s>]/i.test(src) && /<entry[\s>]/i.test(src);
  if (isAtom) {
    const re = /<entry[\s>][\s\S]*?<\/entry>/gi;
    let m;
    while ((m = re.exec(src))) {
      const b = m[0];
      let link = '';
      const links = b.match(/<link\b[^>]*>/gi) || [];
      for (const l of links) {
        const rel = attr(l, 'rel');
        if (!rel || rel === 'alternate') {
          link = attr(l, 'href');
          break;
        }
      }
      if (!link && links[0]) link = attr(links[0], 'href');
      items.push({
        title: cleanText(tag(b, 'title')),
        link,
        guid: tag(b, 'id') || link,
        publishedAt: parseDate(tag(b, 'published') || tag(b, 'updated')),
        updatedAt: parseDate(tag(b, 'updated')),
        summary: cleanText(tag(b, 'summary') || tag(b, 'content')),
        categories: (b.match(/<category\b[^>]*>/gi) || []).map((c) => attr(c, 'term') || attr(c, 'label')).filter(Boolean),
      });
    }
    return items;
  }
  const re = /<item[\s>][\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(src))) {
    const b = m[0];
    let link = tag(b, 'link');
    if (!link) {
      const l = b.match(/<link\b[^>]*>/i);
      if (l) link = attr(l[0], 'href');
    }
    if (!link) {
      const g = b.match(/<guid[^>]*isPermaLink\s*=\s*"true"[^>]*>([\s\S]*?)<\/guid>/i);
      if (g) link = unwrap(g[1]);
    }
    const encoded = tag(b, 'content:encoded');
    const desc = tag(b, 'description');
    items.push({
      title: cleanText(tag(b, 'title')),
      link: link.trim(),
      guid: tag(b, 'guid') || link.trim(),
      publishedAt: parseDate(tag(b, 'pubDate') || tag(b, 'dc:date') || tag(b, 'published') || tag(b, 'updated')),
      updatedAt: parseDate(tag(b, 'updated') || tag(b, 'atom:updated')),
      summary: cleanText(desc || encoded),
      categories: tags(b, 'category').map((c) => cleanText(c)).filter(Boolean),
    });
  }
  return items;
}

// SPA (spa.gov.sa) is a Next.js site without RSS. The public home page embeds the latest
// items in __NEXT_DATA__. We walk that JSON and keep objects that look like news items.
export function parseSpaNextData(html) {
  const m = String(html || '').match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return [];
  }
  const seen = new Map();
  const walk = (v, depth) => {
    if (!v || depth > 12) return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    if (typeof v !== 'object') return;
    if (typeof v.uuid === 'string' && /^N\d{5,}$/.test(v.uuid) && typeof v.title === 'string' && v.published_at) {
      if (!seen.has(v.uuid)) {
        const ts = typeof v.published_at === 'number' ? v.published_at * (v.published_at < 1e12 ? 1000 : 1) : parseDate(v.published_at);
        seen.set(v.uuid, {
          title: cleanText(v.title),
          link: `https://www.spa.gov.sa/${v.uuid}`,
          guid: v.uuid,
          publishedAt: ts || null,
          updatedAt: null,
          summary: cleanText(v.content || v.subtitle || ''),
          categories: [],
          locale: v.locale || null,
        });
      }
    }
    for (const k of Object.keys(v)) walk(v[k], depth + 1);
  };
  walk(data, 0);
  return [...seen.values()].filter((x) => !x.locale || x.locale === 'ar');
}

// SPA article page: returns the article body text (used for summarization context only).
export function parseSpaArticle(html) {
  const m = String(html || '').match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]);
    let found = null;
    const walk = (v, d) => {
      if (found || !v || d > 10 || typeof v !== 'object') return;
      if (typeof v.content === 'string' && typeof v.uuid === 'string' && /^N\d+/.test(v.uuid)) {
        found = { content: cleanText(v.content), title: cleanText(v.title || '') };
        return;
      }
      for (const k of Object.keys(v)) walk(v[k], d + 1);
    };
    walk(data, 0);
    return found;
  } catch {
    return null;
  }
}

// SPA titles carry a category prefix: "اقتصادي / ..." "عام/ ...". Returns {prefix, title}.
export function splitSpaPrefix(title) {
  const m = String(title || '').match(/^\s*([^/]{2,20}?)\s*\/\s*(.+)$/);
  if (!m) return { prefix: '', title: String(title || '').trim() };
  return { prefix: m[1].trim(), title: m[2].trim() };
}

// Generic "list page" extractor for official sites without RSS (disabled by default; the admin
// supplies a link regex that matches article URLs on that site).
export function parseLinkList(html, baseUrl, linkPattern) {
  const out = new Map();
  let re;
  try {
    re = new RegExp(linkPattern);
  } catch {
    return [];
  }
  const aRe = /<a\b[^>]*href\s*=\s*("([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = aRe.exec(String(html || '')))) {
    const href = decodeEntities(m[2] ?? m[3] ?? '');
    let abs;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    if (!re.test(abs)) continue;
    const title = cleanText(m[4]);
    if (title.length < 15) continue;
    if (!out.has(abs)) out.set(abs, { title, link: abs, guid: abs, publishedAt: null, updatedAt: null, summary: '', categories: [] });
  }
  return [...out.values()];
}
