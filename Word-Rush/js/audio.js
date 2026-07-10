// BGMベースを下げる: 旧スライダー15%相当が新スライダー50%で同等になる（0.72 * 0.15 / 0.50）。
const BGM_OUTPUT_SCALE = 0.216;
// 効果音ベースを上げる: 旧スライダー80%相当が新スライダー50%で同等になる（1.16 * 0.80 / 0.50）。
const SFX_OUTPUT_SCALE = 1.856;
const SFX_MAX_GAIN = 1.856;
// 既存の発音音量（効果音50%時）を、単語発音50%の基準にする。
const WORD_AUDIO_OUTPUT_SCALE = 1.08;
const WORD_AUDIO_ROOT = "assets/word-audio/en-us-edge-tts";
const WORD_AUDIO_POOL_LIMIT = 24;
// ネットワーク停滞時に再生待ちAudioが増え続けるのを防ぐ安全上限。
const WORD_AUDIO_ACTIVE_LIMIT = 8;
// 同一語が再生中に再度必要になったときの一時再生用Audio要素の再利用リング上限。
// プール本体と同様、new Audio() の churn を避けるため作り直さず使い回す。
const WORD_AUDIO_TRANSIENT_LIMIT = 4;
const WORD_AUDIO_PREFETCH_LIMIT = 8;
const WORD_AUDIO_LOAD_WARNING_MS = 1400;
const WORD_AUDIO_MANIFEST_TIMEOUT_MS = 3000;
const WORD_AUDIO_PLAY_TIMEOUT_MS = 6500;
const WORD_AUDIO_RETRY_COOLDOWN_MS = 30000;
const WORD_AUDIO_RETRY_COOLDOWN_MAX_MS = 120000;
const WORD_AUDIO_FAILURE_WINDOW_MS = 12000;
const WORD_AUDIO_FAILURE_THRESHOLD = 3;
const WORD_AUDIO_FAILURE_URL_LIMIT = 64;
const WORD_AUDIO_NETWORK_COOLDOWN_MS = 18000;
// ロードが「遅い」（エラーではないが時間がかかる）と検知したら、先読みを一定時間控える。
// 電波が悪いときに遅いロードを積み増して端末を圧迫するのを防ぐ（読み込みが復帰すれば自動で解除）。
const WORD_AUDIO_SLOW_BACKOFF_MS = 8000;
const WORD_AUDIO_SLOW_URL_LIMIT = 16;
// アイドル（非プレイ・無音）状態でAudioContextを止めるまでの猶予。
// BGMのフェードアウト（最長1800ms）が終わってから止めたいので余裕をもたせる。
const CONTEXT_SUSPEND_DELAY_MS = 2200;
// suspend予約時にBGMがまだ鳴っていた場合の再試行上限。
// 呼び出し側は必ず先にfade/stopするため通常は再試行しないが、異常時に
// 2.2秒毎の起床が無限に続かないよう回数を有界にする（5回 ≒ 最大11秒で打ち切り）。
const CONTEXT_SUSPEND_MAX_RETRIES = 5;
const WORD_AUDIO_IDLE_RELEASE_MS = 15000;

export class AudioEngine {
  constructor(getSettings, bgmTracks = []) {
    this.getSettings = getSettings;
    this.bgmTracks = bgmTracks;
    this.currentTrackId = "";
    this.bgmAudio = null;
    this.bgmAudioPool = new Map();
    this.bgmSources = new Map();
    this.previewTrackId = "";
    this.previewAudio = null;
    this.previewAudioPool = new Map();
    this.bgmGain = null;
    this.bgmFadeTimer = 0;
    this.bgmFadeFrame = 0;
    this.bgmFadeToken = 0;
    this.bgmFading = false;
    // 無音アイドル時にAudioContextをsuspendするための予約タイマー。
    this.contextSuspendTimer = 0;
    this.wordAudioRevision = "";
    this.wordAudioRevisionReady = null;
    this.wordAudioPool = new Map();
    this.wordAudioCurrent = null;
    this.wordAudioActive = new Set();
    this.wordAudioCleanup = new Map();
    this.wordAudioTransient = new WeakSet();
    this.wordAudioTransientActive = new Set();
    this.wordAudioTimers = new Set();
    this.wordAudioLoadMonitors = new Set();
    this.wordAudioQueueToken = 0;
    this.wordAudioStatusHandler = null;
    this.wordAudioFailures = new Map();
    this.wordAudioFailureTimes = [];
    this.wordAudioNetworkCooldownUntil = 0;
    // ロードが遅いあいだ先読みを控える期限（part2: 電波劣化時の積み増し抑制）。
    this.wordAudioSlowUntil = 0;
    this.wordAudioSlowUrls = new Set();
    // 一時再生用（クローン）Audio要素の再利用リング。再生終了後にここへ戻して使い回す。
    this.wordAudioTransientRing = [];
    // 結果/単語一覧など非プレイ画面で手動再生した単語音声プールを、無音アイドル後に解放する。
    this.wordAudioIdleReleaseTimer = 0;
    this.noiseBuffer = null;
    this.ctx = null;
    this.master = null;
    this.supported = Boolean(globalThis.AudioContext || globalThis.webkitAudioContext);
  }

  settings() {
    return this.getSettings?.() || {};
  }

  setWordAudioStatusHandler(handler) {
    this.wordAudioStatusHandler = typeof handler === "function" ? handler : null;
  }

  emitWordAudioStatus(status) {
    if (this.wordAudioStatusHandler) {
      this.wordAudioStatusHandler(status);
    }
  }

  clampVolume(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.max(0, Math.min(1, number));
  }

  bgmEnabled() {
    return this.settings().bgmEnabled !== false;
  }

  sfxEnabled() {
    return this.settings().sfxEnabled !== false;
  }

  wordAudioEnabled() {
    return this.settings().wordAudioEnabled !== false;
  }

  bgmVolume() {
    return Math.max(0, Math.min(1, this.clampVolume(this.settings().bgmVolume, 0.15) * BGM_OUTPUT_SCALE));
  }

  sfxVolume() {
    return Math.max(0, Math.min(SFX_MAX_GAIN, this.clampVolume(this.settings().sfxVolume, 0.7) * SFX_OUTPUT_SCALE));
  }

  wordAudioVolume() {
    return Math.max(0, Math.min(1, this.clampVolume(this.settings().wordAudioVolume, 0.5) * WORD_AUDIO_OUTPUT_SCALE));
  }

  setTracks(tracks) {
    this.bgmTracks = Array.isArray(tracks) ? tracks : [];
  }

  encodePathSegment(value) {
    return encodeURIComponent(String(value || "").trim());
  }

  wordAudioUrl(levelId, wordId) {
    const level = this.encodePathSegment(levelId);
    const id = this.encodePathSegment(wordId);
    if (!level || !id) {
      return "";
    }
    const version = this.wordAudioRevision ? `?v=${encodeURIComponent(this.wordAudioRevision)}` : "";
    return `${WORD_AUDIO_ROOT}/${level}/${id}.mp3${version}`;
  }

  // ページロード時に1回だけ呼ぶ。単語音声の再生・プリロードごとにmanifestを見に行かない。
  ensureWordAudioRevision() {
    if (this.wordAudioRevisionReady) {
      return this.wordAudioRevisionReady;
    }
    const controller = globalThis.AbortController ? new AbortController() : null;
    const timeout = controller
      ? setTimeout(() => controller.abort(), WORD_AUDIO_MANIFEST_TIMEOUT_MS)
      : 0;
    this.wordAudioRevisionReady = fetch("cache-manifest.json", {
      cache: "no-store",
      signal: controller?.signal
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("cache-manifest load failed");
        }
        return response.json();
      })
      .then((manifest) => {
        const group = Array.isArray(manifest.assetGroups)
          ? manifest.assetGroups.find((entry) => entry?.url === "assets/word-audio")
          : null;
        this.wordAudioRevision = String(group?.revision || manifest.version || "").trim();
        return this.wordAudioRevision;
      })
      .catch(() => {
        this.wordAudioRevision = "";
        return "";
      })
      .finally(() => {
        if (timeout) {
          clearTimeout(timeout);
        }
      });
    return this.wordAudioRevisionReady;
  }

  wordAudioConnectionIsConstrained() {
    const connection = globalThis.navigator?.connection;
    if (!connection) {
      return false;
    }
    return Boolean(connection.saveData)
      || connection.effectiveType === "slow-2g"
      || connection.effectiveType === "2g";
  }

  pruneWordAudioFailures(now = Date.now()) {
    this.wordAudioFailureTimes = this.wordAudioFailureTimes
      .filter((time) => now - time <= WORD_AUDIO_FAILURE_WINDOW_MS);
    for (const [url, entry] of this.wordAudioFailures) {
      if (!entry?.retryAt || entry.retryAt <= now) {
        this.wordAudioFailures.delete(url);
      }
    }
    if (this.wordAudioNetworkCooldownUntil <= now) {
      this.wordAudioNetworkCooldownUntil = 0;
    }
    if (this.wordAudioSlowUntil <= now) {
      this.wordAudioSlowUntil = 0;
      this.wordAudioSlowUrls.clear();
    }
  }

  wordAudioNetworkCoolingDown(now = Date.now()) {
    this.pruneWordAudioFailures(now);
    return this.wordAudioNetworkCooldownUntil > now;
  }

  wordAudioUrlCoolingDown(url, now = Date.now()) {
    if (!url) {
      return true;
    }
    this.pruneWordAudioFailures(now);
    if (this.wordAudioNetworkCooldownUntil > now) {
      return true;
    }
    const entry = this.wordAudioFailures.get(url);
    return Boolean(entry?.retryAt && entry.retryAt > now);
  }

  canPrefetchWordAudio() {
    return this.wordAudioEnabled()
      && Boolean(globalThis.Audio)
      && !this.wordAudioConnectionIsConstrained()
      && !this.wordAudioNetworkCoolingDown()
      && Date.now() >= this.wordAudioSlowUntil;
  }

  // ロードが遅いと検知したら、しばらく先読みを控える（積み増し防止）。
  markWordAudioSlow(url = "") {
    if (url) {
      if (!this.wordAudioSlowUrls.has(url) && this.wordAudioSlowUrls.size >= WORD_AUDIO_SLOW_URL_LIMIT) {
        const oldest = this.wordAudioSlowUrls.values().next().value;
        if (oldest) {
          this.wordAudioSlowUrls.delete(oldest);
        }
      }
      this.wordAudioSlowUrls.add(url);
    }
    this.wordAudioSlowUntil = Date.now() + WORD_AUDIO_SLOW_BACKOFF_MS;
  }

  markWordAudioReady(url) {
    if (url) {
      this.wordAudioFailures.delete(url);
    }
    this.wordAudioFailureTimes = [];
    this.wordAudioNetworkCooldownUntil = 0;
    // 遅いと判定したURL自身が復帰した時だけ先読み抑制を解除する。
    // 別URLのcanplayで即解除すると、電波劣化中に先読みが再開して取得が積み増される。
    if (!url || this.wordAudioSlowUrls.delete(url)) {
      if (!this.wordAudioSlowUrls.size) {
        this.wordAudioSlowUntil = 0;
      }
    }
  }

  markWordAudioProblem(url) {
    const now = Date.now();
    if (url) {
      const current = this.wordAudioFailures.get(url);
      const count = Math.min(4, (current?.count || 0) + 1);
      const cooldown = Math.min(
        WORD_AUDIO_RETRY_COOLDOWN_MAX_MS,
        WORD_AUDIO_RETRY_COOLDOWN_MS * count
      );
      this.wordAudioFailures.set(url, {
        count,
        retryAt: now + cooldown
      });
      while (this.wordAudioFailures.size > WORD_AUDIO_FAILURE_URL_LIMIT) {
        const oldest = this.wordAudioFailures.keys().next().value;
        if (!oldest) {
          break;
        }
        this.wordAudioFailures.delete(oldest);
      }
      this.wordAudioSlowUrls.delete(url);
    }
    this.wordAudioFailureTimes = this.wordAudioFailureTimes
      .filter((time) => now - time <= WORD_AUDIO_FAILURE_WINDOW_MS);
    this.wordAudioFailureTimes.push(now);
    if (this.wordAudioFailureTimes.length >= WORD_AUDIO_FAILURE_THRESHOLD) {
      this.wordAudioNetworkCooldownUntil = Math.max(
        this.wordAudioNetworkCooldownUntil,
        now + WORD_AUDIO_NETWORK_COOLDOWN_MS
      );
    }
  }

  pauseWordAudioElement(audio, resetTime = true) {
    if (!audio) {
      return;
    }
    audio.pause();
    if (resetTime) {
      try {
        audio.currentTime = 0;
      } catch {
        // Some mobile browsers reject currentTime changes before metadata exists.
      }
    }
  }

  isWordAudioSource(audio, url) {
    if (!audio || !url) {
      return false;
    }
    const attributeUrl = audio.getAttribute?.("src") || "";
    const currentUrl = audio.currentSrc || audio.src || attributeUrl;
    if (attributeUrl === url || currentUrl === url) {
      return true;
    }
    try {
      const base = globalThis.location?.href || "";
      return new URL(currentUrl, base).href === new URL(url, base).href;
    } catch {
      return false;
    }
  }

  releaseAudioElement(audio) {
    if (!audio) {
      return;
    }
    this.pauseWordAudioElement(audio, false);
    audio.removeAttribute("src");
    try {
      audio.load();
    } catch {
      // Some mobile browsers throw if load() races with resource teardown.
    }
  }

  releaseWordAudioEntry(url, entry, options = {}) {
    if (!entry?.audio) {
      if (url) {
        this.wordAudioPool.delete(url);
      }
      return;
    }
    if (options.cleanupActive) {
      this.wordAudioCleanup.get(entry.audio)?.("cancel");
    }
    if (typeof entry.dispose === "function") {
      entry.dispose();
    }
    this.releaseAudioElement(entry.audio);
    if (url) {
      this.wordAudioPool.delete(url);
    }
  }

  loadAudioElement(audio, url) {
    try {
      audio.load();
      return true;
    } catch {
      this.markWordAudioProblem(url);
      return false;
    }
  }

  ensureWordAudio(url, preload = "metadata") {
    if (!url || !globalThis.Audio || this.wordAudioUrlCoolingDown(url)) {
      return null;
    }
    let entry = this.wordAudioPool.get(url);
    if (!entry) {
      // プールが満杯なら Audio 要素を作り直さず、アイドルな要素の src を差し替えて再利用する。
      // 毎回 new Audio() すると iOS で再生資源のchurn＝進行性の発熱・劣化になるため、
      // 生成数を実質プール上限に抑える。再利用できる要素が無いときだけ新規生成する。
      let audio = null;
      if (this.wordAudioPool.size >= WORD_AUDIO_POOL_LIMIT) {
        audio = this.takeReusableWordAudio();
      }
      if (!audio) {
        audio = new Audio();
      }
      entry = this.createWordAudioEntry(audio, url, preload);
      this.evictWordAudioPool();
    } else {
      entry.lastUsed = performance.now();
      if (preload === "auto" && entry.audio.preload !== "auto") {
        entry.audio.preload = "auto";
        this.loadAudioElement(entry.audio, url);
      }
    }
    return entry.audio;
  }

  // Audio 要素（新規または再利用）を url 用のプールエントリに仕立てる。
  createWordAudioEntry(audio, url, preload) {
    audio.preload = preload;
    audio.src = url;
    const entry = {
      audio,
      lastUsed: performance.now(),
      dispose: null
    };
    const ready = () => this.markWordAudioReady(url);
    const error = () => {
      if (this.wordAudioActive.has(audio)) {
        return;
      }
      this.markWordAudioProblem(url);
      this.releaseWordAudioEntry(url, entry);
    };
    audio.addEventListener("canplay", ready);
    audio.addEventListener("playing", ready);
    audio.addEventListener("error", error);
    entry.dispose = () => {
      audio.removeEventListener("canplay", ready);
      audio.removeEventListener("playing", ready);
      audio.removeEventListener("error", error);
    };
    this.wordAudioPool.set(url, entry);
    if (preload !== "none") {
      this.loadAudioElement(audio, url);
    }
    return entry;
  }

  // 再生中でないアイドルなプール要素を1つ取り出して返す（見つからなければ null）。
  // 取り出した要素はプールから外し、リスナーも解除して再利用可能な素の状態にする。
  takeReusableWordAudio() {
    let oldestUrl = null;
    let oldestEntry = null;
    for (const [poolUrl, poolEntry] of this.wordAudioPool) {
      if (this.wordAudioActive.has(poolEntry.audio) || !poolEntry.audio.paused) {
        continue;
      }
      if (!oldestEntry || poolEntry.lastUsed < oldestEntry.lastUsed) {
        oldestUrl = poolUrl;
        oldestEntry = poolEntry;
      }
    }
    if (!oldestEntry) {
      return null;
    }
    this.wordAudioPool.delete(oldestUrl);
    if (typeof oldestEntry.dispose === "function") {
      oldestEntry.dispose();
    }
    this.pauseWordAudioElement(oldestEntry.audio);
    return oldestEntry.audio;
  }

  evictWordAudioPool() {
    if (this.wordAudioPool.size <= WORD_AUDIO_POOL_LIMIT) {
      return;
    }
    const entries = Array.from(this.wordAudioPool.entries())
      .filter(([, entry]) => !this.wordAudioActive.has(entry.audio) && entry.audio.paused)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    while (this.wordAudioPool.size > WORD_AUDIO_POOL_LIMIT && entries.length) {
      const [url, entry] = entries.shift();
      this.releaseWordAudioEntry(url, entry);
    }
    // 安全弁: 再生停滞などで paused にならない要素が居座ると上限が効かず
    // Audio要素が増殖するため、それでも超過している場合は最古のものを強制解放する。
    if (this.wordAudioPool.size > WORD_AUDIO_POOL_LIMIT) {
      const leftovers = Array.from(this.wordAudioPool.entries())
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      while (this.wordAudioPool.size > WORD_AUDIO_POOL_LIMIT && leftovers.length) {
        const [url, entry] = leftovers.shift();
        this.releaseWordAudioEntry(url, entry, { cleanupActive: true });
      }
    }
  }

  // プール済みのAudio要素をすべて解放する（一時停止・ゲーム終了・タイトル復帰時）。
  // iOSではHTMLAudioElementがデコーダ資源を掴むため、長時間の一時停止中に保持し続けない。
  // 必要になれば ensureWordAudio が作り直すので機能への影響はない。
  releaseWordAudioPool() {
    this.clearWordAudioIdleReleaseTimer();
    this.stopWordAudio();
    for (const [url, entry] of Array.from(this.wordAudioPool.entries())) {
      this.releaseWordAudioEntry(url, entry);
    }
    this.wordAudioPool.clear();
    // 一時再生用リングの要素も資源を解放する（次ゲームで必要になれば作り直す）。
    for (const audio of this.wordAudioTransientRing) {
      this.releaseAudioElement(audio);
    }
    this.wordAudioTransientRing.length = 0;
    this.wordAudioTransientActive.clear();
  }

  playableWordAudio(url) {
    if (this.wordAudioUrlCoolingDown(url)) {
      return null;
    }
    if (this.wordAudioActive.size >= WORD_AUDIO_ACTIVE_LIMIT) {
      this.markWordAudioSlow(url);
      return null;
    }
    const audio = this.ensureWordAudio(url, "auto");
    if (!audio) {
      return null;
    }
    if (audio.paused) {
      return audio;
    }
    // プール要素が再生中なら、一時再生用要素を「リングから再利用」して同時再生する（new Audio()しない）。
    return this.acquireTransientWordAudio(url);
  }

  // 一時再生用のAudio要素をリングから取り出す（無ければ上限までのみ新規生成）。
  acquireTransientWordAudio(url) {
    if (this.wordAudioTransientActive.size >= WORD_AUDIO_TRANSIENT_LIMIT) {
      this.markWordAudioSlow(url);
      return null;
    }
    let audio = this.wordAudioTransientRing.pop();
    if (!audio) {
      audio = new Audio();
    }
    audio.preload = "auto";
    // 同じURLの要素を使い回すときは再ロードを避ける（getterは絶対URLなので属性で比較）。
    if (audio.getAttribute("src") !== url) {
      audio.src = url;
    }
    this.wordAudioTransient.add(audio);
    this.wordAudioTransientActive.add(audio);
    return audio;
  }

  // 使い終えた一時再生用要素を解放する。リングに空きがあれば戻して再利用、無ければ資源を解放する。
  recycleTransientWordAudio(audio) {
    if (!audio) {
      return;
    }
    this.wordAudioTransient.delete(audio);
    this.wordAudioTransientActive.delete(audio);
    this.pauseWordAudioElement(audio);
    if (this.wordAudioTransientRing.length < WORD_AUDIO_TRANSIENT_LIMIT) {
      this.wordAudioTransientRing.push(audio);
    } else {
      this.releaseAudioElement(audio);
    }
  }

  monitorWordAudioLoad(audio, url) {
    if (!audio || !url || audio.readyState >= 3) {
      return () => {};
    }
    let warned = false;
    let done = false;
    let warningTimer = 0;
    const clear = (type = "ready") => {
      if (done) {
        return;
      }
      done = true;
      if (warningTimer) {
        clearTimeout(warningTimer);
        warningTimer = 0;
      }
      audio.removeEventListener("canplay", ready);
      audio.removeEventListener("playing", ready);
      audio.removeEventListener("error", error);
      this.wordAudioLoadMonitors.delete(clear);
      if (warned && type !== "cancel") {
        this.emitWordAudioStatus({ type, url });
      }
    };
    const ready = () => clear("ready");
    const error = () => clear("error");
    warningTimer = setTimeout(() => {
      warningTimer = 0;
      if (done || audio.readyState >= 3) {
        ready();
        return;
      }
      warned = true;
      // 遅いロードを検知したら先読みを控える（電波劣化時の積み増しで端末が重くなるのを防ぐ）。
      this.markWordAudioSlow(url);
      this.emitWordAudioStatus({ type: "slow", url });
    }, WORD_AUDIO_LOAD_WARNING_MS);
    audio.addEventListener("canplay", ready, { once: true });
    audio.addEventListener("playing", ready, { once: true });
    audio.addEventListener("error", error, { once: true });
    this.wordAudioLoadMonitors.add(clear);
    return clear;
  }

  clearWordAudioLoadMonitors(type = "cancel") {
    for (const clear of Array.from(this.wordAudioLoadMonitors)) {
      clear(type);
    }
    this.wordAudioLoadMonitors.clear();
  }

  trackWordAudio(audio, maxMs = 8000, onCleanup = null, url = "") {
    this.wordAudioActive.add(audio);
    // ended/error が発火しないまま停滞した場合の watchdog。
    // これが無いと wordAudioActive にAudio要素が溜まり続け、プールの追い出しも効かなくなる。
    let watchdog = 0;
    let done = false;
    const cleanup = (reason = "ended") => {
      if (done) {
        return;
      }
      done = true;
      if (watchdog) {
        clearTimeout(watchdog);
        watchdog = 0;
      }
      this.wordAudioActive.delete(audio);
      this.wordAudioCleanup.delete(audio);
      if (this.wordAudioCurrent === audio) {
        this.wordAudioCurrent = null;
      }
      audio.removeEventListener("ended", ended);
      audio.removeEventListener("error", error);
      const sourceUrl = url || audio.currentSrc || audio.src;
      if (reason === "ended" || reason === "ready") {
        this.markWordAudioReady(sourceUrl);
      } else if (reason === "error" || reason === "timeout") {
        this.markWordAudioProblem(sourceUrl);
      }
      if (typeof onCleanup === "function") {
        onCleanup(reason);
      }
      if (this.wordAudioTransient.has(audio)) {
        this.recycleTransientWordAudio(audio);
      }
    };
    watchdog = setTimeout(() => {
      watchdog = 0;
      this.pauseWordAudioElement(audio);
      cleanup("timeout");
    }, maxMs);
    const ended = () => cleanup("ended");
    const error = () => cleanup("error");
    this.wordAudioCleanup.set(audio, cleanup);
    audio.addEventListener("ended", ended, { once: true });
    audio.addEventListener("error", error, { once: true });
    return cleanup;
  }

  preloadWordAudio(urls, options = {}) {
    if (!this.canPrefetchWordAudio()) {
      return;
    }
    this.clearWordAudioIdleReleaseTimer();
    const preload = options.preload || "metadata";
    const limit = Math.max(1, Math.min(WORD_AUDIO_PREFETCH_LIMIT, Number(options.limit) || WORD_AUDIO_PREFETCH_LIMIT));
    const unique = [...new Set((Array.isArray(urls) ? urls : [urls]).filter(Boolean))]
      .filter((url) => !this.wordAudioUrlCoolingDown(url))
      .slice(0, limit);
    for (const url of unique) {
      this.ensureWordAudio(url, preload);
    }
  }

  clearWordAudioTimers() {
    for (const entry of this.wordAudioTimers) {
      clearTimeout(entry.timer);
      if (typeof entry.resolve === "function") {
        entry.resolve(false);
      }
    }
    this.wordAudioTimers.clear();
  }

  setWordAudioTimer(callback, delayMs) {
    let entry = null;
    const timer = setTimeout(() => {
      this.wordAudioTimers.delete(entry);
      callback();
    }, delayMs);
    entry = { timer };
    this.wordAudioTimers.add(entry);
    return entry;
  }

  waitWordAudioTimer(delayMs) {
    return new Promise((resolve) => {
      let entry = null;
      const timer = setTimeout(() => {
        this.wordAudioTimers.delete(entry);
        resolve(true);
      }, delayMs);
      entry = { timer, resolve };
      this.wordAudioTimers.add(entry);
    });
  }

  stopWordAudio() {
    this.wordAudioQueueToken += 1;
    this.clearWordAudioTimers();
    this.clearWordAudioLoadMonitors();
    for (const audio of Array.from(this.wordAudioActive)) {
      this.pauseWordAudioElement(audio);
      this.wordAudioCleanup.get(audio)?.("cancel");
    }
    // active から外れた直後の pooled/transient 要素にも停止をかける。
    // iOS系で play() 解決が遅れた場合に、前ゲームの発音が次ゲーム冒頭へ残るのを防ぐ。
    for (const entry of this.wordAudioPool.values()) {
      this.pauseWordAudioElement(entry.audio);
    }
    for (const audio of this.wordAudioTransientRing) {
      this.pauseWordAudioElement(audio);
    }
    for (const audio of Array.from(this.wordAudioTransientActive)) {
      this.recycleTransientWordAudio(audio);
    }
    this.wordAudioActive.clear();
    this.wordAudioCleanup.clear();
    this.wordAudioCurrent = null;
  }

  playWordAudio(url, options = {}) {
    if (!this.wordAudioEnabled() || !url || !globalThis.Audio) {
      return;
    }
    this.clearWordAudioIdleReleaseTimer();
    if (!options.fromQueue && options.cancelQueued) {
      this.wordAudioQueueToken += 1;
    }
    const shouldPlay = typeof options.shouldPlay === "function" ? options.shouldPlay : null;
    if (shouldPlay && !shouldPlay()) {
      return;
    }
    const delayMs = Math.max(0, Number(options.delayMs) || 0);
    if (delayMs) {
      this.setWordAudioTimer(() => {
        this.playWordAudio(url, {
          shouldPlay,
          fromQueue: options.fromQueue,
          cancelQueued: options.cancelQueued,
          releaseWhenIdle: options.releaseWhenIdle
        });
      }, delayMs);
      return;
    }

    const audio = this.playableWordAudio(url);
    if (!audio) {
      return;
    }
    this.wordAudioCurrent = audio;
    audio.volume = this.wordAudioVolume();
    try {
      audio.currentTime = 0;
    } catch {
      // Metadata may not be ready yet.
    }
    const clearLoadMonitor = this.monitorWordAudioLoad(audio, url);
    const cleanup = this.trackWordAudio(audio, WORD_AUDIO_PLAY_TIMEOUT_MS, (reason) => {
      clearLoadMonitor(reason === "cancel" ? "cancel" : reason === "ended" ? "ready" : "error");
      if (options.releaseWhenIdle && reason !== "cancel") {
        this.scheduleWordAudioIdleRelease();
      }
    }, url);
    const isSameSource = () => this.isWordAudioSource(audio, url);
    audio.play().then(() => {
      if (!this.wordAudioActive.has(audio)) {
        if (isSameSource()) {
          this.pauseWordAudioElement(audio);
        }
        return;
      }
      clearLoadMonitor("ready");
    }).catch(() => {
      clearLoadMonitor("error");
      cleanup("error");
      // User gesture and autoplay rules can still block media on some browsers.
    });
  }

  playWordAudioQueue(items, options = {}) {
    if (!this.wordAudioEnabled() || !globalThis.Audio) {
      return null;
    }
    this.clearWordAudioIdleReleaseTimer();
    const queue = (Array.isArray(items) ? items : [items])
      .map((item) => (typeof item === "string" ? { url: item } : item))
      .filter((item) => item?.url);
    if (!queue.length) {
      return null;
    }
    const token = this.wordAudioQueueToken + 1;
    this.wordAudioQueueToken = token;
    const delayMs = Math.max(0, Number(options.delayMs) || 0);
    const intervalMs = Math.max(0, Number(options.intervalMs) || 0);
    const gapMs = Math.max(0, Number(options.gapMs) || 0);
    const maxItemMs = Math.max(700, Number(options.maxItemMs) || 1800);
    const entries = queue.map((item) => ({ item, started: false }));
    let serial = 0;
    let done = false;

    const isActive = () => !done && this.wordAudioQueueToken === token;
    const shouldPlayEntry = (entry) => {
      const shouldPlay = typeof entry.item.shouldPlay === "function" ? entry.item.shouldPlay : null;
      return !shouldPlay || shouldPlay();
    };
    const nextEntry = () => {
      while (entries.length) {
        const entry = entries.find((candidate) => !candidate.started);
        if (!entry) {
          done = true;
          return null;
        }
        entry.started = true;
        if (shouldPlayEntry(entry)) {
          return entry;
        }
      }
      done = true;
      return null;
    };
    const skipEntries = (skip) => {
      if (typeof skip !== "function") {
        return;
      }
      for (const entry of entries) {
        if (!entry.started && skip(entry.item)) {
          entry.started = true;
        }
      }
    };
    const playFrom = async (entry, runSerial) => {
      let current = entry;
      while (current && isActive() && runSerial === serial) {
        await this.playWordAudioQueueItem(current.item.url, token, maxItemMs);
        if (!isActive() || runSerial !== serial) {
          return;
        }
        if (gapMs) {
          await this.waitWordAudioTimer(gapMs);
          if (!isActive() || runSerial !== serial) {
            return;
          }
        }
        current = nextEntry();
      }
    };
    const startFromNext = (skip = null) => {
      if (!isActive()) {
        return false;
      }
      skipEntries(skip);
      const entry = nextEntry();
      if (!entry) {
        return false;
      }
      serial += 1;
      playFrom(entry, serial);
      return true;
    };

    const controller = {
      advance: (options = {}) => startFromNext(options.skip),
      cancel: () => {
        done = true;
        serial += 1;
      }
    };

    if (intervalMs) {
      queue.forEach((item, index) => {
        this.setWordAudioTimer(() => {
          if (this.wordAudioQueueToken !== token) {
            return;
          }
          const shouldPlay = typeof item.shouldPlay === "function" ? item.shouldPlay : null;
          if (shouldPlay && !shouldPlay()) {
            return;
          }
          this.playWordAudio(item.url, {
            shouldPlay,
            fromQueue: true
          });
        }, delayMs + intervalMs * index);
      });
      return controller;
    }

    const playNext = async () => {
      if (delayMs) {
        await this.waitWordAudioTimer(delayMs);
      }
      if (!isActive() || serial !== 0) {
        return;
      }
      startFromNext();
    };

    playNext();
    return controller;
  }

  playWordAudioQueueItem(url, token, maxItemMs) {
    if (this.wordAudioQueueToken !== token) {
      return Promise.resolve();
    }
    const audio = this.playableWordAudio(url);
    if (!audio) {
      return Promise.resolve();
    }
    this.wordAudioCurrent = audio;
    audio.volume = this.wordAudioVolume();
    try {
      audio.currentTime = 0;
    } catch {
      // Metadata may not be ready yet.
    }
    const clearLoadMonitor = this.monitorWordAudioLoad(audio, url);
    return new Promise((resolve) => {
      let done = false;
      const finishReady = () => finish("ready");
      const finishError = () => finish("error");
      const finish = (type = "ready") => {
        if (done) {
          return;
        }
        done = true;
        clearLoadMonitor(type);
        this.wordAudioActive.delete(audio);
        this.wordAudioCleanup.delete(audio);
        if (this.wordAudioCurrent === audio) {
          this.wordAudioCurrent = null;
        }
        audio.removeEventListener("ended", finishReady);
        audio.removeEventListener("error", finishError);
        clearTimeout(timer);
        if (type === "ready") {
          this.markWordAudioReady(url);
        } else if (type === "error") {
          this.markWordAudioProblem(url);
        }
        if (this.wordAudioTransient.has(audio)) {
          this.recycleTransientWordAudio(audio);
        }
        resolve();
      };
      const timer = setTimeout(() => finish("error"), maxItemMs);
      this.wordAudioActive.add(audio);
      this.wordAudioCleanup.set(audio, finish);
      audio.addEventListener("ended", finishReady, { once: true });
      audio.addEventListener("error", finishError, { once: true });
      const isSameSource = () => this.isWordAudioSource(audio, url);
      audio.play().then(() => {
        if (this.wordAudioQueueToken !== token || !this.wordAudioActive.has(audio)) {
          if (isSameSource()) {
            this.pauseWordAudioElement(audio);
          }
          finish("cancel");
          return;
        }
        clearLoadMonitor("ready");
      }).catch(() => finish("error"));
    });
  }

  clearBgmFade() {
    if (this.bgmFadeTimer) {
      clearTimeout(this.bgmFadeTimer);
      this.bgmFadeTimer = 0;
    }
    if (this.bgmFadeFrame) {
      cancelAnimationFrame(this.bgmFadeFrame);
      this.bgmFadeFrame = 0;
    }
    this.bgmFadeToken += 1;
    this.bgmFading = false;
    if (this.bgmGain && this.ctx) {
      const now = this.ctx.currentTime;
      try {
        this.bgmGain.gain.cancelScheduledValues(now);
        this.bgmGain.gain.setValueAtTime(this.bgmGain.gain.value, now);
      } catch {
        // Some older WebKit builds are picky about AudioParam scheduling.
      }
    }
  }

  clearContextSuspendTimer() {
    if (this.contextSuspendTimer) {
      clearTimeout(this.contextSuspendTimer);
      this.contextSuspendTimer = 0;
    }
  }

  clearWordAudioIdleReleaseTimer() {
    if (this.wordAudioIdleReleaseTimer) {
      clearTimeout(this.wordAudioIdleReleaseTimer);
      this.wordAudioIdleReleaseTimer = 0;
    }
  }

  scheduleWordAudioIdleRelease(delayMs = WORD_AUDIO_IDLE_RELEASE_MS) {
    if (!globalThis.Audio) {
      return;
    }
    this.clearWordAudioIdleReleaseTimer();
    this.wordAudioIdleReleaseTimer = setTimeout(() => {
      this.wordAudioIdleReleaseTimer = 0;
      this.releaseWordAudioPoolIfIdle();
    }, Math.max(0, delayMs));
  }

  releaseWordAudioPoolIfIdle() {
    if (this.wordAudioActive.size || this.wordAudioTimers.size || this.wordAudioLoadMonitors.size) {
      this.scheduleWordAudioIdleRelease();
      return;
    }
    if (this.wordAudioPool.size || this.wordAudioTransientRing.length) {
      this.releaseWordAudioPool();
    }
  }

  // アイドル（非プレイ・無音）状態でAudioContextを止める予約を入れる。
  // 無音でも running のままだとオーディオ描画スレッドが常時CPUを起こし続け、
  // iOSでは長時間放置の発熱源になる（放置後にスロットリングで重く感じる原因）。
  // 音を出す経路（init / startBgm / playSfx）で必ず resume される。
  scheduleContextSuspend(delayMs = CONTEXT_SUSPEND_DELAY_MS, retriesLeft = CONTEXT_SUSPEND_MAX_RETRIES) {
    if (!this.ctx || typeof this.ctx.suspend !== "function") {
      return;
    }
    this.clearContextSuspendTimer();
    this.contextSuspendTimer = setTimeout(() => {
      this.contextSuspendTimer = 0;
      this.suspendContextIfIdle({ retriesLeft });
    }, Math.max(0, delayMs));
  }

  suspendContextIfIdle(options = {}) {
    if (!this.ctx || this.ctx.state !== "running" || typeof this.ctx.suspend !== "function") {
      return;
    }
    // フェード中・BGM再生中は止めない。HTMLAudio直のBGM試聴/単語音声はContextに非依存。
    if (this.bgmFading || (this.bgmAudio && !this.bgmAudio.paused)) {
      // BGMが止まるのを待って数回だけ再試行する（異常時も2.2秒毎の無限起床にしない）。
      const retriesLeft = Number(options.retriesLeft) || 0;
      if (retriesLeft > 0) {
        this.scheduleContextSuspend(CONTEXT_SUSPEND_DELAY_MS, retriesLeft - 1);
      }
      return;
    }
    this.ctx.suspend().catch(() => {});
  }

  init() {
    if (!this.supported) {
      return false;
    }
    if (!this.ctx) {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      this.ctx = new AudioContextClass();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    this.master.gain.value = this.sfxVolume();
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    // 音を出す＝アクティブになったので、予約済みのアイドルsuspendを取り消す。
    this.clearContextSuspendTimer();
    return true;
  }

  setBgmLevel(value) {
    const volume = this.clampVolume(value, this.bgmVolume());
    if (this.bgmGain) {
      if (this.ctx) {
        const now = this.ctx.currentTime;
        try {
          this.bgmGain.gain.cancelScheduledValues(now);
          this.bgmGain.gain.setValueAtTime(volume, now);
        } catch {
          this.bgmGain.gain.value = volume;
        }
      } else {
        this.bgmGain.gain.value = volume;
      }
      for (const audio of this.bgmAudioPool.values()) {
        audio.volume = 1;
      }
    } else {
      for (const audio of this.bgmAudioPool.values()) {
        audio.volume = volume;
      }
      if (!this.bgmAudioPool.size && this.bgmAudio) {
        this.bgmAudio.volume = volume;
      }
    }
  }

  setupBgmGain(audio) {
    if (!audio || !this.supported || !this.init()) {
      if (audio) {
        audio.volume = this.bgmVolume();
      }
      return;
    }
    if (!this.bgmGain) {
      this.bgmGain = this.ctx.createGain();
      this.bgmGain.connect(this.ctx.destination);
    }
    if (!this.bgmSources.has(audio)) {
      const source = this.ctx.createMediaElementSource(audio);
      source.connect(this.bgmGain);
      this.bgmSources.set(audio, source);
    }
    this.setBgmLevel(this.bgmVolume());
  }

  noteToFrequency(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  playTone(frequency, start, duration, type, gainValue, destination = this.master) {
    if (!this.ctx || !this.sfxEnabled() || !destination) {
      return;
    }
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(destination);
    // 再生終了後にグラフから切り離す。放置するとSFXのたびにノードが
    // オーディオグラフへ蓄積し、iOSで進行性の負荷増・発熱の原因になる。
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  // やわらかい立ち上がりと余韻を持つ音。detune層とサブ層で厚みを出す。
  playNote(frequency, start, duration, options = {}) {
    if (!this.ctx || !this.sfxEnabled() || !this.master) {
      return;
    }
    const {
      type = "triangle",
      gain = 0.08,
      attack = 0.012,
      detune = 0,
      sub = 0,
      glideTo = 0
    } = options;

    const voice = (freq, level, waveType, glide) => {
      const osc = this.ctx.createOscillator();
      const amp = this.ctx.createGain();
      osc.type = waveType;
      osc.frequency.setValueAtTime(freq, start);
      if (glide) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, glide), start + duration);
      }
      amp.gain.setValueAtTime(0.0001, start);
      amp.gain.exponentialRampToValueAtTime(level, start + attack);
      amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(amp);
      amp.connect(this.master);
      // 再生終了後にグラフから切り離す（ノード蓄積によるオーディオスレッド負荷増を防ぐ）。
      osc.onended = () => {
        osc.disconnect();
        amp.disconnect();
      };
      osc.start(start);
      osc.stop(start + duration + 0.04);
    };

    voice(frequency, gain, type, glideTo);
    if (detune) {
      voice(frequency * (1 + detune), gain * 0.5, type, glideTo ? glideTo * (1 + detune) : 0);
    }
    if (sub) {
      voice(frequency / 2, gain * sub, "sine", glideTo ? glideTo / 2 : 0);
    }
  }

  playNoise(start, duration, gainValue) {
    if (!this.ctx || !this.sfxEnabled()) {
      return;
    }
    // ノイズバッファは毎回生成せず使い回す（ミス連発時のアロケーション/GCを避ける）。
    const sampleRate = this.ctx.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * duration));
    if (!this.noiseBuffer || this.noiseBuffer.length < length || this.noiseBuffer.sampleRate !== sampleRate) {
      this.noiseBuffer = this.ctx.createBuffer(1, length, sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      }
    }
    const source = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    filter.type = "highpass";
    filter.frequency.value = 900;
    gain.gain.setValueAtTime(gainValue, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.buffer = this.noiseBuffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    // 再生終了後にグラフから切り離す。
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    source.start(start);
    source.stop(start + duration + 0.03);
  }

  chooseTrack(restart = false) {
    if (!this.bgmTracks.length) {
      return null;
    }

    const requested = this.settings().bgmTrack || "random";
    if (requested !== "random") {
      return this.bgmTracks.find((track) => track.id === requested) || this.bgmTracks[0];
    }

    if (!restart && this.currentTrackId) {
      return this.bgmTracks.find((track) => track.id === this.currentTrackId) || this.bgmTracks[0];
    }

    const index = Math.floor(Math.random() * this.bgmTracks.length);
    return this.bgmTracks[index] || this.bgmTracks[0];
  }

  choosePreviewTrack(trackId) {
    if (!this.bgmTracks.length) {
      return null;
    }
    if (trackId && trackId !== "random") {
      return this.bgmTracks.find((track) => track.id === trackId) || this.bgmTracks[0];
    }
    return this.bgmTracks[Math.floor(Math.random() * this.bgmTracks.length)] || this.bgmTracks[0];
  }

  ensureBgmAudio(track, restart = false) {
    if (!track || !globalThis.Audio) {
      return null;
    }
    let audio = this.bgmAudioPool.get(track.id);
    if (!audio) {
      audio = new Audio();
      audio.loop = true;
      audio.preload = "auto";
      audio.src = track.src;
      audio.load();
      this.bgmAudioPool.set(track.id, audio);
    }
    if (this.bgmAudio && this.bgmAudio !== audio) {
      this.bgmAudio.pause();
    }
    if (this.currentTrackId !== track.id) {
      restart = true;
    }
    this.bgmAudio = audio;
    this.currentTrackId = track.id;
    audio.loop = true;
    this.setupBgmGain(audio);
    if (restart) {
      audio.currentTime = 0;
    }
    return audio;
  }

  ensurePreviewAudio(track) {
    if (!track || !globalThis.Audio) {
      return null;
    }
    let audio = this.previewAudioPool.get(track.id);
    if (!audio) {
      audio = new Audio();
      audio.loop = true;
      audio.preload = "auto";
      audio.src = track.src;
      audio.load();
      this.previewAudioPool.set(track.id, audio);
    }
    audio.volume = this.bgmVolume();
    return audio;
  }

  isBgmPreviewing() {
    return Boolean(this.previewAudio && this.previewTrackId);
  }

  stopBgmPreview() {
    for (const audio of this.previewAudioPool.values()) {
      audio.pause();
    }
    this.previewAudio = null;
    this.previewTrackId = "";
  }

  startBgmPreview(trackId) {
    const track = this.choosePreviewTrack(trackId);
    const audio = this.ensurePreviewAudio(track);
    if (!audio) {
      return false;
    }
    this.stopBgmPreview();
    this.previewAudio = audio;
    this.previewTrackId = track.id;
    audio.volume = this.bgmVolume();
    audio.currentTime = 0;
    audio.play().catch(() => {
      this.stopBgmPreview();
    });
    return true;
  }

  toggleBgmPreview(trackId) {
    if (this.isBgmPreviewing()) {
      this.stopBgmPreview();
      return false;
    }
    return this.startBgmPreview(trackId);
  }

  startBgm(getPhase, options = {}) {
    if (!this.bgmEnabled() || getPhase() !== "playing" || !globalThis.Audio) {
      return;
    }
    // suspend中のAudioContextを確実に起こす（pause→再開でBGMを鳴らすため）。
    this.init();
    this.clearBgmFade();
    this.stopBgmPreview();
    const track = this.chooseTrack(Boolean(options.restart));
    const audio = this.ensureBgmAudio(track, Boolean(options.restart));
    if (!audio) {
      return;
    }
    audio.play().catch(() => {
      // Browsers can reject playback until the next direct user gesture.
    });
  }

  applySettings(getPhase) {
    if (this.master) {
      this.master.gain.value = this.sfxVolume();
    }
    if (!this.wordAudioEnabled()) {
      this.releaseWordAudioPool();
    } else {
      const volume = this.wordAudioVolume();
      for (const audio of this.wordAudioActive) {
        audio.volume = volume;
      }
      if (this.wordAudioCurrent) {
        this.wordAudioCurrent.volume = volume;
      }
    }
    if (this.previewAudio) {
      this.previewAudio.volume = this.bgmVolume();
    }
    const phase = getPhase?.();
    if (!this.bgmEnabled()) {
      this.stopBgm();
    } else if (phase === "playing") {
      this.startBgm(getPhase);
    } else if (this.bgmAudio && !this.bgmFading) {
      this.setBgmLevel(this.bgmVolume());
    }
    // 非プレイ中に音設定を操作した後は、無音になったらContextを再suspendする予約を入れ直す。
    // 何らかの経路でContextが running のまま残っても、次の遷移を待たず自動で止められるようにする。
    if (phase !== "playing") {
      this.scheduleContextSuspend();
    }
  }

  stopBgm() {
    this.clearBgmFade();
    for (const audio of this.bgmAudioPool.values()) {
      audio.pause();
    }
  }

  fadeOutBgm(durationMs = 1200) {
    if (!this.bgmAudio || this.bgmAudio.paused) {
      return;
    }
    this.clearBgmFade();
    const audio = this.bgmAudio;
    const duration = Math.max(80, durationMs);
    const token = ++this.bgmFadeToken;
    this.bgmFading = true;
    const completeFade = () => {
      if (token !== this.bgmFadeToken) {
        return;
      }
      this.bgmFadeTimer = 0;
      this.bgmFadeFrame = 0;
      this.bgmFading = false;
      audio.pause();
      if (this.bgmGain && this.ctx) {
        const now = this.ctx.currentTime;
        try {
          this.bgmGain.gain.cancelScheduledValues(now);
          this.bgmGain.gain.setValueAtTime(0.0001, now);
        } catch {
          this.bgmGain.gain.value = 0.0001;
        }
      } else {
        audio.volume = 0;
      }
    };

    if (this.bgmGain && this.ctx) {
      const gain = this.bgmGain.gain;
      const now = this.ctx.currentTime;
      const startVolume = Math.max(0.0001, gain.value || this.bgmVolume());
      try {
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(startVolume, now);
        gain.linearRampToValueAtTime(0.0001, now + duration / 1000);
        this.bgmFadeTimer = setTimeout(completeFade, duration + 120);
        return;
      } catch {
        gain.value = startVolume;
      }
    }

    const startVolume = audio.volume;
    const startedAt = performance.now();
    const step = (now) => {
      if (token !== this.bgmFadeToken) {
        return;
      }
      const progress = Math.min(1, (now - startedAt) / duration);
      audio.volume = startVolume * (1 - progress);
      if (progress >= 1) {
        completeFade();
      } else {
        this.bgmFadeFrame = requestAnimationFrame(step);
      }
    };
    this.bgmFadeFrame = requestAnimationFrame(step);
  }

  playSfx(kind, detail) {
    if (!this.sfxEnabled() || !this.init()) {
      return;
    }
    this.master.gain.value = this.sfxVolume();
    const now = this.ctx.currentTime;
    if (kind === "start") {
      // 明るく駆け上がるアルペジオ。
      this.playNote(523.25, now, 0.12, { type: "triangle", gain: 0.075, detune: 0.004, sub: 0.4 });
      this.playNote(659.25, now + 0.1, 0.12, { type: "triangle", gain: 0.075, detune: 0.004 });
      this.playNote(783.99, now + 0.2, 0.14, { type: "triangle", gain: 0.075, detune: 0.004 });
      this.playNote(1046.5, now + 0.3, 0.24, { type: "triangle", gain: 0.08, detune: 0.005, sub: 0.35 });
    } else if (kind === "correct") {
      // きらっとした2音のチャイム。
      this.playNote(880, now, 0.09, { type: "triangle", gain: 0.085, detune: 0.005, sub: 0.35 });
      this.playNote(1318.51, now + 0.075, 0.2, { type: "triangle", gain: 0.08, detune: 0.006, sub: 0.3 });
      this.playTone(2637, now + 0.075, 0.06, "sine", 0.02);
    } else if (kind === "wrong") {
      // 下降するにぶいブザー。
      this.playNote(233.08, now, 0.16, { type: "sawtooth", gain: 0.05, detune: 0.01, glideTo: 174.61 });
      this.playNote(155.56, now + 0.05, 0.2, { type: "triangle", gain: 0.045, sub: 0.5 });
    } else if (kind === "miss") {
      // 空振りのノイズと低い衝撃音。
      this.playNoise(now, 0.18, 0.05);
      this.playNote(146.83, now + 0.02, 0.22, { type: "square", gain: 0.03, glideTo: 92.5, sub: 0.6 });
    } else if (kind === "finish") {
      // 小さなファンファーレ。
      this.playNote(523.25, now, 0.12, { type: "triangle", gain: 0.08, detune: 0.004, sub: 0.35 });
      this.playNote(659.25, now + 0.1, 0.12, { type: "triangle", gain: 0.08, detune: 0.004 });
      this.playNote(783.99, now + 0.2, 0.14, { type: "triangle", gain: 0.08, detune: 0.004 });
      this.playNote(1046.5, now + 0.32, 0.34, { type: "triangle", gain: 0.085, detune: 0.006, sub: 0.4 });
      this.playTone(1567.98, now + 0.32, 0.1, "sine", 0.022);
    } else if (kind === "countdown") {
      // 終盤カウントダウン。残り秒が減るほど高音になり緊張感を出す。
      const step = typeof detail === "number" ? detail : 3;
      const freq = step <= 1 ? 1174.66 : step === 2 ? 987.77 : 830.61;
      this.playNote(freq, now, 0.16, { type: "triangle", gain: 0.07, detune: 0.005, sub: 0.4 });
    } else if (kind === "toggle") {
      this.playNote(740, now, 0.08, { type: "triangle", gain: 0.05 });
    }
  }
}
