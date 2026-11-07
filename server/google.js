// "Continue with Google" for parents (OAuth 2.0 authorization-code flow, no extra packages).
// Enabled when GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and PUBLIC_URL are set.
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
const AUTH_URL = process.env.GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";

export const enabled = () => Boolean(CLIENT_ID && CLIENT_SECRET && PUBLIC_URL);
export const redirectUri = () => `${PUBLIC_URL}/api/auth/google/callback`;

export function authUrl(state) {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: redirectUri(), response_type: "code",
    scope: "openid email profile", state, prompt: "select_account"
  });
  return u.toString();
}

// Exchanges the code for tokens and returns the verified Google identity.
// The ID token comes straight from Google's token endpoint over HTTPS, so per Google's
// guidance its signature needn't be re-checked; we still check audience, issuer and expiry.
export async function exchange(code) {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: redirectUri(), grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(10000)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id_token) throw new Error("Google sign-in didn't complete. Try again.");
  let claims;
  try { claims = JSON.parse(Buffer.from(j.id_token.split(".")[1], "base64url").toString("utf8")); }
  catch { throw new Error("Google sign-in returned something unexpected. Try again."); }
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(CLIENT_ID)) throw new Error("Google sign-in was meant for a different app.");
  if (!["accounts.google.com", "https://accounts.google.com"].includes(claims.iss) && !process.env.GOOGLE_TOKEN_URL) throw new Error("Google sign-in came from an unexpected issuer.");
  if (!claims.exp || claims.exp * 1000 < Date.now() - 60e3) throw new Error("Google sign-in expired. Try again.");
  if (!claims.email || claims.email_verified !== true) throw new Error("Your Google account's email isn't verified, so it can't be used here.");
  return { sub: String(claims.sub), email: String(claims.email).toLowerCase(), name: claims.name || "" };
}
