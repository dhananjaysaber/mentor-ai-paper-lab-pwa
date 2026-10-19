# Mentor AI Paper Lab — GitHub Pages PWA

**Public viewing link:** https://dhananjaysaber.github.io/mentor-ai-paper-lab-pwa/

An installable, independent React PWA for autonomous Claude-based NIFTY **paper trading**. This repository contains **frontend files only**, with no Anthropic or FYERS secrets.

## Install to Home Screen

- **iPhone/iPad:** Open the GitHub Pages link in Safari → **Share** → **Add to Home Screen** → **Add**. The Mentor AI icon appears on your home screen and opens the standalone PWA.
- **Android (Chrome):** Open the page and tap **Install app**, or use Chrome menu → **Add to Home screen**.
- **Desktop Chrome/Edge:** Select **Install app** if prompted or use the browser's install option.

The app includes a branded MAI icon, 192/512px PNGs, Apple touch icon, web manifest, install prompt/instructions and service worker caching of static assets. Live FYERS quotes and Claude analyses **require internet** and are never cached.

## Current operation

**The currently deployed PWA connects to the secure Netlify backend**, not to a fully autonomous, hosted worker. Browser-mode auto analysis and simulated paper exits require the PWA to remain open. Trade records are saved in browser storage and can be exported.

A **separate server-side autonomous paper worker** has been implemented in the private repository on branch `mentor-ai-paper-lab`, including SQLite records, encrypted FYERS market-data session, Claude assessments and protective stop monitoring. It is **not running until an always-on server is configured**. No live trading or FYERS orders are supported.

## Switching to the standalone backend later

After an owner-configured Node.js 24 HTTPS worker is tested and deployed, update this public repository's GitHub Actions workflow file `.github/workflows/deploy-pages.yml`:

```yaml
env:
  VITE_AI_API_BASE: https://YOUR-WORKER-HOST
  VITE_AI_BACKEND_MODE: standalone
```

The frontend already has optional worker integration and will then use durable cloud-hosted paper positions/journal rather than browser-only paper records. **Do not enable standalone mode before the worker is reachable and the dedicated FYERS non-trading redirect URI is updated.**

Worker deployment guide (requires private repo access): `dhananjaysaber/index-options-mentor` → `mentor-ai-paper-lab` → `AI-PAPER-WORKER-DEPLOY.md`.

## Build

```bash
npm install
npm run build
```

Built files are published automatically using GitHub Actions and GitHub Pages at `/mentor-ai-paper-lab-pwa/`. The original Index Options Mentor PWA is separate and untouched.

## Risk note

This is quote-based simulation with no real broker order placement. Results omit realistic fill prices, brokerage, spreads and slippage. Claude may make errors. Current news/calendar feeds are not connected and no actual trading performance has been validated.
