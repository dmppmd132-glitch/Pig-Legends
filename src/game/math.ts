import { Vector3 } from './babylon';

export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const clamp01 = (v: number): number => clamp(v, 0, 1);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const invLerp = (a: number, b: number, v: number): number =>
  a === b ? 0 : (v - a) / (b - a);

export const remap = (v: number, a: number, b: number, c: number, d: number): number =>
  lerp(c, d, clamp01(invLerp(a, b, v)));

/** Frame-rate independent exponential approach. `rate` = 1/s convergence. */
export const damp = (current: number, target: number, rate: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-rate * dt));

/** Shortest-arc angle difference in radians, result in (-PI, PI]. */
export const angleDelta = (from: number, to: number): number => {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
};

export const dampAngle = (current: number, target: number, rate: number, dt: number): number =>
  current + angleDelta(current, target) * (1 - Math.exp(-rate * dt));

export const smoothstep = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInCubic = (t: number): number => Math.pow(clamp01(t), 3);
export const easeOutBack = (t: number): number => {
  const x = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/** 0 → 1 → 0 over t in [0,1]; the shape used for swing/flick envelopes. */
export const pulse = (t: number, sharpness = 1): number => {
  const x = clamp01(t);
  return Math.sin(Math.pow(x, 1 / sharpness) * Math.PI);
};

/** Deterministic PRNG (mulberry32). Same seed ⇒ same Dimwood on every device. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  int(lo: number, hi: number): number {
    return Math.floor(this.range(lo, hi + 1));
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }
}

/** Cheap analytic height field: characters and terrain share this exactly, so
 *  no picking ray is needed to keep ARNO on the ground. */
export function terrainHeight(x: number, z: number): number {
  const near =
    Math.sin(x * 0.12) * Math.cos(z * 0.14) * 0.75 +
    Math.sin(x * 0.041 + z * 0.073) * 1.35 +
    Math.cos(x * 0.083 - z * 0.037) * 0.55;
  const fine = Math.sin(x * 0.43) * Math.cos(z * 0.39) * 0.11;
  // Flatten the clearing around the origin so the fight starts on level ground.
  const d = Math.hypot(x, z);
  const flat = smoothstep(clamp01((d - 7) / 16));
  return (near + fine) * flat;
}

export const vec3 = (x = 0, y = 0, z = 0): Vector3 => new Vector3(x, y, z);

/** Yaw in radians for a direction vector; 0 faces +Z (Babylon default forward). */
export const yawFromDir = (x: number, z: number): number => Math.atan2(x, z);

export const forwardFromYaw = (yaw: number): Vector3 =>
  new Vector3(Math.sin(yaw), 0, Math.cos(yaw));

export const degrees = (radians: number): number => (radians * 180) / Math.PI;
export const radians = (deg: number): number => (deg * Math.PI) / 180;

/** Format milliseconds as m:ss for the HUD without pulling in Intl per frame. */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
