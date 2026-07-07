import { AudioEngine } from "./audio.js";
import { BGM_TRACKS } from "./audio-tracks.js";
import {
  APP_TITLE,
  DEFAULT_GAME_SETTINGS,
  DEFAULT_PREFERENCES,
  HELP_SEEN_STORAGE_KEY,
  PLAY_COUNTS_STORAGE_KEY,
  PREFERENCES_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  THEME_STORAGE_KEY,
  WORD_STATS_STORAGE_KEY
} from "./config.js";
import { LEVELS, LEVEL_MAP } from "./levels.js";
import { loadWords } from "./words.js";

const RUN_TIME = 60;
const MAX_LANES = 3;
const STORAGE_PREFIX = "vocab-sprint-best-";
const OLD_THEME_STORAGE_KEY = "vocab-sprint-theme";
const CARD_START_Y = 14;
const FALL_REFERENCE_DISTANCE = 394;
const FALL_SPEED_MULTIPLIER = 0.5;
const STREAK_SPEED_BONUS = 0.95;
const CARD_FADE_IN_TIME = 0.18;
const CARD_FADE_OUT_TIME = 0.24;
const ANSWER_REVEAL_TIME = 1.12;
const REVIEW_TOOLTIP_LONG_PRESS_MS = 520;
const REVIEW_TOOLTIP_TOUCH_MOVE_CANCEL = 10;
const WORD_AUDIO_START_DELAY_MS = 260;
const WORD_AUDIO_START_GAP_MS = 620;
const WORD_AUDIO_START_MAX_ITEM_MS = 2600;
const WORD_AUDIO_SPAWN_DELAY_MS = 90;
const WORD_AUDIO_PREFETCH_COUNT = 6;
const WORD_AUDIO_PREFETCH_INTERVAL_MS = 2400;
const WORD_STATS_SAVE_DEBOUNCE_MS = 1800;
// キャンバスのバックバッファ解像度上限。iPhone(dpr=3)などでは全面塗り＋レーン背景の
// 多層オーバードローがフィルレートを圧迫して発熱するため、2.0ではなく1.5で頭打ちにする。
const CANVAS_MAX_DPR = 1.5;
// レーン背景のうねり帯の分割数。多いほど滑らかだが1フレームの頂点数が増える（発熱要因）。
const LANE_FLOW_STEPS = 12;
// レーン背景のリボン定義。色はテーマ、seedはレーンで変わるので、
// 形状パラメータだけを定数化して毎フレームのオブジェクト生成を避ける。
const LANE_FLOW_RIBBONS = [
  { colorKey: "coolMid", thickness: 0.36, speed: 24, freq: 1.6, sway: 0.55, seedBase: 0, seedStep: 173.3 },
  { colorKey: "warmMid", thickness: 0.28, speed: 17, freq: 2.2, sway: 0.42, seedBase: 91.7, seedStep: 211.9 },
  { colorKey: "greenSoft", thickness: 0.22, speed: 31, freq: 1.25, sway: 0.5, seedBase: 47.1, seedStep: 97.3 }
];
const DEFAULT_GAME_MODE_ID = "rush";
const FADE_MODE_VISIBLE_RATIO = 0.3;
const GAME_MODES = [
  {
    id: "rush",
    label: "ラッシュ",
    cardMotion: "fall",
    usesRunTimer: true,
    usesCardTimeout: false
  },
  {
    id: "fade",
    label: "集中",
    cardMotion: "fade",
    usesRunTimer: true,
    usesCardTimeout: true
  },
  {
    id: "fixed",
    label: "じっくり",
    cardMotion: "fixed",
    usesRunTimer: true,
    usesCardTimeout: false
  }
];
const GAME_MODE_MAP = new Map(GAME_MODES.map((mode) => [mode.id, mode]));
const DEFAULT_QUIZ_DIRECTION = "meaning";
const QUIZ_DIRECTIONS = [
  { id: "meaning", label: "英→日", promptField: "english", answerField: "japanese" },
  { id: "recall", label: "日→英", promptField: "japanese", answerField: "english" }
];
const QUIZ_DIRECTION_MAP = new Map(QUIZ_DIRECTIONS.map((direction) => [direction.id, direction]));
const LANE_KEY_LAYOUTS = {
  1: [["a", "s", "d"]],
  2: [
    ["a", "s", "d"],
    ["j", "k", "l"]
  ],
  3: [
    ["a", "s", "d"],
    ["f", "g", "h"],
    ["j", "k", "l"]
  ]
};

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function parseCanvasColor(color) {
  const value = String(color || "").trim();
  if (!value) {
    return null;
  }
  if (value === "transparent") {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    const raw = hex[1];
    const parts = raw.length <= 4
      ? Array.from(raw).map((part) => part + part)
      : raw.match(/.{2}/g);
    return {
      r: parseInt(parts[0], 16),
      g: parseInt(parts[1], 16),
      b: parseInt(parts[2], 16),
      a: parts[3] ? parseInt(parts[3], 16) / 255 : 1
    };
  }
  const rgb = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (!rgb) {
    return null;
  }
  return {
    r: Number(rgb[1]),
    g: Number(rgb[2]),
    b: Number(rgb[3]),
    a: rgb[4] === undefined ? 1 : Number(rgb[4])
  };
}

// 色文字列のパース結果をメモ化する（毎フレームのregexパースとGC発生を避ける）。
// キーはテーマ色＋固定リテラルのみで高々十数種だが、念のため上限で全クリアする。
const COLOR_PARSE_CACHE = new Map();

function parseCanvasColorCached(color) {
  let parsed = COLOR_PARSE_CACHE.get(color);
  if (parsed === undefined) {
    if (COLOR_PARSE_CACHE.size > 256) {
      COLOR_PARSE_CACHE.clear();
    }
    parsed = parseCanvasColor(color);
    COLOR_PARSE_CACHE.set(color, parsed);
  }
  return parsed;
}

// 色×alpha の rgba 文字列生成もメモ化する。カードのフェード中は同じ色×alphaが
// 複数カード・複数フレームで繰り返し要求されるため、生成文字列の使い回しでGCを抑える。
// alpha は連続値なので 1/64 刻みに量子化してキー数を抑える。
const COLOR_ALPHA_CACHE = new Map();
const COLOR_ALPHA_STEPS = 64;

function colorWithAlpha(color, alpha) {
  if (alpha >= 1) {
    return color;
  }
  const quantized = Math.round(clamp01(alpha) * COLOR_ALPHA_STEPS);
  const key = `${color}@${quantized}`;
  let result = COLOR_ALPHA_CACHE.get(key);
  if (result === undefined) {
    const parsed = parseCanvasColorCached(color);
    if (!parsed) {
      result = color;
    } else {
      const nextAlpha = clamp01(parsed.a * (quantized / COLOR_ALPHA_STEPS));
      result = `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${nextAlpha})`;
    }
    if (COLOR_ALPHA_CACHE.size > 1024) {
      COLOR_ALPHA_CACHE.clear();
    }
    COLOR_ALPHA_CACHE.set(key, result);
  }
  return result;
}

export class VocabSprintGame {
  constructor() {
    this.canvas = document.getElementById("gameCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.ui = {
      phase: document.getElementById("phaseLabel"),
      brandTitle: document.getElementById("brandTitleText"),
      level: document.getElementById("levelSelect"),
      levelButton: document.getElementById("levelButton"),
      levelButtonLabel: document.getElementById("levelButtonLabel"),
      levelButtonMeta: document.getElementById("levelButtonMeta"),
      levelPicker: document.getElementById("levelPicker"),
      levelMenu: document.getElementById("levelMenu"),
      laneCount: document.getElementById("laneCountSelect"),
      quizDirectionOptions: document.getElementById("quizDirectionOptions"),
      quizDirectionInputs: Array.from(document.querySelectorAll('input[name="quizDirection"]')),
      gameModeOptions: document.getElementById("gameModeOptions"),
      gameModeInputs: Array.from(document.querySelectorAll('input[name="gameMode"]')),
      survival: document.getElementById("survivalInput"),
      levelLabel: document.getElementById("levelLabel"),
      soundButton: document.getElementById("soundButton"),
      soundOnIcon: document.querySelector(".sound-on-icon"),
      soundOffIcon: document.querySelector(".sound-off-icon"),
      soundPanel: document.getElementById("soundPanel"),
      soundPanelClose: document.getElementById("soundPanelClose"),
      wordAudioEnabled: document.getElementById("wordAudioEnabledInput"),
      wordAudioVolume: document.getElementById("wordAudioVolumeInput"),
      wordAudioVolumeValue: document.getElementById("wordAudioVolumeValue"),
      bgmEnabled: document.getElementById("bgmEnabledInput"),
      bgmVolume: document.getElementById("bgmVolumeInput"),
      bgmVolumeValue: document.getElementById("bgmVolumeValue"),
      bgmTrack: document.getElementById("bgmTrackSelect"),
      bgmPreview: document.getElementById("bgmPreviewButton"),
      bgmPreviewPlayIcon: document.querySelector(".preview-play-icon"),
      bgmPreviewStopIcon: document.querySelector(".preview-stop-icon"),
      sfxEnabled: document.getElementById("sfxEnabledInput"),
      sfxVolume: document.getElementById("sfxVolumeInput"),
      sfxVolumeValue: document.getElementById("sfxVolumeValue"),
      themeButton: document.getElementById("themeButton"),
      themeLightIcon: document.querySelector(".theme-light-icon"),
      themeDarkIcon: document.querySelector(".theme-dark-icon"),
      pauseButton: document.getElementById("pauseButton"),
      pauseIcon: document.querySelector(".pause-icon"),
      playIcon: document.querySelector(".play-icon"),
      backButton: document.getElementById("backButton"),
      gameShell: document.querySelector(".game-shell"),
      answers: document.getElementById("answers"),
      loadingVeil: document.getElementById("loadingVeil"),
      networkToast: document.getElementById("networkToast"),
      countdownGhost: document.getElementById("countdownGhost"),
      overlay: document.getElementById("overlay"),
      overlayTitle: document.getElementById("overlayTitle"),
      overlayCopy: document.getElementById("overlayCopy"),
      overlayScroll: document.querySelector(".overlay-scroll"),
      titleDetails: document.getElementById("titleDetails"),
      titlePlayCount: document.getElementById("titlePlayCountValue"),
      titleBest: document.getElementById("titleBestValue"),
      titleLearned: document.getElementById("titleLearnedValue"),
      titleUncorrected: document.getElementById("titleUncorrectedValue"),
      titleCumulative: document.getElementById("titleCumulativeValue"),
      titleWrongBestList: document.getElementById("titleWrongBestList"),
      wordListButton: document.getElementById("wordListButton"),
      resetLevelStats: document.getElementById("resetLevelStatsButton"),
      resetConfirmModal: document.getElementById("resetConfirmModal"),
      resetConfirmBackdrop: document.getElementById("resetConfirmBackdrop"),
      resetConfirmCopy: document.getElementById("resetConfirmCopy"),
      resetCancel: document.getElementById("resetCancelButton"),
      resetConfirm: document.getElementById("resetConfirmButton"),
      returnConfirmModal: document.getElementById("returnConfirmModal"),
      returnConfirmBackdrop: document.getElementById("returnConfirmBackdrop"),
      returnContinue: document.getElementById("returnContinueButton"),
      returnConfirm: document.getElementById("returnConfirmButton"),
      wordListModal: document.getElementById("wordListModal"),
      wordListBackdrop: document.getElementById("wordListBackdrop"),
      wordListClose: document.getElementById("wordListCloseButton"),
      wordListTitle: document.getElementById("wordListTitle"),
      wordListTable: document.getElementById("wordListTable"),
      helpModal: document.getElementById("helpModal"),
      helpBackdrop: document.getElementById("helpBackdrop"),
      helpClose: document.getElementById("helpCloseButton"),
      titleLearnedBar: document.getElementById("titleLearnedBar"),
      titleLearnedRate: document.getElementById("titleLearnedRate"),
      titleAccuracyBar: document.getElementById("titleAccuracyBar"),
      titleAccuracyRate: document.getElementById("titleAccuracyRate"),
      reviewList: document.getElementById("reviewList"),
      startButton: document.getElementById("startButton"),
      overlayBackButton: document.getElementById("overlayBackButton"),
      resultCloseButton: document.getElementById("resultCloseButton"),
      titleHelpButton: document.getElementById("titleHelpButton"),
      time: document.getElementById("timeValue"),
      elapsed: document.getElementById("elapsedValue"),
      timeBar: document.getElementById("timeBar"),
      score: document.getElementById("scoreValue"),
      best: document.getElementById("bestValue"),
      streak: document.getElementById("streakValue"),
      correct: document.getElementById("correctValue"),
      wrong: document.getElementById("wrongValue"),
      miss: document.getElementById("missValue"),
      accuracy: document.getElementById("accuracyValue"),
      wordCount: document.getElementById("wordCountValue"),
      learnedCount: document.getElementById("learnedCountValue"),
      unlearnedCount: document.getElementById("unlearnedCountValue"),
      feed: document.getElementById("feed"),
      lookupModal: document.getElementById("lookupModal"),
      lookupBackdrop: document.getElementById("lookupBackdrop"),
      lookupService: document.getElementById("lookupService"),
      lookupTitle: document.getElementById("lookupTitle"),
      lookupOpenLink: document.getElementById("lookupOpenLink"),
      lookupClose: document.getElementById("lookupCloseButton"),
      lookupFrame: document.getElementById("lookupFrame"),
      lookupNote: document.getElementById("lookupNote"),
      youglishHost: document.getElementById("youglishWidgetHost")
    };

    const preferences = this.readPreferences();
    const configuredLevelId = LEVEL_MAP.has(DEFAULT_PREFERENCES.levelId) ? DEFAULT_PREFERENCES.levelId : this.ui.level.value;
    const initialLevelId = LEVEL_MAP.has(preferences.levelId) ? preferences.levelId : configuredLevelId;
    const initialLaneCount = this.clampLaneCount(preferences.laneCount);
    const initialGameModeId = this.normalizeGameModeId(preferences.gameModeId);
    const initialQuizDirection = this.normalizeQuizDirection(preferences.quizDirection);
    this.ui.level.value = initialLevelId;
    this.ui.laneCount.value = String(initialLaneCount);
    this.syncGameModeInputs(initialGameModeId);
    this.syncQuizDirectionInputs(initialQuizDirection);
    if (this.ui.survival) {
      this.ui.survival.checked = Boolean(preferences.survivalEnabled);
    }

    this.state = {
      phase: "loading",
      levelId: initialLevelId,
      laneCount: initialLaneCount,
      gameModeId: initialGameModeId,
      quizDirection: initialQuizDirection,
      survivalEnabled: Boolean(preferences.survivalEnabled),
      words: [],
      lanes: [],
      score: 0,
      best: 0,
      streak: 0,
      correct: 0,
      wrong: 0,
      miss: 0,
      timeLeft: RUN_TIME,
      elapsed: 0,
      lastTime: 0,
      countdownSecond: 0,
      feedback: [],
      review: new Map(),
      recent: [],
      effects: [],
      wordBag: [],
      settings: this.readSettings(),
      playCounts: this.readPlayCounts(),
      wordStats: this.readWordStats(),
      theme: this.readTheme(),
      levelMenuOpen: false,
      soundPanelOpen: false,
      lookupOpen: false,
      resetConfirmOpen: false,
      returnConfirmOpen: false,
      returnConfirmPreviousPhase: "",
      wordListOpen: false,
      helpOpen: false,
      rngSeed: 1,
      loadError: ""
    };

    this.loadToken = 0;
    this.resizeObserver = null;
    this.answerMeasureCanvas = null;
    this.answerMeasureContext = null;
    this.youglishWidget = null;
    this.youglishWidgetReady = null;
    this.youglishWidgetVersion = 0;
    // 描画ループはプレイ中だけ回す（メニュー/一時停止/結果画面では止めて発熱を抑える）。
    this.rafId = 0;
    this.isLooping = false;
    // テーマの色はフレームごとに getComputedStyle し直すと高コストなので一度だけ読んでキャッシュする。
    this.colors = {};
    // レーン背景の縦グラデ（veil）はサイズ・テーマが変わらない限り使い回す（毎フレーム生成を避ける）。
    this.veilGradient = null;
    this.veilGradientKey = "";
    // 学習統計は毎フレーム全単語を走査すると重いので、変化時だけ再計算してキャッシュする。
    this.statsCache = null;
    this.reviewTooltipPressTimer = 0;
    this.reviewTooltipPointer = null;
    this.reviewTooltip = this.createReviewTooltip();
    this.numberFormatter = new Intl.NumberFormat("en-US");
    this.wordStatsSaveTimer = 0;
    this.wordStatsDirty = false;
    this.slowWordAudioUrls = new Set();
    this.lastWordAudioPrefetchAt = 0;
    // カード再出現の setTimeout を管理する。放置すると一時停止/リスタートを跨いで発火し、
    // レーン喪失や新ゲームのカード差し替えを起こすため、状態遷移時に必ずクリアする。
    this.spawnTimers = new Set();
    // 回答ボタンのDOM参照（レーン別）。1レーンだけ変わるとき（出題差し替え/回答フラッシュ）は
    // 全再構築せず該当レーンだけ差分更新するために保持する。renderAnswerButtons が毎回作り直す。
    this.laneButtonRefs = [];
    this.audio = new AudioEngine(() => this.state.settings, BGM_TRACKS);
    this.audio.setWordAudioStatusHandler((status) => this.handleWordAudioStatus(status));
  }

  async init() {
    this.applyTheme(this.state.theme);
    this.state.laneCount = this.clampLaneCount(this.ui.laneCount.value);
    this.state.lastTime = performance.now();
    this.resizeCanvas();
    this.populateBgmTracks();
    this.saveSettings();
    this.syncSettingsInputs();
    this.renderLevelPicker();
    this.renderFeed();
    this.renderAnswerButtons();
    this.updateUi();
    this.drawBoard();
    this.observeCanvasSize();
    this.attachEvents();
    // ループはプレイ中のみ回す。ここでは1フレームだけ描いておく。
    // 単語音声のrevision取得はキャッシュバスト用クエリにしか使わないため、
    // 初回レベル表示をブロックしないよう待たずにバックグラウンドで開始する（低速回線の起動遅延を防ぐ）。
    this.audio.ensureWordAudioRevision();
    await this.loadLevel(this.state.levelId);
    this.maybeOpenInitialHelp();
  }

  activeLevel() {
    return LEVEL_MAP.get(this.state.levelId) || LEVEL_MAP.values().next().value;
  }

  brandTitleText(level = this.activeLevel()) {
    return `${APP_TITLE} - ${level.label}`;
  }

  clampLaneCount(value) {
    return Math.max(1, Math.min(MAX_LANES, Number(value) || DEFAULT_PREFERENCES.laneCount));
  }

  activeLaneCount() {
    return this.clampLaneCount(this.state.laneCount);
  }

  normalizeGameModeId(value) {
    return GAME_MODE_MAP.has(value) ? value : DEFAULT_PREFERENCES.gameModeId || DEFAULT_GAME_MODE_ID;
  }

  activeGameMode() {
    return GAME_MODE_MAP.get(this.normalizeGameModeId(this.state.gameModeId)) || GAME_MODE_MAP.get(DEFAULT_GAME_MODE_ID);
  }

  syncGameModeInputs(modeId = this.state?.gameModeId || DEFAULT_GAME_MODE_ID) {
    const normalized = this.normalizeGameModeId(modeId);
    for (const input of this.ui.gameModeInputs || []) {
      input.checked = input.value === normalized;
    }
  }

  selectedGameModeId() {
    const selected = this.ui.gameModeInputs?.find((input) => input.checked);
    return this.normalizeGameModeId(selected?.value || this.state.gameModeId);
  }

  normalizeQuizDirection(value) {
    return QUIZ_DIRECTION_MAP.has(value) ? value : DEFAULT_PREFERENCES.quizDirection || DEFAULT_QUIZ_DIRECTION;
  }

  activeQuizDirection() {
    return QUIZ_DIRECTION_MAP.get(this.normalizeQuizDirection(this.state.quizDirection))
      || QUIZ_DIRECTION_MAP.get(DEFAULT_QUIZ_DIRECTION);
  }

  syncQuizDirectionInputs(directionId = this.state?.quizDirection || DEFAULT_QUIZ_DIRECTION) {
    const normalized = this.normalizeQuizDirection(directionId);
    for (const input of this.ui.quizDirectionInputs || []) {
      input.checked = input.value === normalized;
    }
  }

  selectedQuizDirection() {
    const selected = this.ui.quizDirectionInputs?.find((input) => input.checked);
    return this.normalizeQuizDirection(selected?.value || this.state.quizDirection);
  }

  selectedSurvivalEnabled() {
    return Boolean(this.ui.survival?.checked);
  }

  promptTextFor(word) {
    const direction = this.activeQuizDirection();
    return String(word?.[direction.promptField] || "").trim();
  }

  answerTextFor(word) {
    const direction = this.activeQuizDirection();
    return String(word?.[direction.answerField] || "").trim();
  }

  shouldAutoPlayWordAudio() {
    return this.normalizeQuizDirection(this.state.quizDirection) === DEFAULT_QUIZ_DIRECTION;
  }

  clampNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.max(min, Math.min(max, number));
  }

  clampDecimalSetting(value, fallback, min, max) {
    return Math.round(this.clampNumber(value, fallback, min, max) * 1000) / 1000;
  }

  normalizeSettings(settings = {}) {
    return {
      ...DEFAULT_GAME_SETTINGS,
      correctTimeBonus: this.clampDecimalSetting(DEFAULT_GAME_SETTINGS.correctTimeBonus, 0.1, 0, 20),
      streakTimeMultiplier: this.clampDecimalSetting(DEFAULT_GAME_SETTINGS.streakTimeMultiplier, 0.01, 0, 5),
      wrongTimePenalty: this.clampDecimalSetting(DEFAULT_GAME_SETTINGS.wrongTimePenalty, 0.7, 0, 20),
      bgmEnabled: settings.bgmEnabled !== false,
      sfxEnabled: settings.sfxEnabled !== false,
      wordAudioEnabled: settings.wordAudioEnabled !== false,
      bgmVolume: this.clampNumber(settings.bgmVolume, DEFAULT_GAME_SETTINGS.bgmVolume, 0, 1),
      sfxVolume: this.clampNumber(settings.sfxVolume, DEFAULT_GAME_SETTINGS.sfxVolume, 0, 1),
      wordAudioVolume: this.clampNumber(settings.wordAudioVolume, DEFAULT_GAME_SETTINGS.wordAudioVolume, 0, 1),
      bgmTrack: settings.bgmTrack || DEFAULT_GAME_SETTINGS.bgmTrack
    };
  }

  readSettings() {
    try {
      return this.normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}"));
    } catch {
      return this.normalizeSettings();
    }
  }

  saveSettings() {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
        bgmEnabled: this.state.settings.bgmEnabled,
        sfxEnabled: this.state.settings.sfxEnabled,
        wordAudioEnabled: this.state.settings.wordAudioEnabled,
        bgmVolume: this.state.settings.bgmVolume,
        sfxVolume: this.state.settings.sfxVolume,
        wordAudioVolume: this.state.settings.wordAudioVolume,
        bgmTrack: this.state.settings.bgmTrack
      }));
    } catch {
      // Ignore storage failures in private or locked-down contexts.
    }
  }

  readPreferences() {
    try {
      const stored = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) || "{}");
      return {
        ...DEFAULT_PREFERENCES,
        ...(stored && typeof stored === "object" ? stored : {})
      };
    } catch {
      return { ...DEFAULT_PREFERENCES };
    }
  }

  savePreferences() {
    try {
      localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
        levelId: this.state.levelId,
        laneCount: this.activeLaneCount(),
        gameModeId: this.normalizeGameModeId(this.state.gameModeId),
        quizDirection: this.normalizeQuizDirection(this.state.quizDirection),
        survivalEnabled: Boolean(this.state.survivalEnabled)
      }));
    } catch {
      // Ignore storage failures in private or locked-down contexts.
    }
  }

  readPlayCounts() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PLAY_COUNTS_STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  savePlayCounts() {
    try {
      localStorage.setItem(PLAY_COUNTS_STORAGE_KEY, JSON.stringify(this.state.playCounts));
    } catch {
      // Ignore storage failures in private or locked-down contexts.
    }
  }

  readWordStats() {
    try {
      const parsed = JSON.parse(localStorage.getItem(WORD_STATS_STORAGE_KEY) || "{}");
      if (!parsed || typeof parsed !== "object") {
        return {};
      }
      const stats = {};
      for (const [id, value] of Object.entries(parsed)) {
        if (!id || !value || typeof value !== "object") {
          continue;
        }
        const correct = Math.max(0, Number(value.correct) || 0);
        const incorrect = Math.max(0, Number(value.incorrect) || 0);
        const seen = Math.max(correct + incorrect, Number(value.seen) || 0);
        const lastSeen = Math.max(0, Number(value.lastSeen) || 0);
        stats[id] = { correct, incorrect, seen, lastSeen };
      }
      return stats;
    } catch {
      return {};
    }
  }

  saveWordStats() {
    if (this.wordStatsSaveTimer) {
      clearTimeout(this.wordStatsSaveTimer);
      this.wordStatsSaveTimer = 0;
    }
    this.wordStatsDirty = false;
    try {
      localStorage.setItem(WORD_STATS_STORAGE_KEY, JSON.stringify(this.state.wordStats));
    } catch {
      // Ignore storage failures in private or locked-down contexts.
    }
  }

  scheduleWordStatsSave() {
    this.wordStatsDirty = true;
    if (this.wordStatsSaveTimer) {
      return;
    }
    this.wordStatsSaveTimer = setTimeout(() => {
      this.wordStatsSaveTimer = 0;
      if (this.wordStatsDirty) {
        this.saveWordStats();
      }
    }, WORD_STATS_SAVE_DEBOUNCE_MS);
  }

  flushWordStats() {
    if (!this.wordStatsDirty && !this.wordStatsSaveTimer) {
      return;
    }
    this.saveWordStats();
  }

  wordStatKey(word) {
    if (!word) {
      return "";
    }
    return word?.id || `${this.state.levelId}:${word?.english || ""}`;
  }

  wordStatFor(word) {
    return this.state.wordStats[this.wordStatKey(word)] || {
      correct: 0,
      incorrect: 0,
      seen: 0,
      lastSeen: 0
    };
  }

  // 学習統計のキャッシュを無効化する（単語データや単語別記録が変わったとき）。
  invalidateStatsCache() {
    this.statsCache = null;
  }

  // 全単語を1回だけ走査して learningCounts と levelSummaryStats の両方を計算・キャッシュする。
  computeStats() {
    if (this.statsCache) {
      return this.statsCache;
    }
    let learned = 0;
    let correct = 0;
    let incorrect = 0;
    let uncorrected = 0;
    let presented = 0;
    for (const word of this.state.words) {
      const stats = this.wordStatFor(word);
      if (stats.seen > 0) {
        learned += 1;
      }
      if (stats.correct <= 0) {
        uncorrected += 1;
      }
      correct += stats.correct;
      incorrect += stats.incorrect;
      presented += stats.seen;
    }
    const totalWords = this.state.words.length;
    const answered = correct + incorrect;
    this.statsCache = {
      totalWords,
      learned,
      unlearned: Math.max(0, totalWords - learned),
      uncorrected,
      correct,
      incorrect,
      answered,
      presented,
      learnedRate: totalWords ? Math.round((learned / totalWords) * 100) : 0,
      accuracyRate: answered ? Math.round((correct / answered) * 100) : 0
    };
    return this.statsCache;
  }

  learningCounts() {
    const stats = this.computeStats();
    return { learned: stats.learned, unlearned: stats.unlearned };
  }

  levelSummaryStats() {
    return this.computeStats();
  }

  updateWordStats(word, outcome) {
    const key = this.wordStatKey(word);
    if (!key) {
      return;
    }
    const current = this.wordStatFor(word);
    const next = {
      correct: current.correct + (outcome === "correct" ? 1 : 0),
      incorrect: current.incorrect + (outcome === "incorrect" ? 1 : 0),
      seen: current.seen + (outcome === "seen" ? 1 : 0),
      lastSeen: outcome === "seen" ? Date.now() : current.lastSeen
    };
    this.state.wordStats[key] = next;
    this.invalidateStatsCache();
    this.scheduleWordStatsSave();
  }

  createSeed() {
    let seed = (Date.now() ^ Math.floor(performance.now() * 1000) ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    if (globalThis.crypto?.getRandomValues) {
      const values = new Uint32Array(2);
      globalThis.crypto.getRandomValues(values);
      seed = (seed ^ values[0] ^ Math.imul(values[1], 2654435761)) >>> 0;
    }
    return seed || 1;
  }

  nextRandom() {
    this.state.rngSeed = (Math.imul(this.state.rngSeed, 1664525) + 1013904223) >>> 0;
    return this.state.rngSeed / 4294967296;
  }

  randInt(min, max) {
    return Math.floor(this.nextRandom() * (max - min + 1)) + min;
  }

  shuffle(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = this.randInt(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  bestKey() {
    return `${STORAGE_PREFIX}${this.state.levelId}`;
  }

  readBest() {
    try {
      const keys = [this.bestKey(), ...this.bestLegacyKeysForLevel(this.state.levelId)];
      return keys.reduce((best, key) => Math.max(best, Number(localStorage.getItem(key) || "0") || 0), 0);
    } catch {
      return 0;
    }
  }

  saveBest() {
    this.state.best = Math.max(this.state.best, this.state.score);
    try {
      localStorage.setItem(this.bestKey(), String(this.state.best));
    } catch {
      // Local storage can be unavailable in private or locked-down contexts.
    }
  }

  bestKeysForLevel(levelId) {
    return [`${STORAGE_PREFIX}${levelId}`, ...this.bestLegacyKeysForLevel(levelId)];
  }

  bestLegacyKeysForLevel(levelId) {
    const keys = [];
    for (let lanes = 1; lanes <= MAX_LANES; lanes += 1) {
      keys.push(`${STORAGE_PREFIX}${levelId}-lanes-${lanes}`);
      for (const mode of GAME_MODES) {
        keys.push(`${STORAGE_PREFIX}${levelId}-mode-${mode.id}-lanes-${lanes}`);
      }
    }
    return keys;
  }

  resetSelectedLevelStats() {
    this.openResetConfirmModal();
  }

  openResetConfirmModal() {
    if (!this.ui.resetConfirmModal || this.state.phase === "playing" || this.state.phase === "paused" || !this.state.words.length) {
      return;
    }
    const level = this.activeLevel();
    if (this.ui.resetConfirmCopy) {
      this.ui.resetConfirmCopy.textContent = `${level.label} のスコア、プレイ回数、単語ごとの正解・誤答数をリセットします。`;
    }
    this.hideReviewTooltip();
    this.setLevelMenuOpen(false);
    this.setSoundPanelOpen(false);
    this.state.resetConfirmOpen = true;
    this.ui.resetConfirmModal.classList.remove("hidden");
    this.updateUi();
    this.ui.resetCancel?.focus();
  }

  closeResetConfirmModal() {
    if (!this.ui.resetConfirmModal || !this.state.resetConfirmOpen) {
      return;
    }
    this.state.resetConfirmOpen = false;
    this.ui.resetConfirmModal.classList.add("hidden");
    this.updateUi();
    this.ui.resetLevelStats?.focus();
  }

  confirmResetSelectedLevelStats() {
    if (!this.state.resetConfirmOpen) {
      return;
    }
    this.state.resetConfirmOpen = false;
    this.ui.resetConfirmModal?.classList.add("hidden");
    this.performResetSelectedLevelStats();
    this.updateUi();
    this.ui.resetLevelStats?.focus();
  }

  openWordListModal() {
    if (
      !this.ui.wordListModal
      || !this.ui.wordListTable
      || this.state.phase === "playing"
      || this.state.phase === "paused"
      || !this.state.words.length
    ) {
      return;
    }
    this.hideReviewTooltip();
    this.setLevelMenuOpen(false);
    this.setSoundPanelOpen(false);
    this.renderWordListModal();
    this.state.wordListOpen = true;
    this.ui.wordListModal.classList.remove("hidden");
    this.updateUi();
    this.ui.wordListClose?.focus();
  }

  closeWordListModal() {
    if (!this.ui.wordListModal || !this.state.wordListOpen) {
      return;
    }
    this.state.wordListOpen = false;
    this.ui.wordListModal.classList.add("hidden");
    this.hideReviewTooltip();
    this.updateUi();
    this.ui.wordListButton?.focus();
  }

  renderWordListModal() {
    const table = this.ui.wordListTable;
    if (!table) {
      return;
    }
    const level = this.activeLevel();
    if (this.ui.wordListTitle) {
      this.ui.wordListTitle.textContent = `${level.label} - Word List`;
    }

    const fragment = document.createDocumentFragment();
    const header = document.createElement("div");
    header.className = "word-list-row word-list-header-row";
    for (const label of ["単語", "意味", "正答", "誤答"]) {
      const cell = document.createElement("span");
      cell.textContent = label;
      header.appendChild(cell);
    }
    fragment.appendChild(header);

    for (const word of this.state.words) {
      const stats = this.wordStatFor(word);
      const row = document.createElement("div");
      row.className = "word-list-row";

      const wordCell = document.createElement("span");
      wordCell.className = "word-list-word";
      const actions = document.createElement("span");
      actions.className = "word-list-actions";
      const wordText = document.createElement("strong");
      wordText.textContent = word.english;
      actions.append(this.createWordAudioButton(word), this.createWordInfoButton(word));
      wordCell.append(actions, wordText);

      const meaning = document.createElement("span");
      meaning.className = "word-list-meaning";
      meaning.textContent = word.japanese || "";

      const correct = document.createElement("span");
      correct.className = "word-list-count";
      correct.textContent = this.formatNumber(stats.correct);

      const incorrect = document.createElement("span");
      incorrect.className = "word-list-count is-wrong";
      incorrect.textContent = this.formatNumber(stats.incorrect);

      row.append(wordCell, meaning, correct, incorrect);
      fragment.appendChild(row);
    }

    table.replaceChildren(fragment);
  }

  requestReturnToTitle() {
    if (this.state.phase === "playing" || this.state.phase === "paused") {
      this.openReturnConfirmModal();
      return;
    }
    this.returnToTitle();
  }

  openReturnConfirmModal() {
    if (!this.ui.returnConfirmModal || this.state.returnConfirmOpen) {
      return;
    }
    if (this.state.phase !== "playing" && this.state.phase !== "paused") {
      this.returnToTitle();
      return;
    }
    this.hideReviewTooltip();
    this.clearReviewTooltipPress();
    this.clearAnswerFocus();
    this.setLevelMenuOpen(false);
    this.setSoundPanelOpen(false);
    this.state.returnConfirmPreviousPhase = this.state.phase;
    if (this.state.phase === "playing") {
      this.state.phase = "paused";
      this.stopRenderLoop();
      this.clearSpawnTimers();
      this.audio.fadeOutBgm(650);
      this.audio.stopWordAudio();
      this.audio.releaseWordAudioPool();
      this.flushWordStats();
      this.hideNetworkToast({ clear: true });
      this.state.countdownSecond = 0;
      this.state.effects = [];
    }
    this.state.returnConfirmOpen = true;
    this.ui.returnConfirmModal.classList.remove("hidden");
    this.updateUi();
    this.renderAnswerButtons();
    this.ui.returnConfirm?.focus();
  }

  closeReturnConfirmModal() {
    if (!this.ui.returnConfirmModal || !this.state.returnConfirmOpen) {
      return;
    }
    const shouldResume = this.state.returnConfirmPreviousPhase === "playing";
    this.state.returnConfirmOpen = false;
    this.state.returnConfirmPreviousPhase = "";
    this.ui.returnConfirmModal.classList.add("hidden");
    if (shouldResume && this.state.phase === "paused") {
      this.state.phase = "playing";
      this.state.lastTime = performance.now();
      this.lastWordAudioPrefetchAt = 0;
      this.audio.startBgm(() => this.state.phase);
      this.respawnStalledLanes();
      this.prefetchUpcomingWordAudio({ force: true });
      this.startRenderLoop();
    }
    this.updateUi();
    this.renderAnswerButtons();
    this.ui.backButton?.focus();
  }

  confirmReturnToTitle() {
    if (!this.state.returnConfirmOpen) {
      return;
    }
    this.state.returnConfirmOpen = false;
    this.state.returnConfirmPreviousPhase = "";
    this.ui.returnConfirmModal?.classList.add("hidden");
    this.returnToTitle();
  }

  isStandaloneDisplay() {
    return Boolean(
      globalThis.matchMedia?.("(display-mode: standalone)")?.matches
      || globalThis.navigator?.standalone
    );
  }

  hasSeenHelp() {
    try {
      return localStorage.getItem(HELP_SEEN_STORAGE_KEY) === "1";
    } catch {
      return true;
    }
  }

  markHelpSeen() {
    try {
      localStorage.setItem(HELP_SEEN_STORAGE_KEY, "1");
    } catch {
      // Local storage can be unavailable in private or locked-down contexts.
    }
  }

  maybeOpenInitialHelp() {
    if (this.hasSeenHelp()) {
      return;
    }
    this.openHelpModal({ markSeen: true });
  }

  openHelpModal(options = {}) {
    if (!this.ui.helpModal) {
      return;
    }
    if (options.markSeen) {
      this.markHelpSeen();
    }
    this.hideReviewTooltip();
    this.setLevelMenuOpen(false);
    this.setSoundPanelOpen(false);
    this.state.helpOpen = true;
    this.ui.helpModal.classList.remove("hidden");
    this.updateUi();
    this.ui.helpClose?.focus();
  }

  closeHelpModal() {
    if (!this.ui.helpModal || !this.state.helpOpen) {
      return;
    }
    this.state.helpOpen = false;
    this.ui.helpModal.classList.add("hidden");
    this.updateUi();
    this.ui.titleHelpButton?.focus();
  }

  performResetSelectedLevelStats() {
    const levelId = this.state.levelId;
    try {
      for (const key of this.bestKeysForLevel(levelId)) {
        localStorage.removeItem(key);
      }
    } catch {
      // Ignore storage failures in private or locked-down contexts.
    }

    delete this.state.playCounts[levelId];
    this.savePlayCounts();
    for (const word of this.state.words) {
      delete this.state.wordStats[this.wordStatKey(word)];
    }
    this.saveWordStats();
    this.invalidateStatsCache();
    this.state.best = this.readBest();
    this.state.score = 0;
    this.state.streak = 0;
    this.state.correct = 0;
    this.state.wrong = 0;
    this.state.miss = 0;
    this.state.review = new Map();
    this.renderLevelPicker();
    this.renderFeed();
    this.updateUi();
    this.renderAnswerButtons();
    this.drawBoard();
    if (this.state.phase === "over") {
      this.showResultOverlay();
    } else {
      this.showTitleOverlay();
    }
  }

  readTheme() {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY) || localStorage.getItem(OLD_THEME_STORAGE_KEY);
      return stored === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  }

  applyTheme(theme) {
    const nextTheme = theme === "light" ? "light" : "dark";
    this.state.theme = nextTheme;
    document.body.dataset.theme = nextTheme;
    this.refreshThemeColors();
    const isLight = nextTheme === "light";
    if (this.ui.themeButton) {
      this.ui.themeButton.title = isLight ? "ダークモード" : "ライトモード";
      this.ui.themeButton.setAttribute("aria-label", this.ui.themeButton.title);
    }
    this.ui.themeLightIcon?.classList.toggle("hidden", isLight);
    this.ui.themeDarkIcon?.classList.toggle("hidden", !isLight);
  }

  toggleTheme() {
    const nextTheme = this.state.theme === "light" ? "dark" : "light";
    this.applyTheme(nextTheme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Ignore storage failures in private or locked-down contexts.
    }
    this.drawBoard();
  }

  formatPercent(value) {
    return `${Math.round(this.clampNumber(value, 0, 0, 1) * 100)}%`;
  }

  formatNumber(value) {
    return this.numberFormatter.format(Math.max(0, Number(value) || 0));
  }

  formatPlayTime(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(total / 60);
    return `${minutes}:${String(total % 60).padStart(2, "0")}`;
  }

  playCountFor(levelId) {
    return Math.max(0, Number(this.state.playCounts[levelId]) || 0);
  }

  incrementPlayCount(levelId) {
    this.state.playCounts[levelId] = this.playCountFor(levelId) + 1;
    this.savePlayCounts();
    this.renderLevelPicker();
  }

  populateBgmTracks() {
    this.ui.bgmTrack.innerHTML = "";

    const random = document.createElement("option");
    random.value = "random";
    random.textContent = "ランダム再生";
    this.ui.bgmTrack.appendChild(random);

    for (const track of BGM_TRACKS) {
      const option = document.createElement("option");
      option.value = track.id;
      option.textContent = track.label;
      this.ui.bgmTrack.appendChild(option);
    }

    if (!BGM_TRACKS.some((track) => track.id === this.state.settings.bgmTrack)) {
      this.state.settings.bgmTrack = "random";
      this.saveSettings();
    }
  }

  syncSettingsInputs() {
    const settings = this.state.settings;
    this.ui.wordAudioEnabled.checked = settings.wordAudioEnabled;
    this.ui.bgmEnabled.checked = settings.bgmEnabled;
    this.ui.sfxEnabled.checked = settings.sfxEnabled;
    this.ui.wordAudioVolume.value = String(settings.wordAudioVolume);
    this.ui.bgmVolume.value = String(settings.bgmVolume);
    this.ui.sfxVolume.value = String(settings.sfxVolume);
    this.ui.wordAudioVolumeValue.textContent = this.formatPercent(settings.wordAudioVolume);
    this.ui.bgmVolumeValue.textContent = this.formatPercent(settings.bgmVolume);
    this.ui.sfxVolumeValue.textContent = this.formatPercent(settings.sfxVolume);
    this.ui.bgmTrack.value = settings.bgmTrack;
    this.updateBgmPreviewUi();
  }

  applySettingsFromInputs() {
    const previousTrack = this.state.settings.bgmTrack;
    const next = this.normalizeSettings({
      ...this.state.settings,
      wordAudioEnabled: this.ui.wordAudioEnabled.checked,
      bgmEnabled: this.ui.bgmEnabled.checked,
      sfxEnabled: this.ui.sfxEnabled.checked,
      wordAudioVolume: this.ui.wordAudioVolume.value,
      bgmVolume: this.ui.bgmVolume.value,
      sfxVolume: this.ui.sfxVolume.value,
      bgmTrack: this.ui.bgmTrack.value
    });
    if (previousTrack !== next.bgmTrack || !next.bgmEnabled) {
      this.audio.stopBgmPreview();
    }
    this.state.settings = next;
    this.syncSettingsInputs();
    this.saveSettings();
    this.audio.applySettings(() => this.state.phase);
    this.updateUi();
  }

  renderLevelPicker() {
    const level = this.activeLevel();
    if (this.ui.brandTitle) {
      this.ui.brandTitle.textContent = this.brandTitleText(level);
    }
    this.ui.levelButtonLabel.textContent = level.label;
    this.ui.levelButtonMeta.textContent = `${this.formatNumber(this.playCountFor(level.id))}回`;
    this.ui.levelMenu.innerHTML = "";

    for (const item of LEVELS) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "level-option";
      option.dataset.level = item.id;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", item.id === this.state.levelId ? "true" : "false");
      option.classList.toggle("active", item.id === this.state.levelId);

      const name = document.createElement("span");
      name.className = "level-option-name";
      name.textContent = item.label;

      const count = document.createElement("span");
      count.className = "level-option-count";
      count.textContent = `${this.formatNumber(this.playCountFor(item.id))}回`;

      option.append(name, count);
      option.addEventListener("click", () => this.selectLevel(item.id));
      this.ui.levelMenu.appendChild(option);
    }
  }

  positionLevelMenu() {
    if (!this.state.levelMenuOpen) {
      return;
    }
    const margin = 8;
    const gap = 7;
    const rect = this.ui.levelButton.getBoundingClientRect();
    const viewportWidth = globalThis.innerWidth || document.documentElement.clientWidth || 390;
    const viewportHeight = globalThis.innerHeight || document.documentElement.clientHeight || 720;
    const width = Math.min(Math.max(rect.width, 260), viewportWidth - margin * 2);
    const left = Math.max(margin, Math.min(rect.left, viewportWidth - width - margin));
    const belowTop = rect.bottom + gap;
    const belowHeight = viewportHeight - belowTop - margin;
    const aboveHeight = rect.top - gap - margin;
    const useAbove = belowHeight < 180 && aboveHeight > belowHeight;
    const maxHeight = Math.max(160, Math.min(430, useAbove ? aboveHeight : belowHeight));
    const top = useAbove ? Math.max(margin, rect.top - gap - maxHeight) : belowTop;

    this.ui.levelMenu.style.setProperty("--level-menu-left", `${left}px`);
    this.ui.levelMenu.style.setProperty("--level-menu-top", `${top}px`);
    this.ui.levelMenu.style.setProperty("--level-menu-width", `${width}px`);
    this.ui.levelMenu.style.setProperty("--level-menu-max-height", `${maxHeight}px`);
  }

  portalLevelMenu() {
    if (this.ui.levelMenu.parentElement !== document.body) {
      document.body.appendChild(this.ui.levelMenu);
    }
  }

  restoreLevelMenu() {
    if (this.ui.levelPicker && this.ui.levelMenu.parentElement !== this.ui.levelPicker) {
      this.ui.levelPicker.appendChild(this.ui.levelMenu);
    }
  }

  setLevelMenuOpen(isOpen) {
    this.state.levelMenuOpen = Boolean(isOpen);
    if (this.state.levelMenuOpen) {
      this.portalLevelMenu();
    }
    this.ui.levelButton.setAttribute("aria-expanded", String(this.state.levelMenuOpen));
    this.ui.levelMenu.classList.toggle("floating", this.state.levelMenuOpen);
    this.ui.levelMenu.classList.toggle("hidden", !this.state.levelMenuOpen);
    if (this.state.levelMenuOpen) {
      this.positionLevelMenu();
      requestAnimationFrame(() => this.positionLevelMenu());
    } else {
      this.restoreLevelMenu();
    }
  }

  toggleLevelMenu() {
    if (this.ui.levelButton.disabled) {
      return;
    }
    this.setSoundPanelOpen(false);
    this.setLevelMenuOpen(!this.state.levelMenuOpen);
  }

  selectLevel(levelId) {
    if (!LEVEL_MAP.has(levelId)) {
      return;
    }
    this.ui.level.value = levelId;
    this.setLevelMenuOpen(false);
    this.state.levelId = levelId;
    this.savePreferences();
    if (this.state.phase === "ready" || this.state.phase === "over" || this.state.phase === "error") {
      this.loadLevel(levelId, { resultMode: this.state.phase === "over" });
    } else {
      this.renderLevelPicker();
      this.updateTitleDetails();
    }
  }

  setSoundPanelOpen(isOpen) {
    this.state.soundPanelOpen = Boolean(isOpen);
    if (!this.state.soundPanelOpen) {
      this.audio.stopBgmPreview();
    }
    this.ui.soundButton.setAttribute("aria-expanded", String(this.state.soundPanelOpen));
    this.ui.soundPanel.classList.toggle("hidden", !this.state.soundPanelOpen);
    this.updateBgmPreviewUi();
  }

  toggleSoundPanel() {
    if (this.ui.soundButton.disabled) {
      return;
    }
    this.setLevelMenuOpen(false);
    this.setSoundPanelOpen(!this.state.soundPanelOpen);
  }

  updateBgmPreviewUi() {
    if (!this.ui.bgmPreview) {
      return;
    }
    const isPlaying = this.audio.isBgmPreviewing();
    const isGameRunning = this.state.phase === "playing";
    this.ui.bgmPreview.disabled = isGameRunning || !BGM_TRACKS.length || !this.state.settings.bgmEnabled;
    this.ui.bgmPreview.classList.toggle("is-playing", isPlaying);
    this.ui.bgmPreview.title = isGameRunning ? "プレイ中はBGMを試聴できません" : isPlaying ? "試聴を停止" : "BGMを試聴";
    this.ui.bgmPreview.setAttribute("aria-label", this.ui.bgmPreview.title);
    this.ui.bgmPreviewPlayIcon?.classList.toggle("hidden", isPlaying);
    this.ui.bgmPreviewStopIcon?.classList.toggle("hidden", !isPlaying);
  }

  toggleBgmPreview() {
    if (this.ui.bgmPreview?.disabled || this.state.phase === "playing") {
      return;
    }
    this.audio.toggleBgmPreview(this.state.settings.bgmTrack);
    this.updateBgmPreviewUi();
  }

  updateTitleDetails() {
    const level = this.activeLevel();
    const summary = this.levelSummaryStats();
    if (this.ui.titlePlayCount) {
      this.ui.titlePlayCount.textContent = `${this.formatNumber(this.playCountFor(level.id))}回`;
    }
    if (this.ui.titleBest) {
      this.ui.titleBest.textContent = this.formatNumber(Math.max(this.state.best, this.state.score));
    }
    if (this.ui.titleLearned) {
      this.ui.titleLearned.textContent = `${this.formatNumber(summary.learned)} / ${this.formatNumber(summary.totalWords)}`;
    }
    if (this.ui.titleUncorrected) {
      this.ui.titleUncorrected.textContent = `${this.formatNumber(summary.uncorrected)} / ${this.formatNumber(summary.totalWords)}`;
    }
    if (this.ui.titleCumulative) {
      this.ui.titleCumulative.textContent = `${this.formatNumber(summary.correct)} / ${this.formatNumber(summary.presented)}`;
    }
    if (this.ui.titleLearnedBar) {
      this.ui.titleLearnedBar.style.width = `${summary.learnedRate}%`;
    }
    if (this.ui.titleLearnedRate) {
      this.ui.titleLearnedRate.textContent = `${summary.learnedRate}%`;
    }
    if (this.ui.titleAccuracyBar) {
      this.ui.titleAccuracyBar.style.width = `${summary.accuracyRate}%`;
    }
    if (this.ui.titleAccuracyRate) {
      this.ui.titleAccuracyRate.textContent = `${summary.accuracyRate}%`;
    }
    this.renderTitleWrongBest();
  }

  renderTitleWrongBest() {
    const list = this.ui.titleWrongBestList;
    if (!list) {
      return;
    }
    const entries = this.state.words
      .map((word) => ({ word, stats: this.wordStatFor(word) }))
      .filter(({ stats }) => stats.incorrect > 0)
      .sort((a, b) => (
        b.stats.incorrect - a.stats.incorrect
        || b.stats.seen - a.stats.seen
        || a.word.english.localeCompare(b.word.english)
      ))
      .slice(0, 10);

    list.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement("li");
      empty.className = "title-wrong-empty";
      empty.textContent = "誤答記録なし";
      list.appendChild(empty);
      return;
    }

    entries.forEach(({ word, stats }, index) => {
      const item = document.createElement("li");
      item.className = "title-wrong-item";

      const actions = document.createElement("span");
      actions.className = "title-wrong-actions";
      actions.append(this.createWordAudioButton(word), this.createWordInfoButton(word));

      const wordText = document.createElement("span");
      wordText.className = "title-wrong-word";
      wordText.textContent = `${index + 1}. ${word.english}`;

      const count = document.createElement("span");
      count.className = "title-wrong-count";
      count.textContent = `誤 ${this.formatNumber(stats.incorrect)}`;

      const meaning = document.createElement("span");
      meaning.className = "title-wrong-meaning";
      meaning.textContent = word.japanese || "";

      item.append(actions, wordText, count, meaning);
      list.appendChild(item);
    });
  }

  cssVar(name, fallback) {
    return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
  }

  // 描画で使うテーマ色を一度だけ読み取ってキャッシュする。テーマ切替時に呼び直す。
  refreshThemeColors() {
    const v = (name, fallback) => this.cssVar(name, fallback);
    this.colors = {
      canvasBg: v("--canvas-bg", "#0c1113"),
      laneBgA: v("--lane-bg-a", "#101719"),
      laneBgB: v("--lane-bg-b", "#151d20"),
      laneLine: v("--lane-line", "rgba(97, 191, 209, 0.22)"),
      missLine: v("--miss-line", "rgba(224, 179, 78, 0.16)"),
      boardLabel: v("--board-label", "rgba(241, 244, 238, 0.16)"),
      edgeLine: v("--edge-line", "rgba(97, 191, 209, 0.28)"),
      flow: {
        coolSoft: v("--lane-flow-cool-soft", "rgba(97, 191, 209, 0.05)"),
        coolMid: v("--lane-flow-cool-mid", "rgba(97, 191, 209, 0.1)"),
        coolStrong: v("--lane-flow-cool-strong", "rgba(97, 191, 209, 0.14)"),
        warmSoft: v("--lane-flow-warm-soft", "rgba(240, 206, 108, 0.04)"),
        warmMid: v("--lane-flow-warm-mid", "rgba(240, 206, 108, 0.075)"),
        greenSoft: v("--lane-flow-green-soft", "rgba(143, 195, 93, 0.075)"),
        shade: v("--lane-flow-shade", "rgba(0, 0, 0, 0.22)"),
        finish: v("--lane-flow-finish", "rgba(0, 0, 0, 0.1)")
      },
      cardText: v("--card-text", "#f1f4ee"),
      cardBgTop: v("--card-bg-top", "rgba(28, 40, 43, 0.94)"),
      cardBgBottom: v("--card-bg-bottom", "rgba(9, 14, 16, 0.9)"),
      cardBorder: v("--card-border", "rgba(97, 191, 209, 0.55)"),
      cardHighlight: v("--card-highlight", "rgba(241, 244, 238, 0.16)"),
      cardShadow: v("--card-shadow", "rgba(0, 0, 0, 0.42)"),
      revealBg: v("--reveal-bg", "rgba(18, 25, 27, 0.95)"),
      green: v("--green", "#8fc35d"),
      red: v("--red", "#df6557"),
      gold: v("--gold", "#f0ce6c"),
      cyan: v("--cyan", "#61bfd1"),
      ink: v("--ink", "#f1f4ee"),
      muted: v("--muted", "#a7b3ad")
    };
  }

  async loadLevel(levelId, options = {}) {
    const level = LEVEL_MAP.get(levelId);
    if (!level) {
      return;
    }
    const stayOnResult = Boolean(options.resultMode);

    this.flushWordStats();
    const token = ++this.loadToken;
    this.stopRenderLoop();
    this.clearSpawnTimers();
    this.audio.stopBgm();
    this.audio.releaseWordAudioPool();
    this.audio.stopBgmPreview();
    this.hideNetworkToast({ clear: true });
    this.clearReviewTooltipPress();
    this.clearAnswerFocus();
    this.state.phase = "loading";
    this.state.levelId = levelId;
    this.ui.level.value = levelId;
    this.state.words = [];
    this.state.lanes = [];
    this.state.effects = [];
    this.state.wordBag = [];
    this.state.recent = [];
    this.state.countdownSecond = 0;
    this.lastWordAudioPrefetchAt = 0;
    this.state.loadError = "";
    this.invalidateStatsCache();
    this.savePreferences();
    this.renderLevelPicker();
    this.showOverlay(stayOnResult ? "Result" : APP_TITLE, "Loading", stayOnResult ? "Restart" : "Start", {
      showTitleDetails: true,
      obscureBoard: !stayOnResult,
      resultMode: stayOnResult,
      titleMode: !stayOnResult,
      loadingMode: true
    });
    this.updateUi();
    this.drawBoard();

    try {
      const words = await loadWords(level);
      if (token !== this.loadToken) {
        return;
      }
      this.state.words = words;
      this.invalidateStatsCache();
      this.state.phase = stayOnResult ? "over" : "ready";
      this.state.best = this.readBest();
      this.state.timeLeft = stayOnResult ? 0 : RUN_TIME;
      this.state.elapsed = 0;
      if (!stayOnResult) {
        this.state.feedback = [];
        this.state.review = new Map();
      }
      this.state.recent = [];
      this.resetWordBag();
      this.makeLanes();
      this.renderFeed();
      if (stayOnResult) {
        this.showResultOverlay();
      } else {
        this.showTitleOverlay();
      }
      this.updateUi();
      this.renderAnswerButtons();
      this.drawBoard();
    } catch (error) {
      if (token !== this.loadToken) {
        return;
      }
      this.state.phase = "error";
      this.state.loadError = error instanceof Error ? error.message : String(error);
      this.showOverlay("読み込みエラー", "ローカルサーバーで開いてください", "Start", { showTitleDetails: false });
      this.updateUi();
      this.renderAnswerButtons();
      this.drawBoard();
    }
  }

  // バックバッファ解像度の倍率。resizeCanvas と canvasSize で必ず同じ値を使う。
  deviceRatio() {
    return Math.max(1, Math.min(CANVAS_MAX_DPR, window.devicePixelRatio || 1));
  }

  resizeCanvas() {
    const oldSize = this.canvas.width && this.canvas.height ? this.canvasSize() : null;
    const box = this.canvas.getBoundingClientRect();
    const ratio = this.deviceRatio();
    this.canvas.width = Math.max(1, Math.floor(box.width * ratio));
    this.canvas.height = Math.max(1, Math.floor(box.height * ratio));
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const newSize = this.canvasSize();
    if (oldSize && this.state.phase === "playing") {
      this.preserveFallProgress(oldSize, newSize);
    }
  }

  observeCanvasSize() {
    if (!globalThis.ResizeObserver) {
      return;
    }
    this.resizeObserver = new ResizeObserver(() => {
      this.resizeCanvas();
      this.drawBoard();
    });
    this.resizeObserver.observe(this.canvas);
  }

  canvasSize() {
    const ratio = this.deviceRatio();
    return {
      width: this.canvas.width / ratio,
      height: this.canvas.height / ratio
    };
  }

  cardSizeForLane(laneWidth) {
    const lanes = this.activeLaneCount();
    const cardGap = laneWidth < 130 ? 8 : laneWidth < 180 ? 14 : 24;
    const maxCardWidth = lanes === 1 ? 420 : lanes === 2 ? 340 : 282;
    return {
      width: Math.max(58, Math.min(laneWidth - cardGap, maxCardWidth)),
      height: lanes === 1 ? 88 : lanes === 2 ? 78 : laneWidth < 130 ? 76 : 70
    };
  }

  missLineY(size = this.canvasSize()) {
    const laneWidth = size.width / this.activeLaneCount();
    const cardHeight = this.cardSizeForLane(laneWidth).height;
    const bottomInset = Math.max(18, Math.min(46, size.height * 0.08));
    return Math.max(CARD_START_Y + 40, size.height - bottomInset - cardHeight);
  }

  guideLineY(size = this.canvasSize()) {
    const laneWidth = size.width / this.activeLaneCount();
    return this.missLineY(size) + this.cardSizeForLane(laneWidth).height;
  }

  fallDistance(size = this.canvasSize()) {
    return Math.max(1, this.missLineY(size) - CARD_START_Y);
  }

  fallHeightScale(size = this.canvasSize()) {
    return this.fallDistance(size) / FALL_REFERENCE_DISTANCE;
  }

  preserveFallProgress(oldSize, newSize) {
    if (this.activeGameMode().cardMotion !== "fall") {
      this.positionFixedModeLanes();
      return;
    }
    const oldMiss = this.missLineY(oldSize);
    const newMiss = this.missLineY(newSize);
    for (const lane of this.state.lanes) {
      if (!lane || lane.locked) {
        continue;
      }
      const startY = lane.startY ?? lane.y;
      const oldRange = Math.max(1, oldMiss - startY);
      const progress = Math.max(0, Math.min(1.25, (lane.y - startY) / oldRange));
      lane.y = startY + (newMiss - startY) * progress;
    }
  }

  fixedCardYForLane(laneWidth = this.canvasSize().width / this.activeLaneCount(), size = this.canvasSize()) {
    const cardHeight = this.cardSizeForLane(laneWidth).height;
    const boardTop = Math.max(CARD_START_Y + 6, size.height * 0.16);
    const boardBottom = Math.min(this.missLineY(size) - 12, size.height - cardHeight - 18);
    return Math.max(CARD_START_Y, boardTop + Math.max(0, boardBottom - boardTop) / 2 - cardHeight / 2);
  }

  positionFixedModeLanes() {
    const mode = this.activeGameMode();
    if (mode.cardMotion === "fall") {
      return;
    }
    const size = this.canvasSize();
    const laneWidth = size.width / this.activeLaneCount();
    const y = this.fixedCardYForLane(laneWidth, size);
    for (const lane of this.state.lanes) {
      if (!lane || lane.locked) {
        continue;
      }
      lane.y = y;
      lane.startY = y;
    }
  }

  cardTimeoutDuration() {
    const distance = this.fallDistance();
    const initialSpeed = Math.max(1, this.speedNow());
    const acceleration = Math.max(0, this.activeLevel().accel * this.fallHeightScale() * FALL_SPEED_MULTIPLIER);
    if (acceleration <= 0.001) {
      return distance / initialSpeed;
    }
    return (-initialSpeed + Math.sqrt(initialSpeed * initialSpeed + 2 * acceleration * distance)) / acceleration;
  }

  recentWindowSize() {
    const words = this.state.words.length;
    if (words <= 3) {
      return Math.max(0, words - 1);
    }
    return Math.min(24, Math.max(9, this.activeLaneCount() * 5, Math.floor(words * 0.12)));
  }

  resetWordBag() {
    this.state.wordBag = this.shuffle(this.state.words);
  }

  wordPriorityWeight(word, now = Date.now()) {
    const stats = this.wordStatFor(word);
    const seen = Math.max(0, stats.seen || 0);
    const incorrectRate = seen ? (stats.incorrect || 0) / seen : 0;
    const lowSeenWeight = 8 / Math.sqrt(seen + 1);
    const unseenWeight = seen ? 0 : 10;
    const incorrectWeight = incorrectRate * 4 + Math.min(5, stats.incorrect || 0) * 0.35;
    const staleDays = stats.lastSeen ? Math.min(14, (now - stats.lastSeen) / 86400000) : 14;
    return Math.max(0.1, 1 + unseenWeight + lowSeenWeight + incorrectWeight + staleDays * 0.08);
  }

  weightedWord(candidates) {
    const now = Date.now();
    const weights = candidates.map((word) => this.wordPriorityWeight(word, now));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) {
      return candidates[this.randInt(0, candidates.length - 1)];
    }
    let roll = this.nextRandom() * total;
    for (let i = 0; i < candidates.length; i += 1) {
      roll -= weights[i];
      if (roll <= 0) {
        return candidates[i];
      }
    }
    return candidates[candidates.length - 1];
  }

  chooseWord(excludedWords = []) {
    const words = this.state.words;
    if (!words.length) {
      return null;
    }
    if (words.length === 1) {
      return words[0];
    }

    const blocked = new Set([
      ...this.state.recent,
      ...excludedWords.filter(Boolean)
    ]);
    const isBlocked = (word) => blocked.has(this.wordStatKey(word)) || blocked.has(word.english);
    let candidates = words.filter((word) => !isBlocked(word));
    if (!candidates.length) {
      const active = new Set(excludedWords.filter(Boolean));
      candidates = words.filter((word) => !active.has(this.wordStatKey(word)) && !active.has(word.english));
    }
    if (!candidates.length) {
      candidates = words;
    }

    const candidate = this.weightedWord(candidates);
    this.state.recent.push(this.wordStatKey(candidate));
    this.state.recent = this.state.recent.slice(-this.recentWindowSize());
    return candidate;
  }

  makeOptions(word) {
    const correct = this.answerTextFor(word);
    const answerField = this.activeQuizDirection().answerField;
    const pool = this.state.words
      .map((entry) => String(entry?.[answerField] || "").trim())
      .filter((entry) => entry && entry !== correct);
    const choices = [correct];
    while (choices.length < 3 && pool.length) {
      const pick = pool.splice(this.randInt(0, pool.length - 1), 1)[0];
      if (!choices.includes(pick)) {
        choices.push(pick);
      }
    }
    return this.shuffle(choices);
  }

  spawnLane(index, startAbove) {
    if (!this.state.words.length) {
      return;
    }
    const activeWords = this.state.lanes
      .filter((lane) => lane && lane.index !== index)
      .map((lane) => this.wordStatKey(lane.word))
      .filter(Boolean);
    const word = this.chooseWord(activeWords);
    if (!word) {
      return;
    }
    if (this.state.phase === "playing") {
      this.updateWordStats(word, "seen");
    }
    const options = this.makeOptions(word);
    const mode = this.activeGameMode();
    const laneWidth = this.canvasSize().width / this.activeLaneCount();
    const startY = mode.cardMotion === "fall"
      ? CARD_START_Y + (startAbove ? this.randInt(0, 20) : this.randInt(0, 12))
      : this.fixedCardYForLane(laneWidth);
    const cardTimeLimit = mode.usesCardTimeout ? this.cardTimeoutDuration() : 0;
    this.state.lanes[index] = {
      index,
      word,
      options,
      y: startY,
      startY,
      age: 0,
      cardTimeLeft: cardTimeLimit,
      cardTimeLimit,
      fadeOut: 0,
      fadeDuration: 0,
      fadeKind: "",
      shake: 0,
      flash: "",
      flashTime: 0,
      locked: false
    };
    if (this.state.phase === "playing") {
      this.preloadWordAudioFor([word], { preload: "auto", limit: 1 });
    }
  }

  // 回答/ミス後のカード再出現を予約する。タイマーは Set で管理し、
  // 一時停止・ゲーム終了・タイトル復帰・再スタート時に clearSpawnTimers で全て破棄する。
  scheduleSpawn(laneIndex, delayMs) {
    const timer = setTimeout(() => {
      this.spawnTimers.delete(timer);
      if (this.state.phase !== "playing") {
        return;
      }
      this.spawnLane(laneIndex, true);
      this.playLaneWordAudio(laneIndex, WORD_AUDIO_SPAWN_DELAY_MS);
      this.prefetchUpcomingWordAudio();
      this.updateLaneAnswerButtons(laneIndex);
    }, delayMs);
    this.spawnTimers.add(timer);
  }

  clearSpawnTimers() {
    for (const timer of this.spawnTimers) {
      clearTimeout(timer);
    }
    this.spawnTimers.clear();
  }

  // 一時停止中に spawn タイマーを破棄した場合、locked のまま残ったレーンを再開時に補充する。
  respawnStalledLanes() {
    let respawned = false;
    for (let i = 0; i < this.state.lanes.length; i += 1) {
      const lane = this.state.lanes[i];
      if (lane && lane.locked) {
        this.spawnLane(i, true);
        respawned = true;
      }
    }
    if (respawned) {
      this.refreshAnswerButtons();
    }
  }

  makeLanes() {
    this.state.lanes = [];
    if (!this.state.words.length) {
      return;
    }
    for (let i = 0; i < this.activeLaneCount(); i += 1) {
      this.spawnLane(i, true);
      if (this.activeGameMode().cardMotion === "fall") {
        this.state.lanes[i].y += i * 18;
        this.state.lanes[i].startY = this.state.lanes[i].y;
      }
    }
  }

  addFeed(text) {
    this.state.feedback.unshift(text);
    this.state.feedback = this.state.feedback.slice(0, 8);
    this.renderFeed();
  }

  renderFeed() {
    this.ui.feed.innerHTML = "";
    const lines = this.state.feedback.length ? this.state.feedback : ["Ready"];
    for (const text of lines) {
      const p = document.createElement("p");
      p.textContent = text;
      this.ui.feed.appendChild(p);
    }
  }

  recordReview(word, picked, reason) {
    this.updateWordStats(word, reason === "correct" ? "correct" : "incorrect");
    const reviewKey = this.wordStatKey(word);
    const existing = this.state.review.get(reviewKey);
    if (existing) {
      existing.count += 1;
      existing.correct += reason === "correct" ? 1 : 0;
      existing.wrong += reason === "wrong" ? 1 : 0;
      existing.miss += reason === "miss" ? 1 : 0;
      existing.reason = existing.wrong || existing.miss ? reason : "correct";
      existing.unanswered = existing.unanswered || 0;
      existing.lastPicked = picked;
      existing.detail = existing.detail || word.detail;
      existing.sample = existing.sample || word.sample;
      existing.sampleJpn = existing.sampleJpn || word.sampleJpn;
      return;
    }
    this.state.review.set(reviewKey, {
      id: word.id,
      english: word.english,
      japanese: word.japanese,
      detail: word.detail,
      sample: word.sample,
      sampleJpn: word.sampleJpn,
      lastPicked: picked,
      reason,
      count: 1,
      correct: reason === "correct" ? 1 : 0,
      wrong: reason === "wrong" ? 1 : 0,
      miss: reason === "miss" ? 1 : 0,
      unanswered: 0
    });
  }

  recordUnansweredReview(word) {
    const reviewKey = this.wordStatKey(word);
    const existing = this.state.review.get(reviewKey);
    if (existing) {
      existing.count += 1;
      existing.unanswered = (existing.unanswered || 0) + 1;
      if (!existing.wrong && !existing.miss) {
        existing.reason = "unanswered";
      }
      existing.lastPicked = null;
      existing.detail = existing.detail || word.detail;
      existing.sample = existing.sample || word.sample;
      existing.sampleJpn = existing.sampleJpn || word.sampleJpn;
      return;
    }
    this.state.review.set(reviewKey, {
      id: word.id,
      english: word.english,
      japanese: word.japanese,
      detail: word.detail,
      sample: word.sample,
      sampleJpn: word.sampleJpn,
      lastPicked: null,
      reason: "unanswered",
      count: 1,
      correct: 0,
      wrong: 0,
      miss: 0,
      unanswered: 1
    });
  }

  recordUnansweredLanes() {
    for (const lane of this.state.lanes) {
      if (lane?.word && !lane.locked) {
        this.recordUnansweredReview(lane.word);
      }
    }
  }

  showAnswerReveal(laneIndex, lane) {
    const size = this.canvasSize();
    this.state.effects.push({
      type: "reveal",
      lane: laneIndex,
      text: this.answerTextFor(lane.word),
      y: Math.max(92, Math.min(size.height - 124, lane.y + 32)),
      life: ANSWER_REVEAL_TIME,
      maxLife: ANSWER_REVEAL_TIME,
      color: this.colors.gold
    });
  }

  wordAudioUrlFor(word, levelId = this.state.levelId) {
    return this.audio.wordAudioUrl(levelId, word?.id);
  }

  preloadWordAudioFor(words, options = {}) {
    const urls = (Array.isArray(words) ? words : [words])
      .map((word) => this.wordAudioUrlFor(word))
      .filter(Boolean);
    this.audio.preloadWordAudio(urls, options);
  }

  handleWordAudioStatus(status) {
    const url = status?.url;
    if (!url) {
      return;
    }
    if (status.type === "slow") {
      if (this.state.phase !== "playing") {
        return;
      }
      this.slowWordAudioUrls.add(url);
      this.syncNetworkToast();
      return;
    }
    if (status.type === "ready" || status.type === "error") {
      this.slowWordAudioUrls.delete(url);
      this.syncNetworkToast();
    }
  }

  syncNetworkToast() {
    if (!this.ui.networkToast) {
      return;
    }
    const shouldShow = this.state.phase === "playing" && this.slowWordAudioUrls.size > 0;
    this.ui.networkToast.classList.toggle("hidden", !shouldShow);
  }

  hideNetworkToast(options = {}) {
    if (options.clear) {
      this.slowWordAudioUrls.clear();
    }
    this.syncNetworkToast();
  }

  prefetchUpcomingWordAudio(options = {}) {
    if (this.state.phase !== "playing" || !this.state.words.length) {
      return;
    }
    if (!this.audio.canPrefetchWordAudio()) {
      return;
    }
    const now = performance.now();
    if (!options.force && now - this.lastWordAudioPrefetchAt < WORD_AUDIO_PREFETCH_INTERVAL_MS) {
      return;
    }
    this.lastWordAudioPrefetchAt = now;
    const active = new Set(
      this.state.lanes
        .map((lane) => this.wordStatKey(lane?.word))
        .filter(Boolean)
    );
    const statsNow = Date.now();
    const candidates = this.state.words
      .filter((word) => !active.has(this.wordStatKey(word)))
      .sort((a, b) => this.wordPriorityWeight(b, statsNow) - this.wordPriorityWeight(a, statsNow))
      .slice(0, WORD_AUDIO_PREFETCH_COUNT);
    this.preloadWordAudioFor(candidates, { preload: "metadata", limit: WORD_AUDIO_PREFETCH_COUNT });
  }

  playLaneWordAudio(laneIndex, delayMs = 0) {
    if (!this.shouldAutoPlayWordAudio()) {
      return;
    }
    const lane = this.state.lanes[laneIndex];
    const wordKey = this.wordStatKey(lane?.word);
    const url = this.wordAudioUrlFor(lane?.word);
    if (!url) {
      return;
    }
    this.audio.playWordAudio(url, {
      delayMs,
      shouldPlay: () =>
        this.state.phase === "playing"
        && this.state.lanes[laneIndex] === lane
        && this.wordStatKey(this.state.lanes[laneIndex]?.word) === wordKey
    });
  }

  playRecallAnswerWordAudio(word) {
    if (this.normalizeQuizDirection(this.state.quizDirection) !== "recall") {
      return;
    }
    const url = this.wordAudioUrlFor(word);
    if (url) {
      this.audio.playWordAudio(url);
    }
  }

  playVisibleWordAudioSequence(initialDelayMs = 0) {
    if (!this.shouldAutoPlayWordAudio()) {
      return;
    }
    const items = [];
    for (let i = 0; i < this.state.lanes.length; i += 1) {
      const lane = this.state.lanes[i];
      const wordKey = this.wordStatKey(lane?.word);
      const url = this.wordAudioUrlFor(lane?.word);
      if (lane?.word && url) {
        items.push({
          url,
          shouldPlay: () =>
            this.state.phase === "playing"
            && this.state.lanes[i] === lane
            && this.wordStatKey(this.state.lanes[i]?.word) === wordKey
        });
      }
    }
    this.audio.playWordAudioQueue(items, {
      delayMs: initialDelayMs,
      intervalMs: WORD_AUDIO_START_GAP_MS,
      gapMs: WORD_AUDIO_START_GAP_MS,
      maxItemMs: WORD_AUDIO_START_MAX_ITEM_MS
    });
    this.prefetchUpcomingWordAudio({ force: true });
  }

  startLaneFade(lane, kind, duration = CARD_FADE_OUT_TIME) {
    lane.fadeKind = kind;
    lane.fadeDuration = duration;
    lane.fadeOut = duration;
  }

  cardMetrics(lane, laneWidth) {
    const laneX = lane.index * laneWidth;
    const { width: cardWidth, height: cardHeight } = this.cardSizeForLane(laneWidth);
    const x = laneX + (laneWidth - cardWidth) / 2 + (lane.shake ? Math.sin(performance.now() / 28) * lane.shake : 0);
    return { x, y: lane.y, width: cardWidth, height: cardHeight };
  }

  addCardParticles(laneIndex, lane, kind) {
    const size = this.canvasSize();
    const laneWidth = size.width / this.activeLaneCount();
    const card = this.cardMetrics(lane, laneWidth);
    const green = this.colors.green;
    const gold = this.colors.gold;
    const cyan = this.colors.cyan;
    const red = this.colors.red;
    const ink = this.colors.ink;
    const muted = this.colors.muted;
    const count = kind === "correct" ? 24 : kind === "wrong" ? 20 : 18;
    const colors = kind === "correct"
      ? [green, gold, cyan]
      : kind === "wrong"
        ? [red, gold, ink]
        : [gold, muted, cyan];
    const shapes = kind === "correct"
      ? ["spark", "diamond", "ring", "dot"]
      : kind === "wrong"
        ? ["spark", "shard", "dot", "ring"]
        : ["shard", "ring", "dot"];

    const centerX = card.x + card.width / 2;
    const centerY = card.y + card.height / 2;
    if (kind === "correct") {
      this.state.effects.push({
        type: "shockwave",
        x: centerX,
        y: centerY,
        radius: Math.min(card.width, card.height) * 0.35,
        growth: laneWidth * 0.42,
        life: 0.38,
        maxLife: 0.38,
        color: green
      });
    } else if (kind === "wrong") {
      this.state.effects.push({
        type: "shockwave",
        x: centerX,
        y: centerY,
        radius: Math.min(card.width, card.height) * 0.3,
        growth: laneWidth * 0.22,
        life: 0.3,
        maxLife: 0.3,
        color: red
      });
    }

    for (let i = 0; i < count; i += 1) {
      const angle = this.nextRandom() * Math.PI * 2;
      const speed = (kind === "correct" ? 42 : 34) + this.nextRandom() * 48;
      const edgeBias = i % 2 === 0 ? -0.42 : 0.42;
      const x = card.x + card.width * (0.5 + edgeBias * this.nextRandom());
      const y = card.y + card.height * (0.25 + this.nextRandom() * 0.55);
      const life = 0.44 + this.nextRandom() * 0.26;
      const vy = kind === "correct"
        ? Math.sin(angle) * speed - 24
        : kind === "miss"
          ? Math.abs(Math.sin(angle)) * speed * 0.55 + 14
          : Math.sin(angle) * speed - 4;
      this.state.effects.push({
        type: "particle",
        x,
        y,
        vx: Math.cos(angle) * speed * (kind === "miss" ? 0.6 : 1),
        vy,
        gravity: kind === "miss" ? 46 : 18,
        radius: 2 + this.nextRandom() * 2.8,
        shape: shapes[this.randInt(0, shapes.length - 1)],
        angle: this.nextRandom() * Math.PI * 2,
        spin: (this.nextRandom() - 0.5) * 8,
        color: colors[this.randInt(0, colors.length - 1)],
        life,
        maxLife: life
      });
    }
  }

  renderReviewList() {
    this.hideReviewTooltip();
    this.ui.reviewList.innerHTML = "";
    if (!this.state.review.size) {
      const empty = document.createElement("div");
      empty.className = "review-title";
      empty.textContent = "復習なし";
      this.ui.reviewList.appendChild(empty);
      return;
    }

    const title = document.createElement("div");
    title.className = "review-title";
    title.textContent = "出題リスト";
    this.ui.reviewList.appendChild(title);

    const reviewItems = Array.from(this.state.review.values())
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const rank = (entry) => {
          if (entry.item.wrong || entry.item.miss) {
            return 0;
          }
          if (entry.item.unanswered) {
            return 1;
          }
          return 2;
        };
        return rank(a) - rank(b) || a.index - b.index;
      })
      .map((entry) => entry.item);

    for (const item of reviewItems) {
      const row = document.createElement("div");
      row.className = "review-item";
      if (item.wrong || item.miss) {
        row.classList.add("needs-review");
      } else if (item.unanswered) {
        row.classList.add("is-unanswered");
      }
      const detailText = this.reviewDetailText(item);
      row.dataset.tooltipTitle = `${item.english} ： ${item.japanese}`;
      row.dataset.tooltipDetail = item.detail || "解説なし";
      row.dataset.tooltipSample = item.sample || "";
      row.dataset.tooltipSampleJpn = item.sampleJpn || "";
      row.setAttribute("aria-label", `${row.dataset.tooltipTitle} ${detailText}`);
      row.addEventListener("pointerenter", (event) => this.handleReviewPointerEnter(row, event));
      row.addEventListener("pointerdown", (event) => this.handleReviewPointerDown(row, event));
      row.addEventListener("pointermove", (event) => this.handleReviewPointerMove(row, event));
      row.addEventListener("pointerup", (event) => this.handleReviewPointerUp(event));
      row.addEventListener("pointerleave", (event) => this.handleReviewPointerLeave(event));
      row.addEventListener("pointercancel", () => this.hideReviewTooltip());
      row.addEventListener("contextmenu", (event) => {
        if (this.isMobileReviewPointer(event)) {
          event.preventDefault();
        }
      });
      const english = document.createElement("span");
      english.className = "review-word";
      const wordAudioButton = this.createWordAudioButton(item);
      const englishText = document.createElement("strong");
      englishText.className = "review-word-text";
      englishText.textContent = item.english;
      english.append(wordAudioButton, englishText);
      const japanese = document.createElement("span");
      japanese.className = "review-meaning";
      japanese.textContent = item.japanese;
      const status = document.createElement("span");
      status.className = "review-status";
      const statusLabel = document.createElement("span");
      statusLabel.className = "review-status-label";
      if (item.wrong || item.miss) {
        status.classList.add("is-alert");
        const parts = [];
        if (item.wrong) {
          parts.push("Wrong");
        }
        if (item.miss) {
          parts.push("Miss");
        }
        statusLabel.textContent = parts.join(" / ");
      } else if (item.unanswered) {
        status.classList.add("is-unanswered");
        statusLabel.textContent = "-";
      } else {
        status.classList.add("is-ok");
        statusLabel.textContent = "OK";
      }
      const cumulativeStats = this.wordStatFor(item);
      const cumulative = document.createElement("span");
      cumulative.className = "review-cumulative";
      cumulative.textContent = `正：${this.formatNumber(cumulativeStats.correct)}回 誤：${this.formatNumber(cumulativeStats.incorrect)}回`;
      status.append(statusLabel, cumulative);
      const detail = this.createReviewDetail(item.detail || "", item.sample || "", item.sampleJpn || "");
      const links = document.createElement("span");
      links.className = "review-links";
      const encoded = encodeURIComponent(item.english);
      const eijiro = this.createLookupButton({
        label: "英辞",
        service: "英辞郎",
        word: item.english,
        url: `https://eow.alc.co.jp/search?q=${encoded}`,
        mode: "iframe"
      });
      const mobileInfo = this.createWordInfoButton(item);
      mobileInfo.classList.add("review-mobile-info-button");
      const youglish = this.createLookupButton({
        label: "YouG",
        service: "YouGlish",
        word: item.english,
        url: `https://youglish.com/pronounce/${encoded}/english`,
        mode: "youglish"
      });
      links.append(mobileInfo, eijiro, youglish);
      row.append(english, japanese, status, detail, links);
      this.ui.reviewList.appendChild(row);
    }
  }

  reviewDetailText(item) {
    // ツールチップ/aria用: 詳細解説、英語例文、日本語訳をそれぞれ改行して読む。
    const parts = [];
    if (item.detail) {
      parts.push(item.detail);
    }
    if (item.sample) {
      parts.push(item.sample);
    }
    if (item.sampleJpn) {
      parts.push(item.sampleJpn);
    }
    return parts.join("\n") || "解説なし";
  }

  createReviewTooltip() {
    const root = document.createElement("div");
    root.className = "review-tooltip hidden";
    root.setAttribute("aria-hidden", "true");
    root.inert = true;
    const title = document.createElement("div");
    title.className = "review-tooltip-title";
    const detail = document.createElement("div");
    detail.className = "review-tooltip-detail";
    const sample = document.createElement("div");
    sample.className = "review-tooltip-sample";
    const sampleJpn = document.createElement("div");
    sampleJpn.className = "review-tooltip-sample-jpn";
    const close = document.createElement("button");
    close.className = "review-tooltip-close hidden";
    close.type = "button";
    close.textContent = "Close";
    close.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    close.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.hideReviewTooltip();
    });
    root.append(title, detail, sample, sampleJpn, close);
    document.body.appendChild(root);
    return { root, title, detail, sample, sampleJpn, close };
  }

  handleReviewPointerEnter(row, event) {
    if (this.isMobileReviewPointer(event)) {
      return;
    }
    this.showReviewTooltip(row, event);
  }

  handleReviewPointerDown(row, event) {
    if (!this.isMobileReviewPointer(event) || event.target.closest(".review-links, .review-audio-button")) {
      return;
    }
    this.hideReviewTooltip();
    this.clearReviewTooltipPress();
    this.reviewTooltipPointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      shown: false
    };
    this.reviewTooltipPressTimer = window.setTimeout(() => {
      if (!this.reviewTooltipPointer || this.reviewTooltipPointer.id !== event.pointerId) {
        return;
      }
      this.reviewTooltipPointer.shown = true;
      this.showReviewTooltip(row, event, { fixedMobile: true, showClose: true });
    }, REVIEW_TOOLTIP_LONG_PRESS_MS);
  }

  handleReviewPointerMove(row, event) {
    if (!this.isMobileReviewPointer(event)) {
      this.positionReviewTooltip(event);
      return;
    }
    if (!this.reviewTooltipPointer || this.reviewTooltipPointer.id !== event.pointerId) {
      return;
    }
    const dx = event.clientX - this.reviewTooltipPointer.x;
    const dy = event.clientY - this.reviewTooltipPointer.y;
    if (Math.hypot(dx, dy) >= REVIEW_TOOLTIP_TOUCH_MOVE_CANCEL) {
      this.clearReviewTooltipPress();
      if (this.reviewTooltipPointer.shown) {
        this.hideReviewTooltip();
      }
      this.reviewTooltipPointer = null;
    }
  }

  handleReviewPointerUp(event) {
    if (!this.isMobileReviewPointer(event)) {
      return;
    }
    this.clearReviewTooltipPress();
    if (this.reviewTooltipPointer?.id === event.pointerId) {
      this.reviewTooltipPointer = null;
    }
  }

  handleReviewPointerLeave(event) {
    if (this.isMobileReviewPointer(event)) {
      this.clearReviewTooltipPress();
      return;
    }
    this.hideReviewTooltip();
  }

  isMobileReviewPointer(event) {
    if (event?.pointerType === "touch") {
      return true;
    }
    return !event?.pointerType && window.matchMedia?.("(hover: none), (pointer: coarse)")?.matches;
  }

  clearReviewTooltipPress() {
    if (this.reviewTooltipPressTimer) {
      window.clearTimeout(this.reviewTooltipPressTimer);
      this.reviewTooltipPressTimer = 0;
    }
  }

  showReviewTooltip(row, event, options = {}) {
    if (!this.reviewTooltip || !row.dataset.tooltipTitle) {
      return;
    }
    this.showReviewTooltipData({
      title: row.dataset.tooltipTitle,
      detail: row.dataset.tooltipDetail || "解説なし",
      sample: row.dataset.tooltipSample || "",
      sampleJpn: row.dataset.tooltipSampleJpn || ""
    }, event, options);
  }

  showReviewTooltipData(data, event, options = {}) {
    if (!this.reviewTooltip || !data.title) {
      return;
    }
    const showClose = Boolean(options.showClose || options.fixedMobile);
    this.reviewTooltip.title.textContent = data.title;
    this.reviewTooltip.detail.textContent = data.detail || "解説なし";
    this.reviewTooltip.sample.textContent = data.sample || "";
    this.reviewTooltip.sample.classList.toggle("hidden", !data.sample);
    this.reviewTooltip.sampleJpn.textContent = data.sampleJpn || "";
    this.reviewTooltip.sampleJpn.classList.toggle("hidden", !data.sampleJpn);
    this.reviewTooltip.close?.classList.toggle("hidden", !showClose);
    this.reviewTooltip.root.classList.toggle("has-close", showClose);
    this.reviewTooltip.root.classList.toggle("is-mobile-fixed", Boolean(options.fixedMobile));
    this.reviewTooltip.root.inert = false;
    this.reviewTooltip.root.classList.remove("hidden");
    this.reviewTooltip.root.setAttribute("aria-hidden", "false");
    if (options.fixedMobile) {
      this.positionFixedReviewTooltip();
    } else if (event) {
      this.positionReviewTooltip(event);
    }
  }

  positionReviewTooltip(event) {
    if (!this.reviewTooltip || this.reviewTooltip.root.classList.contains("hidden")) {
      return;
    }
    const offset = 14;
    const margin = 10;
    const rect = this.reviewTooltip.root.getBoundingClientRect();
    let x = event.clientX + offset;
    let y = event.clientY + offset;
    if (x + rect.width + margin > window.innerWidth) {
      x = event.clientX - rect.width - offset;
    }
    if (y + rect.height + margin > window.innerHeight) {
      y = event.clientY - rect.height - offset;
    }
    this.reviewTooltip.root.style.left = `${Math.max(margin, x)}px`;
    this.reviewTooltip.root.style.top = `${Math.max(margin, y)}px`;
    this.reviewTooltip.root.style.width = "";
  }

  positionFixedReviewTooltip() {
    if (!this.reviewTooltip || this.reviewTooltip.root.classList.contains("hidden")) {
      return;
    }
    const margin = 10;
    const panel = this.ui.overlay?.querySelector(".overlay-panel")?.getBoundingClientRect();
    const title = this.ui.overlayTitle?.getBoundingClientRect();
    const width = Math.max(260, Math.min(window.innerWidth - margin * 2, (panel?.width || window.innerWidth) - 20));
    const left = Math.max(margin, Math.min((panel?.left || margin) + 10, window.innerWidth - width - margin));
    const topBase = title ? title.bottom + 10 : (panel?.top || margin) + 58;
    const top = Math.max(margin, Math.min(topBase, window.innerHeight - margin - 120));
    this.reviewTooltip.root.style.left = `${left}px`;
    this.reviewTooltip.root.style.top = `${top}px`;
    this.reviewTooltip.root.style.width = `${width}px`;
  }

  releaseReviewTooltipFocus() {
    if (!this.reviewTooltip?.root) {
      return;
    }
    const active = document.activeElement;
    if (active && active !== document.body && this.reviewTooltip.root.contains(active) && typeof active.blur === "function") {
      active.blur();
    }
  }

  hideReviewTooltip() {
    if (!this.reviewTooltip) {
      return;
    }
    this.clearReviewTooltipPress();
    this.reviewTooltipPointer = null;
    this.releaseReviewTooltipFocus();
    this.reviewTooltip.root.inert = true;
    this.reviewTooltip.root.classList.add("hidden");
    this.reviewTooltip.root.classList.remove("is-mobile-fixed", "has-close");
    this.reviewTooltip.close?.classList.add("hidden");
    this.reviewTooltip.root.setAttribute("aria-hidden", "true");
    this.reviewTooltip.root.style.left = "";
    this.reviewTooltip.root.style.top = "";
    this.reviewTooltip.root.style.width = "";
  }

  createReviewDetail(detailText, sampleText = "", sampleJpnText = "") {
    const detail = document.createElement("span");
    detail.className = "review-detail";
    const body = document.createElement("span");
    body.className = "review-detail-text";
    const main = document.createElement("span");
    main.className = "review-detail-main";
    main.textContent = detailText || "解説なし";
    body.appendChild(main);
    if (sampleText) {
      const sample = document.createElement("span");
      sample.className = "review-detail-sample";
      sample.textContent = `例: ${sampleText}${sampleJpnText ? `（${sampleJpnText}）` : ""}`;
      body.appendChild(sample);
    }
    detail.appendChild(body);
    return detail;
  }

  createLookupButton({ label, service, word, url, mode }) {
    const button = document.createElement("button");
    button.className = "review-link-button";
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      this.openLookupModal({ service, word, url, mode });
    });
    return button;
  }

  createWordAudioButton(item) {
    const button = document.createElement("button");
    button.className = "review-audio-button";
    button.type = "button";
    button.title = `${item.english} の音声を再生`;
    button.setAttribute("aria-label", `${item.english} の音声を再生`);
    button.disabled = !this.wordAudioUrlFor(item);

    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M8 5l11 7-11 7z");
    icon.appendChild(path);
    button.appendChild(icon);

    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.playReviewWordAudio(item);
    });
    return button;
  }

  createWordInfoButton(item) {
    const button = document.createElement("button");
    button.className = "word-info-button";
    button.type = "button";
    button.textContent = "i";
    button.title = `${item.english} の詳細`;
    button.setAttribute("aria-label", `${item.english} の詳細`);
    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.showWordTooltip(item, event);
    });
    return button;
  }

  wordTooltipData(item) {
    return {
      title: `${item.english} ： ${item.japanese || ""}`,
      detail: item.detail || "解説なし",
      sample: item.sample || "",
      sampleJpn: item.sampleJpn || ""
    };
  }

  showWordTooltip(item, event) {
    this.showReviewTooltipData(this.wordTooltipData(item), event, {
      fixedMobile: this.isMobileReviewPointer(event),
      showClose: true
    });
  }

  playReviewWordAudio(item) {
    this.hideReviewTooltip();
    const url = this.wordAudioUrlFor(item);
    if (url) {
      this.audio.playWordAudio(url);
    }
  }

  openLookupModal({ service, word, url, mode = "iframe" }) {
    this.hideReviewTooltip();
    if (!this.ui.lookupModal || !this.ui.lookupFrame) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    this.state.lookupOpen = true;
    this.ui.lookupService.textContent = service;
    this.ui.lookupTitle.textContent = word;
    this.ui.lookupOpenLink.href = url;
    this.ui.lookupFrame.title = `${service}: ${word}`;
    this.ui.lookupNote.textContent = "表示されない場合は、別タブで開いてください。";
    this.clearLookupContent();
    this.ui.lookupModal.classList.remove("hidden");
    if (mode === "youglish") {
      this.ui.youglishHost?.classList.remove("hidden");
      this.openYouglishWidget(word);
    } else {
      this.ui.lookupFrame.classList.remove("hidden");
      this.ui.lookupFrame.src = url;
    }
    this.updateUi();
    this.ui.lookupClose.focus();
  }

  closeLookupModal() {
    if (!this.ui.lookupModal || !this.state.lookupOpen) {
      return;
    }
    this.state.lookupOpen = false;
    this.ui.lookupModal.classList.add("hidden");
    this.clearLookupContent();
    this.updateUi();
  }

  clearLookupContent() {
    this.pauseYouglishWidget();
    this.ui.lookupFrame?.removeAttribute("src");
    this.ui.lookupFrame?.classList.add("hidden");
    if (this.ui.youglishHost) {
      this.ui.youglishHost.classList.add("hidden");
      this.ui.youglishHost.replaceChildren();
    }
    this.youglishWidget = null;
    this.youglishWidgetReady = null;
    this.youglishWidgetVersion += 1;
  }

  createYouglishSlot() {
    if (!this.ui.youglishHost) {
      return "";
    }
    const slotId = `youglishWidgetSlot${this.youglishWidgetVersion}`;
    const slot = document.createElement("div");
    slot.id = slotId;
    this.ui.youglishHost.replaceChildren(slot);
    return slotId;
  }

  openYouglishWidget(word) {
    if (!this.ui.youglishHost) {
      window.open(`https://youglish.com/pronounce/${encodeURIComponent(word)}/english`, "_blank", "noopener,noreferrer");
      return;
    }
    const requestVersion = this.youglishWidgetVersion;
    this.ensureYouglishWidget()
      .then((widget) => {
        if (
          !this.state.lookupOpen
          || requestVersion !== this.youglishWidgetVersion
          || !this.ui.youglishHost
          || this.ui.youglishHost.classList.contains("hidden")
        ) {
          return;
        }
        widget.fetch(word, "english");
      })
      .catch(() => {
        this.youglishWidgetReady = null;
        this.ui.lookupNote.textContent = "YouGlishを読み込めませんでした。別タブで開いてください。";
      });
  }

  ensureYouglishWidget() {
    if (this.youglishWidget) {
      return Promise.resolve(this.youglishWidget);
    }
    if (this.youglishWidgetReady) {
      return this.youglishWidgetReady;
    }

    this.youglishWidgetReady = new Promise((resolve, reject) => {
      const createWidget = () => {
        if (!window.YG?.Widget) {
          reject(new Error("YouGlish API is unavailable"));
          return;
        }
        const slotId = this.createYouglishSlot();
        if (!slotId) {
          reject(new Error("YouGlish host is unavailable"));
          return;
        }
        this.youglishWidget = new window.YG.Widget(slotId, {
          autoStart: 0,
          components: 92,
          restrictionMode: 1,
          videoQuality: "small"
        });
        resolve(this.youglishWidget);
      };

      if (window.YG?.Widget) {
        createWidget();
        return;
      }

      const previousReady = window.onYouglishAPIReady;
      window.onYouglishAPIReady = () => {
        if (typeof previousReady === "function") {
          previousReady();
        }
        createWidget();
      };

      const existingScript = document.querySelector('script[src="https://youglish.com/public/emb/widget.js"]');
      if (existingScript) {
        existingScript.addEventListener("error", () => reject(new Error("YouGlish API load failed")), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = "https://youglish.com/public/emb/widget.js";
      script.async = true;
      script.onerror = () => reject(new Error("YouGlish API load failed"));
      document.head.appendChild(script);
    });
    return this.youglishWidgetReady;
  }

  pauseYouglishWidget() {
    try {
      this.youglishWidget?.pause();
    } catch {
      // YouGlish may still be loading.
    }
  }

  modeLabel() {
    return `${this.activeGameMode().label} / ${this.activeLevel().label} / ${this.activeLaneCount()}レーン`;
  }

  answerTextSizeClass(text) {
    const score = Array.from(text || "").reduce((total, character) => {
      return total + (/^[\x00-\x7F]$/.test(character) ? 0.55 : 1);
    }, 0);
    const lanes = this.activeLaneCount();
    const longAt = lanes === 1 ? 14 : lanes === 2 ? 10 : 7.5;
    const veryLongAt = lanes === 1 ? 20 : lanes === 2 ? 14 : 10.5;
    if (score >= veryLongAt) {
      return "text-very-long";
    }
    if (score >= longAt) {
      return "text-long";
    }
    return "";
  }

  clearAnswerFocus() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest(".answer-button")) {
      active.blur();
    }
  }

  refreshAnswerButtons() {
    this.renderAnswerButtons();
    this.clearAnswerFocus();
  }

  answerFontRange() {
    const lanes = this.activeLaneCount();
    const narrow = window.innerWidth <= 620;
    const shallow = window.innerHeight <= 700;
    const veryShallow = window.innerHeight <= 560;
    // max は枠に収まる場合のデフォルト表示サイズ。min まで横幅に応じて縮小する。
    let max = lanes === 1 ? 30 : lanes === 2 ? 25 : 20;
    let min = lanes === 1 ? 15 : lanes === 2 ? 13 : 11.5;

    if (narrow) {
      max = lanes === 1 ? 29 : lanes === 2 ? 24 : 19;
      min = lanes === 1 ? 14 : lanes === 2 ? 12.5 : 10.5;
    }
    if (narrow && shallow) {
      max = lanes === 1 ? 26 : lanes === 2 ? 21 : 17.5;
      min = lanes === 1 ? 13 : lanes === 2 ? 11.5 : 10;
    }
    if (narrow && veryShallow) {
      max = lanes === 1 ? 23 : lanes === 2 ? 19 : 16;
      min = lanes === 1 ? 12.5 : lanes === 2 ? 10.8 : 9.8;
    }
    return { max, min };
  }

  // elements を渡すとその要素だけを対象にする（差分更新で該当レーンの3語だけ再フィットする用）。
  fitAnswerTextElements(elements = null) {
    if (!this.ui.answers) {
      return;
    }
    if (!this.answerMeasureCanvas) {
      this.answerMeasureCanvas = document.createElement("canvas");
      this.answerMeasureContext = this.answerMeasureCanvas.getContext("2d");
    }
    const context = this.answerMeasureContext;
    if (!context) {
      return;
    }
    const { max, min } = this.answerFontRange();
    const targets = elements || this.ui.answers.querySelectorAll(".answer-button .word");
    for (const element of targets) {
      const text = element.textContent || "";
      element.style.fontSize = `${max}px`;
      if (!text) {
        continue;
      }
      const available = Math.max(0, element.clientWidth - 2);
      if (!available) {
        continue;
      }
      const style = getComputedStyle(element);
      const family = style.fontFamily || "system-ui, sans-serif";
      const weight = style.fontWeight || "850";
      let size = max;
      while (size > min) {
        context.font = `${weight} ${size}px ${family}`;
        if (context.measureText(text).width <= available) {
          break;
        }
        size = Math.max(min, size - 0.5);
      }
      element.style.fontSize = `${size}px`;
    }
  }

  // stat-row の値を書き換える。テキストが変わったときだけ再フィットする（毎フレームの無駄な計測を避ける）。
  setStatText(element, text) {
    if (!element || element.textContent === text) {
      return;
    }
    element.textContent = text;
    this.fitStatRow(element);
  }

  // ラベルと値が横並びで折り返さないよう、収まらない分だけフォントサイズを縮小する。
  fitStatRow(valueElement) {
    const row = valueElement?.closest(".stat-row");
    const label = row?.querySelector("span");
    if (!row || !label) {
      return;
    }
    if (!this.statMeasureCanvas) {
      this.statMeasureCanvas = document.createElement("canvas");
      this.statMeasureContext = this.statMeasureCanvas.getContext("2d");
    }
    const context = this.statMeasureContext;
    if (!context) {
      return;
    }
    label.style.fontSize = "";
    valueElement.style.fontSize = "";
    const available = row.clientWidth;
    if (!available) {
      return;
    }
    const rowStyle = getComputedStyle(row);
    const gap = parseFloat(rowStyle.columnGap || rowStyle.gap) || 0;
    const labelStyle = getComputedStyle(label);
    const valueStyle = getComputedStyle(valueElement);
    const labelFamily = labelStyle.fontFamily || "system-ui, sans-serif";
    const valueFamily = valueStyle.fontFamily || "system-ui, sans-serif";
    const labelWeight = labelStyle.fontWeight || "700";
    const valueWeight = valueStyle.fontWeight || "900";
    const labelBase = parseFloat(labelStyle.fontSize) || 12;
    const valueBase = parseFloat(valueStyle.fontSize) || 16;
    const isWideScoreValue = valueElement.id === "scoreValue" || valueElement.id === "bestValue";
    const labelMin = Math.max(isWideScoreValue ? 7.5 : 9, labelBase * (isWideScoreValue ? 0.56 : 0.72));
    const valueMin = Math.max(isWideScoreValue ? 7.5 : 11, valueBase * (isWideScoreValue ? 0.42 : 0.72));

    const measure = (text, weight, size, family) => {
      context.font = `${weight} ${size}px ${family}`;
      return context.measureText(text || "").width;
    };

    let labelSize = labelBase;
    let valueSize = valueBase;
    let guard = 0;
    while (guard < 40) {
      guard += 1;
      const labelWidth = measure(label.textContent, labelWeight, labelSize, labelFamily);
      const valueWidth = measure(valueElement.textContent, valueWeight, valueSize, valueFamily);
      if (labelWidth + gap + valueWidth <= available + 0.5) {
        break;
      }
      if (valueSize > valueMin) {
        valueSize = Math.max(valueMin, valueSize - 0.5);
        continue;
      }
      if (labelSize > labelMin) {
        labelSize = Math.max(labelMin, labelSize - 0.5);
        continue;
      }
      break;
    }
    if (labelSize < labelBase - 0.01) {
      label.style.fontSize = `${labelSize}px`;
    }
    if (valueSize < valueBase - 0.01) {
      valueElement.style.fontSize = `${valueSize}px`;
    }
  }

  fitAllStatRows() {
    const elements = [
      this.ui.score,
      this.ui.best,
      this.ui.streak,
      this.ui.correct,
      this.ui.wrong,
      this.ui.miss,
      this.ui.accuracy
    ];
    for (const element of elements) {
      if (element) {
        this.fitStatRow(element);
      }
    }
  }

  // 回答ボタンの1つ分に、現在の状態（disabled / フラッシュ色 / 訳語テキスト・サイズ）を反映する。
  // フル再構築と差分更新の両方から使い、両者で見た目が一致するようロジックを一本化する。
  applyAnswerButtonState(button, word, lane, optionIndex) {
    button.disabled = this.state.phase !== "playing" || Boolean(lane?.locked);
    button.classList.remove("correct", "wrong");
    if (lane && lane.flashTime > 0) {
      const isCorrect = lane.options[optionIndex] === this.answerTextFor(lane.word);
      if (lane.flash === "correct" && isCorrect) {
        button.classList.add("correct");
      } else if (lane.flash === "wrong" && isCorrect) {
        button.classList.add("correct");
      } else if (lane.flash === "wrong" && !isCorrect) {
        button.classList.add("wrong");
      }
    }
    const optionText = lane ? lane.options[optionIndex] : "";
    const changed = word.textContent !== optionText;
    if (changed) {
      word.classList.remove("text-long", "text-very-long");
      const sizeClass = this.answerTextSizeClass(optionText);
      if (sizeClass) {
        word.classList.add(sizeClass);
      }
      word.textContent = optionText;
    }
    return changed;
  }

  renderAnswerButtons() {
    this.clearAnswerFocus();
    this.ui.answers.innerHTML = "";
    this.ui.answers.style.setProperty("--lane-count", String(this.activeLaneCount()));
    const laneKeys = this.laneKeys();
    const refs = [];
    for (let laneIndex = 0; laneIndex < this.activeLaneCount(); laneIndex += 1) {
      const lane = this.state.lanes[laneIndex];
      const panel = document.createElement("section");
      panel.className = "lane-panel";
      panel.setAttribute("aria-label", `Lane ${laneIndex + 1}`);

      const title = document.createElement("div");
      title.className = "lane-title";
      const left = document.createElement("span");
      left.textContent = `Lane ${laneIndex + 1}`;
      const right = document.createElement("span");
      right.textContent = laneKeys[laneIndex].join(" ");
      title.append(left, right);
      panel.appendChild(title);

      const laneRef = [];
      for (let optionIndex = 0; optionIndex < 3; optionIndex += 1) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "answer-button";
        button.dataset.lane = String(laneIndex);
        button.dataset.option = String(optionIndex);

        const key = document.createElement("span");
        key.className = "key";
        key.textContent = laneKeys[laneIndex][optionIndex];
        const word = document.createElement("span");
        word.className = "word";
        this.applyAnswerButtonState(button, word, lane, optionIndex);
        button.append(key, word);
        button.addEventListener("click", () => {
          button.blur();
          this.answer(laneIndex, optionIndex);
        });
        panel.appendChild(button);
        laneRef.push({ button, word });
      }
      refs.push(laneRef);
      this.ui.answers.appendChild(panel);
    }
    this.laneButtonRefs = refs;
    this.fitAnswerTextElements();
  }

  // 1レーンだけ状態が変わったとき（出題差し替え・回答フラッシュ）に、そのレーンの
  // 3ボタンだけを差分更新する。DOM構造が変わっている場合は安全にフル再構築へフォールバックする。
  updateLaneAnswerButtons(laneIndex) {
    const laneRef = this.laneButtonRefs[laneIndex];
    if (
      this.laneButtonRefs.length !== this.activeLaneCount()
      || !laneRef
      || laneRef.length !== 3
      || !laneRef[0].button.isConnected
    ) {
      this.refreshAnswerButtons();
      return;
    }
    const lane = this.state.lanes[laneIndex];
    const changedWords = [];
    for (let optionIndex = 0; optionIndex < 3; optionIndex += 1) {
      const { button, word } = laneRef[optionIndex];
      if (this.applyAnswerButtonState(button, word, lane, optionIndex)) {
        changedWords.push(word);
      }
    }
    if (changedWords.length) {
      this.fitAnswerTextElements(changedWords);
    }
    this.clearAnswerFocus();
  }

  startGame() {
    if (!this.state.words.length || this.state.phase === "loading" || this.state.phase === "error") {
      return;
    }
    this.audio.init();
    this.audio.stopBgmPreview();
    // 前ゲームの残タイマー・再生中の単語音声を持ち越さない。
    this.stopRenderLoop();
    this.clearSpawnTimers();
    this.audio.stopWordAudio();
    this.hideNetworkToast({ clear: true });
    this.lastWordAudioPrefetchAt = 0;
    this.state.rngSeed = this.createSeed();
    this.state.phase = "playing";
    this.state.laneCount = this.clampLaneCount(this.ui.laneCount.value);
    this.state.gameModeId = this.selectedGameModeId();
    this.state.quizDirection = this.selectedQuizDirection();
    this.state.survivalEnabled = this.selectedSurvivalEnabled();
    this.savePreferences();
    this.incrementPlayCount(this.state.levelId);
    this.state.score = 0;
    this.state.best = this.readBest();
    this.state.streak = 0;
    this.state.correct = 0;
    this.state.wrong = 0;
    this.state.miss = 0;
    this.state.timeLeft = RUN_TIME;
    this.state.elapsed = 0;
    this.state.countdownSecond = 0;
    this.state.feedback = [];
    this.state.review = new Map();
    this.state.effects = [];
    this.state.recent = [];
    this.resetWordBag();
    this.state.lastTime = performance.now();
    this.makeLanes();
    this.setLevelMenuOpen(false);
    this.setSoundPanelOpen(false);
    this.hideOverlay();
    this.addFeed(`${this.modeLabel()} / Start`);
    this.audio.playSfx("start");
    this.audio.startBgm(() => this.state.phase, { restart: true });
    this.playVisibleWordAudioSequence(WORD_AUDIO_START_DELAY_MS);
    this.updateUi();
    this.renderAnswerButtons();
    this.startRenderLoop();
  }

  finishGame() {
    if (this.state.phase === "over") {
      return;
    }
    this.recordUnansweredLanes();
    this.state.phase = "over";
    this.stopRenderLoop();
    this.hideNetworkToast({ clear: true });
    this.clearSpawnTimers();
    this.hideReviewTooltip();
    this.clearAnswerFocus();
    this.setLevelMenuOpen(false);
    this.setSoundPanelOpen(false);
    this.state.countdownSecond = 0;
    this.state.effects = [];
    this.audio.fadeOutBgm(1800);
    this.audio.stopWordAudio();
    this.audio.releaseWordAudioPool();
    this.flushWordStats();
    this.saveBest();
    this.showResultOverlay({ fadeIn: true });
    this.addFeed(`Finish: ${this.formatNumber(this.state.score)}`);
    this.audio.playSfx("finish");
    this.updateUi();
    this.renderAnswerButtons();
  }

  returnToTitle() {
    this.stopRenderLoop();
    this.clearSpawnTimers();
    this.audio.fadeOutBgm(650);
    this.audio.stopWordAudio();
    this.audio.releaseWordAudioPool();
    this.flushWordStats();
    this.hideNetworkToast({ clear: true });
    this.hideReviewTooltip();
    this.clearReviewTooltipPress();
    this.clearAnswerFocus();
    this.state.returnConfirmOpen = false;
    this.state.returnConfirmPreviousPhase = "";
    this.state.wordListOpen = false;
    this.state.lookupOpen = false;
    this.state.helpOpen = false;
    this.ui.returnConfirmModal?.classList.add("hidden");
    this.ui.wordListModal?.classList.add("hidden");
    this.ui.lookupModal?.classList.add("hidden");
    this.ui.helpModal?.classList.add("hidden");
    this.clearLookupContent();
    this.state.phase = this.state.words.length ? "ready" : "loading";
    this.state.laneCount = this.clampLaneCount(this.ui.laneCount.value);
    this.state.gameModeId = this.selectedGameModeId();
    this.state.quizDirection = this.selectedQuizDirection();
    this.state.survivalEnabled = this.selectedSurvivalEnabled();
    this.state.score = 0;
    this.state.best = this.readBest();
    this.state.streak = 0;
    this.state.correct = 0;
    this.state.wrong = 0;
    this.state.miss = 0;
    this.state.timeLeft = RUN_TIME;
    this.state.elapsed = 0;
    this.state.feedback = [];
    this.state.review = new Map();
    this.state.effects = [];
    this.state.recent = [];
    this.state.countdownSecond = 0;
    this.lastWordAudioPrefetchAt = 0;
    this.resetWordBag();
    this.state.lastTime = performance.now();
    this.makeLanes();
    this.renderFeed();
    this.setSoundPanelOpen(false);
    this.showTitleOverlay();
    this.updateUi();
    this.renderAnswerButtons();
    this.drawBoard();
  }

  pauseGame() {
    if (this.state.phase === "playing") {
      this.state.phase = "paused";
      this.stopRenderLoop();
      // 長時間の一時停止に備え、タイマー・単語音声・プール済みAudio要素をすべて解放する。
      this.clearSpawnTimers();
      this.audio.fadeOutBgm(650);
      this.audio.stopWordAudio();
      this.audio.releaseWordAudioPool();
      this.audio.stopBgmPreview();
      this.flushWordStats();
      this.hideNetworkToast({ clear: true });
      this.hideReviewTooltip();
      this.clearReviewTooltipPress();
      this.clearAnswerFocus();
      this.state.countdownSecond = 0;
      this.state.effects = [];
      this.showOverlay("Paused", "", "Resume", {
        showTitleDetails: true,
        obscureBoard: true,
        titleMode: true,
        pauseMode: true
      });
    } else if (this.state.phase === "paused") {
      this.state.phase = "playing";
      this.state.lastTime = performance.now();
      this.lastWordAudioPrefetchAt = 0;
      this.hideOverlay();
      this.audio.startBgm(() => this.state.phase);
      // 一時停止時に破棄した spawn タイマーの分、消えたままのレーンを補充する。
      this.respawnStalledLanes();
      this.prefetchUpcomingWordAudio({ force: true });
      this.startRenderLoop();
    }
    this.updateUi();
    this.renderAnswerButtons();
  }

  speedNow() {
    const level = this.activeLevel();
    const progressionBonus = Math.min(42, this.state.correct * 0.42);
    const streakBonus = Math.min(22, this.state.streak * STREAK_SPEED_BONUS);
    const ramp = level.baseSpeed + this.state.elapsed * level.accel + progressionBonus + streakBonus;
    return ramp * this.fallHeightScale() * FALL_SPEED_MULTIPLIER;
  }

  formatTimeDelta(delta) {
    const sign = delta >= 0 ? "+" : "-";
    const value = Math.abs(delta).toFixed(3).replace(/\.?0+$/, "");
    return `${sign}${value}s`;
  }

  adjustTime(delta) {
    this.state.timeLeft = Math.max(0, this.state.timeLeft + delta);
    if (this.state.phase === "playing" && this.state.timeLeft <= 0) {
      this.finishGame();
      return false;
    }
    return true;
  }

  maybeFinishForSurvival() {
    if (this.state.phase === "playing" && this.state.survivalEnabled) {
      this.finishGame();
      return true;
    }
    return false;
  }

  answer(laneIndex, optionIndex) {
    if (this.state.phase !== "playing") {
      return;
    }
    const lane = this.state.lanes[laneIndex];
    if (!lane || lane.locked) {
      return;
    }

    const picked = lane.options[optionIndex];
    const correctAnswer = this.answerTextFor(lane.word);
    const promptText = this.promptTextFor(lane.word);
    if (picked === correctAnswer) {
      lane.locked = true;
      lane.flash = "correct";
      lane.flashTime = 0.18;
      this.state.correct += 1;
      this.state.streak += 1;
      const size = this.canvasSize();
      const bottomBonus = Math.max(0, Math.round((1 - lane.y / (size.height - 92)) * 40));
      const gain = 100 + this.activeLevel().bonus + bottomBonus + Math.min(90, this.state.streak * 3);
      const timeBonus = this.state.settings.correctTimeBonus + this.state.streak * this.state.settings.streakTimeMultiplier;
      this.state.score += gain;
      if (timeBonus > 0) {
        this.adjustTime(timeBonus);
      }
      this.startLaneFade(lane, "correct", CARD_FADE_OUT_TIME);
      this.addCardParticles(laneIndex, lane, "correct");
      this.audio.playSfx("correct");
      this.playRecallAnswerWordAudio(lane.word);
      this.recordReview(lane.word, picked, "correct");
      this.state.effects.push({ lane: laneIndex, text: `+${gain}`, y: lane.y, life: 0.7, color: this.colors.green });
      if (timeBonus > 0) {
        this.state.effects.push({ lane: laneIndex, text: this.formatTimeDelta(timeBonus), y: lane.y + 24, life: 0.7, color: this.colors.gold });
      }
      const timeText = timeBonus > 0 ? ` / ${this.formatTimeDelta(timeBonus)}` : "";
      this.addFeed(`${promptText} = ${correctAnswer}${timeText}`);
      this.scheduleSpawn(laneIndex, CARD_FADE_OUT_TIME * 1000);
    } else {
      lane.locked = true;
      this.state.wrong += 1;
      this.state.streak = 0;
      this.state.score = Math.max(0, this.state.score - 20);
      lane.shake = 8;
      lane.flash = "wrong";
      lane.flashTime = 0.22;
      this.recordReview(lane.word, picked, "wrong");
      this.showAnswerReveal(laneIndex, lane);
      this.startLaneFade(lane, "wrong", CARD_FADE_OUT_TIME + 0.08);
      this.addCardParticles(laneIndex, lane, "wrong");
      this.audio.playSfx("wrong");
      const penalty = this.state.settings.wrongTimePenalty;
      this.state.effects.push({ lane: laneIndex, text: `-20 ${this.formatTimeDelta(-penalty)}`, y: lane.y, life: 0.55, color: this.colors.red });
      this.addFeed(`${promptText}: 正解は ${correctAnswer} / ${this.formatTimeDelta(-penalty)}`);
      this.adjustTime(-penalty);
      const finishedForSurvival = this.maybeFinishForSurvival();
      this.playRecallAnswerWordAudio(lane.word);
      if (finishedForSurvival) {
        this.updateUi();
        this.refreshAnswerButtons();
        return;
      }
      this.scheduleSpawn(laneIndex, (CARD_FADE_OUT_TIME + 0.08) * 1000);
    }
    this.updateUi();
    this.updateLaneAnswerButtons(laneIndex);
  }

  missLane(laneIndex) {
    const lane = this.state.lanes[laneIndex];
    if (!lane || lane.locked) {
      return;
    }
    lane.locked = true;
    lane.flash = "wrong";
    lane.flashTime = 0.22;
    this.state.miss += 1;
    this.state.streak = 0;
    this.state.score = Math.max(0, this.state.score - 35);
    this.recordReview(lane.word, null, "miss");
    this.showAnswerReveal(laneIndex, lane);
    this.startLaneFade(lane, "miss", ANSWER_REVEAL_TIME);
    this.addCardParticles(laneIndex, lane, "miss");
    this.audio.playSfx("miss");
    const penalty = this.state.settings.wrongTimePenalty;
    this.state.effects.push({ lane: laneIndex, text: `MISS ${this.formatTimeDelta(-penalty)}`, y: this.guideLineY(this.canvasSize()) - 16, life: 0.65, color: this.colors.gold });
    this.addFeed(`${this.promptTextFor(lane.word)} = ${this.answerTextFor(lane.word)} / ${this.formatTimeDelta(-penalty)}`);
    this.adjustTime(-penalty);
    if (this.maybeFinishForSurvival()) {
      this.updateUi();
      this.renderAnswerButtons();
      return;
    }
    this.scheduleSpawn(laneIndex, ANSWER_REVEAL_TIME * 1000);
    this.updateUi();
    this.updateLaneAnswerButtons(laneIndex);
  }

  updateGame(dt) {
    if (this.state.phase !== "playing") {
      return;
    }
    this.state.elapsed += dt;
    this.state.timeLeft -= dt;
    if (this.state.timeLeft <= 0) {
      this.state.timeLeft = 0;
      this.finishGame();
      return;
    }

    // 終盤3秒はカウントダウン音を鳴らす。
    const secondsLeft = Math.ceil(this.state.timeLeft);
    if (secondsLeft <= 3 && secondsLeft >= 1) {
      if (secondsLeft !== this.state.countdownSecond) {
        this.state.countdownSecond = secondsLeft;
        this.audio.playSfx("countdown", secondsLeft);
      }
    } else if (this.state.countdownSecond && secondsLeft > 3) {
      this.state.countdownSecond = 0;
    }

    const mode = this.activeGameMode();
    const size = this.canvasSize();
    const isFallMode = mode.cardMotion === "fall";
    const speed = isFallMode ? this.speedNow() : 0;
    const fixedY = isFallMode ? 0 : this.fixedCardYForLane(size.width / this.activeLaneCount(), size);
    const missY = isFallMode ? this.missLineY(size) : 0;
    for (let i = 0; i < this.state.lanes.length; i += 1) {
      const lane = this.state.lanes[i];
      lane.age += dt;
      lane.fadeOut = Math.max(0, lane.fadeOut - dt);
      lane.shake = Math.max(0, lane.shake - 38 * dt);
      lane.flashTime = Math.max(0, lane.flashTime - dt);
      if (lane.locked) {
        continue;
      }
      if (isFallMode) {
        lane.y += speed * dt;
      } else {
        lane.y = fixedY;
      }
      if (mode.usesCardTimeout) {
        lane.cardTimeLeft = Math.max(0, (lane.cardTimeLeft || 0) - dt);
      }
      if (
        (isFallMode && lane.y > missY)
        || (mode.usesCardTimeout && lane.cardTimeLeft <= 0)
      ) {
        this.missLane(i);
      }
    }

    let aliveEffectCount = 0;
    for (const effect of this.state.effects) {
      effect.life -= dt;
      if (effect.type === "particle") {
        effect.x += effect.vx * dt;
        effect.y += effect.vy * dt;
        effect.vy += (effect.gravity || 0) * dt;
        effect.angle += (effect.spin || 0) * dt;
      } else if (effect.type !== "shockwave") {
        effect.y -= 26 * dt;
      }
      if (effect.life > 0) {
        this.state.effects[aliveEffectCount] = effect;
        aliveEffectCount += 1;
      }
    }
    this.state.effects.length = aliveEffectCount;
  }

  drawLaneFlow(x, laneWidth, height, laneIndex, flow, now) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.beginPath();
    ctx.rect(x, 0, laneWidth, height);
    ctx.clip();

    ctx.fillStyle = flow.shade;
    ctx.fillRect(x, 0, laneWidth, height);

    const t = now * 0.001;
    const transparent = "rgba(255, 255, 255, 0)";
    const steps = LANE_FLOW_STEPS;

    // 注意: ここで ctx.filter = "blur(...)" は使わないこと。
    // iOS Safari では Canvas filter が極端に重く、リークの報告もある（発熱・進行性劣化の原因になる）。
    for (const ribbon of LANE_FLOW_RIBBONS) {
      const color = flow[ribbon.colorKey];
      const seed = ribbon.seedBase + laneIndex * ribbon.seedStep;
      const band = height * ribbon.thickness;
      const travel = height + band * 2;
      const waveAmp = band * ribbon.sway;
      ctx.fillStyle = color;
      for (const shift of [0, travel / 2]) {
        const baseY = ((t * ribbon.speed + seed + shift) % travel) - band;
        const wavePhase = t * 0.7 + seed + shift * 0.013;
        ctx.beginPath();
        for (let s = 0; s <= steps; s += 1) {
          const px = x + (laneWidth * s) / steps;
          const py = baseY + Math.sin((s / steps) * Math.PI * ribbon.freq + wavePhase) * waveAmp;
          if (s === 0) {
            ctx.moveTo(px, py);
          } else {
            ctx.lineTo(px, py);
          }
        }
        for (let s = steps; s >= 0; s -= 1) {
          const px = x + (laneWidth * s) / steps;
          const py = baseY + band + Math.sin((s / steps) * Math.PI * ribbon.freq + wavePhase + 1.7) * waveAmp;
          ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
      }
    }

    const gx = x + laneWidth * (0.5 + Math.sin(t * 0.33 + laneIndex * 1.9) * 0.42);
    const gy = height * (0.5 + Math.cos(t * 0.26 + laneIndex * 1.3) * 0.44);
    const gr = Math.max(laneWidth * 0.9, height * 0.4);
    const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    glow.addColorStop(0, flow.coolStrong);
    glow.addColorStop(0.5, flow.warmSoft);
    glow.addColorStop(1, transparent);
    ctx.fillStyle = glow;
    ctx.fillRect(x, 0, laneWidth, height);

    // 縦グラデ(veil)は縦方向のみで x に依存しない（垂直グラデはy座標だけで色が決まる）ため、
    // サイズ・テーマが変わらない限り1つを使い回し、全レーン・全フレームで共有する。
    const veilKey = `${Math.round(height)}|${flow.finish}`;
    if (this.veilGradientKey !== veilKey) {
      const veil = ctx.createLinearGradient(0, 0, 0, height);
      veil.addColorStop(0, flow.finish);
      veil.addColorStop(0.52, transparent);
      veil.addColorStop(1, flow.finish);
      this.veilGradient = veil;
      this.veilGradientKey = veilKey;
    }
    ctx.fillStyle = this.veilGradient;
    ctx.fillRect(x, 0, laneWidth, height);

    ctx.restore();
  }

  drawBoard() {
    const size = this.canvasSize();
    const colors = this.colors;
    const canvasBg = colors.canvasBg;
    const laneBgA = colors.laneBgA;
    const laneBgB = colors.laneBgB;
    const laneLine = colors.laneLine;
    const missLine = colors.missLine;
    const boardLabel = colors.boardLabel;
    const edgeLine = colors.edgeLine;
    const flow = colors.flow;
    this.ctx.clearRect(0, 0, size.width, size.height);
    this.ctx.fillStyle = canvasBg;
    this.ctx.fillRect(0, 0, size.width, size.height);

    const lanes = this.activeLaneCount();
    const laneWidth = size.width / lanes;
    const now = performance.now();
    // レーンで変わらない値はループ外で一度だけ算出する（毎レーン再計算を避ける）。
    const guideLineY = this.guideLineY(size);
    const guideThickness = laneWidth < 140 ? 3 : 4;
    const guideY = guideLineY - guideThickness / 2;
    const guideWidth = laneWidth - 24;
    for (let i = 0; i < lanes; i += 1) {
      const x = i * laneWidth;
      this.ctx.fillStyle = i % 2 === 0 ? laneBgA : laneBgB;
      this.ctx.fillRect(x, 0, laneWidth, size.height);
      this.drawLaneFlow(x, laneWidth, size.height, i, flow, now);

      this.ctx.strokeStyle = laneLine;
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, size.height);
      this.ctx.stroke();

      this.ctx.fillStyle = missLine;
      this.ctx.fillRect(x + 12, guideY, guideWidth, guideThickness);
    }

    this.ctx.fillStyle = boardLabel;
    this.ctx.font = "800 12px system-ui, sans-serif";
    this.ctx.textAlign = "left";
    for (let i = 0; i < lanes; i += 1) {
      this.ctx.fillText(`LANE ${i + 1}`, i * laneWidth + 16, 24);
    }

    this.ctx.strokeStyle = edgeLine;
    this.ctx.beginPath();
    this.ctx.moveTo(size.width - 1, 0);
    this.ctx.lineTo(size.width - 1, size.height);
    this.ctx.stroke();

    this.drawWords(laneWidth, lanes, this.activeGameMode());
    this.drawEffects(laneWidth);
  }

  setCanvasFont(size) {
    this.ctx.font = `950 ${size}px system-ui, sans-serif`;
  }

  measuredWidth(text) {
    return this.ctx.measureText(text).width;
  }

  truncateCanvasText(text, maxWidth) {
    const marker = "...";
    if (this.measuredWidth(text) <= maxWidth) {
      return text;
    }
    let trimmed = "";
    for (const char of Array.from(text)) {
      const next = trimmed + char;
      if (this.measuredWidth(next + marker) > maxWidth) {
        break;
      }
      trimmed = next;
    }
    return trimmed ? trimmed + marker : marker;
  }

  layoutCanvasSingleLine(text, maxWidth, maxHeight, baseSize, minSize = 12) {
    const clean = String(text).trim().replace(/\s+/g, " ");
    const roundedBase = Math.round(baseSize);
    for (let size = roundedBase; size >= minSize; size -= 1) {
      this.setCanvasFont(size);
      const lineHeight = Math.max(12, Math.round(size * 1.06));
      if (this.measuredWidth(clean) <= maxWidth + 0.5 && lineHeight <= maxHeight) {
        return { size, lineHeight, lines: [clean] };
      }
    }

    this.setCanvasFont(minSize);
    return {
      size: minSize,
      lineHeight: Math.max(12, Math.round(minSize * 1.06)),
      lines: [this.truncateCanvasText(clean, maxWidth)]
    };
  }

  wrapContinuousText(text, maxWidth, maxLines) {
    const lines = [];
    let current = "";
    for (const char of Array.from(text)) {
      const candidate = current + char;
      if (current && this.measuredWidth(candidate) > maxWidth) {
        lines.push(current.trim());
        current = char.trimStart();
        if (lines.length >= maxLines) {
          return null;
        }
      } else {
        current = candidate;
      }
    }
    if (current.trim()) {
      lines.push(current.trim());
    }
    return lines.length <= maxLines ? lines : null;
  }

  wrapCanvasText(text, maxWidth, maxLines) {
    const clean = String(text).trim().replace(/\s+/g, " ");
    if (!clean) {
      return [""];
    }

    const words = clean.split(" ");
    if (words.length === 1) {
      return this.wrapContinuousText(clean, maxWidth, maxLines);
    }

    const lines = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (this.measuredWidth(candidate) <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current) {
        lines.push(current);
        current = "";
        if (lines.length >= maxLines) {
          return null;
        }
      }

      if (this.measuredWidth(word) <= maxWidth) {
        current = word;
        continue;
      }

      const chunks = this.wrapContinuousText(word, maxWidth, maxLines - lines.length);
      if (!chunks) {
        return null;
      }
      for (let i = 0; i < chunks.length - 1; i += 1) {
        lines.push(chunks[i]);
        if (lines.length >= maxLines) {
          return null;
        }
      }
      current = chunks[chunks.length - 1] || "";
    }

    if (current) {
      lines.push(current);
    }
    return lines.length <= maxLines ? lines : null;
  }

  layoutCanvasText(text, maxWidth, maxHeight, baseSize, maxLines, minSize = 11) {
    const roundedBase = Math.round(baseSize);
    for (let size = roundedBase; size >= minSize; size -= 1) {
      this.setCanvasFont(size);
      const lineHeight = Math.max(12, Math.round(size * 1.06));
      const lines = this.wrapCanvasText(text, maxWidth, maxLines);
      if (!lines) {
        continue;
      }
      const totalHeight = lineHeight * lines.length;
      const fitsWidth = lines.every((line) => this.measuredWidth(line) <= maxWidth + 0.5);
      if (fitsWidth && totalHeight <= maxHeight) {
        return { size, lineHeight, lines };
      }
    }

    this.setCanvasFont(minSize);
    const fallback = this.wrapCanvasText(text, maxWidth, maxLines)
      || this.wrapContinuousText(String(text).trim().replace(/\s+/g, " "), maxWidth, maxLines)
      || [String(text)];
    return {
      size: minSize,
      lineHeight: Math.max(12, Math.round(minSize * 1.06)),
      lines: fallback.slice(0, maxLines).map((line) => this.truncateCanvasText(line, maxWidth))
    };
  }

  roundRect(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    this.ctx.beginPath();
    this.ctx.moveTo(x + r, y);
    this.ctx.lineTo(x + width - r, y);
    this.ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    this.ctx.lineTo(x + width, y + height - r);
    this.ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    this.ctx.lineTo(x + r, y + height);
    this.ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    this.ctx.lineTo(x, y + r);
    this.ctx.quadraticCurveTo(x, y, x + r, y);
    this.ctx.closePath();
  }

  drawWords(laneWidth, lanes = this.activeLaneCount(), mode = this.activeGameMode()) {
    const colors = this.colors;
    const cardText = colors.cardText;
    const cardBgTop = colors.cardBgTop;
    const cardBgBottom = colors.cardBgBottom;
    const cardBorder = colors.cardBorder;
    const cardHighlight = colors.cardHighlight;
    const cardShadow = colors.cardShadow;
    const green = colors.green;
    const red = colors.red;
    const gold = colors.gold;
    for (const lane of this.state.lanes) {
      if (!lane) {
        continue;
      }
      const card = this.cardMetrics(lane, laneWidth);
      const fadeInT = Math.max(0, Math.min(1, lane.age / CARD_FADE_IN_TIME));
      const fadeInAlpha = 1 - (1 - fadeInT) ** 3;
      const fadeOutAlpha = lane.fadeDuration ? Math.max(0, Math.min(1, lane.fadeOut / lane.fadeDuration)) : 1;
      const modeFadeAlpha = mode.cardMotion === "fade" && !lane.locked && lane.cardTimeLimit
        ? clamp01((lane.cardTimeLeft / lane.cardTimeLimit - (1 - FADE_MODE_VISIBLE_RATIO)) / FADE_MODE_VISIBLE_RATIO)
        : 1;
      const alpha = fadeInAlpha * fadeOutAlpha * modeFadeAlpha;
      if (alpha <= 0.01) {
        continue;
      }
      const fadeOutProgress = 1 - fadeOutAlpha;
      let scale = 0.93 + 0.07 * fadeInAlpha;
      let drift = (1 - fadeInAlpha) * -6;
      if (lane.fadeKind === "correct") {
        scale *= 1 + 0.09 * fadeOutProgress;
        drift = fadeOutProgress * -10;
      } else if (lane.fadeKind === "wrong") {
        scale *= 1 - 0.05 * fadeOutProgress;
        drift = fadeOutProgress * -4;
      } else if (lane.fadeKind === "miss") {
        scale *= 1 - 0.06 * fadeOutProgress;
        drift = fadeOutProgress * 8;
      }
      const cardWidth = card.width * scale;
      const cardHeight = card.height * scale;
      const x = card.x + (card.width - cardWidth) / 2;
      const y = card.y + drift + (card.height - cardHeight) / 2;
      const pulse = lane.flash === "correct" && lane.flashTime > 0 ? 1 : 0;
      const spawning = fadeInT < 1;
      const borderColor = pulse || lane.fadeKind === "correct" ? green
        : lane.fadeKind === "wrong" ? red
          : lane.fadeKind === "miss" ? gold
            : cardBorder;
      const glow = pulse || lane.fadeKind === "correct" ? "rgba(143, 195, 93, 0.5)"
        : lane.fadeKind === "wrong" ? "rgba(223, 101, 87, 0.44)"
          : spawning ? "rgba(97, 191, 209, 0.42)"
            : "rgba(97, 191, 209, 0.2)";
      const alphaCardBgTop = colorWithAlpha(cardBgTop, alpha);
      const alphaCardBgBottom = colorWithAlpha(cardBgBottom, alpha);
      const alphaCardBorder = colorWithAlpha(borderColor, alpha);
      const alphaCardHighlight = colorWithAlpha(cardHighlight, alpha);
      const alphaCardShadow = colorWithAlpha(cardShadow, alpha);
      const alphaGlow = colorWithAlpha(glow, alpha);
      const alphaCardText = colorWithAlpha(cardText, alpha);
      const radius = 10;

      this.ctx.save();
      this.ctx.globalAlpha = 1;
      this.ctx.shadowColor = alphaCardShadow;
      this.ctx.shadowBlur = 14 * alpha;
      this.ctx.shadowOffsetY = 5;
      this.roundRect(x, y, cardWidth, cardHeight, radius);
      const bg = this.ctx.createLinearGradient(x, y, x, y + cardHeight);
      bg.addColorStop(0, alphaCardBgTop);
      bg.addColorStop(1, alphaCardBgBottom);
      this.ctx.fillStyle = bg;
      this.ctx.fill();
      this.ctx.shadowOffsetY = 0;
      this.ctx.shadowColor = alphaGlow;
      this.ctx.shadowBlur = (pulse || lane.fadeKind || spawning ? 20 : 14) * alpha;
      this.ctx.strokeStyle = alphaCardBorder;
      this.ctx.lineWidth = pulse || lane.fadeKind ? 2.2 : 1.6;
      this.ctx.stroke();
      this.ctx.shadowBlur = 0;
      this.ctx.strokeStyle = alphaCardHighlight;
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(x + radius, y + 1.5);
      this.ctx.lineTo(x + cardWidth - radius, y + 1.5);
      this.ctx.stroke();

      // テキストレイアウト（measureTextのループ）は高コストなので、
      // 文言と基準カード幅が変わらない限りレーン単位でキャッシュする。
      // フェード中の拡大縮小は描画時のフォントサイズだけに反映し、再レイアウトを避ける。
      // 文字列（正規化した文言・キー）も毎フレーム生成しないよう lane に一度だけ保持する。
      if (lane.cleanPrompt === undefined) {
        lane.cleanPrompt = this.promptTextFor(lane.word).replace(/\s+/g, " ");
      }
      const cleanPrompt = lane.cleanPrompt;
      const roundW = Math.round(card.width);
      const roundH = Math.round(card.height);
      if (!lane.textLayout || lane.textLayoutW !== roundW || lane.textLayoutH !== roundH || lane.textLayoutLanes !== lanes) {
        const textMaxWidth = card.width - (laneWidth < 130 ? 12 : 24);
        const maxLines = card.width < 118 ? 3 : 2;
        const maxFont = lanes === 1 ? 46 : lanes === 2 ? 40 : 35;
        const minBaseFont = lanes === 1 ? 30 : lanes === 2 ? 27 : 24;
        const baseFont = Math.max(minBaseFont, Math.min(maxFont, card.width * 0.34));
        const minFont = lanes === 1 ? 18 : lanes === 2 ? 16 : 14;
        const visibleCharacters = Array.from(cleanPrompt.replace(/\s+/g, "")).length;
        lane.textLayout = visibleCharacters <= 15
          ? this.layoutCanvasSingleLine(cleanPrompt, textMaxWidth, card.height - 18, baseFont, Math.max(12, minFont - 2))
          : this.layoutCanvasText(cleanPrompt, textMaxWidth, card.height - 18, baseFont, maxLines, minFont);
        lane.textLayoutW = roundW;
        lane.textLayoutH = roundH;
        lane.textLayoutLanes = lanes;
      }
      const textLayout = lane.textLayout;
      this.ctx.fillStyle = alphaCardText;
      const textSize = Math.max(10, Math.round(textLayout.size * scale));
      const lineHeight = textLayout.lineHeight * scale;
      this.setCanvasFont(textSize);
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";
      const textTop = y + cardHeight / 2 - (lineHeight * textLayout.lines.length) / 2;
      for (let i = 0; i < textLayout.lines.length; i += 1) {
        this.ctx.fillText(textLayout.lines[i], x + cardWidth / 2, textTop + lineHeight * (i + 0.5) + 1);
      }
      this.ctx.restore();
    }
  }

  drawEffects(laneWidth) {
    const revealBg = this.colors.revealBg;
    const gold = this.colors.gold;
    for (const effect of this.state.effects) {
      const alpha = Math.max(0, Math.min(1, effect.life / (effect.maxLife || 0.7)));
      this.ctx.save();
      this.ctx.globalAlpha = alpha;
      if (effect.type === "particle") {
        const radius = effect.radius || 3;
        this.ctx.translate(effect.x, effect.y);
        this.ctx.rotate(effect.angle || 0);
        this.ctx.fillStyle = effect.color;
        this.ctx.strokeStyle = effect.color;
        this.ctx.shadowColor = effect.color;
        this.ctx.shadowBlur = (effect.shape === "spark" ? 12 : 8) * alpha;
        if (effect.shape === "spark") {
          this.ctx.lineWidth = Math.max(1.1, radius * 0.48);
          this.ctx.beginPath();
          this.ctx.moveTo(-radius * 2.4, 0);
          this.ctx.lineTo(radius * 2.4, 0);
          this.ctx.moveTo(0, -radius * 1.25);
          this.ctx.lineTo(0, radius * 1.25);
          this.ctx.stroke();
        } else if (effect.shape === "diamond" || effect.shape === "shard") {
          const stretch = effect.shape === "shard" ? 2.2 : 1.35;
          this.ctx.beginPath();
          this.ctx.moveTo(0, -radius * stretch);
          this.ctx.lineTo(radius * 0.95, 0);
          this.ctx.lineTo(0, radius * stretch);
          this.ctx.lineTo(-radius * 0.95, 0);
          this.ctx.closePath();
          this.ctx.fill();
        } else if (effect.shape === "ring") {
          this.ctx.lineWidth = Math.max(1, radius * 0.42);
          this.ctx.beginPath();
          this.ctx.arc(0, 0, radius * 1.7, 0, Math.PI * 2);
          this.ctx.stroke();
        } else {
          this.ctx.beginPath();
          this.ctx.arc(0, 0, radius, 0, Math.PI * 2);
          this.ctx.fill();
        }
      } else if (effect.type === "shockwave") {
        const progress = 1 - alpha;
        const radius = (effect.radius || 18) + progress * (effect.growth || 60);
        this.ctx.globalAlpha = alpha * 0.85;
        this.ctx.strokeStyle = effect.color;
        this.ctx.lineWidth = Math.max(1, 3.2 * alpha);
        this.ctx.shadowColor = effect.color;
        this.ctx.shadowBlur = 10 * alpha;
        this.ctx.beginPath();
        this.ctx.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
        this.ctx.stroke();
      } else if (effect.type === "reveal") {
        const laneCenter = effect.lane * laneWidth + laneWidth / 2;
        const progress = 1 - alpha;
        const scale = 0.88 + Math.sin(Math.min(1, progress * 1.2) * Math.PI) * 0.38;
        const lanes = this.activeLaneCount();
        const baseCardWidth = Math.min(laneWidth - 14, lanes === 1 ? 460 : lanes === 2 ? 390 : 340);
        const baseCardHeight = lanes === 1 ? 112 : lanes === 2 ? 100 : 92;
        const cardWidth = baseCardWidth * scale;
        const cardHeight = baseCardHeight * scale;
        const x = laneCenter - cardWidth / 2;
        const y = effect.y - cardHeight / 2;

        this.ctx.shadowColor = "rgba(240, 206, 108, 0.58)";
        this.ctx.shadowBlur = 22 * alpha;
        this.roundRect(x, y, cardWidth, cardHeight, 10);
        this.ctx.fillStyle = revealBg;
        this.ctx.fill();
        this.ctx.shadowBlur = 0;
        this.ctx.strokeStyle = effect.color;
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        this.ctx.fillStyle = gold;
        const maxLines = baseCardWidth * 0.88 < 150 ? 3 : 2;
        // レイアウトはeffect単位でキャッシュ。テキストは不変なので寸法・行数の数値比較だけで判定し、
        // 毎フレームのキー文字列生成を避ける（カード描画と同じ方式）。
        const revealW = Math.round(baseCardWidth);
        const revealH = Math.round(baseCardHeight);
        if (!effect.textLayout || effect.textLayoutW !== revealW || effect.textLayoutH !== revealH || effect.textLayoutLines !== maxLines) {
          effect.textLayout = this.layoutCanvasText(effect.text, baseCardWidth - 20, baseCardHeight - 18, 44, maxLines, 12);
          effect.textLayoutW = revealW;
          effect.textLayoutH = revealH;
          effect.textLayoutLines = maxLines;
        }
        const textLayout = effect.textLayout;
        const textSize = Math.max(12, Math.round(textLayout.size * scale));
        const lineHeight = textLayout.lineHeight * scale;
        this.setCanvasFont(textSize);
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        const textTop = effect.y - (lineHeight * textLayout.lines.length) / 2;
        for (let i = 0; i < textLayout.lines.length; i += 1) {
          this.ctx.fillText(textLayout.lines[i], laneCenter, textTop + lineHeight * (i + 0.5) + 1);
        }
      } else {
        const laneCenter = effect.lane * laneWidth + laneWidth / 2;
        this.ctx.fillStyle = effect.color;
        this.ctx.font = "italic 900 22px 'Exo 2', system-ui, sans-serif";
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        this.ctx.shadowColor = effect.color;
        this.ctx.shadowBlur = 8 * alpha;
        this.ctx.fillText(effect.text, laneCenter, effect.y);
      }
      this.ctx.restore();
    }
  }

  showTitleOverlay() {
    this.updateTitleDetails();
    this.syncSettingsInputs();
    this.showOverlay(APP_TITLE, "", "Start", {
      showTitleDetails: true,
      showBack: false,
      obscureBoard: true,
      titleMode: true
    });
  }

  showResultOverlay(options = {}) {
    this.updateTitleDetails();
    this.syncSettingsInputs();
    this.showOverlay("Result", "", "Restart", {
      showBack: false,
      showTitleDetails: false,
      obscureBoard: true,
      resultMode: true,
      fadeIn: Boolean(options.fadeIn)
    });
    this.renderReviewList();
  }

  showOverlay(title, copy, buttonText, options = {}) {
    this.ui.overlayTitle.textContent = title;
    this.ui.overlayCopy.textContent = copy;
    this.ui.reviewList.innerHTML = "";
    this.ui.startButton.textContent = buttonText;
    this.ui.titleDetails.classList.toggle("hidden", !options.showTitleDetails);
    this.ui.overlayBackButton.classList.toggle("hidden", !options.showBack);
    this.ui.resultCloseButton?.classList.toggle("hidden", !options.resultMode);
    this.ui.gameShell.classList.toggle("is-obscured", Boolean(options.obscureBoard));
    this.ui.overlay.classList.toggle("result-mode", Boolean(options.resultMode));
    this.ui.overlay.classList.toggle("title-mode", Boolean(options.titleMode));
    this.ui.overlay.classList.toggle("pause-mode", Boolean(options.pauseMode));
    this.ui.overlay.classList.toggle("loading-mode", Boolean(options.loadingMode));
    document.body.classList.toggle("is-result-overlay", Boolean(options.resultMode));
    this.ui.overlay.classList.remove("fade-in");
    if (options.fadeIn) {
      this.ui.overlay.offsetHeight;
      this.ui.overlay.classList.add("fade-in");
    }
    this.ui.overlay.classList.add("show");
  }

  hideOverlay() {
    this.ui.overlay.classList.remove("show");
    this.ui.overlay.classList.remove("fade-in", "result-mode", "title-mode", "pause-mode", "loading-mode");
    this.ui.resultCloseButton?.classList.add("hidden");
    this.ui.gameShell.classList.remove("is-obscured");
    document.body.classList.remove("is-result-overlay");
  }

  accuracy() {
    const total = this.state.correct + this.state.wrong + this.state.miss;
    return total ? Math.round((this.state.correct / total) * 100) : 0;
  }

  // 値が変わったときだけ textContent を書き込む（不要なレイアウト更新を避ける）。
  setText(element, text) {
    if (element && element.textContent !== text) {
      element.textContent = text;
    }
  }

  // 毎フレーム変化しうる HUD の数値だけを更新する軽量パス。gameLoop から呼ぶ。
  updateHud() {
    const countdown = this.state.phase === "playing" && this.state.timeLeft > 0 && this.state.timeLeft <= 3
      ? String(Math.ceil(this.state.timeLeft))
      : "";
    if (this.ui.countdownGhost) {
      this.setText(this.ui.countdownGhost, countdown);
      this.ui.countdownGhost.classList.toggle("hidden", !countdown);
    }
    this.setText(this.ui.time, String(Math.ceil(Math.max(0, this.state.timeLeft))).padStart(2, "0"));
    this.setText(this.ui.elapsed, this.formatPlayTime(this.state.elapsed));
    this.ui.timeBar.style.setProperty(
      "--time-progress",
      `${Math.max(0, Math.min(100, (this.state.timeLeft / RUN_TIME) * 100))}%`
    );
    this.setStatText(this.ui.score, this.formatNumber(this.state.score));
    this.setStatText(this.ui.best, this.formatNumber(Math.max(this.state.best, this.state.score)));
    this.setStatText(this.ui.streak, this.formatNumber(this.state.streak));
    this.setStatText(this.ui.correct, this.formatNumber(this.state.correct));
    this.setStatText(this.ui.wrong, this.formatNumber(this.state.wrong));
    this.setStatText(this.ui.miss, this.formatNumber(this.state.miss));
    this.setStatText(this.ui.accuracy, `${this.accuracy()}%`);
    this.setText(this.ui.wordCount, this.formatNumber(this.state.words.length));
    const learningCounts = this.learningCounts();
    this.setText(this.ui.learnedCount, this.formatNumber(learningCounts.learned));
    this.setText(this.ui.unlearnedCount, this.formatNumber(learningCounts.unlearned));
  }

  updateUi() {
    const isBusy = this.state.phase === "loading";
    const isError = this.state.phase === "error";
    document.body.dataset.lanes = String(this.activeLaneCount());
    document.body.dataset.mode = this.normalizeGameModeId(this.state.gameModeId);
    document.body.classList.toggle("is-game-paused", this.state.phase === "paused");
    document.body.classList.toggle("is-game-resting", this.state.phase !== "playing" && this.state.phase !== "loading");
    this.ui.answers.style.setProperty("--lane-count", String(this.activeLaneCount()));
    this.ui.gameShell.classList.toggle("is-loading", isBusy);
    this.ui.loadingVeil?.classList.toggle("hidden", !isBusy);
    this.setText(this.ui.phase, this.state.phase === "playing"
      ? "Running"
      : this.state.phase === "paused"
        ? "Paused"
        : this.state.phase === "over"
          ? "Done"
          : isBusy
            ? "Loading"
            : isError
              ? "Error"
              : "Ready");
    this.ui.laneCount.value = String(this.activeLaneCount());
    this.updateHud();

    const isPlaying = this.state.phase === "playing";
    const isLookupOpen = Boolean(this.state.lookupOpen);
    const isResetConfirmOpen = Boolean(this.state.resetConfirmOpen);
    const isReturnConfirmOpen = Boolean(this.state.returnConfirmOpen);
    const isWordListOpen = Boolean(this.state.wordListOpen);
    const isHelpOpen = Boolean(this.state.helpOpen);
    const isModalOpen = isLookupOpen || isResetConfirmOpen || isReturnConfirmOpen || isWordListOpen || isHelpOpen;
    if (isModalOpen && this.state.soundPanelOpen) {
      this.setSoundPanelOpen(false);
    }
    const canPause = this.state.phase === "playing" || this.state.phase === "paused";
    this.ui.pauseButton.disabled = !canPause || isModalOpen;
    this.ui.pauseButton.title = this.state.phase === "paused" ? "再開" : "一時停止";
    this.ui.pauseButton.setAttribute("aria-label", this.ui.pauseButton.title);
    this.ui.pauseIcon.classList.toggle("hidden", this.state.phase === "paused");
    this.ui.playIcon.classList.toggle("hidden", this.state.phase !== "paused");
    const audioOn = this.state.settings.wordAudioEnabled || this.state.settings.bgmEnabled || this.state.settings.sfxEnabled;
    this.ui.soundButton.disabled = isModalOpen;
    this.ui.soundButton.title = "音設定";
    this.ui.soundButton.setAttribute("aria-label", this.ui.soundButton.title);
    this.ui.soundOnIcon.classList.toggle("hidden", !audioOn);
    this.ui.soundOffIcon.classList.toggle("hidden", audioOn);
    this.updateBgmPreviewUi();
    this.ui.themeLightIcon?.classList.toggle("hidden", this.state.theme === "light");
    this.ui.themeDarkIcon?.classList.toggle("hidden", this.state.theme !== "light");
    if (this.ui.themeButton) {
      this.ui.themeButton.disabled = isModalOpen;
    }
    if (this.ui.titleHelpButton) {
      this.ui.titleHelpButton.classList.toggle("hidden", this.state.phase !== "ready");
      this.ui.titleHelpButton.disabled = isBusy || isModalOpen;
    }
    this.ui.level.disabled = this.state.phase === "playing" || this.state.phase === "paused" || isBusy || isModalOpen;
    this.ui.levelButton.disabled = this.ui.level.disabled;
    this.ui.laneCount.disabled = this.state.phase === "playing" || this.state.phase === "paused" || isBusy || isModalOpen;
    for (const input of this.ui.quizDirectionInputs || []) {
      input.disabled = this.state.phase === "playing" || this.state.phase === "paused" || isBusy || isModalOpen;
    }
    for (const input of this.ui.gameModeInputs || []) {
      input.disabled = this.state.phase === "playing" || this.state.phase === "paused" || isBusy || isModalOpen;
    }
    if (this.ui.survival) {
      this.ui.survival.disabled = this.state.phase === "playing" || this.state.phase === "paused" || isBusy || isModalOpen;
      this.ui.survival.checked = Boolean(this.state.survivalEnabled);
    }
    if (this.ui.resetLevelStats) {
      this.ui.resetLevelStats.disabled = isBusy || !this.state.words.length || this.state.phase === "playing" || this.state.phase === "paused" || isModalOpen;
    }
    if (this.ui.wordListButton) {
      this.ui.wordListButton.disabled = isBusy || !this.state.words.length || this.state.phase === "playing" || this.state.phase === "paused" || isModalOpen;
    }
    this.syncQuizDirectionInputs();
    this.syncGameModeInputs();
    this.ui.backButton.disabled = isBusy || this.state.phase === "ready" || this.state.phase === "over" || isModalOpen;
    this.ui.startButton.disabled = isBusy || isError || !this.state.words.length || isModalOpen;
    this.updateTitleDetails();
    this.syncNetworkToast();
  }

  // プレイ中だけ描画ループを回す。二重起動しないようフラグで管理する。
  startRenderLoop() {
    if (this.isLooping) {
      return;
    }
    this.isLooping = true;
    this.state.lastTime = performance.now();
    this.rafId = requestAnimationFrame((time) => this.gameLoop(time));
  }

  stopRenderLoop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = 0;
    this.isLooping = false;
  }

  gameLoop(now) {
    const dt = Math.min(0.08, (now - this.state.lastTime) / 1000 || 0);
    this.state.lastTime = now;
    this.updateGame(dt);
    this.drawBoard();
    // プレイ中はHUDの数値だけ軽量更新。全体の updateUi は状態遷移時に呼ぶ。
    if (this.state.phase === "playing") {
      this.updateHud();
      this.rafId = requestAnimationFrame((time) => this.gameLoop(time));
    } else {
      // プレイが終わった（一時停止/終了/タイトルへ）ら最後のフレームを描いてループを止める。
      this.stopRenderLoop();
    }
  }

  laneKeys() {
    return LANE_KEY_LAYOUTS[this.activeLaneCount()] || LANE_KEY_LAYOUTS[MAX_LANES];
  }

  keyToLane(key) {
    const laneKeys = this.laneKeys();
    for (let lane = 0; lane < this.activeLaneCount(); lane += 1) {
      const option = laneKeys[lane].indexOf(key);
      if (option >= 0) {
        return { lane, option };
      }
    }
    return null;
  }

  isTypingTarget(target) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    return target.isContentEditable
      || target.matches("input, select, textarea");
  }

  pauseForHiddenPage() {
    this.flushWordStats();
    if (this.state.phase === "playing") {
      this.pauseGame();
      return;
    }
    this.stopRenderLoop();
    this.clearSpawnTimers();
    this.audio.stopBgm();
    this.audio.stopBgmPreview();
    this.audio.stopWordAudio();
    this.audio.releaseWordAudioPool();
    this.hideNetworkToast({ clear: true });
    this.clearReviewTooltipPress();
    this.clearAnswerFocus();
  }

  attachEvents() {
    this.ui.startButton.addEventListener("click", () => {
      if (this.state.phase === "paused") {
        this.pauseGame();
      } else {
        this.startGame();
      }
    });
    this.ui.overlayBackButton.addEventListener("click", () => this.returnToTitle());
    this.ui.resultCloseButton?.addEventListener("click", () => this.returnToTitle());
    this.ui.titleHelpButton?.addEventListener("click", () => this.openHelpModal());
    this.ui.backButton.addEventListener("click", () => this.requestReturnToTitle());
    this.ui.levelButton.addEventListener("click", () => this.toggleLevelMenu());
    this.ui.wordListButton?.addEventListener("click", () => this.openWordListModal());
    this.ui.soundButton.addEventListener("click", () => this.toggleSoundPanel());
    this.ui.soundPanelClose?.addEventListener("click", (event) => {
      event.stopPropagation();
      this.setSoundPanelOpen(false);
      this.ui.soundButton.focus();
    });
    this.ui.bgmPreview?.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggleBgmPreview();
    });
    this.ui.themeButton?.addEventListener("click", () => this.toggleTheme());
    this.ui.pauseButton.addEventListener("click", () => this.pauseGame());
    this.ui.resetLevelStats?.addEventListener("click", () => this.resetSelectedLevelStats());
    this.ui.resetCancel?.addEventListener("click", () => this.closeResetConfirmModal());
    this.ui.resetConfirm?.addEventListener("click", () => this.confirmResetSelectedLevelStats());
    this.ui.resetConfirmBackdrop?.addEventListener("click", () => this.closeResetConfirmModal());
    this.ui.returnContinue?.addEventListener("click", () => this.closeReturnConfirmModal());
    this.ui.returnConfirm?.addEventListener("click", () => this.confirmReturnToTitle());
    this.ui.returnConfirmBackdrop?.addEventListener("click", () => this.closeReturnConfirmModal());
    this.ui.wordListClose?.addEventListener("click", () => this.closeWordListModal());
    this.ui.wordListBackdrop?.addEventListener("click", () => this.closeWordListModal());
    this.ui.helpClose?.addEventListener("click", () => this.closeHelpModal());
    this.ui.helpBackdrop?.addEventListener("click", () => this.closeHelpModal());
    this.ui.lookupClose?.addEventListener("click", () => this.closeLookupModal());
    this.ui.lookupBackdrop?.addEventListener("click", () => this.closeLookupModal());
    for (const input of [
      this.ui.wordAudioEnabled,
      this.ui.wordAudioVolume,
      this.ui.bgmEnabled,
      this.ui.bgmVolume,
      this.ui.bgmTrack,
      this.ui.sfxEnabled,
      this.ui.sfxVolume
    ]) {
      input.addEventListener("input", () => this.applySettingsFromInputs());
      input.addEventListener("change", () => this.applySettingsFromInputs());
    }
    this.ui.level.addEventListener("change", () => {
      if (this.state.phase === "ready" || this.state.phase === "over" || this.state.phase === "error") {
        this.loadLevel(this.ui.level.value, { resultMode: this.state.phase === "over" });
      }
    });
    this.ui.laneCount.addEventListener("change", () => {
      if (this.state.phase === "ready" || this.state.phase === "over") {
        const stayOnResult = this.state.phase === "over";
        this.state.laneCount = this.clampLaneCount(this.ui.laneCount.value);
        this.savePreferences();
        this.state.best = this.readBest();
        this.state.effects = [];
        this.makeLanes();
        this.updateUi();
        this.renderAnswerButtons();
        this.drawBoard();
        if (stayOnResult) {
          this.showResultOverlay();
        } else {
          this.showTitleOverlay();
        }
      }
    });
    for (const input of this.ui.quizDirectionInputs || []) {
      input.addEventListener("change", () => {
        if (!input.checked || (this.state.phase !== "ready" && this.state.phase !== "over")) {
          this.syncQuizDirectionInputs();
          return;
        }
        const stayOnResult = this.state.phase === "over";
        this.state.quizDirection = this.normalizeQuizDirection(input.value);
        this.savePreferences();
        this.state.effects = [];
        this.makeLanes();
        this.updateUi();
        this.renderAnswerButtons();
        this.drawBoard();
        if (stayOnResult) {
          this.showResultOverlay();
        } else {
          this.showTitleOverlay();
        }
      });
    }
    for (const input of this.ui.gameModeInputs || []) {
      input.addEventListener("change", () => {
        if (!input.checked || (this.state.phase !== "ready" && this.state.phase !== "over")) {
          this.syncGameModeInputs();
          return;
        }
        const stayOnResult = this.state.phase === "over";
        this.state.gameModeId = this.normalizeGameModeId(input.value);
        this.savePreferences();
        this.state.best = this.readBest();
        this.state.effects = [];
        this.makeLanes();
        this.updateUi();
        this.renderAnswerButtons();
        this.drawBoard();
        if (stayOnResult) {
          this.showResultOverlay();
        } else {
          this.showTitleOverlay();
        }
      });
    }
    this.ui.survival?.addEventListener("change", () => {
      if (this.state.phase !== "ready" && this.state.phase !== "over") {
        this.ui.survival.checked = Boolean(this.state.survivalEnabled);
        return;
      }
      this.state.survivalEnabled = this.selectedSurvivalEnabled();
      this.savePreferences();
      this.updateUi();
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".level-picker") && !event.target.closest("#levelMenu")) {
        this.setLevelMenuOpen(false);
      }
      if (!event.target.closest(".sound-control")) {
        this.setSoundPanelOpen(false);
      }
      if (!event.target.closest(".review-item") && !event.target.closest(".review-tooltip")) {
        this.hideReviewTooltip();
      }
    });
    window.addEventListener("resize", () => {
      this.resizeCanvas();
      this.positionLevelMenu();
      this.fitAnswerTextElements();
      this.fitAllStatRows();
      this.hideReviewTooltip();
      this.drawBoard();
    });
    this.ui.overlayScroll.addEventListener("scroll", () => {
      this.positionLevelMenu();
      this.hideReviewTooltip();
    });
    this.ui.wordListTable?.addEventListener("scroll", () => this.hideReviewTooltip());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        this.pauseForHiddenPage();
      }
    });
    window.addEventListener("pagehide", () => this.pauseForHiddenPage());
    window.addEventListener("keydown", (event) => {
      const key = event.key.toLowerCase();
      if (this.state.lookupOpen) {
        if (key === "escape") {
          event.preventDefault();
          this.closeLookupModal();
        }
        return;
      }
      if (this.state.helpOpen) {
        if (key === "escape") {
          event.preventDefault();
          this.closeHelpModal();
        }
        return;
      }
      if (this.state.resetConfirmOpen) {
        if (key === "escape") {
          event.preventDefault();
          this.closeResetConfirmModal();
        }
        return;
      }
      if (this.state.returnConfirmOpen) {
        if (key === "escape") {
          event.preventDefault();
          this.closeReturnConfirmModal();
        }
        return;
      }
      if (this.state.wordListOpen) {
        if (key === "escape") {
          event.preventDefault();
          this.closeWordListModal();
        }
        return;
      }
      if (key === "escape" && (this.state.levelMenuOpen || this.state.soundPanelOpen)) {
        event.preventDefault();
        this.setLevelMenuOpen(false);
        this.setSoundPanelOpen(false);
        return;
      }
      if (this.isTypingTarget(event.target)) {
        return;
      }
      const mapped = this.keyToLane(key);
      if (mapped) {
        event.preventDefault();
        this.answer(mapped.lane, mapped.option);
        return;
      }
      if ((key === "enter" || key === " ") && (this.state.phase === "ready" || this.state.phase === "over")) {
        event.preventDefault();
        this.startGame();
        return;
      }
      if (key === "p" || key === "escape") {
        event.preventDefault();
        this.pauseGame();
      }
    });
  }
}
