import { Scene, TransformNode, Vector3 } from '../babylon';
import { PLAYER } from '../config';
import type { CharacterMaterials } from '../materials';
import {
  clamp,
  clamp01,
  damp,
  dampAngle,
  easeOutCubic,
  lerp,
  pulse,
  terrainHeight,
  yawFromDir,
} from '../math';
import { buildPigKnight, type PigKnightRig } from './PigKnightModel';
import type { InputFrame } from '../input/InputSystem';

export type PlayerState = 'idle' | 'walk' | 'run' | 'attack' | 'dodge' | 'hurt' | 'dead';

/** A swing that is currently allowed to land, and has not landed yet. */
export interface ActiveHit {
  centre: Vector3;
  facing: number;
  arcDeg: number;
  reach: number;
  damage: number;
  poise: number;
  finisher: boolean;
  comboStep: number;
}

/**
 * Animation amplitudes in radians. Kept together and named so the walk and
 * swing cycles can be retuned without hunting through the state machine —
 * these are the numbers a human will want to change after watching it run.
 */
const POSE = {
  strideWalk: 6.2,
  strideRun: 9.4,
  legWalk: 0.44,
  legRun: 0.82,
  kneeWalk: 0.55,
  kneeRun: 1.15,
  armSwing: 0.3,
  bobWalk: 0.028,
  bobRun: 0.055,
  leanWalk: 0.06,
  leanRun: 0.2,
  headStabilise: -0.12,
  breatheRate: 1.5,
  breatheAmp: 0.022,
  idleLook: 0.22,
  capeSway: 0.28,
  guardShoulder: -0.34,
  wind: 0.9,
};

export class PigKnight {
  /** Anchor carries facing; the model root inside it is free for the roll. */
  readonly anchor: TransformNode;
  readonly rig: PigKnightRig;

  readonly position = new Vector3(0, 0, 0);
  yaw = 0;

  hp = PLAYER.maxHp;
  stamina = PLAYER.maxStamina;
  state: PlayerState = 'idle';

  /** Combo cursor, -1 when the chain has lapsed. */
  comboStep = -1;
  private comboTime = 0;

  private attackTime = 0;
  private attackHasLanded = false;
  private dodgeTime = 0;
  private dodgeCooldown = 0;
  private dodgeDir = new Vector3(0, 0, 1);
  private hurtTime = 0;
  private invulnTime = 0;
  private deadTime = 0;

  /** Knockback impulse, decays exponentially; integrated every frame. */
  private readonly impulse = new Vector3(0, 0, 0);

  private stride = 0;
  private time = 0;
  private speedNow = 0;
  private lastStepSide = 0;

  /** Events the engine turns into audio, FX and HUD noise. */
  onStep?: (side: number, speed: number) => void;
  onSwing?: (step: number) => void;
  onDodge?: () => void;
  onHurt?: (damage: number) => void;
  onDeath?: () => void;

  constructor(scene: Scene, mats: CharacterMaterials, parent: TransformNode) {
    this.anchor = new TransformNode('arno-anchor', scene);
    this.anchor.parent = parent;
    this.rig = buildPigKnight(scene, mats, this.anchor).captureRest();
    this.applyRoot();
  }

  /** Free the rig and every mesh it owns. The scene owns the materials. */
  dispose(): void {
    this.rig.dispose();
    this.anchor.dispose();
  }

  /** True when a roll is available: drives the HUD and the touch button. */
  get dodgeReady(): boolean {
    return (
      this.dodgeCooldown <= 0 &&
      this.stamina >= PLAYER.dodgeStaminaMin &&
      this.state !== 'dodge' &&
      this.state !== 'dead'
    );
  }

  get facing(): Vector3 {
    return new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  get invulnerable(): boolean {
    return this.invulnTime > 0 || (this.state === 'dodge' && this.dodgeTime >= PLAYER.dodgeInvulnFrom && this.dodgeTime <= PLAYER.dodgeInvulnTo);
  }

  get canAct(): boolean {
    return this.state === 'idle' || this.state === 'walk' || this.state === 'run' || (this.state === 'attack' && this.attackTime > 0.6);
  }

  get chestWorld(): Vector3 {
    return new Vector3(this.position.x, this.position.y + 1.1, this.position.z);
  }

  // ------------------------------------------------------------------
  // Public commands
  // ------------------------------------------------------------------

  /** Queue a swing; returns false when the state or stamina forbids it. */
  tryAttack(): boolean {
    if (this.state === 'dodge' || this.state === 'hurt' || this.state === 'dead') return false;
    if (this.state === 'attack' && this.attackTime < 0.2) return false;
    if (this.stamina < PLAYER.staminaAttackCost) return false;

    this.comboStep = this.comboTime > 0 && this.comboStep >= 0 ? (this.comboStep + 1) % PLAYER.combo.length : 0;
    this.comboTime = PLAYER.comboWindow;
    this.attackTime = 0;
    this.attackHasLanded = false;
    this.state = 'attack';
    this.stamina = Math.max(0, this.stamina - PLAYER.staminaAttackCost);
    this.onSwing?.(this.comboStep);
    return true;
  }

  tryDodge(preferredDir?: { x: number; z: number }): boolean {
    if (this.state === 'dead' || this.state === 'attack') return false;
    if (this.dodgeCooldown > 0 || this.stamina < PLAYER.dodgeStaminaMin) return false;

    const dx = preferredDir?.x ?? this.dodgeDir.x;
    const dz = preferredDir?.z ?? this.dodgeDir.z;
    if (Math.hypot(dx, dz) > 0.05) this.dodgeDir.set(dx, 0, dz).normalize();
    else this.dodgeDir.copyFrom(this.facing);

    this.state = 'dodge';
    this.dodgeTime = 0;
    this.dodgeCooldown = PLAYER.dodgeCooldown + PLAYER.dodgeDuration;
    this.stamina = Math.max(0, this.stamina - PLAYER.staminaDodgeCost);
    this.comboStep = -1;
    this.onDodge?.();
    return true;
  }

  takeHit(damage: number, fromWorld: Vector3): boolean {
    if (this.invulnerable || this.state === 'dead') return false;
    this.hp = Math.max(0, this.hp - damage);
    this.invulnTime = PLAYER.hurtInvuln;
    this.hurtTime = 0.34;
    this.state = 'hurt';
    this.comboStep = -1;
    this.attackTime = 0;

    const away = new Vector3(this.position.x - fromWorld.x, 0, this.position.z - fromWorld.z);
    if (away.lengthSquared() < 1e-6) away.copyFrom(this.facing.scale(-1));
    away.normalize();
    this.impulse.copyFrom(away.scale(PLAYER.knockbackSelf));

    this.onHurt?.(damage);
    if (this.hp <= 0) this.die();
    return true;
  }

  die(): void {
    if (this.state === 'dead') return;
    this.hp = 0;
    this.state = 'dead';
    this.deadTime = 0;
    this.onDeath?.();
  }

  /** Respawn at a spot, refilling vitals. `keepCombo` false clears the chain. */
  reviveAt(x: number, z: number): void {
    this.position.set(x, terrainHeight(x, z), z);
    this.hp = PLAYER.maxHp;
    this.stamina = PLAYER.maxStamina;
    this.state = 'idle';
    this.comboStep = -1;
    this.comboTime = 0;
    this.attackTime = 0;
    this.dodgeTime = 0;
    this.dodgeCooldown = 0;
    this.hurtTime = 0;
    this.invulnTime = 1.1;
    this.deadTime = 0;
    this.impulse.set(0, 0, 0);
    this.stride = 0;
    this.anchor.rotation.set(0, this.yaw, 0);
    this.applyRoot();
  }

  // ------------------------------------------------------------------
  // Per-frame
  // ------------------------------------------------------------------

  /**
   * @param camYaw  camera heading; movement is authored in camera space
   * @param obstacles trunk circles to slide along
   * @param obstaclesRadius arena wall
   */
  update(
    dt: number,
    input: InputFrame,
    camYaw: number,
    obstacles: ReadonlyArray<{ x: number; z: number; r: number }>,
    arenaRadius: number,
  ): void {
    this.time += dt;
    this.invulnTime = Math.max(0, this.invulnTime - dt);
    this.dodgeCooldown = Math.max(0, this.dodgeCooldown - dt);
    this.comboTime = Math.max(0, this.comboTime - dt);
    if (this.comboTime === 0) this.comboStep = -1;

    const mx = input.move.x;
    const my = input.move.y;
    const inputMag = Math.hypot(mx, my);
    const wantsMove = inputMag > 0.001;

    // World-space move vector from camera-relative stick input.
    const fwdX = Math.sin(camYaw);
    const fwdZ = Math.cos(camYaw);
    const rightX = -fwdZ;
    const rightZ = fwdX;
    let wx = rightX * mx + fwdX * my;
    let wz = rightZ * mx + fwdZ * my;
    const wLen = Math.hypot(wx, wz);
    if (wLen > 1e-5) {
      wx /= wLen;
      wz /= wLen;
    }

    // ---------------- state machine ----------------
    switch (this.state) {
      case 'dead':
        this.deadTime += dt;
        break;

      case 'hurt':
        this.hurtTime = Math.max(0, this.hurtTime - dt);
        if (this.hurtTime === 0) this.state = 'idle';
        break;

      case 'dodge': {
        this.dodgeTime += dt;
        // Launch curve: fast out of the gate, soft landing.
        const p = clamp01(this.dodgeTime / PLAYER.dodgeDuration);
        const c = PLAYER.dodgeCurve;
        const speed =
          p < 0.25 ? lerp(c[0], c[1], p / 0.25) : p < 0.5 ? lerp(c[1], c[2], (p - 0.25) / 0.25) : lerp(c[2], c[3], (p - 0.5) / 0.5);
        const dist = PLAYER.dodgePower * speed * dt;
        this.position.x += this.dodgeDir.x * dist;
        this.position.z += this.dodgeDir.z * dist;
        wx = this.dodgeDir.x;
        wz = this.dodgeDir.z;
        this.yaw = dampAngle(this.yaw, yawFromDir(wx, wz), 16, dt);
        this.speedNow = dist / dt;
        if (this.dodgeTime >= PLAYER.dodgeDuration) this.state = 'idle';
        break;
      }

      case 'attack': {
        this.attackTime += dt;
        const step = PLAYER.combo[Math.max(0, this.comboStep)];
        // The hit window itself is polled by the combat system through
        // `currentHit()`, so a wolf running into a mid-swing blade still
        // gets caught, and only one hit can land per swing.
        if (this.attackTime >= step.duration) {
          this.state = 'idle';
          this.attackTime = 0;
          if (this.comboStep >= PLAYER.combo.length - 1) this.comboStep = -1;
        }
        // A short forward drift on each swing keeps the combo from feeling static.
        const drift = pulse(this.attackTime / step.duration, 1.5) * (step.finisher ? 0.06 : 0.04);
        this.position.x += Math.sin(this.yaw) * drift;
        this.position.z += Math.cos(this.yaw) * drift;
        break;
      }

      default: {
        // idle / walk / run
        if (wantsMove) {
          const running = input.run && this.stamina > 1 && inputMag > 0.45;
          this.state = running ? 'run' : 'walk';
          const targetSpeed = running ? PLAYER.runSpeed : PLAYER.walkSpeed;
          const backPenalty = my < -0.05 ? PLAYER.backSpeedScale : 1;
          const speed = targetSpeed * backPenalty * Math.min(1, inputMag * 1.25);
          const accel = dt * PLAYER.accel;
          this.speedNow = damp(this.speedNow, speed, accel / Math.max(dt, 1e-4) > 6 ? 12 : 12, dt);
          this.position.x += wx * this.speedNow * dt;
          this.position.z += wz * this.speedNow * dt;
          this.yaw = dampAngle(this.yaw, yawFromDir(wx, wz), PLAYER.turnRate, dt);

          if (running) this.stamina = Math.max(0, this.stamina - PLAYER.staminaRunDrain * dt);
        } else {
          this.state = 'idle';
          this.speedNow = damp(this.speedNow, 0, 14, dt);
          if (this.stamina < PLAYER.maxStamina) {
            this.stamina = Math.min(
              PLAYER.maxStamina,
              this.stamina + PLAYER.staminaRegen * dt,
            );
          }
        }
        break;
      }
    }

    // Stamina regenerates in every non-sprinting state, slower mid-swing.
    if (this.state !== 'run' && this.state !== 'dead') {
      const rate = this.state === 'attack' ? PLAYER.staminaRegenWhileAttacking : PLAYER.staminaRegen;
      this.stamina = Math.min(PLAYER.maxStamina, this.stamina + rate * dt);
    }

    // ---------------- knockback ----------------
    if (this.impulse.lengthSquared() > 1e-5) {
      this.position.x += this.impulse.x * dt;
      this.position.z += this.impulse.z * dt;
      const decay = Math.exp(-9 * dt);
      this.impulse.scaleInPlace(decay);
    }

    // ---------------- collisions ----------------
    this.resolveCollisions(obstacles, arenaRadius);
    this.position.y = terrainHeight(this.position.x, this.position.z);

    // ---------------- footfall events ----------------
    if (this.state === 'walk' || this.state === 'run') {
      const rate = this.state === 'run' ? POSE.strideRun : POSE.strideWalk;
      const prev = this.stride;
      this.stride += dt * rate * (this.speedNow / PLAYER.walkSpeed);
      if (Math.floor(prev / Math.PI) !== Math.floor(this.stride / Math.PI)) {
        const side = Math.floor(this.stride / Math.PI) % 2 === 0 ? 1 : -1;
        if (side !== this.lastStepSide) {
          this.lastStepSide = side;
          this.onStep?.(side, this.speedNow);
        }
      }
    }

    this.applyRoot();
    this.animate(dt, inputMag);
  }

  inHitWindow(): boolean {
    if (this.state !== 'attack' || this.comboStep < 0) return false;
    const step = PLAYER.combo[this.comboStep];
    return this.attackTime >= step.hitFrom && this.attackTime <= step.hitTo + 0.05;
  }

  markHitLanded(): void {
    this.attackHasLanded = true;
  }

  currentHit(): ActiveHit | null {
    if (!this.inHitWindow() || this.attackHasLanded) return null;
    const step = PLAYER.combo[Math.max(0, this.comboStep)];
    return {
      centre: this.position.clone(),
      facing: this.yaw,
      arcDeg: step.arc * 0.6,
      reach: step.reach,
          damage: step.damage,
          poise: step.poise,
          finisher: step.finisher,
          comboStep: Math.max(0, this.comboStep),
        };
      }

  private resolveCollisions(
    obstacles: ReadonlyArray<{ x: number; z: number; r: number }>,
    arenaRadius: number,
  ): void {
    const p = PLAYER.radius;
    for (const o of obstacles) {
      const dx = this.position.x - o.x;
      const dz = this.position.z - o.z;
      const min = o.r + p;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min || d2 < 1e-9) continue;
      const d = Math.sqrt(d2);
      const push = (min - d) / d;
      this.position.x += dx * push;
      this.position.z += dz * push;
    }
    const r = Math.hypot(this.position.x, this.position.z);
    if (r > arenaRadius) {
      const s = arenaRadius / r;
      this.position.x *= s;
      this.position.z *= s;
    }
  }

  private applyRoot(): void {
    this.anchor.position.copyFrom(this.position);
    this.anchor.rotation.y = this.yaw;
  }

  // ------------------------------------------------------------------
  // Procedural animation
  // ------------------------------------------------------------------

  /**
   * Pose is layered, not keyframed: a locomotion cycle, an attack overlay on
   * normalised swing time, a dodge roll that rotates the model root, and a
   * hurt flinch. Everything blends through `dampAngle`-style easing so state
   * changes never snap.
   */
  private animate(dt: number, inputMag: number): void {
    const rig = this.rig;
    const blending = this.state === 'attack' || this.state === 'dodge' ? 26 : 13;
    const ease = 1 - Math.exp(-blending * dt);

    // --- defaults: neutral standing with breath ---
    const breath = Math.sin(this.time * POSE.breatheRate) * POSE.breatheAmp;
    let hipsY = 0;
    let hipsPitch = 0;
    let spinePitch = breath;
    let spineTurn = 0;
    let chestTurn = 0;
    let chestPitch = 0;
    let headPitch = -breath * 1.4;
    let headTurn = Math.sin(this.time * 0.43) * POSE.idleLook * 0.3;

    let thighLX = 0;
    let thighRX = 0;
    let kneeLX = 0;
    let kneeRX = 0;
    let shoulderLX = POSE.guardShoulder * 0.35;
    let shoulderRX = POSE.guardShoulder * 0.5;
    let elbowLX = -0.5;
    let elbowRX = -0.85;
    let shoulderRZ = 0.18;
    let shoulderLZ = -0.18;
    let wristRX = 0;
    let wristRZ = 0;

    // --- locomotion cycle ---
    if (this.state === 'walk' || this.state === 'run' || (this.state === 'attack' && inputMag > 0.2)) {
      const running = this.state === 'run';
      const A = running ? POSE.legRun : POSE.legWalk;
      const KA = running ? POSE.kneeRun : POSE.kneeWalk;
      const s = this.stride;
      thighLX = -Math.sin(s) * A;
      thighRX = -Math.sin(s + Math.PI) * A;
      kneeLX = (0.45 - 0.45 * Math.cos(s + 0.8)) * KA;
      kneeRX = (0.45 - 0.45 * Math.cos(s + Math.PI + 0.8)) * KA;
      hipsY = Math.abs(Math.sin(s)) * (running ? POSE.bobRun : POSE.bobWalk);
      spinePitch += running ? POSE.leanRun : POSE.leanWalk;
      spineTurn = Math.sin(s) * 0.05;
      chestTurn = -Math.sin(s) * 0.07;
      shoulderLX = POSE.guardShoulder - Math.sin(s) * POSE.armSwing;
      shoulderRX = POSE.guardShoulder * 0.6 + Math.sin(s) * POSE.armSwing;
      headPitch += running ? POSE.headStabilise * -0.4 : POSE.headStabilise * Math.sin(s * 2) * 0.2;
    } else if (this.state === 'idle') {
      // Weight shift: a pig in full plate never stands perfectly still.
      const sway = Math.sin(this.time * 0.9) * 0.04;
      spineTurn = sway;
      hipsY = breath * 0.4;
      shoulderLX = POSE.guardShoulder * 0.35 + sway * 0.3;
      shoulderRX = POSE.guardShoulder * 0.5 - sway * 0.3;
    }

    // --- attack overlay: authored per combo step ---
    if (this.state === 'attack' && this.comboStep >= 0) {
      const step = PLAYER.combo[this.comboStep];
      const u = clamp01(this.attackTime / step.duration);
      const wind = clamp01(u / (step.hitFrom / step.duration || 0.25));
      const strike = clamp01((u - step.hitFrom / step.duration) / Math.max(0.01, (step.hitTo - step.hitFrom) / step.duration));
      const recover = clamp01((u - step.hitTo / step.duration) / Math.max(0.01, 1 - step.hitTo / step.duration));

      if (this.comboStep === 0) {
        // Diagonal chop, right shoulder over left hip.
        spineTurn = lerp(0, -0.55, wind) + lerp(0, 0.75, easeOutCubic(strike)) * (1 - recover * 0.5);
        chestTurn = spineTurn * 0.4;
        shoulderRX = lerp(-0.4, -1.75, wind) + lerp(0, 2.05, easeOutCubic(strike)) * (1 - recover * 0.35);
        elbowRX = lerp(-0.6, -1.5, wind) + lerp(0, 0.7, strike);
        shoulderRZ = lerp(0.2, 0.9, wind) + lerp(0, -1.1, strike);
        wristRZ = lerp(0, -0.5, strike) * (1 - recover);
        shoulderLX = POSE.guardShoulder + lerp(0, 0.5, strike);
        headTurn = -spineTurn * 0.35;
      } else if (this.comboStep === 1) {
        // Backhand horizontal sweep.
        spineTurn = lerp(0, 0.6, wind) + lerp(0, -0.8, easeOutCubic(strike)) * (1 - recover * 0.4);
        chestTurn = spineTurn * 0.45;
        shoulderRX = -0.9 - Math.sin(wind * Math.PI * 0.5) * 0.5 + lerp(0, 0.9, strike);
        shoulderRZ = lerp(-0.2, -1.35, wind) + lerp(0, 2.3, easeOutCubic(strike));
        elbowRX = -0.35 - wind * 0.3;
        wristRZ = lerp(0, 0.8, strike) * (1 - recover * 0.6);
        shoulderLX = POSE.guardShoulder - 0.4 * (1 - recover);
      } else {
        // Finisher: overhead into a two-handed thrust.
        spinePitch = lerp(0, -0.35, wind) + lerp(0, 0.6, easeOutCubic(strike)) * (1 - recover * 0.5);
        shoulderRX = lerp(-0.2, -2.35, wind) + lerp(0, 2.9, easeOutCubic(strike)) * (1 - recover * 0.3);
        shoulderLX = lerp(-0.2, -2.05, wind) + lerp(0, 2.5, easeOutCubic(strike)) * (1 - recover * 0.3);
        shoulderRZ = lerp(0.1, 0.35, wind) - lerp(0, 0.5, strike);
        shoulderLZ = -0.18 - lerp(0, 0.42, strike) * (1 - recover);
        elbowRX = -0.3 - wind * 0.8 + lerp(0, 0.5, strike);
        elbowLX = -0.4 - wind * 0.7 + lerp(0, 0.6, strike);
        hipsY = -recover * 0.05;
      }
    }

    // --- dodge: forward roll about the model root ---
    let rootPitch = 0;
    let rootLift = 0;
    if (this.state === 'dodge') {
      const p = clamp01(this.dodgeTime / PLAYER.dodgeDuration);
      rootPitch = -easeOutCubic(p) * Math.PI * 1.85;
      rootLift = Math.sin(p * Math.PI) * 0.3;
      hipsY = 0;
      thighLX = -0.5;
      thighRX = -0.2;
      kneeLX = 1.1;
      kneeRX = 0.8;
      shoulderLX = -1.1;
      shoulderRX = -1.1;
      elbowLX = -1.3;
      elbowRX = -1.3;
    } else {
      rootPitch = damp(this.rootPitch, 0, 18, dt);
      rootLift = damp(this.rootLift, 0, 18, dt);
    }
    this.rootPitch = rootPitch;
    this.rootLift = rootLift;

    // --- hurt flinch ---
    if (this.state === 'hurt') {
      const p = clamp01(this.hurtTime / 0.34);
      spinePitch += pulse(1 - p, 0.7) * 0.4;
      headPitch += pulse(1 - p, 0.6) * 0.5;
      shoulderLX += pulse(1 - p, 0.8) * 0.5;
      shoulderRX += pulse(1 - p, 0.8) * 0.4;
      hipsY += 0.03;
    }

    // --- death ---
    if (this.state === 'dead') {
      const p = clamp01(this.deadTime / 1.2);
      rootPitch = lerp(0, -1.35, easeOutCubic(p));
      rootLift = 0;
      hipsY = 0;
      spinePitch = lerp(spinePitch, 0.35, p);
      headPitch = lerp(headPitch, 0.6, p);
      thighLX = lerp(thighLX, 0.5, p);
      thighRX = lerp(thighRX, -0.35, p);
      shoulderLX = lerp(shoulderLX, 0.8, p);
      shoulderRX = lerp(shoulderRX, 1.15, p);
      elbowRX = lerp(elbowRX, -0.2, p);
    }

    // --- write the pose ---
    // `ease` blends toward the target instead of snapping, which is what
    // stops an idle-to-slash or slash-to-roll change from popping.
    rig.setPosition('hips', 0, 0.6 + hipsY, 0);
    rig.smoothPose('hips', hipsPitch, 0, 0, ease);
    rig.smoothPose('spine', spinePitch, spineTurn, 0, ease);
    rig.smoothPose('chest', chestPitch, chestTurn, 0, ease);
    rig.smoothPose('neck', headPitch * 0.4, headTurn * 0.4, 0, ease);
    rig.smoothPose('head', headPitch * 0.6, headTurn * 0.6, 0, ease);
    rig.smoothPose('thighL', thighLX, 0, 0, ease);
    rig.smoothPose('thighR', thighRX, 0, 0, ease);
    rig.smoothPose('kneeL', kneeLX, 0, 0, ease);
    rig.smoothPose('kneeR', kneeRX, 0, 0, ease);
    rig.smoothPose('shoulderL', shoulderLX, 0, shoulderLZ, ease);
    rig.smoothPose('shoulderR', shoulderRX, 0, shoulderRZ, ease);
    rig.smoothPose('elbowL', elbowLX, 0, 0, ease);
    rig.smoothPose('elbowR', elbowRX, 0, 0, ease);
    rig.smoothPose('wristL', 0, 0, wristRX, ease);
    rig.smoothPose('wristR', wristRX, 0, wristRZ, ease);

    // Cape: trails the motion and settles when standing.
    const capeSpeed = clamp(this.speedNow / PLAYER.runSpeed, 0, 1);
    const swayT = this.time * 2.1;
    this.rig.cape.rotation.x = Math.PI / 2 - 0.16 - 0.12 - capeSpeed * 0.85 - Math.sin(swayT) * 0.05 * (1 - capeSpeed);
    this.rig.cape.rotation.y = Math.sin(swayT * 0.8) * POSE.capeSway * 0.25 * (1 - capeSpeed * 0.6);

    // Roll pivot lives on the model root, which the anchor leaves free.
    this.rig.root.rotation.set(rootPitch, 0, 0);
    this.rig.root.position.set(0, rootLift, 0);
  }

  private rootPitch = 0;
  private rootLift = 0;
}
