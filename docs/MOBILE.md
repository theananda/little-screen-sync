# Android and iOS apps

The child app (`public/app/`) is packaged with [Capacitor](https://capacitorjs.com) in `mobile/`. The app's files are bundled inside it; videos play through `https://<your server>/embed.html`, because YouTube requires a real web address for its embedded player.

## Android APK (automatic, no computer needed)

GitHub Actions builds Android for you (`.github/workflows/android.yml`):

| When | What you get |
|---|---|
| A push to `main` that changes `public/app/`, `public/base.css` or `mobile/`, or **Actions → Build Android app → Run workflow** | A test APK under the run's **Artifacts** |
| A version tag like `v2.1.0` (`release.yml`) | A signed `little-screen.apk` and `little-screen.aab` on the **Releases** page |

The website's **Download for Android** button links to `releases/latest/download/little-screen.apk`, so it always serves the newest release. Set the server variable `GITHUB_REPO` to turn it on.

Set the repository variable `LS_API` (**Settings → Secrets and variables → Actions → Variables**) to your server address if it isn't `https://kids.springsprouts.net`.

Releases need the signing secrets described in [MAINTAINERS.md](MAINTAINERS.md#android-signing-key). Use the same key for every release, or phones can't install updates over the old version.

## Building on your own computer

Needs Node.js 22+, plus Android Studio (Otter 2025.2 or newer) for Android, or a Mac with Xcode 26+ for iOS.

```bash
cd mobile
npm install
LS_API=https://kids.example.org npm run build:web
npx cap add android        # first time only
npx cap add ios            # first time only, Mac
npm run assets             # icons and splash screens from mobile/assets
LS_API=https://kids.example.org npm run sync
npm run open:android       # or: npm run open:ios
```

Forks: change `appId` in `mobile/capacitor.config.json` (default `net.springsprouts.kids`) **before** the first `cap add`, and replace the images in `mobile/assets/`.

## Store publishing notes

**Google Play.** Upload `little-screen.aab`. Fill in Data safety (no data from children, no sharing), target audience, and the privacy policy URL. New personal developer accounts need a 14-day closed test with 12 testers first; organization accounts don't.

**Apple App Store.** Archive in Xcode and upload. Don't choose the Kids Category: Apple requires a parental gate before every external link, and YouTube's player has links the app may not block. Give reviewers a demo parent login and explain that the videos play through YouTube's official embedded player. iPhone and iPad users can also install from Safari without the App Store (see the website).

## Policy notes

| YouTube API Services rule | How Little Screen meets it |
|---|---|
| Don't modify or obscure the player or its links | The player is shown untouched. "Up next" sits below it and starts only after a video ends. |
| Keep API data no more than 30 days | Caches are purged after 30 days. |
| Child-directed: no tracking or personalized ads | No ads or analytics. Videos play from `youtube-nocookie.com`. |
