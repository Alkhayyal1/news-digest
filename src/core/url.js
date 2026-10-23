// URL canonicalization: removes tracking parameters so the same article imported with
// different campaign tags maps to one canonical key. Pure module.

const TRACKING_EXACT = new Set([
  'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'igshid', 'mc_cid', 'mc_eid',
  'ref', 'ref_src', 'ref_url', 'referrer', 'source', 'src', 'cmpid', 'cmp', 'ito', 'ncid', 'ocid', 'sr_share',
  'share', 'shared', 'via', 'at_medium', 'at_campaign', 'at_custom1', 'at_custom2', 'at_custom3', 'at_custom4',
  'xtor', 'spm', 'ns_mchannel', 'ns_source', 'ns_campaign', 'ns_linkname', 'ns_fee', '__twitter_impression',
  's_cid', 'cid', 'rss', 'feed', 'output', 'amp', 'outputtype', 'mod', 'taid', 'guccounter', 'guce_referrer',
  'guce_referrer_sig', '_ga', '_gl', 'hsctatracking', 'mkt_tok', 'vero_id', 'oly_enc_id', 'oly_anon_id',
  'utm', 'type',
]);
const TRACKING_PREFIX = ['utm_', 'pk_', 'mtm_', 'hmb_', 'ga_', 'at_', 'vgo_', 'itm_', 'trk_'];

// Some hosts use query params as the article identity; never strip these there.
const KEEP_PARAMS_BY_HOST = {
  'www.federalreserve.gov': [],
  'news.un.org': [],
};
const IDENTITY_PARAMS = new Set(['id', 'p', 'articleid', 'newsid', 'story', 'storyid', 'article', 'nid', 'uuid', 'q', 'page_id']);

export function canonicalizeUrl(input, base) {
  let u;
  try {
    u = new URL(String(input).trim(), base);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.protocol = 'https:';
  u.hostname = u.hostname.toLowerCase().replace(/\.$/, '');
  u.port = '';
  u.hash = '';
  u.username = '';
  u.password = '';
  const keepExtra = KEEP_PARAMS_BY_HOST[u.hostname] || [];
  const kept = [];
  for (const [k, v] of u.searchParams) {
    const kl = k.toLowerCase();
    const isTracking = TRACKING_EXACT.has(kl) || TRACKING_PREFIX.some((p) => kl.startsWith(p));
    if (isTracking && !IDENTITY_PARAMS.has(kl) && !keepExtra.includes(kl)) continue;
    kept.push([k, v]);
  }
  kept.sort((a, b) => (a[0] + '=' + a[1]).localeCompare(b[0] + '=' + b[1]));
  u.search = '';
  for (const [k, v] of kept) u.searchParams.append(k, v);
  let path = u.pathname.replace(/\/{2,}/g, '/');
  path = path.replace(/\/amp\/?$/i, '/').replace(/\/(index\.html?)$/i, '/');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  u.pathname = path;
  return u.toString();
}

// Dedup key: canonical URL with host variants (www./m./amp.) collapsed and scheme dropped.
export function urlKey(input, base) {
  const c = canonicalizeUrl(input, base);
  if (!c) return null;
  const u = new URL(c);
  return u.hostname.replace(/^(www|m|amp|mobile)\./, '') + u.pathname + u.search;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// "www.bbc.co.uk" and "feeds.bbci.co.uk" are related but we only allow exact host or subdomain match
// of an allow-listed base host.
export function hostAllowed(host, allowedHosts) {
  const h = String(host || '').toLowerCase();
  for (const a of allowedHosts) {
    const base = String(a).toLowerCase().replace(/^www\./, '');
    if (h === base || h.endsWith('.' + base)) return true;
  }
  return false;
}

// A link is "direct" when it points to a specific article, not a homepage/section/search page.
export function isDirectArticleUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const path = u.pathname.replace(/\/+$/, '');
  if (!path || path === '' || path === '/ar' || path === '/en') return false;
  if (/\/(search|tag|tags|category|section|topics?)(\/|$)/i.test(path) && !/\d{4,}/.test(path)) return false;
  if (u.searchParams.has('q') || u.searchParams.has('s')) return false;
  return true;
}
