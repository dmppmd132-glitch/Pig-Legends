import { Scene, TransformNode, Vector3 } from '../babylon';
import { WOLF, WORLD } from '../config';
import type { CharacterMaterials } from '../materials';
import {
  clamp,
  clamp01,
  damp,
  dampAngle,
  easeOutCubic,
  lerp,
  pulse,
  radians,
  smoothstep,
  terrainHeight,
  yawFromDir,
} from '../math';
import { buildWolf, type WolfRig } from './WolfModel';

export type WolfState =
  | 'rest'
  | 'patrol'
  | 'alert'
  | 'stalk'
  | 'chase'
  | 'circle'
  | 'windup'
  | 'lunge'
  | 'recover'
  | 'stagger'
  | 'dead';

/** Bite that is currently live. Only the lunge window can hurt ARNO. */
export interface LiveBite {
  from: Vector3;
  facing: number;
  damage: number;
  reached: boolean;
}

const WALK = { stride: 7.4, leg: 0.6, knee: 0.5, bob: 0.035 };
const RUN = { stride: 11.5, leg: 0.95, knee: 1.05, bob: 0.062 };

/** Leg phase order of a real canter: FL, then FR+BL, then BR, then flight. */
const GAIT_PHASE = [0, Math.PI * 0.62, Math.PI * 1.05, Math.PI * 1.72];

export class Wolf {
  readonly anchor: TransformNode;
  readonly rig: WolfRig;

  readonly position = new Vector3(0, 0, 0);
  yaw = 0;
  hp = WOLF.maxHp;
  state: WolfState = 'rest';
  alive = true;

  /** Rises with each kill so later packs hit harder and faster. */
  aggression = 0;

  private stateTime = 0;
  private biteDelivered = false;
  private cooldown = 0;
  private staggerTime = 0;
  private poiseDamage = 0;
  private poiseTimer = 0;
  private readonly impulse = new Vector3(0, 0, 0);
  private readonly velocity = new Vector3(0, 0, 0);
  private patrolPoint = new Vector3(0, 0, 0);
  private circleDir = 1;
  private stride = 0;
  private time = 0;
  private lastSeenAt = new Vector3(0, 0, 0);
  private memory = 0;
  /** Set true when a sword hit lands; drives the flinch and the snarl. */
  /** Short window after a sword hit: head shake, ear pin, snarl anim. */
  private flinchTimer = 0;
  private speedNow = 0;

  onGrowl?: (harsh: boolean) => void;
  onBite?: () => void;
  onHurt?: (world: Vector3) => void;
  onDeath?: (world: Vector3) => void;

  constructor(scene: Scene, mats: CharacterMaterials, parent: TransformNode, spawn: { x: number; z: number }) {
    this.anchor = new TransformNode('wolf-anchor', scene);
    this.anchor.parent = parent;
    this.rig = buildWolf(scene, mats, this.anchor).captureRest();
    this.respawnAt(spawn.x, spawn.z);
  }

  get chestWorld(): Vector3 {
    return new Vector3(this.position.x, this.position.y + 0.55, this.position.z);
  }

  /** Body radius used by the sword arc test so edge hits still register. */
  get radius(): number {
    return WOLF.radius;
  }

  get headWorld(): Vector3 {
    return new Vector3(
      this.position.x + Math.sin(this.yaw) * 0.72,
      this.position.y + 0.72,
      this.position.z + Math.cos(this.yaw) * 0.72,
    );
  }

  get targeting(): boolean {
    return this.state !== 'rest' && this.state !== 'patrol' && this.alive;
  }

  /** Seconds spent in the current AI state. */
  get secondsInState(): number {
    return this.stateTime;
  }

  dispose(): void {
    this.rig.dispose();
    this.anchor.dispose();
  }

  respawnAt(x: number, z: number): void {
    this.position.set(x, terrainHeight(x, z), z);
    this.hp = WOLF.maxHp;
    this.alive = true;
    this.state = 'rest';
    this.stateTime = 0;
    this.staggerTime = 0;
    this.cooldown = 0.6;
    this.poiseDamage = 0;
    this.memory = 0;
    this.impulse.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.speedNow = 0;
    this.yaw = yawFromDir(-x, -z);
    this.pickPatrolPoint();
    this.anchor.setEnabled(true);
    this.anchor.rotation.set(0, this.yaw, 0);
    this.rig.root.rotation.set(0, 0, 0);
  }

  /** Hearing radius is larger than sight: flailing a sword makes noise. */
  private canSense(player: Vector3): boolean {
    const d = Vector3.Distance(this.position, player);
    if (d > WORLD.arenaRadius * 0.9) return false;
    const range = WOLF.sightRange * (1 + this.aggression * 0.4);
    if (d < range * 0.45) return true; // heard him coming
    const bearing = yawFromDir(player.x - this.position.x, player.z - this.position.z);
    let off = Math.abs(bearing - this.yaw) % (Math.PI * 2);
    if (off > Math.PI) off = Math.PI * 2 - off;
    return d < range && off < radians(WOLF.sightArcDeg / 2);
  }

  private pickPatrolPoint(): void {
    const a = Math.random() * Math.PI * 2;
    const r = 6 + Math.random() * (WORLD.arenaRadius - 10);
    this.patrolPoint.set(Math.cos(a) * r, 0, Math.sin(a) * r);
  }

  /**
   * Damage entry point. Returns how the wolf reacted so the combat system can
   * decide hit-stop strength and whether the swing broke its poise.
   */
  applyDamage(damage: number, poise: number, fromWorld: Vector3): { killed: boolean; staggered: boolean } {
    if (!this.alive) return { killed: false, staggered: false };
    this.hp = Math.max(0, this.hp - damage);
    this.poiseDamage += poise;
    this.poiseTimer = 1.6;
    this.flinchTimer = 0.45;

    const away = new Vector3(this.position.x - fromWorld.x, 0, this.position.z - fromWorld.z);
    if (away.lengthSquared() < 1e-6) away.set(0, 0, 1);
    away.normalize();

    const heavy = this.poiseDamage >= WOLF.poiseBreak;
    const knock = heavy ? 6.2 : 2.6;
    this.impulse.copyFrom(away.scale(knock));

    this.onHurt?.(this.chestWorld);

    if (this.hp <= 0) {
      this.kill();
      return { killed: true, staggered: heavy };
    }

    // Being hit snaps the wolf out of whatever it was doing and into a flinch,
    // or a longer stagger when the poise bar breaks.
    this.enterStagger(heavy ? WOLF.stateTimes.heavyStagger : WOLF.stateTimes.stagger);
    if (heavy) this.poiseDamage = 0;
    return { killed: false, staggered: heavy };
  }

  private enterStagger(duration: number): void {
    this.state = 'stagger';
    this.stateTime = 0;
    this.staggerTime = duration;
    this.biteDelivered = false;
  }

  private kill(): void {
    this.alive = false;
    this.state = 'dead';
    this.stateTime = 0;
    this.onDeath?.(this.chestWorld);
  }

  /**
   * @param playerPos  ARNO's feet
   * @param playerAlive used to stop a wolf mauling a corpse
   * @param dt         already scaled by the engine's hit-stop
   */
  update(dt: number, playerPos: Vector3, playerAlive: boolean, arenaRadius: number): void {
    this.time += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.flinchTimer = Math.max(0, this.flinchTimer - dt);
    this.memory = Math.max(0, this.memory - dt);
    this.poiseTimer -= dt;
    if (this.poiseTimer <= 0) this.poiseDamage = Math.max(0, this.poiseDamage - dt * 40);

    const distToPlayer = Vector3.Distance(this.position, playerPos);
    const sensed = playerAlive && this.canSense(playerPos);
    if (sensed) {
      this.lastSeenAt.copyFrom(playerPos);
      this.memory = 3.4;
    }

    if (this.alive) this.think(dt, distToPlayer, sensed, playerPos, playerAlive);

    // ---------------- integrate motion ----------------
    this.position.x += (this.velocity.x + this.impulse.x) * dt;
    this.position.z += (this.velocity.z + this.impulse.z) * dt;
    const decay = Math.exp(-7.5 * dt);
    this.impulse.scaleInPlace(decay);

    this.resolveCollisions(arenaRadius);
    this.position.y = terrainHeight(this.position.x, this.position.z);

    this.animate(dt);
  }

  private think(dt: number, dist: number, sensed: boolean, playerPos: Vector3, playerAlive: boolean): void {
    this.stateTime += dt;

    switch (this.state) {
      case 'rest':
        this.velocity.set(0, 0, 0);
        this.speedNow = 0;
        // Head lifts when something enters sight, then it rises to patrol.
        if (sensed) {
          this.transition('alert');
          this.onGrowl?.(false);
        } else if (this.stateTime > 2.5) {
          this.transition('patrol');
        }
        break;

      case 'patrol': {
        const targetYaw = yawFromDir(this.patrolPoint.x - this.position.x, this.patrolPoint.z - this.position.z);
        this.yaw = dampAngle(this.yaw, targetYaw, WOLF.turnRate * 0.7, dt);
        this.setSpeed(WOLF.patrolSpeed, dt);
        if (Vector3.Distance(this.position, this.patrolPoint) < 2.2 || this.stateTime > 12) this.pickPatrolPoint();
        if (sensed) {
          this.transition('alert');
          this.onGrowl?.(false);
        }
        break;
      }

      case 'alert':
        // Freeze: the "did you hear that" beat that gives the player a window.
        this.setSpeed(0, dt);
        this.facePoint(playerPos, dt, 4.5);
        if (this.stateTime > WOLF.stateTimes.alert / (1 + this.aggression)) {
          this.transition(dist > 9 ? 'stalk' : 'chase');
          this.onGrowl?.(true);
        }
        break;

      case 'stalk':
        this.facePoint(playerPos, dt, 3);
        this.setSpeed(WOLF.stalkSpeed * (0.4 + this.aggression), dt);
        if (dist < 7 || (sensed && this.stateTime > 3)) this.transition('chase');
        else if (!sensed && this.memory <= 0) this.transition('patrol');
        break;

      case 'chase': {
        this.facePoint(playerPos, dt, WOLF.turnRate);
        const chaseSpeed = WOLF.chaseSpeed * (1 + this.aggression * 0.25);
        // Stop closing at bite distance and start circling instead.
        if (dist < WOLF.attackRange * 1.05 && this.cooldown <= 0) {
          this.transition('windup');
        } else if (dist < WOLF.attackRange * 1.7) {
          this.transition('circle');
        } else {
          this.setSpeed(chaseSpeed, dt);
        }
        if (!playerAlive) this.transition('patrol');
        break;
      }

      case 'circle':
        // strafing keeps the fight from becoming a stalemate at the nose.
        this.facePoint(playerPos, dt, 7);
        const tangent = this.yaw + (Math.PI / 2) * this.circleDir;
        this.velocity.set(Math.sin(tangent) * WOLF.stalkSpeed, 0, Math.cos(tangent) * WOLF.stalkSpeed);
        this.speedNow = WOLF.stalkSpeed;
        // Slide inward so circling does not become a permanent orbit.
        this.position.x += Math.sin(this.yaw) * dt * 0.9;
        this.position.z += Math.cos(this.yaw) * dt * 0.9;
        if (this.stateTime > 1.5 || Math.random() < dt * 0.3) this.circleDir *= -1;
        if (dist > WOLF.attackRange * 2.2) this.transition('chase');
        else if (this.cooldown <= 0) this.transition('windup');
        break;

      case 'windup':
        this.setSpeed(0, dt);
        this.facePoint(playerPos, dt, 9);
        // Crouch: the whole front end drops, jaw opens, hackles up.
        if (this.stateTime > WOLF.stateTimes.windup / (1 + this.aggression * 0.7)) {
          this.transition('lunge');
          this.biteDelivered = false;
          this.onBite?.();
        }
        break;

      case 'lunge': {
        const p = clamp01(this.stateTime / WOLF.stateTimes.lunge);
        const burst = WOLF.lungeSpeed * (1 - p * 0.55) * (1 + this.aggression * 0.2);
        this.velocity.set(Math.sin(this.yaw) * burst, 0, Math.cos(this.yaw) * burst);
        this.speedNow = burst;
        if (p > 0.35 && p < 0.9 && !this.biteDelivered) {
          // Reach is checked by the combat system through `liveBite()`.
          if (dist < WOLF.attackRange * 1.25) this.biteDelivered = true;
        }
        if (this.stateTime > WOLF.stateTimes.lunge) {
          this.transition('recover');
          this.cooldown = WOLF.stateTimes.biteCooldown / (1 + this.aggression * 0.5);
        }
        break;
      }

      case 'recover':
        this.setSpeed(WOLF.patrolSpeed * 0.5, dt);
        this.facePoint(playerPos, dt, 3.5);
        if (this.stateTime > WOLF.stateTimes.recover) this.transition(dist > 8 ? 'chase' : 'circle');
        break;

      case 'stagger':
        // Knocked off balance: no forward drive, only a stumble.
        this.setSpeed(0, dt);
        this.velocity.x = -Math.sin(this.yaw) * 1.2;
        this.velocity.z = -Math.cos(this.yaw) * 1.2;
        this.speedNow = 1.2;
        if (this.staggerTime > 0) {
          this.staggerTime = Math.max(0, this.staggerTime - dt);
          if (this.staggerTime === 0) {
            this.transition(this.cooldown > 0 ? 'chase' : 'windup');
            this.onGrowl?.(true);
          }
        } else {
          this.transition('chase');
        }
        break;

      case 'dead':
        this.velocity.set(0, 0, 0);
        this.speedNow = 0;
        break;

      default:
        break;
    }
  }

  private transition(next: WolfState): void {
    if (this.state === next) return;
    this.state = next;
    this.stateTime = 0;
  }

  private setSpeed(target: number, dt: number): void {
    this.speedNow = damp(this.speedNow, target, 9, dt);
    this.velocity.set(Math.sin(this.yaw) * this.speedNow, 0, Math.cos(this.yaw) * this.speedNow);
  }

  private facePoint(p: Vector3, dt: number, rate: number): void {
    const wanted = yawFromDir(p.x - this.position.x, p.z - this.position.z);
    this.yaw = dampAngle(this.yaw, wanted, rate, dt);
  }

  /** The combat system asks this each frame; the bite lands at most once. */
  liveBite(): LiveBite | null {
    if (!this.alive || this.state !== 'lunge' || this.biteDelivered) return null;
    const p = this.stateTime / WOLF.stateTimes.lunge;
    if (p < 0.3 || p > 0.92) return null;
    return {
      from: this.headWorld,
      facing: this.yaw,
      damage: Math.round(WOLF.damage * (1 + this.aggression * 0.35)),
      reached: true,
    };
  }

  markBiteResolved(): void {
    this.biteDelivered = true;
  }

  private resolveCollisions(arenaRadius: number): void {
    const r = Math.hypot(this.position.x, this.position.z);
    const limit = Math.min(arenaRadius, WOLF.leashRadius);
    if (r > limit) {
      const s = limit / r;
      this.position.x *= s;
      this.position.z *= s;
    }
  }

  // ------------------------------------------------------------------
  // Animation
  // ------------------------------------------------------------------

  private animate(dt: number): void {
    const rig = this.rig;
    const ease = 1 - Math.exp(-(this.state === 'lunge' || this.state === 'windup' ? 24 : 14) * dt);

    const running = this.speedNow > 3.4;
    const moving = this.speedNow > 0.35;
    const A = running ? RUN.leg : WALK.leg;
    const KA = running ? RUN.knee : WALK.knee;
    if (moving) this.stride += dt * (running ? RUN.stride : WALK.stride) * clamp(this.speedNow / WOLF.patrolSpeed, 0.4, 2.2);

    let bodyY = 0;
    let bodyPitch = 0;
    let bodyRoll = 0;
    let neckPitch = 0;
    let headPitch = 0;
    let headRoll = 0;
    let jawOpen = 0;
    let tailUp = 0;
    let rootRoll = 0;
    let rootPitch = 0;

    interface LegPose {
      tag: string;
      hipX: number;
      kneeX: number;
    }
    const LEG_TAGS = ['FL', 'FR', 'BL', 'BR'] as const;
    const legs: LegPose[] = LEG_TAGS.map((tag, i) => {
      const s = this.stride + GAIT_PHASE[i];
      const upper = -Math.sin(s) * A;
      // Knees only bend one way; the gait phase offset produces the canter.
      const bend = (0.4 - 0.4 * Math.cos(s + 0.9)) * KA + (running ? 0.15 : 0);
      return { tag, hipX: upper, kneeX: bend * 1.25 };
    });

    bodyY = moving ? Math.abs(Math.sin(this.stride)) * (running ? RUN.bob : WALK.bob) : 0;
    bodyPitch = running ? 0.12 : 0.02;

    // ---------------- state colouring ----------------
    switch (this.state) {
      case 'rest':
        neckPitch = 0.25;
        headPitch = -0.3;
        tailUp = -0.2;
        bodyY = Math.sin(this.time * 1.1) * 0.012;
        headRoll = Math.sin(this.time * 0.5) * 0.14;
        break;
      case 'alert':
        neckPitch = -0.15;
        headPitch = 0.1;
        tailUp = 0.5;
        bodyPitch = -0.05;
        headRoll = Math.sin(this.time * 6) * 0.1;
        break;
      case 'stalk':
        neckPitch = 0.3;
        headPitch = -0.1;
        bodyPitch = 0.16;
        tailUp = 0.25;
        break;
      case 'chase':
        neckPitch = 0.05;
        headPitch = 0.05;
        tailUp = 0.55;
        jawOpen = 0.25;
        break;
      case 'circle':
        neckPitch = 0.1;
        bodyRoll = -this.circleDir * 0.08;
        tailUp = 0.4;
        break;
      case 'windup': {
        const p = clamp01(this.stateTime / WOLF.stateTimes.windup);
        // Coils: front end sinks, spine rocks back, jaws part.
        bodyPitch = lerp(0.1, -0.34, smoothstep(p));
        neckPitch = lerp(0.05, 0.62, smoothstep(p));
        headPitch = lerp(0, -0.42, p);
        jawOpen = lerp(0.1, 1, p);
        tailUp = lerp(0.4, 0.95, p);
        bodyRoll = Math.sin(p * Math.PI * 3) * 0.05;
        break;
      }
      case 'lunge': {
        const p = clamp01(this.stateTime / WOLF.stateTimes.lunge);
        bodyPitch = lerp(-0.3, 0.55, easeOutCubic(clamp01(p * 1.7)));
        neckPitch = lerp(0.6, -0.35, easeOutCubic(clamp01(p * 1.9)));
        headPitch = lerp(-0.4, 0.3, easeOutCubic(clamp01(p * 2.2)));
        jawOpen = p < 0.4 ? 1 : lerp(1, 0.2, (p - 0.4) / 0.6);
        tailUp = 1;
        // Fore legs tuck under on the way in, splay on the way out.
        for (const leg of legs) {
          if (leg.tag === 'FL' || leg.tag === 'FR') {
            leg.hipX -= 0.7;
            leg.kneeX += 0.6;
          } else {
            leg.hipX += 0.35 * p;
          }
        }
        break;
      }
      case 'recover':
        neckPitch = 0.2;
        headPitch = -0.15;
        jawOpen = 0.35;
        tailUp = 0.3;
        break;
      case 'stagger': {
        const p = 1 - clamp01(this.staggerTime / WOLF.stateTimes.stagger);
        bodyRoll = Math.sin(p * Math.PI * 4) * 0.28 * (1 - p);
        bodyPitch = lerp(-0.24, 0.1, p);
        headPitch = 0.4 * (1 - p);
        neckPitch = 0.4 * (1 - p);
        jawOpen = 0.6 * (1 - p);
        tailUp = -0.5 * (1 - p);
        break;
      }
      case 'dead': {
        const p = clamp01(this.stateTime / WOLF.stateTimes.deathFall);
        rootRoll = lerp(0, Math.PI / 2 * 0.92, easeOutCubic(p));
        rootPitch = lerp(0, -0.25, p);
        bodyY = lerp(0, -0.12, p);
        jawOpen = lerp(0.2, 0.75, p);
        headPitch = lerp(0, 0.5, p);
        // Legs stiffen and stick out as it goes limp.
        legs.forEach((leg, i) => {
          leg.hipX = lerp(leg.hipX, 0.7 + (i % 4) * 0.12, p);
          leg.kneeX = lerp(leg.kneeX, 0.9, p);
        });
        break;
      }
      default:
        break;
    }

    // Recent damage shakes the head and pins the ears back.
    if (this.flinchTimer > 0) {
      const k = this.flinchTimer / 0.45;
      headRoll += Math.sin(this.time * 42) * 0.12 * k;
      bodyPitch += pulse(1 - k, 1) * 0.12;
    }

    // ---------------- write ----------------
    rig.setPosition('body', 0, 0.02 + bodyY, 0.34);
    rig.smoothPose('body', bodyPitch, 0, bodyRoll, ease);
    rig.smoothPose('mid', bodyPitch * 0.4, 0, -bodyRoll * 0.4, ease);
    rig.smoothPose('hips', -bodyPitch * 0.3, 0, 0, ease);
    rig.smoothPose('neck', neckPitch, 0, 0, ease);
    rig.smoothPose('head', headPitch, 0, headRoll, ease);
    rig.smoothPose('muzzle', 0, 0, 0, ease);
    rig.smoothPose('jaw', jawOpen * 0.85, 0, 0, ease);
    rig.smoothPose('tail', -tailUp * 0.7, Math.sin(this.time * 2.4) * 0.18, 0, ease);
    rig.smoothPose('tail0', 0.2 + tailUp * 0.15, Math.sin(this.time * 3.1) * 0.2, 0, ease);
    rig.smoothPose('tail1', 0.15 + tailUp * 0.12, Math.sin(this.time * 3.4 + 1) * 0.22, 0, ease);
    rig.smoothPose('tail2', 0.12, Math.sin(this.time * 3.8 + 2) * 0.2, 0, ease);
    for (const earSide of [-1, 1]) {
      rig.smoothPose(`ear${earSide}`, -tailUp * 0.3 - jawOpen * 0.2, 0, earSide * tailUp * 0.25, ease);
    }

    for (const leg of legs) {
      rig.smoothPose(`leg${leg.tag}`, leg.hipX, 0, 0, ease);
      rig.smoothPose(`knee${leg.tag}`, leg.kneeX, 0, 0, ease);
    }

    // Death and stagger lean the whole body through the model root.
    this.rig.root.rotation.set(rootPitch, 0, damp(this.rootRollTarget, rootRoll, 12, dt));
    this.rootRollTarget = rootRoll;
    this.anchor.position.copyFrom(this.position);
    this.anchor.rotation.y = this.yaw;
  }

  private rootRollTarget = 0;
}
