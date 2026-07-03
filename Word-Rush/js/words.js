export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === "\"" && next === "\"") {
        value += "\"";
        i += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

const wordCache = new Map();

async function readWords(level) {
  const response = await fetch(level.file);
  if (!response.ok) {
    throw new Error(`CSV load failed: ${level.file}`);
  }

  const rows = parseCsv(await response.text());
  const body = rows.slice(1);
  const seen = new Set();
  const words = [];

  for (const row of body) {
    const english = String(row[0] || "").trim();
    const japanese = String(row[1] || "").trim();
    const detail = String(row[2] || "").trim();
    const key = english.toLowerCase();
    if (!english || !japanese || seen.has(key)) {
      continue;
    }
    seen.add(key);
    words.push({ english, japanese, detail });
  }

  if (words.length < 3) {
    throw new Error(`Not enough words: ${level.file}`);
  }

  return words;
}

export async function loadWords(level) {
  const cacheKey = level.file;
  if (!wordCache.has(cacheKey)) {
    const request = readWords(level).catch((error) => {
      wordCache.delete(cacheKey);
      throw error;
    });
    wordCache.set(cacheKey, request);
  }

  const words = await wordCache.get(cacheKey);
  return words.slice();
}
