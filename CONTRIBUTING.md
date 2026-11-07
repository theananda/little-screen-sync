# Contributing to Little Screen

Thanks for helping. Little Screen keeps children's video time calm and in parents' hands, so changes should keep it simple, private and safe.

## Ways to help

- **Report a bug** or **suggest a feature** using the issue forms.
- **Ask a question** in Discussions.
- **Translate** the child app or dashboard (Burmese, Thai and others are very welcome).
- **Fix an issue** labelled `good first issue`.

## Ground rules for changes

- **No tracking, ads or analytics**, in the child app or anywhere else.
- **Don't modify YouTube's player.** No overlays, hidden buttons or blocked links; this keeps the project within the YouTube API Services policies.
- **Collect no data from children.** New data about parents needs a reason and a line in `public/privacy.html`.
- **No new runtime dependencies** without discussing it in an issue first. The server deliberately uses only `express` and `pg`.
- **Plain language** in everything people see. Buttons say what they do; errors say what went wrong and how to fix it.

## Development setup

You need Node.js 22+ and PostgreSQL.

```bash
git clone https://github.com/<owner>/<repo>.git
cd <repo>
npm install
createdb littlescreen
DATABASE_URL=postgres://localhost/littlescreen YT_API_KEY=<your key> npm run dev
```

Open <http://localhost:3000> (home page), `/parent/` (dashboard) and `/app/` (child app). The database tables are created on start.

| Folder | What's inside |
|---|---|
| `server/` | Express API, database, YouTube cache, Google sign-in, email, Telegram |
| `public/` | Home page, parent dashboard (`parent/`), child app (`app/`), YouTube player page (`embed.html`) |
| `mobile/` | Capacitor wrapper for Android and iOS |
| `docs/` | Self-hosting, mobile and maintainer guides |

## Before you open a pull request

- Try the full journey: sign up → allow a channel → pair `/app/` with a code → ask for a video → approve it.
- Check the pages at phone width (about 390px) and in dark mode. Nothing should scroll sideways.
- Keep pull requests small and focused, and describe what you tested.

By contributing, you agree your work is released under the project's [MIT License](LICENSE), and you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
