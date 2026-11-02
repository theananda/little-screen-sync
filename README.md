# Little Screen 2 — synced, store-ready

Parents manage everything from their own phone or computer. Children's devices pick up changes within a minute.

```
Parent dashboard (web)  ─┐
Telegram bot (optional) ─┼─►  Railway: Node server + Postgres  ◄──  Child app (iOS / Android / web)
                         │      • rules, devices, requests         • shows only allowed videos
YouTube Data API  ◄──────┘      • shared channel cache             • standard YouTube player
```

| Path | What it is |
|---|---|
| `server/` | Express API, Postgres schema, YouTube cache, Telegram bot |
| `public/parent/` | Parent dashboard (`/parent/`) |
| `public/app/` | Child app (`/app/` on the web, bundled into the iOS/Android apps) |
| `public/embed.html` | Page that hosts YouTube's player for the child app |
| `public/privacy.html`, `terms.html` | Policy templates (fill in the highlighted parts) |
| `mobile/` | Capacitor project that packages the child app for the App Store and Google Play |

## What's different from version 1

- **One place to manage, many devices.** Rules live on the server. Pair each child device with a 6-digit code.
- **Requests reach the parent's phone.** In the dashboard, or in Telegram with Approve / Allow channel / Block channel buttons.
- **Filtering happens on the server.** A device only ever receives the videos it's allowed to show.
- **One YouTube key on the server, shared cache.** Each channel is fetched once (every 3 hours) for all families, so quota grows with the number of channels, not families.
- **Compliant player.** No shields or covers over YouTube's player, no hidden links, native full screen. See "Compliance" below.
- **New settings:** "Only made-for-kids videos", time zone for the daily reset, device PIN checked by the server.

## 1. Deploy on Railway (about 10 minutes)

1. Push this folder to a GitHub repo (for example `theananda/little-screen-sync`).
2. In Railway: **New Project → Deploy from GitHub repo** → pick the repo.
3. In the same project: **New → Database → PostgreSQL**.
4. Open the web service → **Variables** and add:
   - `DATABASE_URL` → choose **Reference** → Postgres → `DATABASE_URL`
   - `YT_API_KEY` → your YouTube Data API v3 key
   - `NODE_ENV` → `production`
   - `PUBLIC_URL` → the service's public address (Settings → Networking → Generate Domain), e.g. `https://little-screen.up.railway.app`
5. Deploy. Tables are created automatically on first start. Check `https://…/healthz` shows `"ok":true,"ytKey":true`.
6. Open `https://…/parent/`, create your parent account, add channels, set a device PIN.

Cost: one small service plus Postgres is typically **$5–10 a month** on Railway's Hobby plan.

### YouTube API key

Google Cloud Console → enable **YouTube Data API v3** → Credentials → API key → restrict it to that API. Since the key now lives on the server, you don't need a website restriction. Each channel refresh costs 2 units, and a link check or request costs 1. The free 10,000 units a day covers roughly 600 distinct channels refreshed every 3 hours, however many families share them. Set `CHANNEL_TTL_MIN=360` to double that before you need a quota extension.

### Telegram alerts (optional)

1. Message **@BotFather** → `/newbot` → copy the token.
2. Add `TELEGRAM_BOT_TOKEN` in Railway (keep `PUBLIC_URL` set). Redeploy; the webhook registers itself.
3. Parent dashboard → **Settings → Telegram alerts → Link Telegram** → open the link → **Start**.

## 2. Pair a child's device

- **Quick test in a browser:** open `https://…/app/` on the child's device.
- **Parent dashboard → Devices → Get a pairing code** → type the code on the child's device and give it a name.
- Rules, approvals and extra time reach the device within about 30 seconds.

## 3. Build the iPhone and Android apps

You need a Mac with Xcode for iOS, and Android Studio for Android.

```bash
cd mobile
npm install
LS_API=https://little-screen.up.railway.app npm run build:web
npx cap add ios        # first time only
npx cap add android    # first time only
LS_API=https://little-screen.up.railway.app npm run sync
npm run open:ios       # or: npm run open:android
```

In Xcode: set your Team and bundle identifier (default `org.theananda.littlescreen`), add app icons, then **Product → Archive** to upload to App Store Connect.

The child app is bundled inside the app (not loaded from a website), which matters for Apple's review. Videos play through `https://…/embed.html` on your server so YouTube receives a proper web address; YouTube refuses to play inside apps that don't provide one.

## 4. Compliance checklist

### YouTube API Services policies

| Rule | How Little Screen meets it |
|---|---|
| Don't modify, block or obscure any part of the player or its links | Player is shown untouched on our embed page. No overlays, no hidden title bar or logo, native full screen on. "Up next" is our own list *below* the player, and only after a video ends. |
| Store API data no longer than 30 days | Channel and video caches are deleted after 30 days (`purge()` runs every 6 hours). |
| Child-directed apps: tracking off, no personalised ads | No ads, no analytics. Videos play from `youtube-nocookie.com`. |
| Quota extensions need a compliance audit | Have your privacy policy and terms published, then use the YouTube API Services Audit and Quota Extension Form if you outgrow 10,000 units a day. |

### Apple App Store (Kids category)

- **Parental gate:** grown-up actions (time, unpair, dashboard address) sit behind the family PIN, checked by the server.
- **No third-party analytics or ads** in the child app. Answer the privacy questions accordingly: no tracking; data collected = none from the child (the parent's email is collected on the web dashboard, not in the app).
- **Account deletion:** parents can delete their account in the dashboard (Settings → Delete account). The child app has no sign-up.
- **Privacy policy URL:** `https://…/privacy` (fill in the highlighted parts first).
- **For App Review:** give reviewers a parent login and a pairing code in the review notes (codes last 15 minutes, so create a long-lived demo device in advance, or explain how to get a code).
- **Reality check:** Apple sometimes rejects apps that mostly show web content (guideline 4.2) or that are built around another company's videos. Clear explanations in the review notes help: the parental controls are the product, and the videos play through YouTube's official embedded player under YouTube's terms.

### Google Play (Families policy)

Declare the app's target age group, complete the Data safety form (no data collected from children, no sharing), and link the same privacy policy.

## 5. Device lock (still important)

The app keeps children inside allowed videos, but YouTube's own player still contains links to YouTube. Pair the app with **Screen Time / Guided Access** (iPhone/iPad) or **Family Link / Screen pinning** (Android) and block the YouTube app and other browsers. If the network is filtered, allow: `youtube-nocookie.com`, `youtube.com`, `googlevideo.com`, `ytimg.com`, `googleapis.com`, and your Railway address.

## Local development

```bash
npm install
DATABASE_URL=postgres://localhost/littlescreen YT_API_KEY=… npm run dev
# open http://localhost:3000/parent/ and http://localhost:3000/app/
```

## API summary

Parent (cookie session): `/api/auth/*`, `/api/me`, `/api/preview`, `/api/rules/{channels,videos,keywords,settings}`, `/api/requests`, `/api/devices`, `/api/pin`, `/api/telegram/*`, `/api/account`.
Device (Bearer token from pairing): `/api/device/{pair,feed,ping,check,request,grownup}`.
