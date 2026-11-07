// Sends email through Resend's HTTP API (works on Railway, which limits outbound SMTP).
// Enabled when RESEND_API_KEY and MAIL_FROM are set.
const KEY = process.env.RESEND_API_KEY || "";
const FROM = process.env.MAIL_FROM || "";
const BASE = process.env.RESEND_API_BASE || "https://api.resend.com";

export const enabled = () => Boolean(KEY && FROM);

export async function send({ to, subject, text, html }) {
  if (!enabled()) return false;
  try {
    const r = await fetch(`${BASE}/emails`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) { console.warn("mail", r.status, (await r.text()).slice(0, 200)); return false; }
    return true;
  } catch (e) { console.warn("mail", e.message); return false; }
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function resetEmail(link) {
  return {
    subject: "Reset your Little Screen password",
    text: `Someone asked to reset the password for your Little Screen parent account.\n\nReset it here (the link works once, for 1 hour):\n${link}\n\nIf this wasn't you, ignore this email. Your password won't change.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;line-height:1.5;color:#16262d">
      <h2 style="margin:0 0 12px">Reset your Little Screen password</h2>
      <p>Someone asked to reset the password for your Little Screen parent account.</p>
      <p><a href="${esc(link)}" style="display:inline-block;background:#1f8a5b;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">Choose a new password</a></p>
      <p style="color:#5b6e74;font-size:14px">The link works once, for 1 hour. If this wasn't you, ignore this email. Your password won't change.</p></div>`
  };
}
