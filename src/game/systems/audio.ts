import { clamp } from '../math';

/**
 * Procedural audio.
 *
 * No sound files: every effect is synthesised with oscillators and shaped
 * noise inside one AudioContext. That means zero licensing questions, zero
 * asset 404s on the GitHub Pages sub-path, and the whole soundtrack fits in
 * the service-worker precache because it is not an asset at all.
 *
 * The context is created lazily on the first user gesture — autoplay policy
 * makes any earlier attempt resume as a silent suspended graph.
 */

export type SfxName =
  | 'swing1'
  | 'swing2'
  | 'swing3'
  | 'hitFlesh'
  | 'hitClang'
  | 'kill'
  | 'dodge'
  | 'footstep'
  | 'hurt'
  | 'miss'
  | 'death'
  | 'wolfGrowl'
  | 'wolfSnarl'
  | 'wolfBite'
  | 'uiClick'
  | 'uiBack'
  | 'levelClear';

interface AudioLevels {
  master: number;
  sfx: number;
  music: number;
}

class NoiseBufferCache {
  private oneSec: AudioBuffer | null = null;

  get(ctx: AudioContext): AudioBuffer {
    if (!this.oneSec) {
      const len = ctx.sampleRate;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i += 1) {
        const white = Math.random() * 2 - 1;
        // Brown-ish noise: softer, more "air" than raw white.
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.2 + white * 0.25;
      }
      this.oneSec = buf;
    }
    return this.oneSec;
  }
}

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private drone: { stop(): void } | null = null;
  private readonly noise = new NoiseBufferCache();
  private lastStepAt = 0;
  private muted = false;

  levels: AudioLevels = { master: 0.75, sfx: 0.9, music: 0.45 };

  /** Safe to call from a click handler; idempotent. */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.sfxBus = this.ctx.createGain();
      this.musicBus = this.ctx.createGain();
      // A gentle limiter stops stacked hits from clipping on phone speakers.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 22;
      comp.ratio.value = 8;
      comp.attack.value = 0.004;
      comp.release.value = 0.18;
      this.sfxBus.connect(comp);
      this.musicBus.connect(comp);
      comp.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.applyLevels();
    }
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        /* user gesture never landed; audio stays off, game still works */
      }
    }
  }

  setLevels(next: Partial<AudioLevels>): void {
    this.levels = { ...this.levels, ...next };
    this.applyLevels();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyLevels();
  }

  private applyLevels(): void {
    if (!this.master || !this.sfxBus || !this.musicBus || !this.ctx) return;
    const t = this.ctx.currentTime;
    const m = this.muted ? 0 : clamp(this.levels.master, 0, 1);
    this.master.gain.setTargetAtTime(m, t, 0.04);
    this.sfxBus.gain.setTargetAtTime(clamp(this.levels.sfx, 0, 1), t, 0.04);
    this.musicBus.gain.setTargetAtTime(clamp(this.levels.music, 0, 1) * 0.5, t, 0.04);
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  // ---- One-shot effects ------------------------------------------------

  play(name: SfxName, intensity = 1): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus || this.muted) return;
    const t = ctx.currentTime;

    switch (name) {
      case 'swing1':
      case 'swing2':
        this.airSwoosh(t, bus, 300, 1400, 0.22, 0.34 * intensity);
        break;
      case 'swing3':
        this.airSwoosh(t, bus, 180, 950, 0.34, 0.5 * intensity);
        this.tone(t, bus, { freq: 92, type: 'sawtooth', dur: 0.3, gain: 0.12, slideTo: 60 });
        break;
      case 'hitFlesh':
        this.thud(t, bus, 68, 0.24, 0.62 * intensity);
        this.noiseHit(t, bus, 900, 0.14, 0.34 * intensity, 'bandpass');
        break;
      case 'hitClang':
        this.metal(t, bus, 0.42 * intensity);
        this.thud(t, bus, 92, 0.16, 0.4 * intensity);
        break;
      case 'kill':
        this.thud(t, bus, 48, 0.5, 0.8);
        this.tone(t, bus, { freq: 150, type: 'sawtooth', dur: 0.7, gain: 0.2, slideTo: 42 });
        this.noiseHit(t, bus, 500, 0.5, 0.3, 'lowpass');
        break;
      case 'dodge':
        this.airSwoosh(t, bus, 620, 2600, 0.18, 0.26 * intensity);
        this.noiseHit(t, bus, 2200, 0.2, 0.18, 'highpass');
        break;
      case 'footstep': {
        // Heavier hooves read as a pig in plate, not a boot.
        const now = performance.now();
        if (now - this.lastStepAt < 90) return;
        this.lastStepAt = now;
        this.noiseHit(t, bus, 260, 0.09, 0.16 * intensity, 'lowpass');
        this.thud(t, bus, 118, 0.08, 0.2 * intensity);
        break;
      }
      case 'hurt':
        this.tone(t, bus, { freq: 220, type: 'square', dur: 0.2, gain: 0.16, slideTo: 110 });
        this.thud(t, bus, 74, 0.3, 0.6);
        this.noiseHit(t, bus, 700, 0.22, 0.3, 'bandpass');
        break;
      case 'death':
        this.tone(t, bus, { freq: 180, type: 'sawtooth', dur: 1.5, gain: 0.22, slideTo: 34 });
        this.thud(t, bus, 40, 1.1, 0.75);
        break;
      case 'wolfGrowl':
        this.growl(t, bus, 62, 0.9, 0.3 * intensity);
        break;
      case 'wolfSnarl':
        this.growl(t, bus, 84, 0.6, 0.34 * intensity);
        this.noiseHit(t, bus, 1600, 0.3, 0.2, 'bandpass');
        break;
      case 'wolfBite':
        this.thud(t, bus, 112, 0.14, 0.55);
        this.noiseHit(t, bus, 1300, 0.1, 0.32, 'bandpass');
        this.tone(t, bus, { freq: 340, type: 'square', dur: 0.1, gain: 0.12, slideTo: 170 });
        break;
      case 'miss':
        this.whiff(t, bus);
        break;
      case 'uiClick':
        this.tone(t, bus, { freq: 640, type: 'triangle', dur: 0.07, gain: 0.14 });
        break;
      case 'uiBack':
        this.tone(t, bus, { freq: 300, type: 'triangle', dur: 0.09, gain: 0.12, slideTo: 210 });
        break;
      case 'levelClear':
        [0, 0.14, 0.3, 0.5].forEach((delay, i) => {
          const scale = [146.83, 174.61, 220, 293.66][i];
          this.tone(t + delay, bus, { freq: scale, type: 'triangle', dur: 0.7, gain: 0.14 });
        });
        break;
      default:
        break;
    }
  }

  private tone(
    t: number,
    bus: GainNode,
    opts: { freq: number; type: OscillatorType; dur: number; gain: number; slideTo?: number },
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.freq, t);
    if (opts.slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), t + opts.dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, opts.gain), t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(t);
    osc.stop(t + opts.dur + 0.05);
  }

  private thud(t: number, bus: GainNode, freq: number, dur: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 6, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, freq), t + dur);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.6, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(24, freq * 0.55), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filter);
    filter.connect(g);
    g.connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private noiseHit(
    t: number,
    bus: GainNode,
    cutoff: number,
    dur: number,
    gain: number,
    type: BiquadFilterType,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise.get(ctx);
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = type === 'bandpass' ? 1.4 : 0.7;
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.35), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(bus);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** Sword through air: rising then falling band-passed noise. */
  private airSwoosh(t: number, bus: GainNode, from: number, to: number, dur: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise.get(ctx);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.4;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + dur * 0.55);
    bp.frequency.exponentialRampToValueAtTime(from * 0.8, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(bus);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** Blade on bone/iron: detuned partials with a fast decay. */
  private metal(t: number, bus: GainNode, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    [1040, 1560, 2330, 3120].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = i % 2 === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(f * (1 + (Math.random() - 0.5) * 0.03), t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain * (0.5 / (i + 1)), t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55 - i * 0.08);
      osc.connect(g);
      g.connect(bus);
      osc.start(t);
      osc.stop(t + 0.6);
    });
  }

  /** Wolf throat: low sawtooth tremolo plus filtered breath. */
  /** Dry heave: the sound of a swing that was never paid for. */
  private whiff(t: number, out: AudioNode): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(72, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    o.connect(lp).connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.22);
  }

  private growl(t: number, bus: GainNode, freq: number, dur: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.linearRampToValueAtTime(freq * 0.82, t + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(24, t);
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(freq * 0.12, t);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    const sh = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i += 1) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 3.4);
    }
    sh.curve = curve;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(420, t);
    lp.frequency.linearRampToValueAtTime(240, t + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), t + 0.08);
    g.gain.setValueAtTime(Math.max(0.001, gain), t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(sh);
    sh.connect(lp);
    lp.connect(g);
    g.connect(bus);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);

    this.noiseHit(t, bus, 380, dur * 0.8, gain * 0.4, 'bandpass');
  }

  // ---- Ambient bed -----------------------------------------------------

  /**
  * A slow, two-note drone under the whole game. Cost is two detuned saws
  * through a lowpass and a long-release gain — it loops itself, so no
  * scheduler and no audio files.
  */
  startAmbience(): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus || this.drone) return;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 4);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    lp.Q.value = 0.9;

    const filterLfo = ctx.createOscillator();
    const filterDepth = ctx.createGain();
    filterLfo.frequency.value = 0.06;
    filterDepth.gain.value = 120;
    filterLfo.connect(filterDepth);
    filterDepth.connect(lp.frequency);

    const voices: OscillatorNode[] = [];
    [55, 82.4, 110.2, 164.8].forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = i < 2 ? 'sawtooth' : 'triangle';
      osc.frequency.value = f;
      osc.detune.value = (i - 1.5) * 7;
      const vg = ctx.createGain();
      vg.gain.value = 0.3 / (i + 1);
      osc.connect(vg);
      vg.connect(lp);
      osc.start();
      voices.push(osc);
    });

    lp.connect(gain);
    gain.connect(bus);
    filterLfo.start();

    // Wind layer: noise through a very slow band sweep.
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise.get(ctx);
    wind.loop = true;
    const windBp = ctx.createBiquadFilter();
    windBp.type = 'bandpass';
    windBp.Q.value = 0.7;
    windBp.frequency.value = 420;
    const windLfo = ctx.createOscillator();
    windLfo.frequency.value = 0.037;
    const windDepth = ctx.createGain();
    windDepth.gain.value = 260;
    windLfo.connect(windDepth);
    windDepth.connect(windBp.frequency);
    const windGain = ctx.createGain();
    windGain.gain.value = 0.22;
    wind.connect(windBp);
    windBp.connect(windGain);
    windGain.connect(gain);
    wind.start();
    windLfo.start();

    this.drone = {
      stop: () => {
        try {
          const now = ctx.currentTime;
          gain.gain.cancelScheduledValues(now);
          gain.gain.setValueAtTime(gain.gain.value, now);
          gain.gain.linearRampToValueAtTime(0.0001, now + 0.6);
          voices.forEach((o) => o.stop(now + 0.7));
          filterLfo.stop(now + 0.7);
          windLfo.stop(now + 0.7);
          wind.stop(now + 0.7);
        } catch {
          /* already stopped */
        }
      },
    };
  }

  stopAmbience(): void {
    this.drone?.stop();
    this.drone = null;
  }

  dispose(): void {
    this.stopAmbience();
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
  }
}
