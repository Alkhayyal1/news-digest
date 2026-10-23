// Static (GitHub) mode has no live admin panel. The owner edits a JSON file in the
// repository instead; it is applied on every run, idempotently.
//   config/overrides.json : { split: [itemId], merge: [[keepEventId, mergeEventId]], dismiss: [reviewId], hide: [eventId], unhide: [eventId] }
import { readFileSync, existsSync } from 'node:fs';
import { getSetting, setSetting, J } from './db.js';
import { splitItem, mergeEvents, dismissReview } from './admin.js';

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
