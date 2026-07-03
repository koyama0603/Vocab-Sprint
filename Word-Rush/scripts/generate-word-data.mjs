import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEVELS } from "../js/levels.js";
import { parseCsv } from "../js/words.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const USER_AGENT = "Vocab-Sprint-Data-Generator";
const EJDICT_RAW = "https://raw.githubusercontent.com/kujirahand/EJDict/master";
const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
const DEFAULT_TARGET_WORDS = 200;
const JAPANESE_RE = /[\u3040-\u30ff\u3400-\u9fff]/;
const BAD_MEANING_RE = /(複数形|短縮形|省略形|化学記号|略語|頭字語|過去形|過去分詞|古語|古詩|古期|廃語|俗語|卑語|差別|売春|娼婦|性交|性器|陰部|裸|麻薬|アヘン|糞|排泄|尿|殺人)/;
const BAD_WORDS = new Set([
  "adult", "anus", "bitch", "boob", "boobs", "brothel", "condom", "crap", "cunt",
  "damn", "dick", "erotic", "fuck", "fucking", "gay", "hooker", "naked", "nude",
  "ass", "fag", "penis", "porn", "porno", "prostitute", "pussy", "rape", "raped", "raping",
  "sex", "sexual", "sexy", "shit", "slut", "sperm", "suicide", "vagina", "whore", "wop"
]);

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT }
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  return response.text();
}

function normalizeWord(word) {
  return String(word || "").trim().toLowerCase();
}

function isValidWord(word) {
  return /^[a-z][a-z]{1,15}$/.test(word);
}

function cleanMeaning(definition) {
  const segments = String(definition || "")
    .replace(/\r/g, "")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment && !BAD_MEANING_RE.test(segment));
  const cleanedSegments = segments.map((segment) => segment
    .replace(/〈[^〉]*〉/g, "")
    .replace(/《[^》]*》/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[『』"“”]/g, "")
    .replace(/…+/g, "")
    .replace(/[{}]/g, "")
    .replace(/^\d+/, "")
    .replace(/\s+/g, " ")
    .replace(/^[,;:・\s]+/, "")
    .trim());
  const cleaned = cleanedSegments.find((segment) => JAPANESE_RE.test(segment) && !BAD_MEANING_RE.test(segment)) || "";

  const compact = cleaned.split(/[;；,，]/).map((part) => part.trim()).find((part) => JAPANESE_RE.test(part)) || cleaned;
  if (!JAPANESE_RE.test(compact) || BAD_MEANING_RE.test(compact)) {
    return "";
  }
  return compact.replace(/\s+/g, " ").slice(0, 36);
}

function hashWord(word) {
  let hash = 2166136261;
  for (const char of word) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function toCsv(rows) {
  const lines = [["english", "japanese"], ...rows.map((entry) => [entry.english, entry.japanese])];
  return `\uFEFF${lines.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

async function targetWordsForLevel(level) {
  try {
    const text = await readFile(path.join(ROOT, level.file), "utf8");
    const rows = parseCsv(text).slice(1);
    const words = rows.filter((row) => String(row[0] || "").trim() && String(row[1] || "").trim());
    if (words.length >= 3) {
      return words.length;
    }
  } catch {
    // If the CSV does not exist yet, fall back to a conservative default.
  }
  return DEFAULT_TARGET_WORDS;
}

async function loadDictionary() {
  const dictionary = new Map();
  const exactLowercase = new Set();
  for (const letter of LETTERS) {
    const text = await fetchText(`${EJDICT_RAW}/src/${letter}.txt`);
    for (const line of text.split("\n")) {
      const tab = line.indexOf("\t");
      if (tab < 1) {
        continue;
      }
      const rawWord = line.slice(0, tab).trim();
      const word = normalizeWord(rawWord);
      const isExactLowercase = rawWord === word;
      if (!isValidWord(word)) {
        continue;
      }
      if (dictionary.has(word) && (!isExactLowercase || exactLowercase.has(word))) {
        continue;
      }
      const japanese = cleanMeaning(line.slice(tab + 1));
      if (japanese) {
        dictionary.set(word, japanese);
        if (isExactLowercase) {
          exactLowercase.add(word);
        }
      }
    }
  }
  return dictionary;
}

async function loadFrequencyRanks(dictionary) {
  const text = await fetchText(`${EJDICT_RAW}/frequency/2000.txt`);
  const ranks = new Map();
  let rank = 1;
  for (const line of text.split("\n")) {
    const word = normalizeWord(line);
    if (!isValidWord(word) || !dictionary.has(word) || ranks.has(word)) {
      continue;
    }
    ranks.set(word, rank);
    rank += 1;
  }
  return ranks;
}

function buildCandidates(dictionary, ranks) {
  return [...dictionary.entries()]
    .map(([english, japanese]) => {
      const rank = ranks.get(english);
      const lengthPenalty = Math.max(0, english.length - 5) ** 2 * 54;
      const veryShortBonus = english.length <= 4 ? -120 : 0;
      const score = rank
        ? rank + lengthPenalty + veryShortBonus
        : 5200 + english.length * 165 + (hashWord(english) % 180);
      return { english, japanese, score };
    })
    .filter((entry) => {
      const rank = ranks.get(entry.english);
      if (!rank && entry.english.length <= 3) {
        return false;
      }
      if (BAD_WORDS.has(entry.english)) {
        return false;
      }
      if (entry.japanese.includes("=")) {
        return false;
      }
      if (BAD_MEANING_RE.test(entry.japanese)) {
        return false;
      }
      if (/[A-Za-z]{2,}/.test(entry.japanese)) {
        return false;
      }
      if (/^[A-Z]/.test(entry.japanese)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => a.score - b.score || a.english.localeCompare(b.english));
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  const dictionary = await loadDictionary();
  const ranks = await loadFrequencyRanks(dictionary);
  const candidates = buildCandidates(dictionary, ranks);
  const levelsWithTargets = await Promise.all(LEVELS.map(async (level) => ({
    ...level,
    targetWords: await targetWordsForLevel(level)
  })));
  const required = levelsWithTargets.reduce((sum, level) => sum + level.targetWords, 0);

  if (candidates.length < required) {
    throw new Error(`Only ${candidates.length} words available for ${required} requested words.`);
  }

  let offset = 0;
  const manifest = [];
  for (const level of levelsWithTargets) {
    const entries = candidates.slice(offset, offset + level.targetWords);
    offset += level.targetWords;
    const filePath = path.join(ROOT, level.file);
    await writeFile(filePath, toCsv(entries), "utf8");
    manifest.push({
      id: level.id,
      label: level.label,
      file: level.file,
      words: entries.length,
      first: entries[0]?.english,
      last: entries[entries.length - 1]?.english
    });
  }

  await writeFile(
    path.join(DATA_DIR, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  console.log(`Generated ${manifest.length} CSV files with ${offset} words.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
