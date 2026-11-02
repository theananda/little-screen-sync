// Optional Telegram bot: request alerts with one-tap approve buttons.
// Enabled when TELEGRAM_BOT_TOKEN and PUBLIC_URL are set.
import crypto from "node:crypto";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
export const webhookSecret = TOKEN ? crypto.createHash("sha256").update("tg:" + TOKEN).digest("hex").slice(0, 32) : "";
export const enabled = () => Boolean(TOKEN && PUBLIC_URL);
let botUsername = process.env.TELEGRAM_BOT_USERNAME || "";
export const username = () => botUsername;

async function call(method, body) {
  if (!TOKEN) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000)
    });
    const j = await r.json();
    if (!j.ok) console.warn("telegram", method, j.description);
    return j.result;
  } catch (e) { console.warn("telegram", method, e.message); return null; }
}

export async function setup() {
  if (!enabled()) return;
  const me = await call("getMe", {});
  if (me?.username) botUsername = me.username;
  await call("setWebhook", {
    url: `${PUBLIC_URL}/api/telegram/webhook`, secret_token: webhookSecret,
    allowed_updates: ["message", "callback_query"]
  });
}

export const send = (chat_id, text, extra = {}) => call("sendMessage", { chat_id, text, parse_mode: "HTML", disable_web_page_preview: false, ...extra });
export const answer = (callback_query_id, text) => call("answerCallbackQuery", { callback_query_id, text });
export const edit = (chat_id, message_id, text) => call("editMessageText", { chat_id, message_id, text, parse_mode: "HTML", disable_web_page_preview: true });

const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
export function requestMessage(req, deviceName) {
  const v = req.video;
  return {
    text: `🔔 <b>${esc(deviceName || "Your child")}</b> asked to watch:\n<b>${esc(v.title)}</b>\n${esc(v.channelTitle)}\nhttps://www.youtube.com/watch?v=${esc(v.id)}`,
    reply_markup: {
      inline_keyboard: [
        [{ text: "✅ Approve video", callback_data: `r:${req.id}:video` }, { text: "📺 Allow channel", callback_data: `r:${req.id}:channel` }],
        [{ text: "⛔ Block channel", callback_data: `r:${req.id}:block` }, { text: "Dismiss", callback_data: `r:${req.id}:no` }]
      ]
    }
  };
}
export { esc as escHtml };
