import type { QualityLevel } from './config';

export type Phase = 'boot' | 'menu' | 'playing' | 'paused' | 'dead' | 'cleared';

export interface HudState {
  phase: Phase;
  loadingPct: number;
  loadingLabel: string;

  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;

  comboIndex: number;
  comboCount: number;

  kills: number;
  runKills: number;
  wolvesAlive: number;
  timeMs: number;

  /** The wolf ARNO is currently facing / locked onto, if any. */
  targetName: string | null;
  targetHp: number;
  targetMaxHp: number;
  targetVisible: boolean;

  toast: string | null;
  toastId: number;

  dodgeReady: boolean;
  staminaLocked: boolean;

  fps: number;
  msPerFrame: number;
  drawCalls: number;

  isTouch: boolean;
  quality: QualityLevel;
}

export const initialHud: HudState = {
  phase: 'boot',
  loadingPct: 0,
  loadingLabel: 'Waking the Dimwood',

  hp: 120,
  maxHp: 120,
  stamina: 100,
  maxStamina: 100,

  comboIndex: 0,
  comboCount: 0,

  kills: 0,
  runKills: 0,
  wolvesAlive: 1,
  timeMs: 0,

  targetName: null,
  targetHp: 0,
  targetMaxHp: 0,
  targetVisible: false,

  toast: null,
  toastId: 0,

  dodgeReady: true,
  staminaLocked: false,

  fps: 0,
  msPerFrame: 0,
  drawCalls: 0,

  isTouch: false,
  quality: 'medium',
};

/** One floating combat number, projected from world space into a DOM node. */
export interface DamageFloater {
  id: number;
  text: string;
  kind: 'player-hit' | 'crit' | 'player-hurt' | 'miss' | 'block';
  /** Normalised screen position, updated by the engine each frame. */
  x: number;
  y: number;
  bornAt: number;
}

export interface Settings {
  quality: QualityLevel;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  invertY: boolean;
  showFps: boolean;
  joystickSize: number;
  buttonSize: number;
  cameraSensitivity: number;
  touchControls: 'auto' | 'always' | 'never';
}

export interface Profile {
  totalKills: number;
  bestRunKills: number;
  bestRunMs: number;
  runs: number;
  deaths: number;
  firstPlayedAt: number;
  lastPlayedAt: number;
  playMs: number;
}

export interface Checkpoint {
  hp: number;
  kills: number;
  x: number;
  z: number;
  savedAt: number;
}

export const defaultSettings: Settings = {
  quality: 'medium',
  masterVolume: 0.75,
  sfxVolume: 0.9,
  musicVolume: 0.45,
  invertY: false,
  showFps: false,
  joystickSize: 132,
  buttonSize: 66,
  cameraSensitivity: 1,
  touchControls: 'auto',
};

export const defaultProfile: Profile = {
  totalKills: 0,
  bestRunKills: 0,
  bestRunMs: 0,
  runs: 0,
  deaths: 0,
  firstPlayedAt: 0,
  lastPlayedAt: 0,
  playMs: 0,
};
