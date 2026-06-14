# Paper Flick 🗑️📄

A Paper Toss–style flick game. Swipe up to toss the crumpled paper ball across
the room and into the trash can — but mind the wind from the office fan!

Built with **HTML5 Canvas + TypeScript** (no game-engine dependency, ~7 kB JS),
so it runs on **web, iOS, and Android** from a single codebase.

## Play

- **Web:** deployed to GitHub Pages (see below).
- **iPhone / Android:** open the web URL in the browser, then **Add to Home
  Screen** — it's a PWA, so it launches fullscreen like a native app and works
  offline.

### How to play

- **Swipe up** to flick the ball. A longer flick throws further.
- Watch the **wind indicator** (top-right) and the spinning **fan**: angle your
  swipe *into* the wind to compensate.
- Sink consecutive shots to build a **streak** for bonus points.

## Develop

```bash
npm install
npm run dev      # local dev server
npm run build    # production build to dist/
npm run preview  # preview the production build
npm run gen:icons # regenerate PWA icons
```

## Deploy (GitHub Pages)

Pushing to the development branch (or `main`) runs
`.github/workflows/deploy.yml`, which builds the app and publishes `dist/` to
GitHub Pages. The Vite `base` is set to `/paperball-flick/` for the project
site, so the live URL is:

```
https://davidjonidev.github.io/paperball-flick/
```

The workflow enables Pages automatically on its first successful run. If the
first deploy doesn't appear, check **Settings → Pages** and confirm the source
is set to **GitHub Actions**.

## Native app builds (later)

Because the game is a standard web app, packaging it for the App Store / Play
Store is a wrapper step with [Capacitor](https://capacitorjs.com/) — no rewrite:

```bash
npm i -D @capacitor/cli @capacitor/core @capacitor/ios @capacitor/android
npx cap init "Paper Flick" com.example.paperflick --web-dir dist
npm run build && npx cap add ios && npx cap add android
npx cap open ios   # build/run in Xcode
npx cap open android # build/run in Android Studio
```

## Tech notes

- Pseudo-3D perspective projection renders the room; the ball scales down as it
  flies away.
- Throw physics are a projectile arc with lateral wind acceleration. Scoring is
  forgiving in depth but tight laterally, so the **wind is the real skill** —
  matching the feel of the original Paper Toss.
