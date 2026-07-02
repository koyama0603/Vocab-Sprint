import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const AUDIO_DIR = path.join(ROOT, "assets", "audio");
const OUT_FILE = path.join(ROOT, "js", "audio-tracks.js");

function toLabel(fileName) {
  return path.basename(fileName, path.extname(fileName));
}

function toWebPath(fileName) {
  return `assets/audio/${encodeURIComponent(fileName).replace(/%2F/gi, "/")}`;
}

const files = (await readdir(AUDIO_DIR))
  .filter((fileName) => path.extname(fileName).toLowerCase() === ".mp3")
  .sort((a, b) => a.localeCompare(b, "en"));

const tracks = files.map((fileName) => ({
  id: toLabel(fileName),
  label: toLabel(fileName),
  src: toWebPath(fileName)
}));

const body = `export const BGM_TRACKS = ${JSON.stringify(tracks, null, 2)};\n`;
await writeFile(OUT_FILE, body, "utf8");

console.log(`Generated ${path.relative(ROOT, OUT_FILE)} (${tracks.length} tracks)`);
