import crypto from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(crypto.scrypt);

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const h = await scrypt(pw, salt, 64);
  return `scrypt$${salt}$${h.toString("base64url")}`;
}
export async function checkPassword(pw, stored) {
  const [alg, salt, hash] = String(stored || "").split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const h = await scrypt(pw, salt, 64);
  const want = Buffer.from(hash, "base64url");
  return want.length === h.length && crypto.timingSafeEqual(h, want);
}
export const newToken = () => crypto.randomBytes(32).toString("base64url");
export const sha256 = s => crypto.createHash("sha256").update(s).digest("hex");
export const pairCode = () => String(crypto.randomInt(0, 1e6)).padStart(6, "0");
export const linkCode = () => crypto.randomBytes(6).toString("base64url");

// Tiny fixed-window rate limiter (per process). Good enough for one Railway instance.
const buckets = new Map();
export function limited(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.reset) { buckets.set(key, { n: 1, reset: now + windowMs }); return false; }
  b.n++;
  return b.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k); }, 60e3).unref();
