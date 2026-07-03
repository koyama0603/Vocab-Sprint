# Word Rush

Static website version of the English vocabulary rush game.

## Run Locally

```bash
npm run serve
```

Then open:

```text
http://127.0.0.1:5173/
```

The app loads level-specific CSV files with `fetch()`, so use a local HTTP server instead of opening `index.html` directly with `file://`.

## Generate CSV Word Data

```bash
npm run generate:data
```

This regenerates the CEFR-based level CSV files in `data/` and updates `js/levels.config.js`.
The CSV files use CEFR-J / Octanove vocabulary profiles with Japanese meanings from EJDict.

## Generate BGM Manifest

```bash
npm run generate:audio
```

This updates `js/audio-tracks.js` from the `.mp3` files in `assets/audio/`.

## Generate Cache Manifest

```bash
npm run generate:cache
```

Run this after changing deployable files such as HTML, CSS, JavaScript, CSV, icons, or audio. The service worker checks `cache-manifest.json` on reload, keeps already-loaded assets in Cache Storage, and deletes older version caches when a new version is detected.
