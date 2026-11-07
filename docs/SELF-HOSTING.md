# Self-hosting Little Screen

Run your own Little Screen for your family, school or organization. You need:

- a small Node.js server with PostgreSQL (these steps use [Railway](https://railway.com); any host works),
- a Google Cloud project for a YouTube Data API key (free).

Expect about 20 minutes for the basics, plus 10 minutes each for the optional parts.

## 1. Deploy the server

1. Fork this repository (or push your copy to your own GitHub account).
2. In Railway: **New Project → Deploy from GitHub repo** → pick your repo.
3. In the same project: **New → Database → PostgreSQL**.
4. Open the web service → **Settings → Networking** → **Generate Domain**, or add your own domain (for example `kids.example.org`) and create the DNS record Railway shows.
5. Open **Variables** and add:

| Variable | Value |
|---|---|
| `DATABASE_URL` | **Add Reference** → Postgres → `DATABASE_URL` |
| `PUBLIC_URL` | your full address, e.g. `https://kids.example.org` |
| `YT_API_KEY` | from step 2 below |
| `NODE_ENV` | `production` |
| `GITHUB_REPO` | optional, e.g. `your-org/little-screen`. Turns on the website's APK download and source-code links. |

6. Railway deploys automatically. Tables are created on first start.
7. Open `https://…/healthz`. It should show `"ok":true` and `"ytKey":true`.
8. Open `https://…/parent/`, create your parent account, and add a channel.

Cost: one small service plus Postgres is usually **$5–10 a month** on Railway's Hobby plan.

## 2. YouTube Data API key (required)

1. [Google Cloud Console](https://console.cloud.google.com) → create or pick a project.
2. **APIs & Services → Library** → search **YouTube Data API v3** → **Enable**.
3. **APIs & Services → Credentials → Create credentials → API key**.
4. Open the new key:
   - **Application restrictions: None.** The server calls YouTube directly. A "Websites" restriction makes every request fail.
   - **API restrictions: Restrict key** → tick only **YouTube Data API v3**.
5. Put the key in Railway as `YT_API_KEY`.

**Quota:** the free 10,000 units a day covers about 600 different channels, refreshed every 3 hours, shared by every family on your server. Set `CHANNEL_TTL_MIN=360` to double that. Beyond that, apply through Google's *YouTube API Services Audit and Quota Extension Form*.

## 3. "Continue with Google" (optional)

1. Same Google Cloud project → **APIs & Services → OAuth consent screen** (Google Auth Platform) → **Get started**:
   - App name, support email, audience **External**, contact email → **Create**.
2. **Branding:** home page `https://…/`, privacy policy `https://…/privacy`, terms `https://…/terms`, authorized domain = your domain. Leave the logo empty; a logo triggers a brand review.
3. **Audience → Publish app.** Otherwise only listed test users can sign in.
4. **Clients → Create client → Web application**:
   - Authorized JavaScript origin: `https://kids.example.org`
   - Authorized redirect URI: `https://kids.example.org/api/auth/google/callback`
5. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Railway.

Only the `openid`, `email` and `profile` scopes are used, so Google doesn't need to review the app.

## 4. Password-reset emails (recommended)

Railway limits outgoing SMTP, so email goes through [Resend](https://resend.com)'s HTTP API (free up to 3,000 emails a month).

1. Resend → **Domains → Add domain** → add the DNS records it shows → **Verify**.
2. **API Keys → Create** with sending access.
3. In Railway add `RESEND_API_KEY` and `MAIL_FROM`, e.g. `Little Screen <no-reply@example.org>`.

The "Forgot password?" link appears once email (or Telegram) is set up.

## 5. Telegram alerts (optional)

1. Message **@BotFather** → `/newbot` → copy the token.
2. Add `TELEGRAM_BOT_TOKEN` in Railway (keep `PUBLIC_URL` set). The webhook registers itself on start.
3. Parents link their chat in **Settings → Telegram alerts**.

## 6. Before you invite other families

- Fill in the highlighted placeholders in `public/privacy.html` and `public/terms.html` (organization name, contact, hosting region, date).
- Check `/healthz` shows everything you expect.
- Try the whole journey yourself: sign up, add channels, pair a device, ask for a video, approve it.

## All settings

| Variable | Required | What it does |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `PUBLIC_URL` | yes | Full public address; used for Google, Telegram and reset links. `https://` is added if missing. |
| `YT_API_KEY` | yes | YouTube Data API v3 key |
| `NODE_ENV` | recommended | `production` turns on secure cookies |
| `GITHUB_REPO` | no | `owner/repo`; shows the APK download and source links on the home page |
| `APK_URL` | no | Override the APK download link (default: latest GitHub release) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | "Continue with Google" |
| `RESEND_API_KEY`, `MAIL_FROM` | no | Password-reset emails |
| `TELEGRAM_BOT_TOKEN` | no | Request alerts with approve buttons |
| `CHANNEL_TTL_MIN` | no | Minutes between channel refreshes (default 180) |
| `DATABASE_SSL` | no | `true` if your database needs SSL from outside its private network |

## Troubleshooting

| You see | Fix |
|---|---|
| "The YouTube API key only works from websites…" | Set the key's **Application restrictions** to **None**. |
| "The YouTube Data API v3 isn't turned on…" | Enable it in **APIs & Services → Library**. |
| Google `invalid_request` / `redirect_uri_mismatch` | `PUBLIC_URL` and the redirect URI in Google must match exactly, including `https://`. |
| "Access blocked: app is in testing" | **Audience → Publish app** in the Google console. |
| No "Forgot password?" link | Set `RESEND_API_KEY` and `MAIL_FROM` (or `TELEGRAM_BOT_TOKEN`). |
| Anything else | Railway → service → **Deployments → View logs**. YouTube problems are logged as `YouTube API …`. |
