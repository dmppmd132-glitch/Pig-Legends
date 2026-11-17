import {
  Color3,
  Color4,
  Constants,
  DefaultRenderingPipeline,
  DirectionalLight,
  DynamicTexture,
  Engine,
  FreeCamera,
  GlowLayer,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  PointLight,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  TransformNode,
  Vector3,
  type Nullable,
} from './babylon';

import { CAMERA, HUD, PLAYER, QUALITY, WOLF, WORLD, type QualityLevel } from './config';
import { Rng, clamp, clamp01, damp, terrainHeight } from './math';
import { Store } from './store';
import { initialHud } from './types';
import type { HudState, Settings } from './types';
import { createCharacterMaterials, particleSprite, type CharacterMaterials } from './materials';
import { InputSystem } from './input/InputSystem';
import { PigKnight } from './entities/PigKnight';
import { Wolf } from './entities/Wolf';
import { CameraRig } from './systems/camera';
import { FxSystem } from './systems/fx';
import { AudioSystem } from './systems/audio';
import { FloaterLayer } from './systems/floaters';
import { contactPoint, resolveBite, resolveSwing } from './systems/combat';
import { FOG_COLOR, MOONLIGHT, createBoundaryMarkers, createGround } from './world/terrain';
import { buildForest, buildMist, buildSky } from './world/forest';

/** Wolves killed before the hunt is "complete". Play on for an endless run. */
export const HUNT_TARGET = 5;

export interface EngineCallbacks {
  onPhase?: (phase: HudState['phase']) => void;
  /** Called when a run ends so React can persist the profile to IndexedDB. */
  onRunEnd?: (result: { kills: number; timeMs: number; died: boolean }) => void;
}

export interface CreateOptions {
  quality: QualityLevel;
  settings: Settings;
  isTouch: boolean;
}

/**
 * Owns the Babylon engine, the scene and the whole simulation. React never
 * touches any of this directly: it reads `hud` and calls the small command
 * surface (`start`, `pause`, `resume`, `restart`, `touch.*`).
 */
export class GameEngine {
  private engine!: Engine;
  private scene!: Scene;
  private camera!: FreeCamera;
  private rig!: CameraRig;
  private input!: InputSystem;
  private fx!: FxSystem;
  private audio!: AudioSystem;
  private floaters!: FloaterLayer;
  private mats!: CharacterMaterials;
  private player!: PigKnight;
  private wolves: Wolf[] = [];
  private pipeline: Nullable<DefaultRenderingPipeline> = null;
  private glow: Nullable<GlowLayer> = null;
  private shadow: Nullable<ShadowGenerator> = null;
  private moonLight!: DirectionalLight;
  private worldRoot!: TransformNode;
  private entityRoot!: TransformNode;
  private obstacles: Array<{ x: number; z: number; r: number }> = [];
  private torchLights: PointLight[] = [];
  /** Follows ARNO so the player and his footing stay legible. */
  private lantern!: PointLight;
  private torchCoals: Mesh[] = [];
  private readonly detach: Array<() => void> = [];

  readonly hud = new Store<HudState>(initialHud);

  private running = false;
  private paused = false;
  private hitStop = 0;
  private timeMs = 0;
  private kills = 0;
  private runKills = 0;
  private respawnTimer = 0;
  private lockTarget: Wolf | null = null;
  private toastTimer = 0;
  private toastSeq = 0;
  private fpsAvg = 60;
  private lastHudPush = 0;
  private clearedShown = false;
  private readonly rng = new Rng(WORLD.seed ^ 0x9c1a);

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly overlay: HTMLElement,
    private readonly opts: CreateOptions,
    private readonly cb: EngineCallbacks = {},
  ) {}

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------

  /**
   * Built in yields so the loading bar actually animates instead of blocking
   * one long frame; each step is a discrete world layer.
   */
  async boot(): Promise<void> {
    const quality = QUALITY[this.opts.quality];

    try {
      this.engine = new Engine(this.canvas, true, {
        antialias: this.opts.quality !== 'low',
        alpha: false,
        stencil: true,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
        failIfMajorPerformanceCaveat: false,
      });
    } catch (err) {
      throw new Error(
        'WebGL is unavailable here. Enable hardware acceleration, or open the game in a recent Chrome, Safari or Firefox.',
        { cause: err },
      );
    }

    // A 4K phone panel at device-pixel ratio cannot hold 30 fps with a shadow
    // map plus bloom, so hardware scaling is our primary throttle.
    this.engine.setHardwareScalingLevel(1 / clamp(window.devicePixelRatio || 1, 1, quality.hardwareScalingCap));

    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.016, 0.028, 0.024, 1);
    this.scene.fogMode = Constants.FOGMODE_EXP2;
    this.scene.fogColor = FOG_COLOR;
    this.scene.fogDensity = WORLD.fogDensity;
    this.scene.ambientColor = new Color3(0.05, 0.062, 0.055);
    // Nothing in the game needs Babylon's pointer picking; skipping it saves
    // a ray test against ~2000 instances on every touchmove.
    this.scene.skipPointerMovePicking = true;

    this.progress('Carving the sky', 0.06);
    this.worldRoot = new TransformNode('world', this.scene);
    this.entityRoot = new TransformNode('entities', this.scene);
    this.buildLights();
    await this.yieldFrame();

    this.progress('Raising the ground', 0.18);
    createGround(this.scene, this.worldRoot, this.opts.quality);
    buildSky(this.scene, this.worldRoot);
    buildMist(this.scene, this.worldRoot);
    await this.yieldFrame();

    this.progress('Planting the Dimwood', 0.36);
    const forest = buildForest(
      this.scene,
      this.worldRoot,
      {
        treeCount: WORLD.treeCount[this.opts.quality],
        rockCount: WORLD.rockCount[this.opts.quality],
        grassCount: Math.round(WORLD.grassCount[this.opts.quality] * quality.grassScale),
      },
      (label, pct) => this.progress(label, pct),
    );
    this.obstacles = forest.obstacles;
    createBoundaryMarkers(this.scene, this.worldRoot);
    await this.yieldFrame();

    this.progress('Armouring ARNO', 0.66);
    this.mats = createCharacterMaterials(this.scene);
    this.fx = new FxSystem(this.scene, this.entityRoot, quality.particleScale);
    this.player = new PigKnight(this.scene, this.mats, this.entityRoot);
    this.player.position.set(0, terrainHeight(0, 0), 0);
    this.player.yaw = 0;
    await this.yieldFrame();

    this.progress('Waking the wolf', 0.8);
    this.buildTorchRack();
    this.spawnWolf(true);
    await this.yieldFrame();

    // ---- camera ----
    this.camera = new FreeCamera('cm', new Vector3(0, 3, -8), this.scene);
    this.rig = new CameraRig(this.camera);
    this.rig.setOccluders(this.obstacles);
    this.rig.snapTo(this.player.position, 0);
    this.scene.activeCamera = this.camera;

    this.progress('Polishing the lens', 0.9);
    this.buildPost(quality);

    // ---- input, audio, labels ----
    this.input = new InputSystem(this.canvas);
    this.input.sensitivity = this.opts.settings.cameraSensitivity;
    this.input.invertY = this.opts.settings.invertY;
    this.audio = new AudioSystem();
    this.audio.setLevels({
      master: this.opts.settings.masterVolume,
      sfx: this.opts.settings.sfxVolume,
      music: this.opts.settings.musicVolume,
    });
    this.floaters = new FloaterLayer(this.overlay, this.scene, this.engine);

    this.wirePlayerEvents();
    this.attachResize();

    this.progress('Ready', 1);
    this.hud.set({
      phase: 'menu',
      hp: this.player.hp,
      maxHp: PLAYER.maxHp,
      stamina: this.player.stamina,
      maxStamina: PLAYER.maxStamina,
      isTouch: this.opts.isTouch,
      quality: this.opts.quality,
    });

    // The title card sits over the live, lit forest, so the render loop starts
    // here rather than only in `start()`. `tick()` notices the menu phase and
    // just draws — nothing is simulated until the hunt begins.
    this.engine.runRenderLoop(() => this.tick());
  }

  private progress(label: string, pct: number): void {
    this.hud.set({ loadingLabel: label, loadingPct: clamp01(pct) });
  }

  private yieldFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  // ------------------------------------------------------------------
  // Scene construction
  // ------------------------------------------------------------------

  private buildLights(): void {
    const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), this.scene);
    hemi.intensity = 0.52;
    hemi.diffuse = new Color3(0.4, 0.5, 0.54);
    hemi.groundColor = new Color3(0.075, 0.1, 0.07);

    const moon = new DirectionalLight('moon', new Vector3(-0.42, -0.85, 0.3), this.scene);
    moon.position = new Vector3(30, 60, -40);
    moon.intensity = 1.5;
    moon.diffuse = MOONLIGHT;
    moon.specular = new Color3(0.35, 0.42, 0.5);
    this.moonLight = moon;

    // ARNO carries a lantern. A dark-fantasy wood is meant to feel oppressive,
    // but under moonlight alone the knight reads as a black cut-out and the
    // few metres of floor that combat timing depends on go unreadable. The
    // light is deliberately short-ranged so it lifts the player without
    // flattening the atmosphere around him.
    this.lantern = new PointLight('lantern', new Vector3(0, 2, 0), this.scene);
    this.lantern.diffuse = new Color3(0.86, 0.76, 0.56);
    this.lantern.specular = new Color3(0.45, 0.4, 0.28);
    this.lantern.intensity = 1.35;
    this.lantern.range = 9.5;
  }

  /**
   * Three braziers at the clearing edge. They are the only warm colour in the
   * scene, so the eye learns the arena boundary without a wall texture.
   */
  private buildTorchRack(): void {
    const coalMat = new StandardMaterial('ember-coal', this.scene);
    coalMat.diffuseColor = new Color3(0.2, 0.05, 0.01);
    coalMat.emissiveColor = new Color3(0.95, 0.36, 0.08);
    coalMat.specularColor = new Color3(0, 0, 0);

    const spots = [
      { x: -10, z: 7 },
      { x: 9, z: -9 },
      { x: 2.5, z: 12 },
    ];

    for (const p of spots) {
      const y = terrainHeight(p.x, p.z);

      const post = MeshBuilder.CreateCylinder(
        'brazier-post',
        { diameter: 0.14, height: 0.7, tessellation: 6 },
        this.scene,
      );
      post.material = this.mats.leather;
      post.position.set(p.x, y + 0.35, p.z);
      post.receiveShadows = true;

      const bowl = MeshBuilder.CreateCylinder(
        'brazier-bowl',
        { diameterTop: 0.62, diameterBottom: 0.24, height: 0.34, tessellation: 8 },
        this.scene,
      );
      bowl.material = this.mats.armour;
      bowl.position.set(p.x, y + 0.82, p.z);
      bowl.receiveShadows = true;

      const coal = MeshBuilder.CreateSphere('brazier-coal', { diameter: 0.34, segments: 6 }, this.scene);
      coal.material = coalMat;
      coal.position.set(p.x, y + 0.95, p.z);
      coal.scaling.set(1, 0.6, 1);
      this.torchCoals.push(coal);

      const light = new PointLight('torch', new Vector3(p.x, y + 1.15, p.z), this.scene);
      light.diffuse = new Color3(0.95, 0.5, 0.18);
      light.specular = new Color3(0.7, 0.4, 0.15);
      light.intensity = 0.9;
      light.range = 12;
      this.torchLights.push(light);
    }

    if (this.glow) for (const c of this.torchCoals) this.glow.addIncludedOnlyMesh(c);
  }

  private buildPost(quality: (typeof QUALITY)[QualityLevel]): void {
    this.glow = new GlowLayer('glow', this.scene, {
      mainTextureFixedSize: this.opts.quality === 'high' ? 512 : 256,
    });
    this.glow.intensity = quality.bloom ? 0.85 : 0.3;
    for (const c of this.torchCoals) this.glow.addIncludedOnlyMesh(c);

    if (quality.shadowMapSize >= 512) {
      this.shadow = new ShadowGenerator(quality.shadowMapSize, this.moonLight);
      this.shadow.useBlurExponentialShadowMap = true;
      this.shadow.blurKernel = 16;
      this.shadow.depthScale = 50;
      this.shadow.bias = 0.0013;
      this.shadow.darkness = 0.55;
      const floor = this.scene.getMeshByName('dimwood-ground');
      if (floor) floor.receiveShadows = true;
      this.addEntityShadows(this.player.rig.meshes);
      for (const w of this.wolves) this.addEntityShadows(w.rig.meshes);
    }

    // Tone mapping, vignette and grain are one cheap chain that turns a plain
    // grey scene into "dark fantasy"; at Low we skip the pipeline entirely.
    if (!quality.postProcess) return;
    this.pipeline = new DefaultRenderingPipeline('mood', true, this.scene, [this.camera]);
    const ip = this.pipeline.imageProcessing;
    ip.toneMappingEnabled = true;
    ip.exposure = 1.08;
    ip.contrast = 1.36;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 3.2;
    ip.vignetteColor = new Color4(0, 0, 0, 1);
    ip.colorGradingEnabled = false;

    this.pipeline.bloomEnabled = quality.bloom;
    this.pipeline.bloomThreshold = 0.6;
    this.pipeline.bloomWeight = 0.3;
    this.pipeline.bloomKernel = 48;
    this.pipeline.bloomScale = 0.5;

    this.pipeline.grainEnabled = true;
    this.pipeline.grain.intensity = 8;
    this.pipeline.grain.animated = true;

    this.pipeline.chromaticAberrationEnabled = this.opts.quality === 'high';
    this.pipeline.chromaticAberration.aberrationAmount = 7;

    this.pipeline.sharpenEnabled = false;
  }

  private addEntityShadows(meshes: readonly Mesh[]): void {
    if (!this.shadow) return;
    for (const m of meshes) this.shadow.addShadowCaster(m);
  }

  // ------------------------------------------------------------------
  // Wolves
  // ------------------------------------------------------------------

  private spawnWolf(first = false): void {
    const angle = first ? Math.PI : this.rng.range(0, Math.PI * 2);
    const dist = first ? 13 : this.rng.range(17, WORLD.arenaRadius - 4);
    const x = Math.sin(angle) * dist;
    const z = Math.cos(angle) * dist;

    const wolf = new Wolf(this.scene, this.mats, this.entityRoot, { x, z });
    wolf.aggression = clamp(this.kills * WOLF.aggressionPerKill, 0, 0.65);
    wolf.onGrowl = (harsh) => this.audio.play(harsh ? 'wolfSnarl' : 'wolfGrowl');
    wolf.onBite = () => this.audio.play('wolfBite', 0.85);
    wolf.onHurt = (p) => this.fx.bleed(p, 1);
    wolf.onDeath = (p) => {
      this.fx.bleed(p, 2.2);
      this.fx.hitSpark(p, 1.4);
      this.rig.shake(0.4, 0.3);
    };
    this.addEntityShadows(wolf.rig.meshes);
    this.wolves.push(wolf);
  }

  private aliveWolves(): Wolf[] {
    const out: Wolf[] = [];
    for (const w of this.wolves) if (w.alive) out.push(w);
    return out;
  }

  // ------------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------------

  private wirePlayerEvents(): void {
    this.player.onStep = (side, speed) => {
      const running = speed > PLAYER.walkSpeed * 0.9;
      this.audio.play('footstep', running ? 1.2 : 0.8);
      if (!running) return;
      const f = this.player.facing;
      this.fx.kickUpDust(
        new Vector3(
          this.player.position.x - f.x * 0.25 + side * 0.12,
          this.player.position.y + 0.08,
          this.player.position.z - f.z * 0.25,
        ),
        0.55,
      );
    };

    this.player.onSwing = (step) => {
      this.audio.play(step === 2 ? 'swing3' : step === 1 ? 'swing2' : 'swing1');
      const f = this.player.facing;
      const centre = new Vector3(
        this.player.position.x + f.x * 1.1,
        this.player.position.y + (step === 2 ? 1.05 : 0.95),
        this.player.position.z + f.z * 1.1,
      );
      this.fx.slash(centre, this.player.yaw, step === 2 ? 1.55 : 1.3, step === 2 ? 0.3 : 0.22, step >= 1);
    };

    this.player.onDodge = () => {
      this.audio.play('dodge');
      this.fx.kickUpDust(
        new Vector3(this.player.position.x, this.player.position.y + 0.06, this.player.position.z),
        1.1,
      );
    };

    this.player.onHurt = (damage) => {
      this.audio.play('hurt');
      this.rig.shake(1.2, 0.4);
      this.floaters.spawn(`-${Math.round(damage)}`, this.player.chestWorld, 'player-hurt');
      this.hud.set({ hp: Math.round(this.player.hp) });
    };

    this.player.onDeath = () => {
      this.audio.play('death');
      this.endRun(true);
      this.rig.shake(1.5, 0.9);
      this.lockTarget = null;
      this.fx.setLockTarget(null);
    };
  }

  private attachResize(): void {
    const onResize = () => {
      // The scene renders behind the menus too, so the drawing buffer has to
      // follow the viewport even before the first run starts.
      this.engine.resize();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    this.detach.push(() => window.removeEventListener('resize', onResize));
    this.detach.push(() => window.removeEventListener('orientationchange', onResize));
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', onResize);
      this.detach.push(() => vv.removeEventListener('resize', onResize));
    }
  }

  // ------------------------------------------------------------------
  // Command surface for React
  // ------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.setPhase('playing');
    void this.audio.unlock();
    this.audio.startAmbience();
    this.toast('The hunt begins');
    this.engine.runRenderLoop(() => this.tick());
  }

  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.input.reset();
    this.setPhase('paused');
    this.audio.stopAmbience();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.input.reset();
    this.setPhase(this.player.state === 'dead' ? 'dead' : 'playing');
    void this.audio.unlock();
    this.audio.startAmbience();
  }

  /** Full reset of the run: vitals, wolves, camera and counters. */
  restart(): void {
    for (const w of this.wolves) w.dispose();
    this.wolves = [];
    this.player.reviveAt(0, 0);
    this.kills = 0;
    this.runKills = 0;
    this.timeMs = 0;
    this.respawnTimer = 0;
    this.lockTarget = null;
    this.clearedShown = false;
    this.hitStop = 0;
    this.floaters.clear();
    this.spawnWolf(true);
    this.rig.snapTo(this.player.position, 0);
    this.hud.set({
      kills: 0,
      runKills: 0,
      comboIndex: 0,
      comboCount: 0,
      timeMs: 0,
      targetName: null,
      targetVisible: false,
      hp: PLAYER.maxHp,
      stamina: PLAYER.maxStamina,
    });
    this.setPhase('playing');
    this.audio.stopAmbience();
    void this.audio.unlock();
    this.audio.startAmbience();
    this.toast('A new hunt');
    if (!this.running) this.start();
  }

  setQuality(quality: QualityLevel): void {
    // React can push a settings object while `boot()` is still between stages;
    // the engine and post-process fields are assigned later in that method, so
    // touching them here would throw on the very first commit.
    if (!this.engine) {
      this.hud.set({ quality });
      return;
    }
    const q = QUALITY[quality];
    this.engine.setHardwareScalingLevel(1 / clamp(window.devicePixelRatio || 1, 1, q.hardwareScalingCap));
    if (this.glow) this.glow.intensity = q.bloom ? 0.85 : 0.3;
    if (this.pipeline) {
      this.pipeline.bloomEnabled = q.bloom;
      this.pipeline.grainEnabled = q.postProcess;
      this.pipeline.chromaticAberrationEnabled = quality === 'high';
    }
    this.hud.set({ quality });
  }

  applySettings(next: Settings): void {
    // `boot()` already seeded input and audio from the same object; a call that
    // arrives before those exist is a no-op rather than a crash.
    if (this.input) {
      this.input.sensitivity = next.cameraSensitivity;
      this.input.invertY = next.invertY;
    }
    if (this.audio) {
      this.audio.setLevels({
        master: next.masterVolume,
        sfx: next.sfxVolume,
        music: next.musicVolume,
      });
    }
    this.setQuality(next.quality);
  }

  setMuted(muted: boolean): void {
    this.audio.setMuted(muted);
  }

  /** Touch layer feeds the same input system the keyboard uses. */
  readonly touch = {
    move: (x: number, y: number): void => this.input?.setVirtualMove(x, y),
    hold: (action: 'attack' | 'dodge' | 'run' | 'lock' | 'pause', down: boolean): void =>
      this.input?.setVirtualHold(action, down),
    tap: (action: 'attack' | 'dodge' | 'run' | 'lock' | 'pause'): void => this.input?.tap(action),
  };

  get isReady(): boolean {
    return this.running;
  }

  get runResult(): { kills: number; runKills: number; timeMs: number } {
    return { kills: this.kills, runKills: this.runKills, timeMs: Math.round(this.timeMs) };
  }

  /**
   * Reachable only through the `?debug=1` hook in App. Art bugs — "what is
   * that glowing ball" — cannot be answered from a hashed production bundle
   * otherwise, and typing them out by hand from a screenshot wastes more time
   * than this accessor costs.
   */
  get debugView(): {
    scene: Scene;
    camera: FreeCamera;
    player: { x: number; y: number; z: number; hp: number; stamina: number; state: string };
    wolves: Array<{ x: number; z: number; hp: number; state: string; alive: boolean }>;
    locked: boolean;
    run: { kills: number; timeMs: number };
  } {
    const p = this.player;
    return {
      scene: this.scene,
      camera: this.camera,
      player: {
        x: +p.position.x.toFixed(2),
        y: +p.position.y.toFixed(2),
        z: +p.position.z.toFixed(2),
        hp: Math.round(p.hp),
        stamina: Math.round(p.stamina),
        state: p.state,
      },
      wolves: this.wolves.map((w) => ({
        x: +w.position.x.toFixed(2),
        z: +w.position.z.toFixed(2),
        hp: Math.round(w.hp),
        state: w.state,
        alive: w.alive,
      })),
      locked: this.lockTarget !== null,
      run: { kills: this.kills, timeMs: Math.round(this.timeMs) },
    };
  }

  // ------------------------------------------------------------------
  // Frame
  // ------------------------------------------------------------------

  private tick(): void {
    const rawDeltaMs = this.engine.getDeltaTime();
    const dt = Math.min(0.05, rawDeltaMs / 1000);

    const phase = this.hud.peek().phase;
    if (this.paused || phase === 'menu') {
      // The menus freeze the simulation, never the keyboard. `Esc` has to be
      // able to release the game it just paused: the code that reads
      // `input.pause` lives below this return, so without this poll the only
      // way back in was the on-screen button. The title card also has to
      // consume whatever was pressed while it was up, or a run would begin
      // mid-swing.
      const input = this.input.update();
      if (this.paused) {
        if (input.pause) {
          this.resume();
          this.audio.play('uiClick');
        } else if (input.restart) {
          this.restart();
        }
      }
      // A dead-still 3D scene reads as a screenshot and invites the player to
      // assume the load failed, so the title card drifts the camera instead.
      if (phase === 'menu') {
        this.rig.idleOrbit(dt, this.player.position);
      }
      this.updateLantern();
      this.scene.render();
      this.floaters.update(this.camera);
      return;
    }

    // ---- hit-stop: freeze the simulation, never the camera ----
    let simDt = dt;
    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - dt);
      simDt = dt * 0.12;
    }
    this.timeMs += simDt * 1000;

    const input = this.input.update();

    if (input.pause) {
      if (this.paused) this.resume();
      else this.pause();
      this.audio.play('uiClick');
    }
    if (input.restart && (this.player.state === 'dead' || this.paused)) this.restart();

    if (input.attack && !this.player.tryAttack()) {
      if (this.player.stamina < PLAYER.staminaAttackCost) this.audio.play('miss');
    }
    if (input.dodge) this.player.tryDodge(this.moveDirectionWorld(input));
    if (input.lock) this.cycleLock();

    this.player.update(simDt, input, this.rig.yaw, this.obstacles, WORLD.arenaRadius);
    this.updateWolves(simDt);
    this.updateLock();
    this.resolveCombat();
    this.rig.update(simDt, this.player.position, input, this.player.state === 'run', this.player.state === 'dodge');
    this.fx.update(simDt);
    this.updateLantern();
    this.updateTorches();
    this.updateRespawn(simDt);
    this.updateHud(dt, rawDeltaMs);

    this.scene.render();
    this.floaters.update(this.camera);
  }

  private moveDirectionWorld(input: { move: { x: number; y: number } }): { x: number; z: number } {
    const camYaw = this.rig.yaw;
    const fwdX = Math.sin(camYaw);
    const fwdZ = Math.cos(camYaw);
    // Right vector is the forward vector turned a quarter circle clockwise.
    const x = -fwdZ * input.move.x + fwdX * input.move.y;
    const z = fwdX * input.move.x + fwdZ * input.move.y;
    const len = Math.hypot(x, z);
    return len > 0.001 ? { x: x / len, z: z / len } : { x: 0, z: 0 };
  }

  private updateWolves(dt: number): void {
    for (const wolf of this.wolves) {
      // Dead wolves still tick: their fall animation and fade need frames.
      wolf.update(dt, this.player.position, this.player.state !== 'dead', WORLD.arenaRadius);
    }
    this.separateWolves(this.aliveWolves());
  }

  /** Keeps a growing pack from stacking into one silhouette. */
  private separateWolves(alive: Wolf[]): void {
    const minDist = 1.3;
    for (let i = 0; i < alive.length; i += 1) {
      for (let j = i + 1; j < alive.length; j += 1) {
        const a = alive[i];
        const b = alive[j];
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 1e-4 || d > minDist) continue;
        const push = (minDist - d) / 2;
        const nx = dx / d;
        const nz = dz / d;
        a.position.x -= nx * push;
        a.position.z -= nz * push;
        b.position.x += nx * push;
        b.position.z += nz * push;
      }
    }
  }

  private resolveCombat(): void {
    const contacts = resolveSwing(this.player, this.wolves);
    for (const c of contacts) {
      const result = c.wolf.applyDamage(c.damage, c.poise, this.player.position);
      const point = contactPoint(this.player, c.wolf);
      this.fx.hitSpark(point, c.finisher ? 1.8 : 1);
      this.floaters.spawn(`${c.damage}`, point, c.finisher ? 'crit' : 'player-hit');
      this.hitStop = c.finisher ? PLAYER.hitStopStrong : PLAYER.hitStopWeak;
      this.rig.shake(c.finisher ? 0.7 : 0.32, c.finisher ? 0.3 : 0.18);
      this.audio.play(result.killed ? 'kill' : result.staggered ? 'hitClang' : 'hitFlesh', c.finisher ? 1.25 : 1);

      if (!result.killed) continue;

      this.kills += 1;
      this.runKills += 1;
      this.hud.set({ kills: this.kills, runKills: this.runKills });
      if (this.lockTarget === c.wolf) this.lockTarget = null;
      for (const w of this.wolves) w.aggression = clamp(this.kills * WOLF.aggressionPerKill, 0, 0.65);

      if (this.kills >= HUNT_TARGET && !this.clearedShown) {
        this.clearedShown = true;
        this.audio.play('levelClear');
        this.setPhase('cleared');
        this.toast(`${HUNT_TARGET} down — the wood is quiet`);
        this.cb.onRunEnd?.({ kills: this.kills, timeMs: Math.round(this.timeMs), died: false });
      } else {
        this.toast(result.staggered ? 'Wolf broken' : 'Wolf slain');
      }
    }

    for (const wolf of this.aliveWolves()) {
      const damage = resolveBite(wolf, this.player);
      if (damage === null) continue;
      if (this.player.takeHit(damage, wolf.headWorld)) {
        this.hitStop = 0.05;
        this.fx.hitSpark(this.player.chestWorld, 1.1);
      }
    }
  }

  private cycleLock(): void {
    const alive = this.aliveWolves();
    if (alive.length === 0) {
      this.lockTarget = null;
      return;
    }
    if (this.lockTarget && !alive.includes(this.lockTarget)) this.lockTarget = null;
    if (this.lockTarget) {
      const idx = alive.indexOf(this.lockTarget);
      this.lockTarget = alive[(idx + 1) % alive.length];
      this.audio.play('uiClick', 0.45);
      return;
    }
    let best: Wolf | null = null;
    let bestScore = -Infinity;
    for (const w of alive) {
      const dx = w.position.x - this.player.position.x;
      const dz = w.position.z - this.player.position.z;
      const d = Math.hypot(dx, dz);
      let off = (Math.atan2(dx, dz) - this.player.yaw) % (Math.PI * 2);
      if (off > Math.PI) off -= Math.PI * 2;
      if (off < -Math.PI) off += Math.PI * 2;
      const score = -d - Math.abs(off) * 4;
      if (score > bestScore) {
        bestScore = score;
        best = w;
      }
    }
    this.lockTarget = best;
    if (best) this.audio.play('uiClick', 0.45);
  }

  private updateLock(): void {
    const target = this.lockTarget && this.lockTarget.alive ? this.lockTarget : null;
    if (!target) {
      this.rig.lockTarget = null;
      this.fx.setLockTarget(null);
      return;
    }
    this.rig.lockTarget = target.chestWorld;
    this.fx.setLockTarget(target.position, clamp(target.radius * 2.6, 1, 2.2), this.timeMs / 1000);
  }

  /**
   * Wolves come back one at a time early and up to three once ARNO has proven
   * himself, so the arena always has a fight without becoming a crowd scene.
   */
  private updateRespawn(dt: number): void {
    const aliveCount = this.aliveWolves().length;
    const cap = this.kills >= 6 ? 3 : this.kills >= 2 ? 2 : 1;

    const corpses = this.wolves.filter((w) => !w.alive === false && w.secondsInState > 6);
    for (const corpse of corpses) {
      const i = this.wolves.indexOf(corpse);
      if (i >= 0) this.wolves.splice(i, 1);
      corpse.dispose();
    }

    if (aliveCount >= cap) {
      this.respawnTimer = Math.max(this.respawnTimer, 2.2);
      return;
    }
    this.respawnTimer -= dt;
    if (this.respawnTimer > 0) return;
    this.spawnWolf(false);
    this.respawnTimer = WOLF.stateTimes.respawnDelay / (1 + this.kills * 0.08);
    if (aliveCount === 0) this.toast('Another shape in the trees');
  }

  /**
   * Hug the lantern to ARNO's off-hand side, slightly ahead so it grazes the
   * ground in front of him rather than lighting the inside of his own cloak.
   */
  private updateLantern(): void {
    const p = this.player.position;
    this.lantern.position.set(p.x + 0.5, p.y + 1.45, p.z + 0.45);
  }

  private updateTorches(): void {
    const t = this.timeMs / 1000;
    for (let i = 0; i < this.torchLights.length; i += 1) {
      const light = this.torchLights[i];
      const flicker =
        Math.sin(t * (7.3 + i)) * 0.16 + Math.sin(t * (17.1 + i * 3)) * 0.09 + Math.sin(t * 2.3) * 0.05;
      light.intensity = clamp(0.9 + flicker, 0.3, 1.4);
      const coal = this.torchCoals[i];
      if (coal) coal.scaling.set(1 + flicker * 0.14, 0.6 + flicker * 0.1, 1 + flicker * 0.14);
    }
  }

  private setPhase(phase: HudState['phase']): void {
    this.hud.set({ phase });
    this.cb.onPhase?.(phase);
  }

  private endRun(died: boolean): void {
    if (this.hud.peek().phase === 'dead') return;
    this.setPhase('dead');
    this.cb.onRunEnd?.({ kills: this.runKills, timeMs: Math.round(this.timeMs), died });
  }

  private toast(message: string): void {
    this.toastSeq += 1;
    this.hud.set({ toast: message, toastId: this.toastSeq });
    this.toastTimer = HUD.toastDurationMs / 1000;
  }

  private updateHud(dt: number, rawDeltaMs: number): void {
    this.fpsAvg = damp(this.fpsAvg, 1000 / Math.max(1, rawDeltaMs), 3, dt);

    this.toastTimer = Math.max(0, this.toastTimer - dt);
    if (this.toastTimer === 0 && this.hud.peek().toast) this.hud.set({ toast: null });

    const now = performance.now();
    if (now - this.lastHudPush < 1000 / HUD.pushRate) return;
    this.lastHudPush = now;

    const target = this.lockTarget && this.lockTarget.alive ? this.lockTarget : this.nearestThreat();
    this.hud.set({
      hp: Math.round(this.player.hp),
      maxHp: PLAYER.maxHp,
      stamina: Math.round(this.player.stamina),
      maxStamina: PLAYER.maxStamina,
      comboIndex: Math.max(0, this.player.comboStep),
      comboCount: this.player.comboStep >= 0 ? this.player.comboStep + 1 : 0,
      kills: this.kills,
      runKills: this.runKills,
      wolvesAlive: this.aliveWolves().length,
      timeMs: Math.round(this.timeMs),
      targetName: target ? WOLF.name : null,
      targetHp: target ? Math.round(target.hp) : 0,
      targetMaxHp: WOLF.maxHp,
      targetVisible: target !== null,
      dodgeReady: this.player.dodgeReady,
      staminaLocked: this.player.stamina < PLAYER.dodgeStaminaMin,
      fps: Math.round(this.fpsAvg),
      msPerFrame: Math.round(rawDeltaMs * 10) / 10,
      drawCalls: this.scene.getActiveMeshes().length,
    });
  }

  /** Show the closest attacking wolf even when ARNO has no lock. */
  private nearestThreat(): Wolf | null {
    let best: Wolf | null = null;
    let bestD = Infinity;
    for (const w of this.aliveWolves()) {
      if (!w.targeting) continue;
      const d = Vector3.Distance(w.position, this.player.position);
      if (d < bestD) {
        bestD = d;
        best = w;
      }
    }
    return bestD < CAMERA.distance + 5 ? best : null;
  }

  dispose(): void {
    this.running = false;
    for (const off of this.detach) off();
    this.detach.length = 0;
    this.input?.dispose();
    this.audio?.dispose();
    this.floaters?.dispose();
    this.fx?.dispose();
    for (const w of this.wolves) w.dispose();
    this.wolves = [];
    this.player?.dispose();
    this.pipeline?.dispose();
    this.glow?.dispose();
    this.shadow?.dispose();
    // Scene.dispose also frees the world meshes, materials and textures.
    this.scene?.dispose();
    if (this.engine) {
      this.engine.stopRenderLoop();
      this.engine.dispose();
    }
  }
}

/** Kept for the brazier ember sprite; unused imports break the type check. */
void particleSprite;
void DynamicTexture;
void Rng;
