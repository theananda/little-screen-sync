# Maintainer guide

For the people who run the official Little Screen repository: making it public, releasing apps, and day-to-day care.

## Before making the repository public

Work through this once. Each step takes a few minutes.

### 1. Make sure no secrets are in the code or its history

Anything ever committed stays in the git history after it's made public, even if a later commit deleted it.

- [ ] No `.env` file is committed (it's in `.gitignore`; check with `git ls-files | grep -i env`).
- [ ] Search the whole history for keys:

  ```bash
  git log -p --all | grep -nE "AIza[0-9A-Za-z_-]{20,}|GOCSPX-|re_[0-9A-Za-z]{20,}|[0-9]{8,10}:AA[0-9A-Za-z_-]{30,}|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY"
  ```

  These patterns match Google API keys, Google OAuth secrets, Resend keys, Telegram bot tokens and private keys. No output means none were found. For a deeper scan, run [gitleaks](https://github.com/gitleaks/gitleaks): `gitleaks detect --source . -v`.

- [ ] **If anything is found:** first replace it with a new key (Google Cloud → Credentials, Resend → API Keys, BotFather → `/revoke`) and update Railway. Then either rewrite history, or, simpler, start a fresh public repository with a single first commit of the current files.
- [ ] No `*.jks` / `*.keystore` signing keys are in the repo.

### 2. Check content

- [ ] `public/privacy.html` and `public/terms.html`: fill every highlighted placeholder (organization, contact email, hosting region, date).
- [ ] `LICENSE`: the copyright line names the right organization. See "License" below.
- [ ] `SECURITY.md`: replace the placeholder contact address.
- [ ] `CODE_OF_CONDUCT.md`: replace the placeholder contact address.
- [ ] `.github/ISSUE_TEMPLATE/config.yml` and `CONTRIBUTING.md`: replace `OWNER/REPO` / `<owner>/<repo>` with your repository's name.
- [ ] Decide what to do with the older v1 repository (GitHub Pages version): archive it (**Settings → Archive this repository**) and add a line to its README pointing here.

### 3. Repository settings (GitHub → Settings)

**General**
- [ ] Description: "YouTube for kids with only the channels parents choose. Free and open source."
- [ ] Website: `https://kids.springsprouts.net`
- [ ] Topics: `parental-controls`, `youtube`, `kids`, `pwa`, `capacitor`, `nodejs`, `postgresql`
- [ ] Features: Issues **on**, Discussions **on** (for questions), Wiki **off**.
- [ ] Pull requests: allow **squash merging**; turn on **Automatically delete head branches**.

**Rules → Rulesets → New branch ruleset** for `main` (Railway deploys from it):
- [ ] Require a pull request before merging (1 approval if you have a second maintainer).
- [ ] Block force pushes and deletions.

**Advanced Security** (named *Code security* on some accounts):
- [ ] Dependabot alerts **on**, Dependabot security updates **on**.
- [ ] Secret scanning **on**, Push protection **on**.
- [ ] Private vulnerability reporting **on**.
- [ ] CodeQL analysis → **Default setup**.

**Actions → General**
- [ ] Workflow permissions: **Read repository contents** (the release workflow asks for write access itself).
- [ ] Fork pull request workflows: **Require approval for first-time contributors**.

**Secrets and variables → Actions**
- [ ] Variable `LS_API` = `https://kids.springsprouts.net`
- [ ] The four Android signing secrets (next section).

### 4. Flip the switch

**Settings → General → Danger Zone → Change repository visibility → Public.**

Then:
- [ ] In Railway, add `GITHUB_REPO=<owner>/<repo>` so the website shows the APK button and source link.
- [ ] Publish the first release (see "Releasing").
- [ ] Open the website on an Android phone and tap **Download for Android** to check the link works.

## Android signing key

Release APKs must be signed with **the same key forever**. If the key changes, phones refuse to install updates over the old app. Make it once, on your own computer, and back it up.

1. Create the key. `keytool` comes with Java or Android Studio. On a Mac with Android Studio, it's at `/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool`.

   ```bash
   keytool -genkeypair -v -keystore little-screen-release.jks -alias littlescreen \
     -keyalg RSA -keysize 4096 -validity 10000
   ```

   Choose a strong password and answer the name questions (organization name is enough).

2. Turn it into text for GitHub:
   - **Mac:** `base64 -i little-screen-release.jks | pbcopy` (copies it)
   - **Linux:** `base64 -w0 little-screen-release.jks`
   - **Windows PowerShell:** `[Convert]::ToBase64String([IO.File]::ReadAllBytes("little-screen-release.jks")) | Set-Clipboard`

3. GitHub → **Settings → Secrets and variables → Actions → New repository secret**, four times:

   | Secret | Value |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | the long text from step 2 |
   | `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
   | `ANDROID_KEY_ALIAS` | `littlescreen` |
   | `ANDROID_KEY_PASSWORD` | the key password (the same as the keystore password unless you chose a different one) |

4. **Back up** `little-screen-release.jks` and both passwords in your organization's password manager, plus one offline copy. Never commit the file.

If you later publish on Google Play, enroll in **Play App Signing** and upload with this key.

## Releasing

1. Make sure `main` has everything you want, and the latest **Build Android app** run is green.
2. Pick the next version number: `v2.0.1` for fixes, `v2.1.0` for new features.
3. Either:
   - **On GitHub's website:** **Releases → Draft a new release → Choose a tag** → type `v2.1.0` → **Create new tag on publish** → write what changed → **Publish release**; or
   - **With git:** `git tag v2.1.0 && git push origin v2.1.0`.
4. About 10 minutes later, `little-screen.apk`, `little-screen.aab` and `SHA256SUMS.txt` appear on the release. The website's download button serves it automatically.

Server changes (dashboard, rules, API) don't need a release: Railway redeploys whenever `main` changes.

## Day-to-day

- **Issues:** label them `bug`, `enhancement`, `question` or `good first issue`. Point questions to Discussions.
- **Dependabot pull requests:** merge them after checks pass; test the app if a major version changes.
- **Security reports** arrive privately under **Security → Advisories**. Reply within a few days, fix in a private fork, release, then publish the advisory.
- **Quota:** watch YouTube API usage in Google Cloud → APIs & Services → YouTube Data API v3 → Quotas.

## License

The repository uses the **MIT License**: anyone may use, change and redistribute the code, including in closed products, as long as they keep the copyright notice.

If you'd rather require that anyone who runs a modified version as a public service also publishes their changes, switch to the **GNU AGPL-3.0** before going public. Replace `LICENSE` with the text from [gnu.org/licenses/agpl-3.0.txt](https://www.gnu.org/licenses/agpl-3.0.txt) and update the README. Changing the license later is harder once others have contributed.
