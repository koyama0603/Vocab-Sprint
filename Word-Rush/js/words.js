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
  const header = (rows[0] || []).map((value, index) => {
    const text = String(value || "").trim();
    return index === 0 ? text.replace(/^\uFEFF/, "") : text;
  });
  const body = rows.slice(1);
  const seen = new Set();
  const words = [];
  const columnIndex = (name, fallback) => {
    const index = header.indexOf(name);
    return index >= 0 ? index : fallback;
  };
  const idIndex = columnIndex("id", -1);
  const englishIndex = columnIndex("english", idIndex >= 0 ? 1 : 0);
  const japaneseIndex = columnIndex("japanese", idIndex >= 0 ? 2 : 1);
  const detailIndex = columnIndex("detail", idIndex >= 0 ? 3 : 2);
  const sampleIndex = columnIndex("sample", idIndex >= 0 ? 4 : 3);
  const sampleJpnIndex = columnIndex("sample-jpn", idIndex >= 0 ? 5 : -1);

  for (const row of body) {
    const id = idIndex >= 0 ? String(row[idIndex] || "").trim() : "";
    const english = String(row[englishIndex] || "").trim();
    const japanese = String(row[japaneseIndex] || "").trim();
    const detail = String(row[detailIndex] || "").trim();
    const sample = String(row[sampleIndex] || "").trim();
    const sampleJpn = sampleJpnIndex >= 0 ? String(row[sampleJpnIndex] || "").trim() : "";
    const key = id || english.toLowerCase();
    if (!english || !japanese || seen.has(key)) {
      continue;
    }
    seen.add(key);
    words.push({ id, english, japanese, detail, sample, sampleJpn });
  }

  if (words.length < 3) {
    throw new Error(`Not enough words: ${level.file}`);
  }

  return words;
}

export async function loadWords(level) {
  const cacheKey = level.file;
  let request = wordCache.get(cacheKey);
  if (!wordCache.has(cacheKey)) {
    request = readWords(level);
    wordCache.set(cacheKey, request);
  }

  try {
    const words = await request;
    return words.slice();
  } finally {
    if (wordCache.get(cacheKey) === request) {
      wordCache.delete(cacheKey);
    }
  }
}
