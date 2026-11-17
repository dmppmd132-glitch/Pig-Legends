import {
  Color3,
  Color4,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  BaseParticleSystem,
  Material,
  ParticleSystem,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '../babylon';
import { Rng } from '../math';
import { particleSprite } from '../materials';

/**
 * All transient visuals. Every effect is a pooled object or a Babylon particle
 * system, so a fight never allocates meshes mid-swing.
 */
export class FxSystem {
  private readonly root: TransformNode;
  private readonly arcs: SlashArc[] = [];
  private readonly lockRing: Mesh;
  private readonly hitSparks: ParticleSystem;
  private readonly ichor: ParticleSystem;
  private readonly dust: ParticleSystem;
  private readonly fireflies: ParticleSystem;
  private readonly motes: ParticleSystem;
  private readonly rng = new Rng(0x5eed);

  constructor(private readonly scene: Scene, parent: TransformNode, particleScale: number) {
    this.root = new TransformNode('fx', scene);
    this.root.parent = parent;

    for (let i = 0; i < 4; i += 1) this.arcs.push(new SlashArc(scene, this.root));

    // Lock-on reticle: a flat ring that sits at the target's feet.
    this.lockRing = MeshBuilder.CreateTorus('lock-ring', { diameter: 1.5, thickness: 0.045, tessellation: 24 }, scene);
    this.lockRing.material = ringMaterial(scene, new Color3(0.34, 0.92, 0.52));
    this.lockRing.parent = this.root;
    this.lockRing.setEnabled(false);
    this.lockRing.applyFog = false;

    this.hitSparks = this.makeBurst(
      'sparks',
      [255, 232, 170],
      new Color4(1, 0.86, 0.52, 1),
      new Color4(0.72, 0.3, 0.08, 0),
      Math.round(46 * particleScale),
      0.9,
    );
    this.ichor = this.makeBurst(
      'ichor',
      [110, 24, 30],
      new Color4(0.32, 0.06, 0.08, 1),
      new Color4(0.08, 0.02, 0.03, 0),
      Math.round(38 * particleScale),
      1.4,
    );
    this.dust = this.makeBurst(
      'dust',
      [150, 160, 140],
      new Color4(0.34, 0.36, 0.3, 0.45),
      new Color4(0.12, 0.14, 0.12, 0),
      Math.round(30 * particleScale),
      1.1,
    );

    this.fireflies = this.makeAmbient(
      'fireflies',
      [168, 255, 190],
      new Color4(0.55, 1, 0.66, 0.5),
      new Color4(0.2, 0.7, 0.32, 0),
      Math.round(320 * particleScale),
      1.9,
      34,
    );
    this.motes = this.makeAmbient(
      'motes',
      [190, 200, 210],
      new Color4(0.5, 0.56, 0.6, 0.3),
      new Color4(0.3, 0.34, 0.36, 0),
      Math.round(220 * particleScale),
      0.9,
      20,
    );
  }

  /** One-shot world-space burst; repositioning the emitter then starting it. */
  private makeBurst(
    name: string,
    rgb: [number, number, number],
    c1: Color4,
    c2: Color4,
    capacity: number,
    speed: number,
  ): ParticleSystem {
    const ps = new ParticleSystem(name, capacity, this.scene);
    ps.particleTexture = particleSprite(this.scene, `${name}-tex`, rgb);
    ps.emitter = new Vector3(0, -100, 0);
    ps.minEmitBox = new Vector3(-0.04, -0.04, -0.04);
    ps.maxEmitBox = new Vector3(0.04, 0.04, 0.04);
    ps.color1 = c1;
    ps.color2 = c1;
    ps.colorDead = c2;
    ps.minSize = 0.05;
    ps.maxSize = 0.19;
    ps.minLifeTime = 0.14;
    ps.maxLifeTime = 0.42;
    // One-shots are driven only by `manualEmitCount`; a rate here would make
    // every burst continuous.
    ps.emitRate = 0;
    ps.manualEmitCount = 0;
    ps.blendMode = BaseParticleSystem.BLENDMODE_ADD;
    ps.gravity = new Vector3(0, -5.2, 0);
    ps.direction1 = new Vector3(-speed, speed * 0.8, -speed);
    ps.direction2 = new Vector3(speed, speed * 1.5, speed);
    ps.minAngularSpeed = -4;
    ps.maxAngularSpeed = 4;
    ps.updateSpeed = 1 / 60;
    ps.isLocal = false;
    ps.disposeOnStop = false;
    ps.stop();
    return ps;
  }

  private makeAmbient(
    name: string,
    rgb: [number, number, number],
    c1: Color4,
    c2: Color4,
    capacity: number,
    speed: number,
    radius: number,
  ): ParticleSystem {
    const ps = new ParticleSystem(name, capacity, this.scene);
    ps.particleTexture = particleSprite(this.scene, `${name}-tex`, rgb);
    // A box emitter around the arena keeps the swarm local instead of global.
    // The band deliberately sits under the third-person camera's eye height:
    // CPU particles have no near-plane culling, so a single sprite that drifts
    // in front of the lens inflates into a screen-eating orb, which is exactly
    // what the first playthrough showed.
    ps.emitter = new Vector3(0, 0.4, 0);
    ps.minEmitBox = new Vector3(-radius, 0.15, -radius);
    ps.maxEmitBox = new Vector3(radius, 1.55, radius);
    ps.color1 = c1;
    ps.color2 = c1;
    ps.colorDead = c2;
    ps.minSize = name === 'fireflies' ? 0.028 : 0.015;
    ps.maxSize = name === 'fireflies' ? 0.068 : 0.04;
    ps.minLifeTime = 3.5;
    ps.maxLifeTime = 9;
    ps.emitRate = capacity / 6;
    ps.blendMode = BaseParticleSystem.BLENDMODE_ADD;
    ps.gravity = new Vector3(0, name === 'motes' ? -0.12 : 0.02, 0);
    ps.direction1 = new Vector3(-speed * 0.4, speed * 0.25, -speed * 0.4);
    ps.direction2 = new Vector3(speed * 0.4, speed * 0.5, speed * 0.4);
    ps.minAngularSpeed = 0;
    ps.maxAngularSpeed = 0.6;
    ps.minEmitPower = 0.12;
    ps.maxEmitPower = 0.5;
    ps.updateSpeed = 1 / 30;
    ps.start();
    return ps;
  }

  /**
   * Fire a pooled one-shot burst at a world point.
   *
   * A burst system is created with `emitRate = 0`, so the only particles it
   * ever produces come from `manualEmitCount`. That means no `setTimeout` to
   * stop it (which would leak across a pause or a restart) and no chance of a
   * stray continuous emitter: the particles simply age out on their own.
   */
  private fire(ps: ParticleSystem, point: Vector3, count: number, size = 1): void {
    ps.emitter = point.clone();
    ps.minSize = 0.05 * size;
    ps.maxSize = 0.19 * size;
    ps.manualEmitCount = Math.max(4, Math.round(count));
    if (!ps.isStarted()) ps.start();
  }

  hitSpark(point: Vector3, strength = 1): void {
    this.fire(this.hitSparks, point, Math.round(26 * strength), 1 + strength * 0.4);
  }

  bleed(point: Vector3, strength = 1): void {
    this.fire(this.ichor, point, Math.round(20 * strength), 1);
  }

  kickUpDust(point: Vector3, strength = 1): void {
    this.fire(this.dust, point, Math.round(16 * strength), 1.3);
  }

  /**
   * Show a slash arc. `from`/`to` are unit-ish directions in world space and
   * `centre` is the swing pivot; the crescent is built between them so it
   * always lines up with the blade path regardless of facing.
   */
  slash(centre: Vector3, facingYaw: number, radius: number, duration: number, wide = false): void {
    const free = this.arcs.find((a) => !a.busy);
    if (!free) return;
    free.play(centre, facingYaw, radius, duration, wide, this.rng);
  }

  setLockTarget(position: Vector3 | null, scale = 1, pulse = 0): void {
    if (!position) {
      this.lockRing.setEnabled(false);
      return;
    }
    this.lockRing.setEnabled(true);
    this.lockRing.position.copyFrom(position);
    const s = scale * (1 + Math.sin(pulse * 6) * 0.05);
    this.lockRing.scaling.set(s, 1, s);
  }

  setTimeScale(_scale: number): void {
    /* particle systems follow scene.deltaTime, which the engine already scales */
  }

  update(dt: number): void {
    for (const arc of this.arcs) arc.update(dt);
  }

  dispose(): void {
    for (const arc of this.arcs) arc.dispose();
    this.hitSparks.dispose();
    this.ichor.dispose();
    this.dust.dispose();
    this.fireflies.dispose();
    this.motes.dispose();
    this.lockRing.dispose();
    this.root.dispose();
  }
}

/**
 * A crescent of light swept by the blade. Drawn once into a texture (a
 * tapered arc with a hot leading edge), then reused by four pooled planes.
 */
class SlashArc {
  readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  busy = false;
  private life = 0;
  private duration = 1;

  constructor(scene: Scene, parent: TransformNode) {
    const tex = new DynamicTexture('slash-tex', { width: 256, height: 128 }, scene, true);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 256, 128);

    // Draw the crescent: a thick arc fading from the middle of the sweep.
    ctx.lineCap = 'round';
    for (let i = 0; i < 26; i += 1) {
      const t = i / 25;
      const alpha = Math.pow(Math.sin(t * Math.PI), 0.7) * (0.25 + t * 0.75);
      ctx.strokeStyle = `rgba(${230 + t * 25},${236},${210},${alpha * 0.5})`;
      ctx.lineWidth = 3 + Math.sin(t * Math.PI) * 26;
      ctx.beginPath();
      ctx.arc(128, 190, 128 - i * 0.6, Math.PI * 1.18 + t * 0.62, Math.PI * 1.2 + t * 0.66);
      ctx.stroke();
    }
    tex.hasAlpha = true;
    tex.update();

    this.material = new StandardMaterial('slash-mat-' + Math.random().toString(36).slice(2), scene);
    this.material.emissiveTexture = tex;
    this.material.opacityTexture = tex;
    this.material.diffuseColor = new Color3(0, 0, 0);
    this.material.specularColor = new Color3(0, 0, 0);
    this.material.disableLighting = true;
    this.material.backFaceCulling = false;
    this.material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.material.alpha = 0;

    this.mesh = MeshBuilder.CreatePlane('slash-arc', { width: 2, height: 1 }, scene);
    this.mesh.material = this.material;
    this.mesh.parent = parent;
    this.mesh.applyFog = false;
    this.mesh.billboardMode = Mesh.BILLBOARDMODE_Y;
    this.mesh.setEnabled(false);
    this.mesh.renderingGroupId = 2;
  }

  play(centre: Vector3, facingYaw: number, radius: number, duration: number, wide: boolean, rng: Rng): void {
    this.busy = true;
    this.life = 0;
    this.duration = duration;
    this.mesh.position.copyFrom(centre);
    this.mesh.position.y += 0.06;
    // Billboard Y still needs an initial heading so the crescent sweeps right.
    this.mesh.rotation.y = facingYaw + (wide ? rng.range(-0.2, 0.2) : 0);
    const s = radius * (wide ? 1.5 : 1.25);
    this.mesh.scaling.set(s, s * (wide ? 0.85 : 0.72), 1);
    this.material.alpha = 0.95;
    this.mesh.setEnabled(true);
  }

  update(dt: number): void {
    if (!this.busy) return;
    this.life += dt;
    const t = this.life / this.duration;
    if (t >= 1) {
      this.busy = false;
      this.material.alpha = 0;
      this.mesh.setEnabled(false);
      return;
    }
    // Fast fade with a slight outward creep, like the light is being left behind.
    this.material.alpha = 0.95 * Math.pow(1 - t, 1.6);
    this.mesh.scaling.x *= 1 + dt * 0.9;
    this.mesh.scaling.y *= 1 + dt * 0.6;
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
  }
}

function ringMaterial(scene: Scene, color: Color3): StandardMaterial {
  const m = new StandardMaterial('ring-mat', scene);
  m.emissiveColor = color;
  m.diffuseColor = new Color3(0, 0, 0);
  m.specularColor = new Color3(0, 0, 0);
  m.disableLighting = true;
  m.alpha = 0.85;
  return m;
}
