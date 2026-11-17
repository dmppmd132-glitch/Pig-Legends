import { FreeCamera, Vector2, Vector3 } from '../babylon';
import { CAMERA } from '../config';
import { angleDelta, clamp, damp, terrainHeight } from '../math';
import type { InputFrame } from '../input/InputSystem';

/**
 * Third-person orbit camera.
 *
 * A plain `FreeCamera` whose position we compute by hand, instead of
 * `ArcRotateCamera`: with our own polar maths the collision pull-in, the
 * lock-on soft aim and the shake offset are ordinary vector arithmetic, and
 * there is no ambiguity about whose frame `alpha`/`beta` live in.
 *
 * Convention: `yaw` is the direction ARNO faces, 0 = +Z, increasing toward
 * +X (turning right). `pitch` is the camera's elevation above the shoulder
 * line in radians.
 */
export class CameraRig {
  /** Single source of truth for "which way is forward" this frame. */
  yaw = 0;
  pitch = CAMERA.pitchStart;
  /** Wheel/zoom distance the rig eases toward. */
  distance = CAMERA.distance;

  /** Soft aim target (a locked wolf's chest). Cleared on unlock. */
  lockTarget: Vector3 | null = null;

  private readonly currentDistance: { value: number } = { value: CAMERA.distance };
  private readonly focus = new Vector3(0, 0, 0);
  private readonly lookAt = new Vector3(0, 0, 0);
  private occluders: Array<{ x: number; z: number; r: number }> = [];

  private shakeAmp = 0;
  private shakeTime = 0;
  private shakeSeed = 0;

  private readonly zeroInput: InputFrame = {
    move: new Vector2(0, 0),
    run: false,
    attack: false,
    dodge: false,
    lock: false,
    pause: false,
    restart: false,
    look: new Vector2(0, 0),
    zoom: 0,
  };

  constructor(readonly camera: FreeCamera) {
    // Rotation is driven only through `setTarget`, so disable Babylon's
    // keyboard/mouse camera inputs; otherwise WASD would fly the camera.
    camera.inputs.clear();
    camera.minZ = 0.15;
    camera.maxZ = 240;
    camera.fov = CAMERA.fovIdle;
  }

  shake(strength: number, duration = 0.3): void {
    this.shakeAmp = Math.max(this.shakeAmp, strength);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  zoomBy(delta: number): void {
    this.distance = clamp(this.distance + delta, CAMERA.minDistance, CAMERA.maxDistance);
  }

  setOccluders(list: Array<{ x: number; z: number; r: number }>): void {
    this.occluders = list.filter((o) => o.r > 0.45);
  }

  /**
   * Establishing orbit for the title card.
   *
   * The menu renders the real, fully lit world rather than a flat backdrop, so
   * the camera has to keep moving or the screen looks like a still screenshot.
   * It pulls back a little and creeps around ARNO at about one turn per minute
   * — slow enough that it never competes with the text.
   */
  idleOrbit(dt: number, target: Vector3): void {
    this.yaw += dt * 0.1;
    this.lockTarget = null;
    this.pitch = CAMERA.pitchStart;
    this.distance = damp(this.distance, CAMERA.distance * 1.45, 1.4, dt);
    this.update(dt, target, this.zeroInput, false);
  }

  /**
   * @param target   world position at the character's feet
   * @param running  pulls the rig back and opens the lens
   * @param dodge    pushes in for the roll
   */
  update(dt: number, target: Vector3, input: InputFrame, running: boolean, dodge = false): void {
    // ---- manual look ------------------------------------------------
    this.yaw += input.look.x;
    this.pitch = clamp(this.pitch - input.look.y, CAMERA.minPitch, CAMERA.maxPitch);
    if (input.zoom !== 0) this.zoomBy(input.zoom);

    // ---- lock-on soft aim -------------------------------------------
    if (this.lockTarget) {
      const wanted = Math.atan2(this.lockTarget.x - target.x, this.lockTarget.z - target.z);
      this.yaw += angleDelta(this.yaw, wanted) * clamp(dt * 3.2, 0, 0.3);
    }

    // ---- follow the shoulder ----------------------------------------
    const raise = CAMERA.targetHeight + (running ? -0.06 : 0) + (dodge ? -0.12 : 0);
    const rate = CAMERA.followRate * (running ? 0.85 : 1);
    this.focus.x = damp(this.focus.x, target.x, rate, dt);
    this.focus.y = damp(this.focus.y, target.y + raise, rate * 1.7, dt);
    this.focus.z = damp(this.focus.z, target.z, rate, dt);

    const wantedDistance =
      this.distance + (running ? CAMERA.runDistanceBoost : 0) + (dodge ? -0.35 : 0);
    this.currentDistance.value = damp(this.currentDistance.value, wantedDistance, 6, dt);

    // Unit vector from the focus toward the camera: behind and above.
    const cosP = Math.cos(this.pitch);
    const backX = -Math.sin(this.yaw) * cosP;
    const backZ = -Math.cos(this.yaw) * cosP;
    const upY = Math.sin(this.pitch);

    // ---- collision: no trunk between lens and subject ----------------
    let allowed = this.currentDistance.value;
    for (const o of this.occluders) {
      const dx = this.focus.x - o.x;
      const dz = this.focus.z - o.z;
      const along = dx * backX + dz * backZ; // >0 when the pillar is behind us
      if (along <= 0.25 || along > allowed) continue;
      const lateral = Math.abs(dx * -backZ + dz * backX);
      if (lateral < o.r + 0.34) allowed = Math.max(CAMERA.minDistance * 0.72, along - (o.r + 0.4));
    }

    // ---- never bury the lens in a hill -------------------------------
    const probeX = this.focus.x + backX * allowed;
    const probeZ = this.focus.z + backZ * allowed;
    const probeY = this.focus.y + upY * allowed;
    const floor = terrainHeight(probeX, probeZ) + 0.42;
    if (probeY < floor && upY > 0.05) {
      allowed = Math.max(CAMERA.minDistance * 0.72, (floor - this.focus.y) / upY);
    }

    this.camera.position.set(
      this.focus.x + backX * allowed,
      this.focus.y + upY * allowed,
      this.focus.z + backZ * allowed,
    );

    // ---- shake -------------------------------------------------------
    let sx = 0;
    let sy = 0;
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      this.shakeSeed += dt * 60;
      const decay = this.shakeAmp * Math.min(1, this.shakeTime * 4);
      if (this.shakeTime === 0) this.shakeAmp = 0;
      sx = Math.sin(this.shakeSeed * 3.1) * decay * 0.09;
      sy = Math.cos(this.shakeSeed * 4.7) * decay * 0.09;
    }

    this.lookAt.set(this.focus.x + sx, this.focus.y + sy, this.focus.z);
    this.camera.setTarget(this.lookAt);

    // Speed cue: the lens opens while sprinting.
    this.camera.fov = damp(this.camera.fov, running ? CAMERA.fovRun : CAMERA.fovIdle, 5, dt);
  }

  /** Teleport the rig (first spawn, respawn) without a lerp across the map. */
  snapTo(target: Vector3, yaw: number): void {
    this.yaw = yaw;
    this.pitch = CAMERA.pitchStart;
    this.distance = CAMERA.distance;
    this.currentDistance.value = CAMERA.distance;
    this.focus.set(target.x, target.y + CAMERA.targetHeight, target.z);
    this.shakeTime = 0;
    this.shakeAmp = 0;
    this.camera.fov = CAMERA.fovIdle;
    this.update(1 / 30, target, this.zeroInput, false);
  }

  distanceTo(p: Vector3): number {
    return Vector3.Distance(this.camera.position, p);
  }
}
