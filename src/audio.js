// ==============================================================================
// AirDnD Tactical Audio Engine — Procedural Web Audio Synthesizer
// 100% offline, zero-asset military sound effects via Web Audio API
// ==============================================================================

class TacticalAudioEngine {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  // 1. Radar Sweep Ping: Soft high-tech resonant sweep (880 Hz)
  playRadarPing() {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, this.ctx.currentTime + 0.15);

      gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.18);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.2);
    } catch (_) {}
  }

  // 2. Lock-On Chirp: Rapid tactical dual-tone lock confirmation
  playLockOn() {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1400, this.ctx.currentTime);
      osc.frequency.setValueAtTime(1800, this.ctx.currentTime + 0.05);

      gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.12);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.14);
    } catch (_) {}
  }

  // 3. EW Jamming Alarm: Urgent dual-tone pulse with static noise
  playJammingAlarm() {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx) return;

    try {
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.type = 'sawtooth';
      osc2.type = 'square';
      osc1.frequency.setValueAtTime(480, this.ctx.currentTime);
      osc2.frequency.setValueAtTime(620, this.ctx.currentTime);

      gain.gain.setValueAtTime(0.18, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.45);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.start();
      osc2.start();
      osc1.stop(this.ctx.currentTime + 0.48);
      osc2.stop(this.ctx.currentTime + 0.48);
    } catch (_) {}
  }

  // 4. Kinetic Intercept Explosion: Low-frequency noise burst with deep bass drop
  playExplosion() {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx) return;

    try {
      // Noise buffer for blast crackle
      const bufferSize = this.ctx.sampleRate * 0.4;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      // Lowpass filter to simulate explosive shockwave
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(600, this.ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(80, this.ctx.currentTime + 0.35);

      // Deep sub-bass thud
      const bassOsc = this.ctx.createOscillator();
      bassOsc.type = 'sine';
      bassOsc.frequency.setValueAtTime(110, this.ctx.currentTime);
      bassOsc.frequency.exponentialRampToValueAtTime(28, this.ctx.currentTime + 0.35);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.35, this.ctx.currentTime);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.35);

      const bassGain = this.ctx.createGain();
      bassGain.gain.setValueAtTime(0.45, this.ctx.currentTime);
      bassGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.38);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.ctx.destination);

      bassOsc.connect(bassGain);
      bassGain.connect(this.ctx.destination);

      noise.start();
      bassOsc.start();
      noise.stop(this.ctx.currentTime + 0.4);
      bassOsc.stop(this.ctx.currentTime + 0.4);
    } catch (_) {}
  }

  // 5. Radio Squelch Click: Tactical VHF walkie-talkie keying sound
  playRadioClick() {
    if (this.isMuted) return;
    this.ensureContext();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(2200, this.ctx.currentTime);

      gain.gain.setValueAtTime(0.06, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.04);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.05);
    } catch (_) {}
  }
}

export const soundFx = new TacticalAudioEngine();
