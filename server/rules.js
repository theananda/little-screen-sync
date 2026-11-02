// Shared rule logic: what a child may watch.

export const DEFAULT_RULES = {
  whitelist: [],      // {id, handle, title, thumb}
  blacklist: [],
  videos: [],         // individually approved videos
  keywords: [],
  blockShorts: true,
  dailyLimit: 0       // minutes, 0 = no limit
};

export function normalizeRules(r = {}) {
  const out = { ...DEFAULT_RULES, ...r };
  for (const k of ["whitelist", "blacklist", "videos", "keywords"]) if (!Array.isArray(out[k])) out[k] = [];
  out.blockShorts = out.blockShorts !== false;
  out.dailyLimit = Math.max(0, Math.min(600, parseInt(out.dailyLimit, 10) || 0));
  return out;
}

export function parseInput(s) {
  s = String(s || "").trim(); let m;
  if (!s || s.length > 300) return null;
  if ((m = s.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/))) return { type: "video", id: m[1] };
  if ((m = s.match(/(UC[\w-]{22})/))) return { type: "channel", id: m[1] };
  if ((m = s.match(/@([\w.\-]{3,})/))) return { type: "handle", handle: "@" + m[1].toLowerCase() };
  if (/^[\w-]{11}$/.test(s)) return { type: "video", id: s };
  if (/^[\w.\-]{3,30}$/.test(s) && !looksLikeSite(s)) return { type: "handle", handle: "@" + s.toLowerCase() };
  return null;
}

export const looksLikeSite = s =>
  /^(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|org|net|io|co|tv|app|dev|be|th|mm)(\/.*)?$/i.test(String(s).trim()) &&
  !/youtu(\.be|be\.com)\/.+/i.test(s);

const keysOf = v => [v.channelId, v.channelHandle].filter(Boolean).map(x => x.toLowerCase());
export function inList(list, v) {
  const ks = keysOf(v);
  return list.some(c => (c.id && ks.includes(c.id.toLowerCase())) || (c.handle && ks.includes(c.handle.toLowerCase())));
}
export const isShort = v =>
  /#shorts?\b/i.test((v.title || "") + " " + (v.desc || "")) || (v.dur != null && v.dur > 0 && v.dur <= 60);

// Returns {ok, why}. Order matters: blocked channel always wins.
export function verdict(rules, v) {
  if (v.embeddable === false) return { ok: false, why: "This video's channel only lets it play on YouTube itself.", code: "noembed" };
  if (inList(rules.blacklist, v)) return { ok: false, why: "This channel is blocked.", code: "blocked" };
  if (rules.videos.some(x => x.id === v.id)) return { ok: true };
  if (v.madeForKids === false && rules.kidsOnly) return { ok: false, why: "This video isn't marked as made for kids.", code: "notkids" };
  const hay = ((v.title || "") + " " + (v.desc || "") + " " + (v.tags || []).join(" ")).toLowerCase();
  if (rules.keywords.some(k => k && hay.includes(String(k).toLowerCase()))) return { ok: false, why: "This video has a word your grown-up blocked.", code: "word" };
  if (rules.blockShorts && isShort(v)) return { ok: false, why: "Shorts are turned off.", code: "short" };
  if (v.live === "live" || v.live === "upcoming") return { ok: false, why: "Live streams aren't on your list.", code: "live" };
  if (inList(rules.whitelist, v)) return { ok: true };
  return { ok: false, why: "This channel isn't on your list yet.", code: "notlisted" };
}

// Compact public shape sent to devices.
export const publicVideo = v => ({
  id: v.id, title: v.title, channelId: v.channelId, channelTitle: v.channelTitle, dur: v.dur ?? null, pub: v.pub || ""
});
