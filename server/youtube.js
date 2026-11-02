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
  const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const reason = j.error?.errors?.[0]?.reason;
    if (reason === "quotaExceeded") throw new UserError("Today's YouTube quota is used up. New videos will load again after midnight Pacific time.");
    throw new Error(j.error?.message || "YouTube returned error " + r.status);
  }
  return j;
}

function isoDur(s) {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(s || "");
  if (!m) return null;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

export function toVideo(v) {
  return {
    id: v.id,
    title: v.snippet?.title || "",
    desc: (v.snippet?.description || "").slice(0, 400),
    tags: (v.snippet?.tags || []).slice(0, 25),
    channelId: v.snippet?.channelId || "",
    channelHandle: "",
    channelTitle: v.snippet?.channelTitle || "",
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
  await q(`insert into video_cache(video_id, data, fetched_at) values($1,$2,now())
           on conflict (video_id) do update set data=excluded.data, fetched_at=now()`, [id, v]);
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
      await q(`insert into channel_cache(channel_id, info, items, fetched_at) values($1,$2,$3,now())
               on conflict (channel_id) do update set info=excluded.info, items=excluded.items, fetched_at=now()`,
        [ch.id, { title: ch.title, handle: ch.handle }, JSON.stringify(items)]);
      return items;
    } catch (e) {
      if (row) return row.items;   // serve stale data rather than nothing
      throw e;
    } finally { inflight.delete(ch.id); }
  })();
  inflight.set(ch.id, p);
  return p;
}
