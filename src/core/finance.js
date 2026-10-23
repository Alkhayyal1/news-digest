// Company financial analysis computed from disclosed figures only. Every metric returns
// null (with a stated reason) when the inputs needed for it are missing. Pure module.

const num = (x) => (x === null || x === undefined || x === '' || Number.isNaN(Number(x)) ? null : Number(x));
const pct = (a, b) => (a === null || b === null || b === 0 ? null : ((a - b) / Math.abs(b)) * 100);
const ratio = (a, b) => (a === null || b === null || b === 0 ? null : a / b);

// period: "2026-Q2" | "2026-FY"
export function parsePeriod(p) {
  const m = String(p || '').match(/^(\d{4})-(Q[1-4]|H[12]|FY)$/);
  return m ? { year: +m[1], part: m[2] } : null;
}
export function samePeriodLastYear(p) {
  const x = parsePeriod(p);
  return x ? `${x.year - 1}-${x.part}` : null;
}
export function previousQuarter(p) {
  const x = parsePeriod(p);
  if (!x || !x.part.startsWith('Q')) return null;
  const q = +x.part[1];
  return q === 1 ? `${x.year - 1}-Q4` : `${x.year}-Q${q - 1}`;
}

// reports: array of {period, revenue, gross_profit, operating_profit, net_profit, non_recurring,
// total_debt, cash, equity, operating_cash_flow, capex, dps, shares_outstanding, source_url, disclosed_at}
// price: {price, as_of, source_url} | null
export function analyzeCompany(reports, price, { sectorPeers = [] } = {}) {
  const byP = new Map(reports.map((r) => [r.period, r]));
  const sorted = [...reports].sort((a, b) => String(b.period).localeCompare(String(a.period)));
  const latest = sorted[0] || null;
  const notes = [];
  if (!latest) return { latest: null, metrics: {}, notes: ['لا توجد قوائم مالية مُدخلة من إفصاح أصلي لهذه الشركة بعد.'] };

  const yoyP = samePeriodLastYear(latest.period);
  const qoqP = previousQuarter(latest.period);
  const yoy = byP.get(yoyP) || null;
  const qoq = qoqP ? byP.get(qoqP) || null : null;
  const L = Object.fromEntries(Object.entries(latest).map(([k, v]) => [k, typeof v === 'string' && !/^[\d.-]+$/.test(v) ? v : num(v)]));

  const recurringNet = L.net_profit !== null && L.non_recurring !== null ? L.net_profit - L.non_recurring : null;
  const m = {
    revenue_yoy_pct: yoy ? pct(L.revenue, num(yoy.revenue)) : null,
    net_profit_yoy_pct: yoy ? pct(L.net_profit, num(yoy.net_profit)) : null,
    operating_profit_yoy_pct: yoy ? pct(L.operating_profit, num(yoy.operating_profit)) : null,
    revenue_qoq_pct: qoq ? pct(L.revenue, num(qoq.revenue)) : null,
    net_profit_qoq_pct: qoq ? pct(L.net_profit, num(qoq.net_profit)) : null,
    gross_margin_pct: ratio(L.gross_profit, L.revenue) !== null ? ratio(L.gross_profit, L.revenue) * 100 : null,
    operating_margin_pct: ratio(L.operating_profit, L.revenue) !== null ? ratio(L.operating_profit, L.revenue) * 100 : null,
    net_margin_pct: ratio(L.net_profit, L.revenue) !== null ? ratio(L.net_profit, L.revenue) * 100 : null,
    recurring_net_profit: recurringNet,
    free_cash_flow: L.operating_cash_flow !== null && L.capex !== null ? L.operating_cash_flow - Math.abs(L.capex) : null,
    net_debt: L.total_debt !== null && L.cash !== null ? L.total_debt - L.cash : null,
    debt_to_equity: ratio(L.total_debt, L.equity),
    eps: ratio(L.net_profit, L.shares_outstanding),
  };
  if (!yoy) notes.push(`لا تتوفر بيانات الفترة المماثلة (${yoyP}) للمقارنة السنوية.`);
  if (qoqP && !qoq) notes.push(`لا تتوفر بيانات الربع السابق (${qoqP}).`);
  if (L.non_recurring === null) notes.push('لم يُدخل مبلغ البنود غير المتكررة؛ لا يمكن فصل الربح المتكرر.');

  // Trailing-twelve-months net profit needs the last 4 quarters.
  let ttm = null;
  const p = parsePeriod(latest.period);
  if (p && p.part.startsWith('Q')) {
    const qs = [latest.period];
    let cur = latest.period;
    for (let i = 0; i < 3; i++) {
      cur = previousQuarter(cur);
      qs.push(cur);
    }
    const vals = qs.map((q) => num(byP.get(q)?.net_profit));
    if (vals.every((v) => v !== null)) ttm = vals.reduce((a, b) => a + b, 0);
    else notes.push('لا تتوفر أربعة أرباع متتالية لحساب أرباح آخر 12 شهرًا.');
  } else if (p && p.part === 'FY') ttm = L.net_profit;

  const priceVal = price ? num(price.price) : null;
  const shares = L.shares_outstanding;
  let valuation = { pe_ttm: null, dividend_yield_pct: null, market_cap: null, price_as_of: price?.as_of ?? null, price_source: price?.source_url ?? null };
  if (priceVal === null || !price?.as_of) notes.push('لا يوجد سعر سهم بتاريخ محدد؛ لم يُحسب أي مضاعف تقييم.');
  else if (shares === null) notes.push('عدد الأسهم غير مُدخل؛ لا يمكن حساب القيمة السوقية أو مكرر الربحية.');
  else {
    valuation.market_cap = priceVal * shares;
    valuation.pe_ttm = ttm !== null && ttm > 0 ? valuation.market_cap / ttm : null;
    if (ttm !== null && ttm <= 0) notes.push('أرباح آخر 12 شهرًا سالبة أو صفرية؛ مكرر الربحية غير ذي معنى.');
    valuation.dividend_yield_pct = L.dps !== null ? (L.dps / priceVal) * 100 : null;
  }

  // Sector comparison: only peers that have the same metric computed.
  const peerPe = sectorPeers.map((x) => x.pe_ttm).filter((x) => x !== null && Number.isFinite(x));
  const peerNm = sectorPeers.map((x) => x.net_margin_pct).filter((x) => x !== null && Number.isFinite(x));
  const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)] : null);
  const sector = { peers_count: sectorPeers.length, pe_median: median(peerPe), net_margin_median: median(peerNm) };
  if (sectorPeers.length < 2) notes.push('عدد الشركات المماثلة ذات البيانات في القطاع غير كافٍ لمقارنة قطاعية موثوقة.');

  return { latest, yoy, qoq, metrics: m, ttm_net_profit: ttm, valuation, sector, notes };
}
