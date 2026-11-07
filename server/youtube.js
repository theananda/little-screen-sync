// YouTube Data API v3 access with a shared cache.
// One fetch of a channel serves every family that allows it, so quota grows with
// the number of distinct channels, not with the number of users.
import { q, one } from "./db.js";

const API_BASE = process.env.YT_API_BASE || "https://www.googleapis.com/youtube/v3/";
const KEY = process.env.YT_API_KEY || "";
const CHANNEL_TTL_MS = (parseInt(process.env.CHANNEL_TTL_MIN, 10) || 180) * 60e3;
const VIDEO_TTL_MS = 7 * 24 * 3600e3;

export const hasKey = () => Boolean(KEY);

export class UserError extends Error {}

async function yt(path, params) {
  if (!KEY) throw new UserError("The server has no YouTube API key yet. Set YT_API_KEY on Railway.");
  const u = new URL(path, API_BASE);
  for (const k in params) u.searchParams.set(k, params[k]);
  u.searchParams.set("key", KEY);
  let r;
  try { r = await fetch(u, { signal: AbortSignal.timeout(10000) }); }
  catch { throw new UserError("The server couldn't reach YouTube just now. Try again in a minute."); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.warn("YouTube API", r.status, JSON.stringify(j.error || {}).slice(0, 500));
    throw new UserError(explainYouTubeError(r.status, j.error || {}));
  }
  return j;
}

// Turns YouTube's error into a sentence the parent (or whoever runs the server) can act on.
export function explainYouTubeError(status, err) {
  const reasons = [
    ...(err.errors || []).map(e => e.reason),
    ...(err.details || []).map(d => d.reason)
  ].filter(Boolean).map(String);
  const has = (...k) => k.some(x => reasons.includes(x));
  const msg = String(err.message || "");
  if (has("quotaExceeded", "dailyLimitExceeded", "RATE_LIMIT_EXCEEDED"))
    return "Today's YouTube quota is used up. New videos will load again after midnight Pacific time.";
  if (has("API_KEY_HTTP_REFERRER_BLOCKED") || /referer/i.test(msg))
    return "The YouTube API key only works from websites, so the server can't use it. In Google Cloud Console → Credentials, open the key and set Application restrictions to None.";
  if (has("API_KEY_IP_ADDRESS_BLOCKED", "API_KEY_ANDROID_APP_BLOCKED", "API_KEY_IOS_APP_BLOCKED"))
    return "The YouTube API key is limited to certain apps or addresses, so the server can't use it. In Google Cloud Console → Credentials, set the key's Application restrictions to None.";
  if (has("API_KEY_SERVICE_BLOCKED"))
    return "The API key isn't allowed to use the YouTube Data API. In Google Cloud Console → Credentials, add “YouTube Data API v3” to the key's API restrictions.";
  if (has("accessNotConfigured", "SERVICE_DISABLED"))
    return "The YouTube Data API v3 isn't turned on for this Google Cloud project. Enable it under APIs & Services → Library.";
  if (has("keyInvalid", "API_KEY_INVALID", "badRequest") && /key/i.test(msg))
    return "The YouTube API key on the server isn't valid. Check YT_API_KEY in Railway for typos or extra spaces.";
  if (status === 404 || has("playlistNotFound", "channelNotFound", "videoNotFound"))
    return "YouTube couldn't find that. Check the link or @handle.";
  return `YouTube refused the request (${status}${msg ? ": " + msg.slice(0, 140) : ""}).`;
}

function isoDur(s) {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(s || "");
  if (!m) return null;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

// Makes text safe to store: cuts on whole characters (never half an emoji),
// drops broken characters and the null character, which PostgreSQL can't store as JSON.
export function cleanText(s, max = 0) {
  let t = String(s ?? "");
  t = typeof t.toWellFormed === "function" ? t.toWellFormed() : t.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
  t = t.replace(/\u0000/g, "");
  if (max && t.length > max) t = Array.from(t).slice(0, max).join("");
  return t;
}

export function toVideo(v) {
  return {
    id: v.id,
    title: cleanText(v.snippet?.title, 300),
    desc: cleanText(v.snippet?.description, 400),
    tags: (v.snippet?.tags || []).slice(0, 25).map(t => cleanText(t, 100)),
    channelId: v.snippet?.channelId || "",
    channelHandle: "",
    channelTitle: cleanText(v.snippet?.channelTitle, 200),
    dur: isoDur(v.contentDetails?.duration),
    pub: v.snippet?.publishedAt || "",
    live: v.snippet?.liveBroadcastContent || "none",
    embeddable: v.status?.embeddable !== false,
    madeForKids: v.status?.madeForKids === true
  };
}

export async function resolveChannel(p) {
  const params = { part: "snippet,contentDetails" };
  if (p.type === "channel") params.id = p.id; else params.forHandle = p.handle;
  const j = await yt("channels", params);
  const c = j.items?.[0];
  if (!c) throw new UserError("We couldn't find that channel. Check the link or @handle.");
  return {
    id: c.id,
    handle: (c.snippet.customUrl || "").toLowerCase(),
    title: c.snippet.title,
    thumb: c.snippet.thumbnails?.medium?.url || c.snippet.thumbnails?.default?.url || "",
    uploads: c.contentDetails?.relatedPlaylists?.uploads || "UU" + c.id.slice(2)
  };
}

export async function videoMeta(id) {
  const cached = await one("select data, fetched_at from video_cache where video_id=$1", [id]);
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < VIDEO_TTL_MS) return cached.data;
  const j = await yt("videos", { part: "snippet,contentDetails,status", id });
  if (!j.items?.[0]) throw new UserError("That video isn't available.");
  const v = toVideo(j.items[0]);
  try {
    await q(`insert into video_cache(video_id, data, fetched_at) values($1,$2,now())
           on conflict (video_id) do update set data=excluded.data, fetched_at=now()`, [id, JSON.stringify(v)]);
  } catch (e) { console.warn("video cache save failed", id, e.message); }
  return v;
}

const inflight = new Map();
export async function channelItems(ch) {
  if (!ch.id) return [];
  const row = await one("select items, fetched_at from channel_cache where channel_id=$1", [ch.id]);
  const fresh = row && Date.now() - new Date(row.fetched_at).getTime() < CHANNEL_TTL_MS;
  if (fresh) return row.items;
  if (inflight.has(ch.id)) return inflight.get(ch.id);
  const p = (async () => {
    try {
      const pl = await yt("playlistItems", { part: "contentDetails", playlistId: ch.uploads || "UU" + ch.id.slice(2), maxResults: 50 });
      const ids = (pl.items || []).map(i => i.contentDetails.videoId).join(",");
      let items = [];
      if (ids) items = ((await yt("videos", { part: "snippet,contentDetails,status", id: ids })).items || []).map(toVideo);
      items.forEach(v => { v.channelHandle = ch.handle || ""; });
      // A saving problem must never hide a channel's videos: show them anyway and log it.
      try {
        await q(`insert into channel_cache(channel_id, info, items, fetched_at) values($1,$2,$3,now())
                 on conflict (channel_id) do update set info=excluded.info, items=excluded.items, fetched_at=now()`,
          [ch.id, JSON.stringify({ title: cleanText(ch.title), handle: ch.handle || "" }), JSON.stringify(items)]);
      } catch (e) { console.warn("channel cache save failed", ch.id, e.message); }
      return items;
    } catch (e) {
      if (row) return row.items;   // serve stale data rather than nothing
      throw e;
    } finally { inflight.delete(ch.id); }
  })();
  inflight.set(ch.id, p);
  return p;
}
