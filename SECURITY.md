# Security Policy and Hardening Notes

## Current Risk Posture

This project is a static client-side app. If it is deployed on GitHub Pages, every shipped file is publicly retrievable by URL.

## Important Deployment Constraint

GitHub Pages does **not** provide true access control for static files.

- `noindex`, `robots.txt`, and unlisted URLs reduce discovery only.
- They do not prevent direct access.

If your portfolio data must be private, do not publish sensitive CSV files to a public Pages site.

## Recommended Private Deployment Pattern

1. Put this app behind an authentication gateway (for example: Cloudflare Access, Tailscale Funnel with ACL, or another reverse proxy with auth).
2. Keep sensitive transaction data out of the public branch.
3. Use a private data source authenticated server-side.
4. Keep GitHub Actions enabled for secret scanning and static analysis.

## What Is Hardened in This Repo

- CSP and browser policy meta tags are enabled in `index.html`.
- Inline event handlers and unsafe DOM HTML injection patterns were removed.
- Data now loads from same-origin files instead of `raw.githubusercontent.com`.
- Automated secret/static scans run from `.github/workflows/security-sweep.yml`.
- Automated daily BTC historical data updates run from `.github/workflows/update-historical-prices.yml`.
- Coinbase API usage is server-side only via GitHub Actions (`.github/workflows/sync-coinbase-transactions.yml`); API keys are not embedded in frontend code.

## Reporting a Security Issue

Open a private report by email or private message instead of filing a public issue with exploit details.
