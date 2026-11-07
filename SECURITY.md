# Security policy

Little Screen protects children's viewing and parents' accounts, so we take security reports seriously.

## Reporting a vulnerability

**Please don't open a public issue.** Instead:

- use **Security → Report a vulnerability** on this repository (private), or
- email **[security contact email]**.

Include what you found, how to reproduce it, and what an attacker could do. We'll reply within 5 working days and keep you updated until it's fixed. We're happy to credit you in the release notes.

## Supported versions

Only the latest release and the `main` branch get security fixes. If you self-host, keep your server up to date with `main`.

## Scope

In scope: the server (`server/`), the parent dashboard, the child app and the Android/iOS wrappers.

Out of scope: YouTube's own player and content, third-party services (Google, Railway, Resend, Telegram), and attacks that need physical access to an unlocked parent device.
