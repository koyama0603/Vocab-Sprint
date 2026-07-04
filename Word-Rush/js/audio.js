// BGMベースを下げる: 旧スライダー15%相当が新スライダー50%で同等になる（0.72 * 0.15 / 0.50）。
const BGM_OUTPUT_SCALE = 0.216;
// 効果音ベースを上げる: 旧スライダー80%相当が新スライダー50%で同等になる（1.16 * 0.80 / 0.50）。
const SFX_OUTPUT_SCALE = 1.856;
const SFX_MAX_GAIN = 1.856;
const WORD_AUDIO_ROOT = "assets/word-audio/en-us-edge-tts";
const WORD_AUDIO_POOL_LIMIT = 24;
const WORD_AUDIO_PREFETCH_LIMIT = 8;

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
    this.wordAudioRevision = "";
    this.wordAudioRevisionReady = null;
    this.wordAudioPool = new Map();
    this.wordAudioCurrent = null;
    this.wordAudioTimers = new Set();
    this.ctx = null;
    this.master = null;
    this.supported = Boolean(globalThis.AudioContext || globalThis.webkitAudioContext);
  }

  settings() {
    return this.getSettings?.() || {};
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

  bgmVolume() {
    return Math.max(0, Math.min(1, this.clampVolume(this.settings().bgmVolume, 0.15) * BGM_OUTPUT_SCALE));
  }

  sfxVolume() {
    return Math.max(0, Math.min(SFX_MAX_GAIN, this.clampVolume(this.settings().sfxVolume, 0.7) * SFX_OUTPUT_SCALE));
  }

  wordAudioVolume() {
    return Math.max(0, Math.min(1, this.clampVolume(this.settings().sfxVolume, 0.7) * 1.08));
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

  ensureWordAudioRevision() {
    if (this.wordAudioRevisionReady) {
      return this.wordAudioRevisionReady;
    }
    this.wordAudioRevisionReady = fetch("cache-manifest.json", { cache: "no-store" })
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
      });
    return this.wordAudioRevisionReady;
  }

  ensureWordAudio(url, preload = "metadata") {
    if (!url || !globalThis.Audio) {
      return null;
    }
    let entry = this.wordAudioPool.get(url);
    if (!entry) {
      const audio = new Audio();
      audio.preload = preload;
      audio.src = url;
      entry = {
        audio,
        lastUsed: performance.now()
      };
      this.wordAudioPool.set(url, entry);
      if (preload !== "none") {
        audio.load();
      }
      this.evictWordAudioPool();
    } else {
      entry.lastUsed = performance.now();
      if (preload === "auto" && entry.audio.preload !== "auto") {
        entry.audio.preload = "auto";
        entry.audio.load();
      }
    }
    return entry.audio;
  }

  evictWordAudioPool() {
    if (this.wordAudioPool.size <= WORD_AUDIO_POOL_LIMIT) {
      return;
    }
    const entries = Array.from(this.wordAudioPool.entries())
      .filter(([, entry]) => entry.audio !== this.wordAudioCurrent && entry.audio.paused)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    while (this.wordAudioPool.size > WORD_AUDIO_POOL_LIMIT && entries.length) {
      const [url, entry] = entries.shift();
      entry.audio.removeAttribute("src");
      entry.audio.load();
      this.wordAudioPool.delete(url);
    }
  }

  preloadWordAudio(urls, options = {}) {
    if (!this.sfxEnabled() || !globalThis.Audio) {
      return;
    }
    const preload = options.preload || "metadata";
    const limit = Math.max(1, Math.min(WORD_AUDIO_PREFETCH_LIMIT, Number(options.limit) || WORD_AUDIO_PREFETCH_LIMIT));
    const unique = [...new Set((Array.isArray(urls) ? urls : [urls]).filter(Boolean))].slice(0, limit);
    for (const url of unique) {
      this.ensureWordAudio(url, preload);
    }
  }

  clearWordAudioTimers() {
    for (const timer of this.wordAudioTimers) {
      clearTimeout(timer);
    }
    this.wordAudioTimers.clear();
  }

  stopWordAudio() {
    this.clearWordAudioTimers();
    if (this.wordAudioCurrent) {
      this.wordAudioCurrent.pause();
      try {
        this.wordAudioCurrent.currentTime = 0;
      } catch {
        // Some mobile browsers reject currentTime changes before metadata exists.
      }
    }
    this.wordAudioCurrent = null;
  }

  playWordAudio(url, options = {}) {
    if (!this.sfxEnabled() || !url || !globalThis.Audio) {
      return;
    }
    const shouldPlay = typeof options.shouldPlay === "function" ? options.shouldPlay : null;
    if (shouldPlay && !shouldPlay()) {
      return;
    }
    const delayMs = Math.max(0, Number(options.delayMs) || 0);
    if (delayMs) {
      const timer = setTimeout(() => {
        this.wordAudioTimers.delete(timer);
        this.playWordAudio(url, { shouldPlay });
      }, delayMs);
      this.wordAudioTimers.add(timer);
      return;
    }

    const audio = this.ensureWordAudio(url, "auto");
    if (!audio) {
      return;
    }
    if (this.wordAudioCurrent && this.wordAudioCurrent !== audio) {
      this.wordAudioCurrent.pause();
      try {
        this.wordAudioCurrent.currentTime = 0;
      } catch {
        // Metadata may not be ready yet.
      }
    }
    this.wordAudioCurrent = audio;
    audio.volume = this.wordAudioVolume();
    try {
      audio.currentTime = 0;
    } catch {
      // Metadata may not be ready yet.
    }
    audio.play().catch(() => {
      // User gesture and autoplay rules can still block media on some browsers.
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
    const sampleRate = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, Math.max(1, Math.floor(sampleRate * duration)), sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const source = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    filter.type = "highpass";
    filter.frequency.value = 900;
    gain.gain.setValueAtTime(gainValue, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(start);
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
    if (!this.sfxEnabled()) {
      this.stopWordAudio();
    } else if (this.wordAudioCurrent) {
      this.wordAudioCurrent.volume = this.wordAudioVolume();
    }
    if (this.previewAudio) {
      this.previewAudio.volume = this.bgmVolume();
    }
    if (!this.bgmEnabled()) {
      this.stopBgm();
      return;
    }
    if (getPhase?.() === "playing") {
      this.startBgm(getPhase);
    } else if (this.bgmAudio && !this.bgmFading) {
      this.setBgmLevel(this.bgmVolume());
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
