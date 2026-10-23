export const randomUUID = () => crypto.randomUUID();
export const randomBytes = (n) => ({ toString: () => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('') });
// harness only: NOT a real HMAC (admin login is not exercised in the browser harness)
export const createHmac = (alg, key) => { let s = String(key); return { update(v) { s += '|' + v; return this; }, digest() { let h = 0; for (const c of s) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0; return { toString: () => String(h), length: 8 }; } }; };
export const timingSafeEqual = (a, b) => String(a) === String(b);
