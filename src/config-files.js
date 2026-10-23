// Static (GitHub) mode has no live admin panel. The owner edits two JSON files in the
// repository instead; they are applied on every run, idempotently.
//   config/overrides.json  : { split: [itemId], merge: [[keepEventId, mergeEventId]], dismiss: [reviewId], hide: [eventId], unhide: [eventId] }
//   config/financials.json : { reports: [{ symbol, period, ..., source_url }], prices: [{ symbol, price, as_of, source_url }] }
import { readFileSync, existsSync } from 'node:fs';
import { getSetting, setSetting, J } from './db.js';
import { splitItem, mergeEvents, dismissReview } from './admin.js';
import { canonicalizeUrl } from './core/url.js';

const FIN_FIELDS = ['revenue', 'gross_profit', 'operating_profit', 'net_profit', 'non_recurring', 'total_debt', 'cash', 'equity', 'operating_cash_flow', 'capex', 'dps', 'shares_outstanding'];

function readJsonFile(path) {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
  return text.trim() ? JSON.parse(text) : null;
}

export function applyOverrides(db, path = 'config/overrides.json', now = Date.now()) {
  const o = readJsonFile(path);
  const log = [];
  if (!o) return log;
  const done = new Set(J(getSetting(db, 'overrides_applied'), []));
  const once = (key, fn) => {
    if (done.has(key)) return;
    try {
      fn();
      log.push(`تم: ${key}`);
    } catch (e) {
      log.push(`تعذر ${key}: ${e.message}`);
    }
    done.add(key); // failed ops are not retried forever; the log shows why
  };
  for (const id of o.split || []) once(`split:${id}`, () => splitItem(db, +id, now));
  for (const [into, from] of o.merge || []) once(`merge:${into}<${from}`, () => mergeEvents(db, +into, +from, now));
  for (const id of o.dismiss || []) once(`dismiss:${id}`, () => dismissReview(db, +id));
  // hide/unhide are states, re-applied every run
  for (const id of o.hide || []) db.prepare('UPDATE events SET hidden = 1 WHERE id = ? AND merged_into IS NULL').run(+id);
  for (const id of o.unhide || []) db.prepare('UPDATE events SET hidden = 0 WHERE id = ? AND merged_into IS NULL').run(+id);
  setSetting(db, 'overrides_applied', JSON.stringify([...done]));
  return log;
}

const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

export function applyFinancials(db, path = 'config/financials.json', now = Date.now()) {
  const f = readJsonFile(path);
  const log = [];
  if (!f) return log;
  for (const r of f.reports || []) {
    const src = canonicalizeUrl(r.source_url || '');
    const vals = FIN_FIELDS.map((k) => num(r[k]));
    if (!db.prepare('SELECT 1 FROM companies WHERE symbol = ?').get(String(r.symbol))) log.push(`رمز غير معروف: ${r.symbol}`);
    else if (!/^\d{4}-(Q[1-4]|H[12]|FY)$/.test(String(r.period))) log.push(`فترة غير صالحة: ${r.symbol} ${r.period}`);
    else if (!src) log.push(`رابط الإفصاح مطلوب: ${r.symbol} ${r.period}`);
    else if (vals.some((v) => v !== null && !Number.isFinite(v))) log.push(`قيمة غير رقمية: ${r.symbol} ${r.period}`);
    else {
      db.prepare(`INSERT INTO financial_reports (symbol, period, period_end, currency, unit, ${FIN_FIELDS.join(', ')}, source_url, disclosed_at, notes, created_at)
        VALUES (?, ?, ?, 'SAR', 'million', ${FIN_FIELDS.map(() => '?').join(', ')}, ?, ?, ?, ?)
        ON CONFLICT(symbol, period) DO UPDATE SET ${FIN_FIELDS.map((k) => `${k} = excluded.${k}`).join(', ')}, period_end = excluded.period_end, source_url = excluded.source_url, disclosed_at = excluded.disclosed_at, notes = excluded.notes`).run(
        String(r.symbol), String(r.period), r.period_end || null, ...vals, src, r.disclosed_at || null, r.notes ? String(r.notes).slice(0, 500) : null, now);
    }
  }
  for (const p of f.prices || []) {
    const src = canonicalizeUrl(p.source_url || '');
    const price = num(p.price);
    if (!(price > 0) || !/^\d{4}-\d{2}-\d{2}/.test(String(p.as_of)) || !src) log.push(`سعر غير صالح أو بلا تاريخ/مصدر: ${p.symbol}`);
    else db.prepare('INSERT INTO prices (symbol, price, as_of, source_url, note) VALUES (?, ?, ?, ?, ?) ON CONFLICT(symbol, as_of) DO UPDATE SET price = excluded.price, source_url = excluded.source_url, note = excluded.note').run(
      String(p.symbol), price, String(p.as_of).slice(0, 16), src, p.note ? String(p.note).slice(0, 200) : 'سعر إغلاق (ليس لحظيًا)');
  }
  return log;
}
