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

This regenerates the level CSV files in `data/` from EJDict.

## Generate BGM Manifest

```bash
npm run generate:audio
```

This updates `js/audio-tracks.js` from the `.mp3` files in `assets/audio/`.
