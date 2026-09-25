// ==============================================================================
// AirDnD Tactical Electronic Warfare — RF Spectrum Waterfall Canvas
// Real-time rolling waterfall display for drone control and video bands
// ==============================================================================

export class RfWaterfall {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.width = this.canvas ? this.canvas.width : 450;
    this.height = this.canvas ? this.canvas.height : 220;
    this.history = [];
    this.isJamming = false;
    this.jamPower = 85;
    this.animationId = null;
    this.init();
  }

  init() {
    if (!this.ctx) return;
    // Pre-fill black background
    this.ctx.fillStyle = '#03060c';
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  setJamming(active, power = 85) {
    this.isJamming = active;
    this.jamPower = power;
  }

  // Generate a single spectrum sweep line (450 frequency bins)
  generateSweep() {
    const bins = new Float32Array(this.width);
    const time = Date.now() / 1000;

    // Base thermal RF noise floor (-105 dBm normalized)
    for (let x = 0; x < this.width; x++) {
      bins[x] = 0.08 + Math.random() * 0.06;
    }

    // 1. Sub-GHz Band (bins 40 to 120, ~915 MHz ExpressLRS hopping pulses)
    const elrsCenter = 60 + Math.floor(Math.sin(time * 8) * 35);
    for (let dx = -6; dx <= 6; dx++) {
      const idx = elrsCenter + dx;
      if (idx >= 0 && idx < this.width) {
        bins[idx] += 0.45 * Math.exp(-(dx * dx) / 8);
      }
    }

    // 2. 2.4 GHz Band (bins 180 to 300, DJI OcuSync multi-carrier 8ms bursts)
    const ocuSyncActive = (Math.sin(time * 12) > -0.2);
    if (ocuSyncActive) {
      for (let carrier = 0; carrier < 4; carrier++) {
        const center = 200 + carrier * 25 + Math.floor(Math.sin(time * 3 + carrier) * 8);
        for (let dx = -8; dx <= 8; dx++) {
          const idx = center + dx;
          if (idx >= 0 && idx < this.width) {
            bins[idx] += 0.65 * Math.exp(-(dx * dx) / 12);
          }
        }
      }
    }

    // 3. 5.8 GHz Band (bins 340 to 420, Analog FPV video carrier)
    const fpvCenter = 380 + Math.floor(Math.sin(time * 2) * 15);
    for (let dx = -10; dx <= 10; dx++) {
      const idx = fpvCenter + dx;
      if (idx >= 0 && idx < this.width) {
        bins[idx] += 0.55 * Math.exp(-(dx * dx) / 15);
      }
    }

    // 4. Electronic Warfare Jamming Noise (Floods entire spectrum with broadband jammer pulse)
    if (this.isJamming) {
      const jamIntensity = (this.jamPower / 100) * 0.85;
      for (let x = 0; x < this.width; x++) {
        bins[x] = Math.min(1.0, bins[x] + jamIntensity * (0.5 + Math.random() * 0.5));
      }
    }

    return bins;
  }

  // Draw rolling waterfall frame
  step() {
    if (!this.ctx) return;

    // 1. Shift canvas content downward by 2 pixels
    const imgData = this.ctx.getImageData(0, 0, this.width, this.height - 2);
    this.ctx.putImageData(imgData, 0, 2);

    // 2. Generate new top line
    const bins = this.generateSweep();
    const lineImg = this.ctx.createImageData(this.width, 2);

    for (let x = 0; x < this.width; x++) {
      const power = bins[x];
      // Multi-stop heat color ramp: Navy -> Cyan -> Green -> Amber -> Red -> White
      let r, g, b;
      if (power < 0.2) {
        // Cold noise: Deep Navy / Black
        r = 5;
        g = 12 + Math.floor(power * 100);
        b = 30 + Math.floor(power * 250);
      } else if (power < 0.45) {
        // Low signal: Cyan
        const t = (power - 0.2) / 0.25;
        r = Math.floor(10 + t * 20);
        g = Math.floor(60 + t * 180);
        b = Math.floor(120 + t * 135);
      } else if (power < 0.7) {
        // Active carrier: Emerald to Amber
        const t = (power - 0.45) / 0.25;
        r = Math.floor(30 + t * 220);
        g = Math.floor(220 - t * 40);
        b = Math.floor(120 - t * 120);
      } else {
        // High power / Jammer: Crimson to White
        const t = (power - 0.7) / 0.3;
        r = Math.floor(255);
        g = Math.floor(40 + t * 215);
        b = Math.floor(40 + t * 215);
      }

      // Write 2 rows of pixels
      for (let y = 0; y < 2; y++) {
        const offset = (y * this.width + x) * 4;
        lineImg.data[offset] = r;
        lineImg.data[offset + 1] = g;
        lineImg.data[offset + 2] = b;
        lineImg.data[offset + 3] = 255;
      }
    }

    this.ctx.putImageData(lineImg, 0, 0);
  }

  start() {
    if (this.animationId) return;
    const loop = () => {
      this.step();
      this.animationId = requestAnimationFrame(loop);
    };
    this.animationId = requestAnimationFrame(loop);
  }

  stop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }
}
