import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const LEVEL_CONFIG_PATH = path.join(ROOT, "js", "levels.config.js");
const USER_AGENT = "Word-Rush-CEFR-Data-Generator";

const SOURCES = {
  cefrJ: "https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/cefrj-vocabulary-profile-1.5.csv",
  octanove: "https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/octanove-vocabulary-profile-c1c2-1.0.csv",
  wordsCefrWords: "https://raw.githubusercontent.com/Maximax67/Words-CEFR-Dataset/main/csv/words.csv",
  wordsCefrPos: "https://raw.githubusercontent.com/Maximax67/Words-CEFR-Dataset/main/csv/word_pos.csv",
  wordsCefrPosTags: "https://raw.githubusercontent.com/Maximax67/Words-CEFR-Dataset/main/csv/pos_tags.csv",
  ejdictRoot: "https://raw.githubusercontent.com/kujirahand/EJDict/master/src"
};

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const LEVEL_RANK = Object.fromEntries(LEVELS.map((level, index) => [level, index + 1]));
const RANK_LEVEL = Object.fromEntries(LEVELS.map((level, index) => [index + 1, level]));
const LEVEL_QUOTAS = {
  A1: 1600,
  A2: 1400,
  B1: 1600,
  B2: 1400,
  C1: 800,
  C2: 200
};
const PART_SIZE = 200;
const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
const JAPANESE_RE = /[\u3040-\u30ff\u3400-\u9fff]/;
const BAD_MEANING_RE = /(複数形|短縮形|省略形|化学記号|略語|頭字語|過去形|過去分詞|古語|古詩|古期|廃語|俗語|卑語|差別|売春|娼婦|性交|性器|陰部|裸|麻薬|アヘン|糞|排泄|尿|殺人)/;
const BAD_WORDS = new Set([
  "adult", "anus", "bitch", "boob", "boobs", "brothel", "condom", "crap", "cunt",
  "damn", "dick", "erotic", "fuck", "fucking", "gay", "hooker", "naked", "nude",
  "ass", "fag", "penis", "porn", "porno", "prostitute", "pussy", "rape", "raped",
  "raping", "sex", "sexual", "sexy", "shit", "slut", "sperm", "suicide", "vagina",
  "whore", "wop"
]);
const PROPER_NOUN_TAGS = new Set(["NNP", "NNPS"]);
const SHORT_WORD_ALLOWLIST = new Set([
  "a", "i", "am", "an", "as", "at", "be", "by", "do", "go", "he", "hi", "if",
  "in", "is", "it", "me", "my", "no", "of", "oh", "ok", "on", "or", "so",
  "to", "up", "us", "we"
]);
const MEANING_OVERRIDES = new Map(Object.entries({
  am: "です",
  file: "ファイル",
  milk: "ミルク",
  book: "本",
  table: "テーブル",
  right: "右",
  left: "左",
  light: "光",
  play: "遊ぶ",
  game: "ゲーム",
  train: "電車",
  tour: "旅行",
  revolve: "回転する",
  kind: "親切な",
  mean: "意味する",
  well: "よく",
  fine: "元気な",
  watch: "見る",
  key: "鍵",
  note: "メモ",
  date: "日付",
  match: "試合",
  class: "授業",
  subject: "科目",
  point: "点",
  sound: "音",
  voice: "声",
  line: "線",
  page: "ページ",
  address: "住所",
  letter: "手紙",
  present: "プレゼント",
  party: "パーティー",
  chance: "機会",
  cheque: "小切手",
  support: "支える",
  record: "記録",
  project: "計画",
  service: "サービス",
  data: "データ",
  sports: "スポーツ",
  issue: "問題",
  term: "用語",
  rate: "割合",
  stock: "在庫",
  trial: "試験",
  charge: "料金",
  figure: "数字",
  mine: "私のもの",
  will: "意志",
  may: "かもしれない",
  can: "できる"
}));
const DETAIL_OVERRIDES = new Map(Object.entries({
  am: "be動詞の一つ。主語がIのときに使う。",
  file: "書類やデータのまとまり。動詞では保管する。",
  milk: "牛乳やミルク。飲み物・食材として使う。",
  book: "読むための本。予約するという動詞にもなる。",
  table: "食事や作業に使うテーブル。表の意味もある。",
  right: "右。正しい、権利という意味もある。",
  left: "左。leaveの過去形では去ったという意味。",
  light: "光。軽い、明るいという意味もある。",
  play: "遊ぶ、演奏する、競技をする。",
  game: "ゲームや試合。競争や遊びのまとまり。",
  train: "電車。訓練するという動詞にもなる。",
  tour: "旅行や見学。場所を巡ることを表す。",
  revolve: "回転する。中心の周りを回ることを表す。",
  kind: "親切な。種類という名詞にもなる。",
  mean: "意味する。形容詞では意地悪な。",
  watch: "見る。腕時計という名詞にもなる。",
  key: "鍵。重要なものという意味もある。",
  class: "授業やクラス。種類・階級の意味もある。",
  cheque: "小切手。銀行を通じて支払うための書類。",
  charge: "料金を請求する。責任や充電の意味もある。",
  sports: "スポーツ。競技や運動全般を表す。",
  stock: "在庫や株。蓄えるという意味もある。",
  issue: "問題や論点。発行するという動詞にもなる。",
  term: "用語や期間。条件という意味もある。"
}));

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT }
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  return response.text();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\"") {
      if (quoted && text[index + 1] === "\"") {
        cell += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += character;
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((candidate) => candidate.some((value) => String(value).trim()));
}

function isWord(word) {
  if (!/^[a-z]{1,24}$/.test(word) || BAD_WORDS.has(word)) {
    return false;
  }
  return word.length >= 3 || SHORT_WORD_ALLOWLIST.has(word);
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

function normalizeMeaning(word, meaning) {
  return MEANING_OVERRIDES.get(word) || String(meaning || "")
    .replace(/[A-Za-z]+[+＋][^、。;；,，]*/g, "")
    .replace(/[A-Za-z]+(?:名|形|副|動|他|自|前|接|代|冠|間|句|略|俗|複|過|分|助)[^、。;；,，・]*/g, "")
    .replace(/[()（）]/g, "")
    .replace(/[→⇒=]/g, "")
    .replace(/《[^》]*》/g, "")
    .replace(/〈[^〉]*〉/g, "")
    .replace(/[+＋]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[,;:・\s]+/, "")
    .trim()
    .slice(0, 24);
}

function makeDetail(word, meaning) {
  const override = DETAIL_OVERRIDES.get(word);
  if (override) {
    return override.slice(0, 50);
  }
  const normalized = normalizeMeaning(word, meaning);
  const detail = `${normalized}を表す基本語。文脈で意味が広がる。`;
  return detail.slice(0, 50);
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function toCsv(rows) {
  const lines = [["english", "japanese", "detail"], ...rows.map((entry) => [entry.english, entry.japanese, entry.detail])];
  return `\uFEFF${lines.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function hashWord(word) {
  return createHash("sha256").update(word).digest("hex");
}

function sourcePriority(source) {
  if (source === "cefr-j" || source === "octanove") {
    return 0;
  }
  return 1;
}

function addCandidate(candidates, word, level, source, frequency = 0) {
  const normalized = String(word || "").toLowerCase().trim();
  if (!isWord(normalized) || !LEVEL_RANK[level]) {
    return;
  }
  const previous = candidates.get(normalized);
  const candidate = {
    word: normalized,
    level,
    source,
    frequency: Number(frequency) || previous?.frequency || 0
  };
  if (
    !previous
    || sourcePriority(candidate.source) < sourcePriority(previous.source)
    || (
      sourcePriority(candidate.source) === sourcePriority(previous.source)
      && LEVEL_RANK[candidate.level] < LEVEL_RANK[previous.level]
    )
    || (
      sourcePriority(candidate.source) === sourcePriority(previous.source)
      && candidate.level === previous.level
      && candidate.frequency > previous.frequency
    )
  ) {
    candidates.set(normalized, candidate);
  }
}

function loadVocabularyProfile(candidates, text, source, excludedWords = new Set(), frequencyByWord = new Map()) {
  const rows = parseCsv(text.replace(/^\uFEFF/, "")).slice(1);
  for (const row of rows) {
    const word = String(row[0] || "").toLowerCase().trim();
    if (excludedWords.has(word)) {
      continue;
    }
    addCandidate(candidates, row[0], row[2], source, frequencyByWord.get(word) || 0);
  }
}

function loadSupplementalMetadata(wordsText, wordPosText, posTagsText) {
  const words = new Map();
  const rows = parseCsv(wordsText.replace(/^\uFEFF/, "")).slice(1);
  for (const row of rows) {
    words.set(row[0], String(row[1] || "").toLowerCase().trim());
  }

  const tagById = new Map();
  for (const row of parseCsv(posTagsText.replace(/^\uFEFF/, "")).slice(1)) {
    tagById.set(row[0], row[1]);
  }

  const wordTags = new Map();
  const wordPosRows = parseCsv(wordPosText.replace(/^\uFEFF/, "")).slice(1);
  for (const row of wordPosRows) {
    const word = words.get(row[3] || row[1]) || words.get(row[1]);
    const tag = tagById.get(row[2]) || row[2];
    if (!word || !isWord(word)) {
      continue;
    }
    if (!wordTags.has(word)) {
      wordTags.set(word, new Set());
    }
    wordTags.get(word).add(tag);
  }

  const properOnlyWords = new Set([...wordTags.entries()]
    .filter(([, tags]) => [...tags].every((tag) => PROPER_NOUN_TAGS.has(tag)))
    .map(([word]) => word));
  const frequencyByWord = new Map();
  for (const row of wordPosRows) {
    const posTag = tagById.get(row[2]) || row[2];
    if (PROPER_NOUN_TAGS.has(posTag)) {
      continue;
    }
    const word = words.get(row[3] || row[1]) || words.get(row[1]);
    const frequency = Number(row[4]) || 0;
    if (!word || !isWord(word) || properOnlyWords.has(word)) {
      continue;
    }
    frequencyByWord.set(word, (frequencyByWord.get(word) || 0) + frequency);
  }
  return { properOnlyWords, frequencyByWord };
}

async function loadDictionary() {
  const dictionary = new Map();
  const exactLowercase = new Set();
  for (const letter of LETTERS) {
    const text = await fetchText(`${SOURCES.ejdictRoot}/${letter}.txt`);
    for (const line of text.split("\n")) {
      const tab = line.indexOf("\t");
      if (tab < 1) {
        continue;
      }
      const rawWord = line.slice(0, tab).trim();
      const word = rawWord.toLowerCase();
      const isExactLowercase = rawWord === word;
      if (!isWord(word)) {
        continue;
      }
      if (dictionary.has(word) && (!isExactLowercase || exactLowercase.has(word))) {
        continue;
      }
      const japanese = cleanMeaning(line.slice(tab + 1));
      if (japanese) {
        const normalized = normalizeMeaning(word, japanese);
        dictionary.set(word, {
          japanese: normalized,
          detail: makeDetail(word, normalized)
        });
        if (isExactLowercase) {
          exactLowercase.add(word);
        }
      }
    }
  }
  return dictionary;
}

function pickEntries(candidates, dictionary) {
  const picked = new Map();
  const used = new Set();
  const available = new Map();

  for (const level of LEVELS) {
    available.set(level, [...candidates.values()]
      .filter((candidate) => candidate.level === level && dictionary.has(candidate.word) && !used.has(candidate.word))
      .sort((a, b) => {
        return b.frequency - a.frequency
          || a.word.length - b.word.length
          || a.word.localeCompare(b.word);
      }));
  }

  for (const level of LEVELS) {
    const needed = LEVEL_QUOTAS[level];
    const sourceStart = LEVELS.indexOf(level);
    const borrowed = [];
    for (let sourceIndex = sourceStart; sourceIndex < LEVELS.length && borrowed.length < needed; sourceIndex += 1) {
      const sourceLevel = LEVELS[sourceIndex];
      const pool = available.get(sourceLevel);
      while (pool.length && borrowed.length < needed) {
        const candidate = pool.shift();
        if (used.has(candidate.word)) {
          continue;
        }
        used.add(candidate.word);
        borrowed.push(candidate);
      }
    }
    if (borrowed.length < needed) {
      throw new Error(`${level} has only ${borrowed.length} usable words for ${needed} requested words.`);
    }
    const entries = borrowed.map((candidate) => ({
      english: candidate.word,
      japanese: dictionary.get(candidate.word).japanese,
      detail: dictionary.get(candidate.word).detail,
      level,
      sourceLevel: candidate.level,
      source: candidate.source,
      sourceHash: hashWord(`${candidate.source}:${candidate.word}`)
    }));
    picked.set(level, entries);
  }

  return picked;
}

function levelConfigLine({ order, id, label, file, bonus }) {
  return `  { order: ${order}, id: "${id}", label: "${label}", csvFile: "${file}", baseSpeed: 50, accel: 0.8, bonus: ${bonus} }`;
}

async function clearOldCsvFiles() {
  await mkdir(DATA_DIR, { recursive: true });
  const entries = await readdir(DATA_DIR, { withFileTypes: true });
  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csv"))
    .map((entry) => unlink(path.join(DATA_DIR, entry.name))));
}

async function writeOutput(picked) {
  await clearOldCsvFiles();
  const manifest = [];
  const configLines = [];
  let order = 10;
  let bonus = 0;

  for (const level of LEVELS) {
    const entries = picked.get(level);
    const parts = Math.ceil(entries.length / PART_SIZE);
    for (let part = 1; part <= parts; part += 1) {
      const slice = entries.slice((part - 1) * PART_SIZE, part * PART_SIZE);
      const id = `${level.toLowerCase()}-part${part}`;
      const label = `${level} Part${part}`;
      const file = `data/${id}.csv`;
      await writeFile(path.join(ROOT, file), toCsv(slice), "utf8");
      manifest.push({
        id,
        label,
        file,
        cefr: level,
        part,
        words: slice.length,
        first: slice[0]?.english || "",
        last: slice.at(-1)?.english || "",
        sources: [...new Set(slice.map((entry) => entry.source))],
        sourceCefrLevels: [...new Set(slice.map((entry) => entry.sourceLevel))]
      });
      configLines.push(levelConfigLine({ order, id, label, file, bonus }));
      order += 10;
      bonus += 2;
    }
  }

  await writeFile(
    path.join(DATA_DIR, "manifest.json"),
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      totalWords: [...picked.values()].reduce((sum, entries) => sum + entries.length, 0),
      sources: {
        primary: ["CEFR-J Vocabulary Profile 1.5", "Octanove Vocabulary Profile C1/C2 1.0"],
        frequencyAndProperNounFilter: "Words-CEFR-Dataset",
        translations: "EJDict"
      },
      levels: manifest
    }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    LEVEL_CONFIG_PATH,
    `export const LEVEL_CONFIG = [\n${configLines.join(",\n")}\n];\n`,
    "utf8"
  );
  return manifest;
}

async function main() {
  const [cefrJ, octanove, words, wordPos, posTags] = await Promise.all([
    fetchText(SOURCES.cefrJ),
    fetchText(SOURCES.octanove),
    fetchText(SOURCES.wordsCefrWords),
    fetchText(SOURCES.wordsCefrPos),
    fetchText(SOURCES.wordsCefrPosTags)
  ]);
  const candidates = new Map();
  const { properOnlyWords, frequencyByWord } = loadSupplementalMetadata(words, wordPos, posTags);
  loadVocabularyProfile(candidates, cefrJ, "cefr-j", properOnlyWords, frequencyByWord);
  loadVocabularyProfile(candidates, octanove, "octanove", properOnlyWords, frequencyByWord);
  const dictionary = await loadDictionary();
  const picked = pickEntries(candidates, dictionary);
  const manifest = await writeOutput(picked);

  for (const level of LEVELS) {
    const total = manifest.filter((item) => item.cefr === level).reduce((sum, item) => sum + item.words, 0);
    console.log(`${level}: ${total} words`);
  }
  console.log(`Generated ${manifest.length} CSV files with ${manifest.reduce((sum, item) => sum + item.words, 0)} words.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
