# tom-diary

A browser reimplementation of [riddle](https://github.com/MaximeRivest/riddle) —
Tom Riddle's diary as an installable PWA for iPad and other tablets. Write with
a pen; rest; the diary drinks your ink and replies in animated handwriting.

## Run locally

```bash
npm install
npx playwright install chromium   # for the browser tests
npm test           # unit (Vitest + jsdom)
npm run test:browser  # browser (Playwright)
npm run serve      # http://localhost:8080
```

Open the served URL, hold the top-left corner to open **Settings**, and enter
your OpenAI-compatible API key, base URL, and model. On first launch with no key
the Settings panel opens automatically. Everything else runs client-side; only
the reply call needs network.

## Deploy to GitHub Pages

The app is static files with **no build step**, so Pages serves the repo as-is.

1. Push to `jumbomochi/tom-diary` on GitHub.
2. Settings → Pages → Build and deployment → **Deploy from a branch**, branch
   `main`, folder `/ (root)`. Save.
3. Wait for the deploy; the app is at `https://jumbomochi.github.io/tom-diary/`.
   All asset paths are **relative** (`./…`), so it works from that subpath.
4. On the iPad, open that URL in Safari once, then **Share → Add to Home
   Screen**. The manifest (`display: standalone`) launches it fullscreen, and
   the service worker caches the shell (HTML/CSS/JS, the font, `opentype.mjs`)
   so it opens offline — only the oracle call needs Wi-Fi.

> **On every deploy, bump the `CACHE` constant in `sw.js`** (e.g.
> `tom-diary-v1` → `-v2`). The worker serves the shell cache-first under that
> fixed name, so already-installed clients keep serving the old cached assets
> until the cache name changes — without a bump, updated HTML/CSS/JS never reach
> them.

## How it works

- `js/ink.js` — pen capture, live ink, scribble-erase, idle-commit, the "!" help gesture.
- `js/commit.js` — crop/downscale the page to a black-on-white PNG.
- `js/handwriting.js` (+ `glyphs/layout/reveal/skeleton/dissolve`) — glyph
  rasterize → Zhang-Suen thin → centerline trace → animated brush reveal + dissolve.
- `js/oracle.js` — OpenAI-compatible streaming, the persona/memory prompts, the SSE parser.
- `js/memory.js` — IndexedDB pages, the catalog, `spoken_date`, conjure lookup.
- `js/statemachine.js` — the pure 9-state reducer.
- `js/app.js` — the driver wiring it all together.
