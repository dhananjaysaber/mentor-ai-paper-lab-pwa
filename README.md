# Mentor AI Paper Lab — GitHub Pages PWA

This **independent** public repository hosts only the static user interface for Claude-powered NIFTY options **paper trading**.

- **GitHub Pages viewing link:** https://dhananjaysaber.github.io/mentor-ai-paper-lab-pwa/
- **Development branch:** `dhananjaysaber/index-options-mentor` → `mentor-ai-paper-lab`
- **Backend (separate):** https://mentor-ai-paper-lab.netlify.app
- **Original Options Mentor PWA:** https://dhananjaysaber.github.io/index-options-mentor-pwa/ (unmodified)

## Enable GitHub Pages once

In this repository open **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Then open **Actions → Publish Mentor AI Paper Lab to GitHub Pages → Run workflow** if a deployment has not already started automatically. The workflow also runs on every new push to `main`.

## Secrets and FYERS market data

**Do not put any API keys or passwords in this public repository or in Vite environment variables.** The public app references only the non-secret backend URL. Server-side Anthropic and FYERS credentials remain in Netlify Environment Variables.

The GitHub Pages URL hosts a **static frontend**; it cannot execute the Claude API or FYERS authentication backend directly.

The separate Netlify backend must remain working for FYERS login, live market data, and Claude analysis. A future alternative host can replace Netlify without changing the GitHub Pages URL if it supports the same API and secret management.

FYERS login uses the dedicated non-trading AI app and the backend redirect URI `https://mentor-ai-paper-lab.netlify.app/api/fyers/callback`.

## Paper-only limitations

No live orders are implemented. Simulated fills use observed price quotes and exclude realistic spread, brokerage and slippage. AI decisions and simulated trades are saved locally in the browser and can be exported as CSV/JSON.

**Unattended trading is not implemented yet**: automatic market analysis and paper position monitoring currently run only while the browser tab remains open and the market-data session is available. Before running unattended research or relying on its results, migrate the journal and execution loop to a persistent backend.

Risk caps limit paper entries, but virtual losses can exceed modeled stop levels because markets gap and quote observations are discrete.

## Development

```bash
npm install
npm run dev
npm run build
```

The Vite base path is configured for this repository's GitHub Pages subpath. The app is intended to run on HTTPS.
