const BGM_OUTPUT_SCALE = 0.72;
const SFX_OUTPUT_SCALE = 1.16;
const SFX_MAX_GAIN = 1.16;

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

  setTracks(tracks) {
    this.bgmTracks = Array.isArray(tracks) ? tracks : [];
  }

  clearBgmFade() {
    if (this.bgmFadeTimer) {
      clearInterval(this.bgmFadeTimer);
      this.bgmFadeTimer = 0;
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
      this.bgmGain.gain.value = volume;
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
    if (this.bgmAudio) {
      this.setBgmLevel(this.bgmVolume());
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
    const startVolume = this.bgmGain ? this.bgmGain.gain.value : audio.volume;
    const startedAt = Date.now();
    this.bgmFadeTimer = setInterval(() => {
      const progress = Math.min(1, (Date.now() - startedAt) / durationMs);
      this.setBgmLevel(startVolume * (1 - progress));
      if (progress >= 1) {
        this.clearBgmFade();
        audio.pause();
        this.setBgmLevel(this.bgmVolume());
      }
    }, 40);
  }

  playSfx(kind) {
    if (!this.sfxEnabled() || !this.init()) {
      return;
    }
    this.master.gain.value = this.sfxVolume();
    const now = this.ctx.currentTime;
    if (kind === "start") {
      this.playTone(523.25, now, 0.08, "triangle", 0.08);
      this.playTone(659.25, now + 0.08, 0.09, "triangle", 0.075);
      this.playTone(783.99, now + 0.16, 0.12, "triangle", 0.07);
    } else if (kind === "correct") {
      this.playTone(659.25, now, 0.07, "triangle", 0.085);
      this.playTone(880, now + 0.065, 0.1, "triangle", 0.08);
    } else if (kind === "wrong") {
      this.playTone(220, now, 0.12, "sawtooth", 0.055);
      this.playTone(164.81, now + 0.07, 0.16, "sawtooth", 0.045);
    } else if (kind === "miss") {
      this.playNoise(now, 0.16, 0.055);
      this.playTone(196, now + 0.04, 0.16, "square", 0.032);
    } else if (kind === "finish") {
      this.playTone(783.99, now, 0.09, "triangle", 0.08);
      this.playTone(659.25, now + 0.09, 0.1, "triangle", 0.075);
      this.playTone(523.25, now + 0.18, 0.2, "triangle", 0.07);
    } else if (kind === "toggle") {
      this.playTone(740, now, 0.08, "triangle", 0.055);
    }
  }
}
