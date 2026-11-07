import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { q, one, migrate, purge, pool } from "./db.js";
import { normalizeRules, parseInput, looksLikeSite, verdict, publicVideo, inList } from "./rules.js";
import { resolveChannel, videoMeta, channelItems, hasKey, UserError } from "./youtube.js";
import { hashPassword, checkPassword, newToken, sha256, pairCode, linkCode, limited } from "./auth.js";
import * as tg from "./telegram.js";
import * as google from "./google.js";
import * as mail from "./mail.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === "production";
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

/* ---------- security headers ---------- */
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  // The YouTube player needs a Referer from our embed page, so don't use no-referrer.
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (!req.path.startsWith("/embed") && !req.path.startsWith("/api/device")) res.set("X-Frame-Options", "DENY");
  next();
});

/* ---------- helpers ---------- */
const bad = (msg, status = 400) => Object.assign(new UserError(msg), { status });
const ip = req => req.ip || "unknown";
function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) { const i = part.indexOf("="); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
function todayIn(tz) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}
const dateStr = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || "").slice(0, 10));
function usageOf(dev, fam) {
  const rules = normalizeRules(fam.rules);
  const today = todayIn(fam.tz);
  const sameDay = dev.usage_date && dateStr(dev.usage_date) === today;
  const sec = sameDay ? dev.usage_sec : 0, extra = sameDay ? dev.extra_min : 0;
  const remaining = rules.dailyLimit ? Math.max(0, (rules.dailyLimit + extra) * 60 - sec) : null;
  return { today, sec, extra, remaining, limit: rules.dailyLimit };
}
async function saveRules(familyId, rules) {
  return one("update families set rules=$2, rules_version=rules_version+1 where id=$1 returning rules, rules_version",
    [familyId, JSON.stringify(normalizeRules(rules))]);
}
async function familyById(id) { return one("select * from families where id=$1", [id]); }

/* ---------- parent auth ---------- */
const COOKIE = "ls_sess";
function setSession(res, token) {
  res.set("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 86400}${PROD ? "; Secure" : ""}`);
}
async function parent(req, res, next) {
  const t = cookies(req)[COOKIE];
  if (!t) throw bad("Please sign in.", 401);
  const s = await one("select f.* from sessions s join families f on f.id=s.family_id where s.token_hash=$1", [sha256(t)]);
  if (!s) throw bad("Please sign in again.", 401);
  req.fam = s; next();
}
// JSON-only writes from the dashboard: blocks cross-site form posts.
function jsonOnly(req, res, next) {
  if (req.method !== "GET" && !req.is("application/json")) throw bad("Expected JSON.", 415);
  next();
}

app.post("/api/auth/signup", jsonOnly, async (req, res) => {
  if (limited("signup:" + ip(req), 10, 3600e3)) throw bad("Too many sign-ups from here. Try again later.", 429);
  const email = String(req.body.email || "").trim().toLowerCase();
  const pw = String(req.body.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad("Enter a valid email address.");
  if (pw.length < 8) throw bad("Use a password of at least 8 characters.");
  if (await one("select 1 from families where email=$1", [email])) throw bad("That email already has an account. Sign in instead.");
  const tz = typeof req.body.tz === "string" && req.body.tz.length < 60 ? req.body.tz : "UTC";
  const fam = await one("insert into families(email, pass_hash, tz, rules) values($1,$2,$3,$4) returning id",
    [email, await hashPassword(pw), tz, JSON.stringify(normalizeRules())]);
  const t = newToken(); await q("insert into sessions(token_hash, family_id) values($1,$2)", [sha256(t), fam.id]);
  setSession(res, t); res.json({ ok: true });
});
app.post("/api/auth/login", jsonOnly, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  if (limited("login:" + ip(req), 20, 900e3) || limited("login:" + email, 8, 900e3)) throw bad("Too many attempts. Wait 15 minutes and try again.", 429);
  const fam = await one("select id, pass_hash from families where email=$1", [email]);
  if (fam && !fam.pass_hash) throw bad("This account signs in with Google. Use “Continue with Google”, or choose “Forgot password?” to add a password.", 401);
  if (!fam || !(await checkPassword(String(req.body.password || ""), fam.pass_hash))) throw bad("Email or password is wrong.", 401);
  const t = newToken(); await q("insert into sessions(token_hash, family_id) values($1,$2)", [sha256(t), fam.id]);
  setSession(res, t); res.json({ ok: true });
});
app.post("/api/auth/logout", async (req, res) => {
  const t = cookies(req)[COOKIE];
  if (t) await q("delete from sessions where token_hash=$1", [sha256(t)]);
  res.set("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`); res.json({ ok: true });
});


/* ---------- sign-in options, Google, password reset ---------- */
const baseUrl = req => (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
async function startSession(res, familyId) {
  const t = newToken(); await q("insert into sessions(token_hash, family_id) values($1,$2)", [sha256(t), familyId]);
  setSession(res, t);
}
app.get("/api/auth/options", (req, res) => {
  res.json({ google: google.enabled(), reset: mail.enabled() || tg.enabled() });
});

const OAUTH_COOKIE = "ls_oauth";
app.get("/api/auth/google", (req, res) => {
  if (!google.enabled()) return res.redirect("/parent/?auth_error=" + encodeURIComponent("Google sign-in isn't set up on this server yet."));
  const state = newToken();
  const tz = typeof req.query.tz === "string" && /^[\w/+\-]{1,60}$/.test(req.query.tz) ? req.query.tz : "UTC";
  res.set("Set-Cookie", `${OAUTH_COOKIE}=${state}.${encodeURIComponent(tz)}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${PROD ? "; Secure" : ""}`);
  res.redirect(google.authUrl(state));
});
app.get("/api/auth/google/callback", async (req, res) => {
  const fail = msg => res.redirect("/parent/?auth_error=" + encodeURIComponent(msg));
  const clear = `${OAUTH_COOKIE}=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0`;
  const [state, tzEnc] = String(cookies(req)[OAUTH_COOKIE] || "").split(".");
  res.set("Set-Cookie", clear);
  if (req.query.error) return fail(req.query.error === "access_denied" ? "Google sign-in was cancelled." : "Google sign-in didn't complete. Try again.");
  if (!state || state !== req.query.state || !req.query.code) return fail("Google sign-in took too long or was opened in another browser. Try again.");
  if (limited("google:" + ip(req), 30, 900e3)) return fail("Too many sign-in attempts. Wait 15 minutes.");
  let who;
  try { who = await google.exchange(String(req.query.code)); } catch (e) { return fail(e.message); }
  let fam = await one("select id from families where google_sub=$1", [who.sub]);
  let isNew = false;
  if (!fam) {
    // Same verified email as an existing password account: link Google to it.
    fam = await one("update families set google_sub=$2 where email=$1 and google_sub is null returning id", [who.email, who.sub]);
  }
  if (!fam) {
    if (await one("select 1 from families where email=$1", [who.email])) return fail("That email is already linked to a different Google account.");
    const tz = decodeURIComponent(tzEnc || "UTC");
    fam = await one("insert into families(email, pass_hash, google_sub, tz, rules) values($1,null,$2,$3,$4) returning id",
      [who.email, who.sub, tz, JSON.stringify(normalizeRules())]);
    isNew = true;
  }
  const t = newToken(); await q("insert into sessions(token_hash, family_id) values($1,$2)", [sha256(t), fam.id]);
  res.set("Set-Cookie", [clear, `${COOKIE}=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 86400}${PROD ? "; Secure" : ""}`]);
  res.redirect(isNew ? "/parent/#allow" : "/parent/");
});

app.post("/api/auth/forgot", jsonOnly, async (req, res) => {
  if (!mail.enabled() && !tg.enabled()) throw bad("Password reset by email isn't set up on this server yet. Ask the person who runs it.", 503);
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad("Enter the email address you signed up with.");
  if (limited("forgot:" + ip(req), 10, 3600e3) || limited("forgot:" + email, 3, 3600e3)) throw bad("Too many reset requests. Try again in an hour.", 429);
  const fam = await one("select id, email, tg_chat_id from families where email=$1", [email]);
  if (fam) {
    const token = newToken();
    await q("delete from password_resets where family_id=$1", [fam.id]);
    await q("insert into password_resets(token_hash, family_id, expires_at) values($1,$2, now() + interval '1 hour')", [sha256(token), fam.id]);
    const link = `${baseUrl(req)}/parent/?reset=${token}`;
    const m = mail.resetEmail(link);
    await mail.send({ to: fam.email, ...m });
    if (fam.tg_chat_id) tg.send(fam.tg_chat_id, `🔑 Someone asked to reset your Little Screen password.\n\n<a href="${link}">Choose a new password</a> (works once, for 1 hour).\n\nIf this wasn't you, ignore this message.`);
  }
  // Same answer whether or not the email has an account, so the form can't be used to find accounts.
  res.json({ ok: true });
});
app.post("/api/auth/reset", jsonOnly, async (req, res) => {
  if (limited("reset:" + ip(req), 20, 900e3)) throw bad("Too many tries. Wait 15 minutes.", 429);
  const pw = String(req.body.password || "");
  if (pw.length < 8) throw bad("Use a password of at least 8 characters.");
  const row = await one("delete from password_resets where token_hash=$1 and expires_at > now() returning family_id", [sha256(String(req.body.token || ""))]);
  if (!row) throw bad("This reset link has expired or was already used. Ask for a new one.");
  await q("update families set pass_hash=$2 where id=$1", [row.family_id, await hashPassword(pw)]);
  await q("delete from sessions where family_id=$1", [row.family_id]);   // sign out everywhere
  await startSession(res, row.family_id);
  res.json({ ok: true });
});

/* ---------- parent: overview ---------- */
app.get("/api/me", parent, async (req, res) => {
  const f = req.fam;
  const pending = (await one("select count(*)::int n from requests where family_id=$1 and status='pending'", [f.id])).n;
  res.json({
    email: f.email, tz: f.tz, pinSet: Boolean(f.pin), ytKey: hasKey(), pending,
    hasPassword: Boolean(f.pass_hash), google: Boolean(f.google_sub),
    telegram: { enabled: tg.enabled(), linked: Boolean(f.tg_chat_id), bot: tg.username() },
    rules: normalizeRules(f.rules), version: f.rules_version
  });
});

/* ---------- feed (what the child sees) ---------- */
async function buildFeed(fam) {
  const rules = normalizeRules(fam.rules);
  const chans = rules.whitelist.filter(c => c.id);
  const results = await Promise.allSettled(chans.map(c => channelItems(c)));
  const map = new Map(), failed = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") for (const v of r.value) map.set(v.id, v);
    else failed.push(chans[i].title + ": " + r.reason.message);
  });
  for (const v of rules.videos) if (!map.has(v.id)) map.set(v.id, v);
  const videos = [...map.values()].filter(v => verdict(rules, v).ok)
    .sort((a, b) => String(b.pub || "").localeCompare(String(a.pub || ""))).slice(0, 400);
  return { rules, videos, failed };
}
app.get("/api/preview", parent, async (req, res) => {
  const { videos, failed } = await buildFeed(req.fam);
  res.json({ count: videos.length, sample: videos.slice(0, 12).map(publicVideo), failed });
});

/* ---------- parent: rules ---------- */
async function addChannel(fam, input, listName) {
  if (looksLikeSite(input)) throw bad("That's a website address, not a YouTube channel. Paste a channel @handle or a video link.");
  const p = parseInput(input);
  if (!p) throw bad("Paste a channel link, an @handle, or a video link from that channel.");
  let ch;
  if (p.type === "video") { const v = await videoMeta(p.id); ch = await resolveChannel({ type: "channel", id: v.channelId }); }
  else ch = await resolveChannel(p);
  const rules = normalizeRules(fam.rules);
  const same = c => (ch.id && c.id === ch.id) || (ch.handle && c.handle === ch.handle);
  const other = listName === "whitelist" ? "blacklist" : "whitelist";
  rules[other] = rules[other].filter(c => !same(c));
  if (!rules[listName].some(same)) rules[listName].push(ch);
  const saved = await saveRules(fam.id, rules);
  // settle pending requests from this channel
  await q(`update requests set status=$3 where family_id=$1 and status='pending' and video->>'channelId'=$2`,
    [fam.id, ch.id, listName === "whitelist" ? "allowed" : "blocked"]);
  return { channel: ch, rules: saved.rules };
}
app.post("/api/rules/channels", parent, jsonOnly, async (req, res) => {
  const list = req.body.list === "blacklist" ? "blacklist" : "whitelist";
  res.json(await addChannel(req.fam, String(req.body.input || ""), list));
});
app.delete("/api/rules/channels", parent, jsonOnly, async (req, res) => {
  const list = req.body.list === "blacklist" ? "blacklist" : "whitelist";
  const key = String(req.body.key || "");
  const rules = normalizeRules(req.fam.rules);
  rules[list] = rules[list].filter(c => (c.id || c.handle) !== key);
  res.json({ rules: (await saveRules(req.fam.id, rules)).rules });
});
app.post("/api/rules/videos", parent, jsonOnly, async (req, res) => {
  const p = parseInput(req.body.input);
  if (!p || p.type !== "video") throw bad("Paste a link to a single video.");
  const v = await videoMeta(p.id);
  const rules = normalizeRules(req.fam.rules);
  if (!rules.videos.some(x => x.id === v.id)) rules.videos.unshift(v);
  res.json({ video: v, rules: (await saveRules(req.fam.id, rules)).rules });
});
app.delete("/api/rules/videos/:id", parent, async (req, res) => {
  const rules = normalizeRules(req.fam.rules);
  rules.videos = rules.videos.filter(v => v.id !== req.params.id);
  res.json({ rules: (await saveRules(req.fam.id, rules)).rules });
});
app.post("/api/rules/keywords", parent, jsonOnly, async (req, res) => {
  const words = String(req.body.words || "").split(",").map(s => s.trim()).filter(s => s && s.length <= 60);
  const rules = normalizeRules(req.fam.rules);
  rules.keywords = [...new Set([...rules.keywords, ...words])].slice(0, 300);
  res.json({ rules: (await saveRules(req.fam.id, rules)).rules });
});
app.delete("/api/rules/keywords", parent, jsonOnly, async (req, res) => {
  const rules = normalizeRules(req.fam.rules);
  rules.keywords = rules.keywords.filter(k => k !== req.body.word);
  res.json({ rules: (await saveRules(req.fam.id, rules)).rules });
});
app.put("/api/rules/settings", parent, jsonOnly, async (req, res) => {
  const rules = normalizeRules(req.fam.rules);
  if (typeof req.body.blockShorts === "boolean") rules.blockShorts = req.body.blockShorts;
  if (typeof req.body.kidsOnly === "boolean") rules.kidsOnly = req.body.kidsOnly;
  if (req.body.dailyLimit !== undefined) rules.dailyLimit = req.body.dailyLimit;
  if (typeof req.body.tz === "string" && req.body.tz.length < 60) await q("update families set tz=$2 where id=$1", [req.fam.id, req.body.tz]);
  res.json({ rules: (await saveRules(req.fam.id, rules)).rules });
});

/* ---------- parent: requests ---------- */
async function applyRequest(familyId, reqId, action) {
  const r = await one("select * from requests where id=$1 and family_id=$2", [reqId, familyId]);
  if (!r) throw bad("That request no longer exists.", 404);
  if (r.status !== "pending") return { status: r.status, already: true };
  const fam = await familyById(familyId);
  if (action === "video") {
    const rules = normalizeRules(fam.rules);
    if (!rules.videos.some(x => x.id === r.video.id)) rules.videos.unshift(r.video);
    await saveRules(familyId, rules);
    await q("update requests set status='approved' where id=$1", [r.id]);
    return { status: "approved" };
  }
  if (action === "channel" || action === "block") {
    await addChannel(fam, r.video.channelId, action === "channel" ? "whitelist" : "blacklist");
    await q("update requests set status=$2 where id=$1", [r.id, action === "channel" ? "allowed" : "blocked"]);
    return { status: action === "channel" ? "allowed" : "blocked" };
  }
  await q("update requests set status='dismissed' where id=$1", [r.id]);
  return { status: "dismissed" };
}
app.get("/api/requests", parent, async (req, res) => {
  const rows = (await q(`select r.id, r.video, r.status, r.created_at, d.name device from requests r left join devices d on d.id=r.device_id
    where r.family_id=$1 and (r.status='pending' or r.created_at > now() - interval '7 days') order by (r.status='pending') desc, r.created_at desc limit 100`, [req.fam.id])).rows;
  res.json({ requests: rows });
});
app.post("/api/requests/:id", parent, jsonOnly, async (req, res) => {
  const action = ["video", "channel", "block", "no"].includes(req.body.action) ? req.body.action : null;
  if (!action) throw bad("Unknown action.");
  res.json(await applyRequest(req.fam.id, parseInt(req.params.id, 10), action));
});

/* ---------- parent: devices ---------- */
app.get("/api/devices", parent, async (req, res) => {
  const rows = (await q("select * from devices where family_id=$1 order by created_at", [req.fam.id])).rows;
  res.json({ devices: rows.map(d => ({ id: d.id, name: d.name, lastSeen: d.last_seen, ...usageOf(d, req.fam) })) });
});
app.post("/api/devices/pair-code", parent, async (req, res) => {
  let code;
  for (let i = 0; i < 5; i++) {
    code = pairCode();
    try { await q("insert into pair_codes(code, family_id, expires_at) values($1,$2, now() + interval '15 minutes')", [code, req.fam.id]); break; }
    catch (e) { code = null; }
  }
  if (!code) throw new Error("Couldn't make a code. Try again.");
  res.json({ code, expiresInMin: 15 });
});
app.patch("/api/devices/:id", parent, jsonOnly, async (req, res) => {
  const d = await one("select * from devices where id=$1 and family_id=$2", [req.params.id, req.fam.id]);
  if (!d) throw bad("Device not found.", 404);
  if (typeof req.body.name === "string" && req.body.name.trim()) await q("update devices set name=$2 where id=$1", [d.id, req.body.name.trim().slice(0, 40)]);
  if (req.body.extraMin) await addExtra(d, req.fam, parseInt(req.body.extraMin, 10));
  res.json({ ok: true });
});
async function addExtra(d, fam, minutes) {
  minutes = Math.max(0, Math.min(240, minutes || 0));
  const u = usageOf(d, fam);
  await q("update devices set usage_date=$2, usage_sec=$3, extra_min=$4 where id=$1", [d.id, u.today, u.sec, u.extra + minutes]);
}
app.delete("/api/devices/:id", parent, async (req, res) => {
  await q("delete from devices where id=$1 and family_id=$2", [req.params.id, req.fam.id]);
  res.json({ ok: true });
});

/* ---------- parent: PIN, Telegram, account ---------- */
app.put("/api/pin", parent, jsonOnly, async (req, res) => {
  const pin = req.body.pin;
  if (pin === null) { await q("update families set pin=null where id=$1", [req.fam.id]); return res.json({ ok: true }); }
  if (!/^\d{4,6}$/.test(String(pin))) throw bad("A PIN is 4 to 6 numbers.");
  await q("update families set pin=$2 where id=$1", [req.fam.id, { hash: await hashPassword(String(pin)) }]);
  res.json({ ok: true });
});
app.post("/api/telegram/link", parent, async (req, res) => {
  if (!tg.enabled()) throw bad("Telegram isn't set up on this server.");
  const code = linkCode();
  await q("update families set tg_link_code=$2 where id=$1", [req.fam.id, code]);
  res.json({ url: `https://t.me/${tg.username()}?start=${code}` });
});
app.delete("/api/telegram", parent, async (req, res) => {
  await q("update families set tg_chat_id=null, tg_link_code=null where id=$1", [req.fam.id]); res.json({ ok: true });
});
app.put("/api/account/password", parent, jsonOnly, async (req, res) => {
  if (req.fam.pass_hash && !(await checkPassword(String(req.body.current || ""), req.fam.pass_hash))) throw bad("Your current password is wrong.");
  if (String(req.body.next || "").length < 8) throw bad("Use a new password of at least 8 characters.");
  await q("update families set pass_hash=$2 where id=$1", [req.fam.id, await hashPassword(String(req.body.next))]);
  res.json({ ok: true });
});
app.delete("/api/account", parent, jsonOnly, async (req, res) => {
  if (req.fam.pass_hash) { if (!(await checkPassword(String(req.body.password || ""), req.fam.pass_hash))) throw bad("Password is wrong."); }
  else if (String(req.body.confirm || "").trim().toLowerCase() !== req.fam.email) throw bad("Type your email address exactly to confirm.");
  await q("delete from families where id=$1", [req.fam.id]);   // cascades to sessions, devices, codes, requests
  res.set("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`); res.json({ ok: true });
});

/* ---------- device API (child app; token auth, any origin) ---------- */
app.use("/api/device", (req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "authorization, content-type");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.post("/api/device/pair", async (req, res) => {
  if (limited("pair:" + ip(req), 10, 900e3)) throw bad("Too many tries. Wait 15 minutes.", 429);
  const code = String(req.body.code || "").replace(/\D/g, "");
  const row = await one("delete from pair_codes where code=$1 and expires_at > now() returning family_id", [code]);
  if (!row) throw bad("That code isn't right or has expired. Make a new one in the parent dashboard.");
  const token = newToken();
  const name = String(req.body.name || "Child's device").trim().slice(0, 40) || "Child's device";
  const d = await one("insert into devices(family_id, name, token_hash, last_seen) values($1,$2,$3,now()) returning id", [row.family_id, name, sha256(token)]);
  res.json({ token, deviceId: d.id, name });
});
async function device(req, res, next) {
  const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!t) throw bad("This device isn't paired.", 401);
  const d = await one("select * from devices where token_hash=$1", [sha256(t)]);
  if (!d) throw bad("This device was removed. Pair it again.", 401);
  req.dev = d; req.fam = await familyById(d.family_id);
  if (!d.last_seen || Date.now() - new Date(d.last_seen).getTime() > 60e3) await q("update devices set last_seen=now() where id=$1", [d.id]);
  next();
}
app.get("/api/device/feed", device, async (req, res) => {
  const { rules, videos } = await buildFeed(req.fam);
  const u = usageOf(req.dev, req.fam);
  res.json({
    v: req.fam.rules_version, deviceName: req.dev.name, hasPin: Boolean(req.fam.pin),
    channels: rules.whitelist.map(c => ({ id: c.id || c.handle, title: c.title, thumb: c.thumb || "" })),
    videos: videos.map(publicVideo), remaining: u.remaining, limit: u.limit
  });
});
// Heartbeat: reports watched seconds, returns rules version + remaining time.
app.post("/api/device/ping", device, async (req, res) => {
  const watched = Math.max(0, Math.min(90, parseInt(req.body.watched, 10) || 0));
  let u = usageOf(req.dev, req.fam);
  if (watched) {
    await q("update devices set usage_date=$2, usage_sec=$3, extra_min=$4 where id=$1", [req.dev.id, u.today, u.sec + watched, u.extra]);
    u = usageOf({ ...req.dev, usage_date: u.today, usage_sec: u.sec + watched, extra_min: u.extra }, req.fam);
  }
  res.json({ v: req.fam.rules_version, remaining: u.remaining, limit: u.limit });
});
app.post("/api/device/check", device, async (req, res) => {
  const p = parseInput(req.body.input);
  if (!p || p.type !== "video") throw bad("That doesn't look like a video link. Copy the link from the Share button and try again.");
  const v = await videoMeta(p.id);
  const rules = normalizeRules(req.fam.rules);
  const vd = verdict(rules, v);
  const asked = Boolean(await one("select 1 from requests where family_id=$1 and status='pending' and video->>'id'=$2", [req.fam.id, v.id]));
  res.json({ ok: vd.ok, why: vd.why || "", video: publicVideo(v), canAsk: !vd.ok && !inList(rules.blacklist, v) && v.embeddable !== false, asked });
});
app.post("/api/device/request", device, async (req, res) => {
  if (limited("req:" + req.dev.id, 30, 3600e3)) throw bad("That's a lot of requests. Try again later.", 429);
  const id = String(req.body.videoId || "");
  if (!/^[\w-]{11}$/.test(id)) throw bad("Unknown video.");
  const v = await videoMeta(id);
  const exists = await one("select id from requests where family_id=$1 and status='pending' and video->>'id'=$2", [req.fam.id, id]);
  if (exists) return res.json({ ok: true, already: true });
  const r = await one("insert into requests(family_id, device_id, video) values($1,$2,$3) returning *", [req.fam.id, req.dev.id, v]);
  if (req.fam.tg_chat_id) { const m = tg.requestMessage(r, req.dev.name); tg.send(req.fam.tg_chat_id, m.text, { reply_markup: m.reply_markup }); }
  res.json({ ok: true });
});
// Grown-up actions on the child's device, protected by the family PIN (checked here, never stored on the device).
app.post("/api/device/grownup", device, async (req, res) => {
  const d = req.dev, f = req.fam;
  if (!f.pin) throw bad("Set a device PIN in the parent dashboard first.");
  if (d.pin_locked_until && new Date(d.pin_locked_until) > new Date()) {
    throw bad(`Too many wrong PINs. Try again in ${Math.ceil((new Date(d.pin_locked_until) - Date.now()) / 60000)} min.`, 429);
  }
  if (!(await checkPassword(String(req.body.pin || ""), f.pin.hash))) {
    const fails = d.pin_fails + 1;
    await q("update devices set pin_fails=$2, pin_locked_until=$3 where id=$1", [d.id, fails, fails >= 5 ? new Date(Date.now() + 5 * 60e3 * (fails - 4)) : null]);
    throw bad(fails >= 5 ? "Too many wrong PINs. Wait 5 minutes." : "That PIN isn't right.", 403);
  }
  await q("update devices set pin_fails=0, pin_locked_until=null where id=$1", [d.id]);
  const action = req.body.action;
  if (action === "extra") await addExtra(d, f, parseInt(req.body.minutes, 10));
  else if (action === "unpair") await q("delete from devices where id=$1", [d.id]);
  const fresh = action === "unpair" ? null : await one("select * from devices where id=$1", [d.id]);
  res.json({ ok: true, remaining: fresh ? usageOf(fresh, f).remaining : null });
});

/* ---------- Telegram webhook ---------- */
app.post("/api/telegram/webhook", async (req, res) => {
  if (!tg.enabled() || req.get("x-telegram-bot-api-secret-token") !== tg.webhookSecret) return res.sendStatus(403);
  res.json({ ok: true });   // reply fast; Telegram retries slow webhooks
  const u = req.body || {};
  try {
    if (u.message?.text) {
      const chat = String(u.message.chat.id);
      const m = u.message.text.match(/^\/start\s+([\w-]+)/);
      if (m) {
        const f = await one("update families set tg_chat_id=$2, tg_link_code=null where tg_link_code=$1 returning email", [m[1], chat]);
        await tg.send(chat, f ? "✅ Linked. You'll get Little Screen requests here and can approve them with one tap." : "That link has expired. Make a new one in the parent dashboard.");
      } else if (/^\/start$/.test(u.message.text)) {
        await tg.send(chat, "Open the Little Screen parent dashboard → Settings → Telegram to link this chat.");
      }
    } else if (u.callback_query) {
      const cq = u.callback_query, chat = String(cq.message?.chat?.id || "");
      const m = String(cq.data || "").match(/^r:(\d+):(video|channel|block|no)$/);
      const f = m && await one("select id from families where tg_chat_id=$1", [chat]);
      if (!f) return void tg.answer(cq.id, "This chat isn't linked any more.");
      try {
        const out = await applyRequest(f.id, parseInt(m[1], 10), m[2]);
        const label = { approved: "✅ Video approved", allowed: "📺 Channel allowed", blocked: "⛔ Channel blocked", dismissed: "Dismissed" }[out.status] || out.status;
        await tg.answer(cq.id, out.already ? "Already handled" : label);
        await tg.edit(chat, cq.message.message_id, `${cq.message.text?.split("\n").slice(0, 3).map(tg.escHtml).join("\n") || ""}\n\n<b>${label}</b>`);
      } catch (e) { await tg.answer(cq.id, e.message.slice(0, 180)); }
    }
  } catch (e) { console.error("telegram webhook", e); }
});

/* ---------- static pages ---------- */
const pub = path.join(__dirname, "..", "public");
app.get("/", (req, res) => res.redirect("/parent/"));
app.get("/app/base.css", (req, res) => res.sendFile(path.join(pub, "base.css")));
app.use(express.static(pub, { extensions: ["html"], maxAge: PROD ? "1h" : 0 }));
app.get("/healthz", async (req, res) => { await q("select 1"); res.json({ ok: true, ytKey: hasKey(), telegram: tg.enabled(), google: google.enabled(), email: mail.enabled() }); });

/* ---------- errors ---------- */
app.use((err, req, res, next) => {
  if (err instanceof UserError) return res.status(err.status || 400).json({ error: err.message });
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Bad request." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server. Try again in a moment." });
});

/* ---------- start ---------- */
await migrate();
await purge().catch(e => console.warn("purge", e.message));
setInterval(() => purge().catch(e => console.warn("purge", e.message)), 6 * 3600e3).unref();
await tg.setup();
const server = app.listen(PORT, () => console.log(`Little Screen listening on :${PORT} (YouTube key: ${hasKey() ? "set" : "MISSING"}, Telegram: ${tg.enabled() ? "on" : "off"}, Google sign-in: ${google.enabled() ? "on" : "off"}, reset email: ${mail.enabled() ? "on" : "off"})`));
process.on("SIGTERM", () => server.close(() => pool.end()));
