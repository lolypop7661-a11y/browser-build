const SOUND_PROFILES = {
  Soft: [110, 164.81, 220],
  Crystalline: [130.81, 196, 261.63],
  Analog: [82.41, 123.47, 164.81],
  'Solar Wind': [146.83, 220, 293.66],
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function ramp(parameter, value, context, smoothing = 0.12) {
  const now = context.currentTime;
  parameter.cancelScheduledValues(now);
  parameter.setTargetAtTime(value, now, smoothing);
}

/** Small, offline Web Audio soundscape; audio nodes are only created after a user gesture. */
export class BrowseryAudioEngine {
  constructor() {
    this.settings = {
      ambience: true,
      ambienceVolume: 58,
      clicks: true,
      hover: false,
      master: 48,
      startup: false,
      downloadtone: true,
      theme: 'Crystalline',
      spatialaudio: true,
    };
    this.context = null;
    this.masterBus = null;
    this.ambientBus = null;
    this.effectsBus = null;
    this.analyser = null;
    this.ambientNodes = [];
    this.ambientVoices = [];
    this.ambientStopTimer = 0;
    this.unlocking = null;
    this.startupPlayed = false;
    this.lastHoverAt = 0;
  }

  ensureGraph() {
    if (this.context) return true;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;

    const context = new AudioContextClass({ latencyHint: 'interactive' });
    const masterBus = context.createGain();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.84;
    const ambientBus = context.createGain();
    const effectsBus = context.createGain();

    ambientBus.connect(masterBus);
    effectsBus.connect(masterBus);
    masterBus.connect(analyser);
    analyser.connect(context.destination);

    this.context = context;
    this.masterBus = masterBus;
    this.ambientBus = ambientBus;
    this.effectsBus = effectsBus;
    this.analyser = analyser;
    this.applyLevels();
    return true;
  }

  setSettings(settings) {
    const previousTheme = this.settings.theme;
    this.settings = { ...this.settings, ...settings };
    if (!this.context) return;
    this.applyLevels();

    if (this.canPlayAmbience()) {
      window.clearTimeout(this.ambientStopTimer);
      window.clearTimeout(this.sleepTimer);
      this.ambientStopTimer = 0;
      if (this.context.state === 'suspended') this.unlock();
      if (this.ambientNodes.length === 0) this.startAmbience();
      else if (previousTheme !== this.settings.theme) this.applyTheme();
      this.applySpatialField();
    } else {
      this.fadeOutAmbience();
    }
  }

  canPlayAmbience() {
    return Boolean(this.settings.ambience && Number(this.settings.ambienceVolume) > 0 && Number(this.settings.master) > 0);
  }

  applyLevels() {
    if (!this.context) return;
    const master = clamp(Number(this.settings.master) || 0, 0, 100) / 100;
    ramp(this.masterBus.gain, master, this.context, 0.08);
    const ambience = this.canPlayAmbience()
      ? (clamp(Number(this.settings.ambienceVolume) || 0, 0, 100) / 100) * 1.2
      : 0;
    ramp(this.ambientBus.gain, ambience, this.context, 0.36);
  }

  unlock() {
    if (!this.ensureGraph()) return Promise.resolve(false);
    if (this.context.state === 'running') {
      this.onAudioReady();
      return Promise.resolve(true);
    }
    if (this.unlocking) return this.unlocking;
    this.unlocking = this.context.resume().then(() => {
      const ready = this.context?.state === 'running';
      this.unlocking = null;
      if (ready) this.onAudioReady();
      return ready;
    }).catch(error => {
      console.warn('Browsery audio could not start:', error);
      this.unlocking = null;
      return false;
    });
    return this.unlocking;
  }

  onAudioReady() {
    this.applyLevels();
    if (this.canPlayAmbience() && this.ambientNodes.length === 0) this.startAmbience();
    if (this.settings.startup && !this.startupPlayed) {
      this.startupPlayed = true;
      this.play('startup');
    }
  }

  startAmbience() {
    if (!this.context || !this.canPlayAmbience() || this.ambientNodes.length) return;
    const context = this.context;
    const theme = this.settings.theme;
    const profile = SOUND_PROFILES[theme] || SOUND_PROFILES.Crystalline;
    const waveform = theme === 'Analog' ? 'triangle' : 'sine';
    const basePans = [-0.36, 0.08, 0.42];

    this.ambientVoices = profile.map((frequency, index) => {
      const oscillator = context.createOscillator();
      const voiceGain = context.createGain();
      const panner = context.createStereoPanner();
      const drift = context.createOscillator();
      const driftDepth = context.createGain();
      const panDrift = context.createOscillator();
      const panDepth = context.createGain();

      oscillator.type = waveform;
      oscillator.frequency.value = frequency;
      voiceGain.gain.value = [0.064, 0.043, 0.029][index];
      panner.pan.value = this.settings.spatialaudio ? basePans[index] : 0;
      drift.frequency.value = 0.035 + index * 0.009;
      driftDepth.gain.value = 0.005 + index * 0.001;
      panDrift.frequency.value = 0.018 + index * 0.006;
      panDepth.gain.value = this.settings.spatialaudio ? 0.19 : 0;

      oscillator.connect(voiceGain);
      voiceGain.connect(panner);
      panner.connect(this.ambientBus);
      drift.connect(driftDepth);
      driftDepth.connect(voiceGain.gain);
      panDrift.connect(panDepth);
      panDepth.connect(panner.pan);

      oscillator.start();
      drift.start();
      panDrift.start();
      this.ambientNodes.push(oscillator, voiceGain, panner, drift, driftDepth, panDrift, panDepth);
      return { oscillator, panner, panDepth, frequency, basePan: basePans[index] };
    });

    // Quiet filtered air adds a little texture without any downloaded audio asset.
    const noiseBuffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
    const noise = noiseBuffer.getChannelData(0);
    let brown = 0;
    for (let index = 0; index < noise.length; index += 1) {
      brown = (brown + (Math.random() * 2 - 1) * 0.035) / 1.035;
      noise[index] = brown * 3.2;
    }
    const noiseSource = context.createBufferSource();
    const noiseFilter = context.createBiquadFilter();
    const noiseGain = context.createGain();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.value = 720;
    noiseGain.gain.value = 0.015;
    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.ambientBus);
    noiseSource.start();
    this.ambientNodes.push(noiseSource, noiseFilter, noiseGain);

    ramp(this.ambientBus.gain, (Number(this.settings.ambienceVolume) / 100) * 1.2, context, 0.85);
  }

  applyTheme() {
    const profile = SOUND_PROFILES[this.settings.theme] || SOUND_PROFILES.Crystalline;
    const waveform = this.settings.theme === 'Analog' ? 'triangle' : 'sine';
    const now = this.context.currentTime;
    this.ambientVoices.forEach((voice, index) => {
      voice.frequency = profile[index];
      voice.oscillator.type = waveform;
      voice.oscillator.frequency.setTargetAtTime(profile[index], now, 0.7);
    });
  }

  applySpatialField() {
    if (!this.context) return;
    const enabled = Boolean(this.settings.spatialaudio);
    const now = this.context.currentTime;
    this.ambientVoices.forEach(voice => {
      voice.panner.pan.setTargetAtTime(enabled ? voice.basePan : 0, now, 0.25);
      voice.panDepth.gain.setTargetAtTime(enabled ? 0.19 : 0, now, 0.25);
    });
  }

  fadeOutAmbience() {
    if (!this.context || this.ambientNodes.length === 0) return;
    ramp(this.ambientBus.gain, 0, this.context, 0.12);
    window.clearTimeout(this.ambientStopTimer);
    this.ambientStopTimer = window.setTimeout(() => {
      if (this.canPlayAmbience() || !this.context) return;
      this.ambientNodes.forEach(node => {
        try { node.stop?.(); } catch {}
        try { node.disconnect(); } catch {}
      });
      this.ambientNodes = [];
      this.ambientVoices = [];
      this.ambientStopTimer = 0;
      this.sleepWhenIdle(1000);
    }, 900);
  }

  getAnalyser() {
    return this.analyser;
  }

  preview() {
    return this.unlock().then(ready => {
      if (ready) this.play('preview');
      return ready;
    });
  }

  play(kind, horizontalPosition = 0.5) {
    const allowed = {
      click: Boolean(this.settings.clicks),
      hover: Boolean(this.settings.hover),
      startup: Boolean(this.settings.startup),
      download: Boolean(this.settings.downloadtone),
      preview: true,
    };
    if (!allowed[kind] || Number(this.settings.master) <= 0) return Promise.resolve(false);
    if (kind === 'hover') {
      const now = performance.now();
      if (now - this.lastHoverAt < 100) return Promise.resolve(false);
      this.lastHoverAt = now;
    }
    if (!this.context || this.context.state !== 'running') {
      return this.unlock().then(ready => ready ? this.play(kind, horizontalPosition) : false);
    }

    const context = this.context;
    const profile = SOUND_PROFILES[this.settings.theme] || SOUND_PROFILES.Crystalline;
    const base = profile[0];
    const toneSets = {
      click: [base * (this.settings.theme === 'Analog' ? 5.4 : 8)],
      hover: [base * 9.5],
      startup: [base * 2, base * 3, base * 4],
      download: [base * 4, base * 5, base * 7],
      preview: [base * 3, base * 4, base * 6],
    };
    const duration = { click: 0.09, hover: 0.045, startup: 0.72, download: 0.62, preview: 0.8 }[kind];
    const peak = { click: 0.065, hover: 0.018, startup: 0.04, download: 0.042, preview: 0.045 }[kind];
    const waveform = this.settings.theme === 'Analog' ? 'triangle' : 'sine';
    const pan = this.settings.spatialaudio ? clamp((Number(horizontalPosition) - 0.5) * 1.5, -0.75, 0.75) : 0;

    toneSets[kind].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      const panner = context.createStereoPanner();
      const now = context.currentTime;
      oscillator.type = waveform;
      oscillator.frequency.value = frequency;
      if (kind === 'hover') oscillator.detune.value = -18;
      panner.pan.value = pan;
      envelope.gain.setValueAtTime(0.0001, now);
      envelope.gain.exponentialRampToValueAtTime(peak / Math.sqrt(toneSets[kind].length), now + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(envelope);
      envelope.connect(panner);
      panner.connect(this.effectsBus);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.025);
      oscillator.onended = () => {
        oscillator.disconnect();
        envelope.disconnect();
        panner.disconnect();
      };
    });
    if (!this.canPlayAmbience()) this.sleepWhenIdle(1500);
    return Promise.resolve(true);
  }

  // Suspending the audio graph stops all audio processing, and its CPU use,
  // while nothing can be heard. The next sound resumes it on demand.
  sleep() {
    window.clearTimeout(this.sleepTimer);
    if (this.context?.state === 'running') this.context.suspend().catch(() => {});
  }

  sleepWhenIdle(delay = 4000) {
    window.clearTimeout(this.sleepTimer);
    this.sleepTimer = window.setTimeout(() => { if (!this.canPlayAmbience()) this.sleep(); }, delay);
  }

  wake() {
    window.clearTimeout(this.sleepTimer);
    if (this.context && this.canPlayAmbience()) this.unlock();
  }
}
