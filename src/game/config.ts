/**
 * Every gameplay number lives here so tuning is a single-file edit and the
 * prototype never drifts from its own constants. Units: metres, seconds,
 * damage points. Facing convention: yaw 0 looks down +Z.
 */

export const WORLD = {
  /** Display name used by the boot bar and the settings footer. */
  name: 'The Dimwood',
  /** Invisible circular wall — the Dimwood "ends" in fog before it. */
  arenaRadius: 46,
  /** Trees and rocks are kept out of this radius so the fight has room. */
  clearingRadius: 9,
  groundExtent: 120,
  fogDensity: 0.021,
  fogColor: [0.043, 0.072, 0.062] as const,
  /** Seeded so the generated forest is identical on every device. */
  seed: 20261117,
  treeCount: { high: 148, medium: 96, low: 58 },
  rockCount: { high: 64, medium: 42, low: 24 },
  grassCount: { high: 1400, medium: 800, low: 380 },
  fireflyCount: { high: 900, medium: 500, low: 240 },
  emberCount: { high: 260, medium: 160, low: 90 },
};

export const PLAYER = {
  name: 'ARNO',
  title: 'Pig Knight of the Dimwood',
  maxHp: 120,
  maxStamina: 100,

  radius: 0.44,
  /** Feet sit at terrain height; the rig's eyes are this far above the feet. */
  eyeHeight: 1.52,

  walkSpeed: 4.35,
  runSpeed: 7.45,
  /** Backward input is a shuffling step, as in most character-action games. */
  backSpeedScale: 0.72,
  accel: 30,
  decel: 34,
  turnRate: 14,

  staminaRunDrain: 10.5,
  staminaRegen: 26,
  /** Regen is slowed while mid-swing so attack spam has a cost. */
  staminaRegenWhileAttacking: 8,
  staminaAttackCost: 7,
  staminaDodgeCost: 24,
  /** Must stay above this to start a dodge; prevents 0-stamina panic rolls. */
  dodgeStaminaMin: 14,

  dodgeDuration: 0.46,
  dodgeInvulnFrom: 0.06,
  dodgeInvulnTo: 0.4,
  dodgeCooldown: 0.52,
  dodgePower: 8.4,
  /** Speed curve of the roll: sharp launch, soft landing. */
  dodgeCurve: [1.9, 1.35, 0.55, 0.2] as const,

  /**
   * A key or tap that begins and ends inside one frame is still heard for
   * this long. Without it, a fast press is dropped entirely whenever the
   * frame budget slips — the swing feels eaten, not the key ignored.
   */
  inputBufferMs: 220,
  comboWindow: 0.66,
  attackWindup: 0.11,
  /**
   * Each entry: total duration, the active-hit window [start,end], damage,
   * poise damage, arc and reach. `finisher` is present on all three (rather
   * than only the last) so `PLAYER.combo[i]` stays a single object type and
   * the animation code can read it without a narrowing test.
   */
  combo: [
    { duration: 0.46, hitFrom: 0.13, hitTo: 0.26, damage: 16, poise: 12, arc: 118, reach: 2.75, finisher: false },
    { duration: 0.44, hitFrom: 0.12, hitTo: 0.25, damage: 15, poise: 12, arc: 128, reach: 2.7, finisher: false },
    {
      duration: 0.74,
      hitFrom: 0.2,
      hitTo: 0.4,
      damage: 33,
      poise: 34,
      arc: 150,
      reach: 3.05,
      finisher: true,
    },
  ],
  /** Angle (degrees from facing) within which a hit registers. */
  hitArcDeg: 105,
  hitStopStrong: 0.075,
  hitStopWeak: 0.045,

  hurtInvuln: 0.62,
  knockbackSelf: 3.4,
  /** Small forgiveness radius so near-misses from the joystick still count. */
  deadzone: 0.16,
};

export const WOLF = {
  name: 'Dimwood Wolf',
  maxHp: 84,
  radius: 0.42,

  patrolSpeed: 1.35,
  stalkSpeed: 2.5,
  chaseSpeed: 5.55,
  lungeSpeed: 10.2,
  turnRate: 6.2,
  /** Player distance at which it stops and circles instead of charging. */
  leashRadius: WORLD.arenaRadius - 4,
  sightRange: 21,
  /** Degrees of forward vision; wolves also hear attacks. */
  sightArcDeg: 150,
  attackRange: 2.35,
  damage: 18,
  poiseBreak: 30,

  stateTimes: {
    alert: 0.85,
    windup: 0.52,
    lunge: 0.34,
    recover: 0.72,
    biteCooldown: 1.15,
    stagger: 0.42,
    heavyStagger: 0.9,
    deathFall: 1.1,
    respawnDelay: 9.5,
  },
  /** Chase aggression ramps as the pack thins, so later hunts are tighter. */
  aggressionPerKill: 0.06,
};

export const CAMERA = {
  distance: 5.6,
  minDistance: 2.4,
  maxDistance: 9,
  /**
   * `pitch` is the camera's elevation above the shoulder line, in radians:
   * 0 looks straight down ARNO's spine, larger looks down at his back.
   */
  minPitch: 0.06,
  maxPitch: 0.92,
  pitchStart: 0.3,
  followRate: 9.5,
  /** Camera sits this far above the character's feet. */
  targetHeight: 1.42,
  /** Slow push-in while running, standard third-person feel. */
  runDistanceBoost: 0.42,
  shakeDecay: 7.5,
  fovIdle: 0.86,
  fovRun: 0.98,
};

export const HUD = {
  /** HUD state is pushed to React at most this often (per second). */
  pushRate: 30,
  toastDurationMs: 2200,
  damageNumberMs: 900,
};

export type QualityLevel = 'low' | 'medium' | 'high';

export const QUALITY: Record<
  QualityLevel,
  {
    label: string;
    hardwareScalingCap: number;
    shadowMapSize: number;
    postProcess: boolean;
    bloom: boolean;
    grassScale: number;
    particleScale: number;
    maxFps: number;
  }
> = {
  low: {
    label: 'Low',
    hardwareScalingCap: 1.6,
    shadowMapSize: 0,
    postProcess: false,
    bloom: false,
    grassScale: 0.35,
    particleScale: 0.4,
    maxFps: 30,
  },
  medium: {
    label: 'Medium',
    hardwareScalingCap: 1.3,
    shadowMapSize: 1024,
    postProcess: true,
    bloom: true,
    grassScale: 0.65,
    particleScale: 0.7,
    maxFps: 60,
  },
  high: {
    label: 'High',
    hardwareScalingCap: 1.0,
    shadowMapSize: 2048,
    postProcess: true,
    bloom: true,
    grassScale: 1,
    particleScale: 1,
    maxFps: 60,
  },
};

export const DEFAULTS = {
  quality: 'medium' as QualityLevel,
  masterVolume: 0.75,
  sfxVolume: 0.9,
  musicVolume: 0.45,
  invertY: false,
  showFps: false,
  joystickSize: 132,
  buttonSize: 66,
  cameraSensitivity: 1,
  /** Touch controls appear automatically, but can be forced on for testing. */
  touchControls: 'auto' as 'auto' | 'always' | 'never',
};

export const STORAGE_KEYS = {
  settings: 'settings',
  profile: 'profile',
  checkpoint: 'checkpoint',
};

export const GAME_VERSION = '0.1.0';
