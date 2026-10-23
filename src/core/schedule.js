// Fixed-interval schedule math. Slots are anchor + k * interval (UTC epoch ms), so the gap is
// always exactly the interval: it does not reset at midnight like a cron "every 7 hours" would.
// Pure module.

export const SEVEN_HOURS = 7 * 3600_000;

export function slotIndexAt(anchor, interval, now) {
  if (now < anchor) return -1;
  return Math.floor((now - anchor) / interval);
}

export function slotTime(anchor, interval, k) {
  return anchor + k * interval;
}

export function nextSlotAfter(anchor, interval, now) {
  const k = slotIndexAt(anchor, interval, now);
  return slotTime(anchor, interval, k + 1);
}

// Given the last slot index that completed (or was merged into a catch-up run), return what
// to do now: nothing, run the current slot, or run the current slot as a catch-up that also
// covers missed slots (missed slots are recorded, not run one by one).
export function duePlan(anchor, interval, now, lastDoneIndex) {
  const k = slotIndexAt(anchor, interval, now);
  if (k < 0 || k <= lastDoneIndex) return { due: false, slot: k, next: slotTime(anchor, interval, Math.max(k, lastDoneIndex) + 1) };
  const missed = [];
  for (let i = Math.max(lastDoneIndex + 1, k - 50); i < k; i++) missed.push(i);
  return { due: true, slot: k, plannedAt: slotTime(anchor, interval, k), missed, catchUp: missed.length > 0 };
}

// Exponential backoff for failed runs within a slot.
export function retryDelayMs(attempt) {
  return [2, 10, 30, 60][Math.min(attempt, 3)] * 60_000;
}

export const RIYADH_TZ = 'Asia/Riyadh';

export function formatRiyadh(ms, opts = {}) {
  if (ms == null) return '—';
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
    timeZone: RIYADH_TZ, year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, ...opts,
  }).format(new Date(ms));
}
