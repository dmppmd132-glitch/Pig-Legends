import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Texture,
  TransformNode,
} from '../babylon';
import { WORLD } from '../config';
import { Rng, clamp, terrainHeight } from '../math';

export interface ScatterSpot {
  x: number;
  z: number;
  r: number;
}

/** Positions of every solid trunk, used by the entity collision resolver. */
export function obstacleList(root: TransformNode): Array<{ x: number; z: number; r: number }> {
  const out: Array<{ x: number; z: number; r: number }> = [];
  for (const child of root.getChildMeshes(false)) {
    if (child.metadata && typeof child.metadata === 'object' && 'obstacle' in child.metadata) {
      const meta = child.metadata as { obstacle?: { x: number; z: number; r: number } };
      if (meta.obstacle) out.push(meta.obstacle);
    }
  }
  return out;
}

/**
 * Build the whole forest. Everything is procedural geometry + vertex/solid
 * colour: no external model files, so the first run works with the network
 * off and the precache stays small.
 */
export function buildForest(
  scene: Scene,
  parent: TransformNode,
  quality: { treeCount: number; rockCount: number; grassCount: number },
  onProgress: (label: string, pct: number) => void,
): { root: TransformNode; obstacles: ScatterSpot[] } {
  const root = new TransformNode('dimwood', scene);
  root.parent = parent;
  const rng = new Rng(WORLD.seed);
  const obstacles: ScatterSpot[] = [];

  const mats = forestMaterials(scene);

  onProgress('Planting the Dimwood', 0.25);

  // ---- Dead trees --------------------------------------------------
  const trunkTemplates = buildTreeTemplates(scene, rng);
  for (const t of trunkTemplates) {
    t.material = mats.bark;
    t.parent = root;
    t.setEnabled(false);
  }

  const placed: Array<{ x: number; z: number }> = [];
  const minSpacing = 3.1;
  for (let i = 0; i < quality.treeCount; i += 1) {
    const spot = rejectSample(rng, placed, minSpacing, WORLD.arenaRadius + 6, WORLD.clearingRadius);
    if (!spot) continue;
    placed.push(spot);
    const template = trunkTemplates[i % trunkTemplates.length];
    const trunk = template.createInstance(`tree-${i}`);
    trunk.parent = root;
    const scale = rng.range(0.75, 1.65);
    trunk.position.set(spot.x, terrainHeight(spot.x, spot.z) - 0.2, spot.z);
    trunk.rotation.y = rng.range(0, Math.PI * 2);
    trunk.rotation.z = rng.range(-0.05, 0.05);
    trunk.scaling.set(scale, scale * rng.range(0.9, 1.3), scale);
    trunk.freezeWorldMatrix();

    const r = 0.42 * scale;
    obstacles.push({ x: spot.x, z: spot.z, r });
    trunk.metadata = { obstacle: { x: spot.x, z: spot.z, r } };
  }

  onProgress('Scattering bones and stone', 0.45);

  // ---- Rocks -------------------------------------------------------
  const rockTemplate = MeshBuilder.CreatePolyhedron('rock', { type: 1, size: 1 }, scene);
  rockTemplate.material = mats.rock;
  rockTemplate.parent = root;
  rockTemplate.setEnabled(false);
  for (let i = 0; i < quality.rockCount; i += 1) {
    const x = rng.range(-WORLD.arenaRadius, WORLD.arenaRadius);
    const z = rng.range(-WORLD.arenaRadius, WORLD.arenaRadius);
    const d = Math.hypot(x, z);
    if (d < WORLD.clearingRadius * 0.55) continue;
    const rock = rockTemplate.createInstance(`rock-${i}`);
    rock.parent = root;
    const s = rng.range(0.25, 1.35);
    rock.position.set(x, terrainHeight(x, z) - s * 0.28, z);
    rock.rotation.set(rng.range(0, 3), rng.range(0, 6), rng.range(0, 3));
    rock.scaling.set(s * rng.range(0.8, 1.5), s * rng.range(0.5, 1), s * rng.range(0.8, 1.5));
    rock.receiveShadows = true;
    rock.freezeWorldMatrix();
    if (s > 0.9) obstacles.push({ x, z, r: s * 0.8 });
  }

  // ---- Fallen logs -------------------------------------------------
  const logTemplate = MeshBuilder.CreateCylinder(
    'log',
    { diameter: 0.62, height: 4.4, tessellation: 7 },
    scene,
  );
  logTemplate.material = mats.bark;
  logTemplate.parent = root;
  logTemplate.setEnabled(false);
  for (let i = 0; i < 14; i += 1) {
    const x = rng.range(-WORLD.arenaRadius * 0.95, WORLD.arenaRadius * 0.95);
    const z = rng.range(-WORLD.arenaRadius * 0.95, WORLD.arenaRadius * 0.95);
    const d = Math.hypot(x, z);
    if (d < WORLD.clearingRadius * 0.8 || d > WORLD.arenaRadius - 2) continue;
    const log = logTemplate.createInstance(`log-${i}`);
    log.parent = root;
    log.position.set(x, terrainHeight(x, z) + 0.22, z);
    log.rotation.set(0, rng.range(0, Math.PI), Math.PI / 2);
    const s = rng.range(0.7, 1.25);
    log.scaling.set(s, s, s);
    log.receiveShadows = true;
    log.freezeWorldMatrix();
    obstacles.push({ x, z, r: 1.4 * s });
  }

  // ---- Grass tufts -------------------------------------------------
  onProgress('Growing the undergrowth', 0.62);
  const blade = buildGrassBlade(scene, mats.grass);
  blade.parent = root;
  blade.setEnabled(false);
  const tuft = buildTuft(scene, mats.grass);
  tuft.parent = root;
  tuft.setEnabled(false);
  for (let i = 0; i < quality.grassCount; i += 1) {
    const x = rng.range(-WORLD.arenaRadius, WORLD.arenaRadius);
    const z = rng.range(-WORLD.arenaRadius, WORLD.arenaRadius);
    const src = rng.next() < 0.35 ? tuft : blade;
    const g = src.createInstance(`grass-${i}`);
    g.parent = root;
    const s = rng.range(0.55, 1.5);
    g.position.set(x, terrainHeight(x, z) - 0.02, z);
    g.rotation.y = rng.range(0, Math.PI * 2);
    g.scaling.set(s, s * rng.range(0.8, 1.6), s);
    g.freezeWorldMatrix();
  }

  // ---- Glowing cap mushrooms, the only warm light on the floor ------
  const cap = buildShroomCap(scene, mats.shroomGlow);
  cap.parent = root;
  cap.setEnabled(false);
  const shroomCount = Math.round(quality.grassCount * 0.02) + 8;
  for (let i = 0; i < shroomCount; i += 1) {
    const x = rng.range(-WORLD.arenaRadius * 0.9, WORLD.arenaRadius * 0.9);
    const z = rng.range(-WORLD.arenaRadius * 0.9, WORLD.arenaRadius * 0.9);
    const m = cap.createInstance(`shroom-${i}`);
    m.parent = root;
    const s = rng.range(0.5, 1.15);
    m.position.set(x, terrainHeight(x, z), z);
    m.scaling.set(s, s, s);
    m.rotation.y = rng.range(0, 6.28);
    m.freezeWorldMatrix();
  }


  return { root, obstacles };
}

function rejectSample(
  rng: Rng,
  placed: Array<{ x: number; z: number }>,
  minSpacing: number,
  maxRadius: number,
  clearing: number,
): { x: number; z: number } | null {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const a = rng.range(0, Math.PI * 2);
    // Bias outward: r^0.62 gives a denser rim without a hollow centre.
    const r = Math.sqrt(rng.next()) * maxRadius * 0.94 + clearing * rng.range(0.15, 0.5);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (Math.hypot(x, z) < clearing) continue;
    if (Math.hypot(x, z) > maxRadius) continue;
    let ok = true;
    for (const p of placed) {
      if ((p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < minSpacing * minSpacing) {
        ok = false;
        break;
      }
    }
    if (ok) return { x, z };
  }
  return null;
}

/** Three gnarled silhouettes; instances of these read as a hundred trees. */
function buildTreeTemplates(scene: Scene, rng: Rng): Mesh[] {
  const templates: Mesh[] = [];
  for (let variant = 0; variant < 3; variant += 1) {
    const parts: Mesh[] = [];
    const height = 6.5 + variant * 1.6;
    const trunk = MeshBuilder.CreateCylinder(
      `t${variant}-trunk`,
      {
        diameterTop: 0.22 + variant * 0.04,
        diameterBottom: 0.95 + variant * 0.3,
        height,
        tessellation: 8,
      },
      scene,
    );
    trunk.position.y = height / 2;
    parts.push(trunk);

    const branchCount = 4 + variant;
    for (let b = 0; b < branchCount; b += 1) {
      const bl = rng.range(1.5, 3.4);
      const branch = MeshBuilder.CreateCylinder(
        `t${variant}-b${b}`,
        { diameterTop: 0.05, diameterBottom: 0.24, height: bl, tessellation: 5 },
        scene,
      );
      const at = rng.range(0.45, 0.95);
      branch.position.set(0, height * at, 0);
      branch.rotation.z = rng.range(0.6, 1.5) * (b % 2 === 0 ? 1 : -1);
      branch.rotation.y = (b / branchCount) * Math.PI * 2 + rng.range(-0.4, 0.4);
      parts.push(branch);
    }

    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true);
    const tree = merged ?? parts[0];
    tree.name = `tree-template-${variant}`;
    tree.material = null;
    templates.push(tree);
  }
  return templates;
}

function buildGrassBlade(scene: Scene, mat: StandardMaterial): Mesh {
  const blade = MeshBuilder.CreateCylinder(
    'grass-blade',
    { diameterTop: 0, diameterBottom: 0.07, height: 0.42, tessellation: 3 },
    scene,
  );
  blade.position.y = 0.2;
  blade.material = mat;
  return blade;
}

function buildTuft(scene: Scene, mat: StandardMaterial): Mesh {
  const parts: Mesh[] = [];
  for (let i = 0; i < 4; i += 1) {
    const b = MeshBuilder.CreateCylinder(
      `tuft-${i}`,
      { diameterTop: 0, diameterBottom: 0.09, height: 0.6, tessellation: 3 },
      scene,
    );
    b.rotation.z = (i / 4) * 0.5 - 0.12;
    b.position.set((i % 2) * 0.08 - 0.04, 0.28, Math.floor(i / 2) * 0.07);
    parts.push(b);
  }
  const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true);
  const tuft = merged ?? parts[0];
  tuft.name = 'grass-tuft';
  tuft.material = mat;
  return tuft;
}

function buildShroomCap(scene: Scene, glowMat: StandardMaterial): Mesh {
  const stem = MeshBuilder.CreateCylinder(
    'shroom-stem',
    { diameter: 0.06, height: 0.18, tessellation: 5 },
    scene,
  );
  stem.position.y = 0.09;
  const cap = MeshBuilder.CreateSphere('shroom-cap', { diameter: 0.22, segments: 6 }, scene);
  cap.scaling.set(1, 0.6, 1);
  cap.position.y = 0.2;
  const merged = Mesh.MergeMeshes([stem, cap], true, true, undefined, false, true);
  const shroom = merged ?? cap;
  shroom.name = 'shroom';
  shroom.material = glowMat;
  return shroom;
}

interface ForestMaterials {
  bark: StandardMaterial;
  rock: StandardMaterial;
  grass: StandardMaterial;
  shroomGlow: StandardMaterial;
}

function forestMaterials(scene: Scene): ForestMaterials {
  const bark = new StandardMaterial('bark-mat', scene);
  bark.diffuseColor = new Color3(0.075, 0.068, 0.058);
  bark.specularColor = new Color3(0.02, 0.02, 0.02);
  bark.emissiveColor = new Color3(0.006, 0.008, 0.007);

  const rock = new StandardMaterial('rock-mat', scene);
  rock.diffuseColor = new Color3(0.108, 0.118, 0.115);
  rock.specularColor = new Color3(0.04, 0.045, 0.05);
  rock.specularPower = 20;
  rock.emissiveColor = new Color3(0.005, 0.008, 0.008);

  const grass = new StandardMaterial('grass-mat', scene);
  grass.diffuseColor = new Color3(0.062, 0.098, 0.05);
  grass.specularColor = new Color3(0.02, 0.03, 0.02);
  grass.emissiveColor = new Color3(0.008, 0.016, 0.008);

  const shroomGlow = new StandardMaterial('shroom-glow-mat', scene);
  shroomGlow.diffuseColor = new Color3(0.1, 0.16, 0.1);
  shroomGlow.emissiveColor = new Color3(0.16, 0.62, 0.34);
  shroomGlow.specularColor = new Color3(0, 0, 0);

  return { bark, rock, grass, shroomGlow };
}

/**
 * Night sky dome + moon. Drawn once into a DynamicTexture so the "art" costs
 * no file requests; the dome sits at infinite distance and ignores fog.
 */
export function buildSky(scene: Scene, parent: TransformNode): void {
  const size = 512;
  const tex = new DynamicTexture('sky-tex', { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;

  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#01030a');
  grad.addColorStop(0.35, '#04080f');
  grad.addColorStop(0.62, '#0a1417');
  grad.addColorStop(0.82, '#12211b');
  grad.addColorStop(1, '#1b2a20');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Stars, denser near the zenith.
  const rng = new Rng(WORLD.seed ^ 0x574152);
  for (let i = 0; i < 420; i += 1) {
    const x = rng.range(0, size);
    const y = Math.pow(rng.next(), 1.7) * size * 0.7;
    const a = rng.range(0.12, 0.8) * (1 - y / (size * 0.8));
    ctx.fillStyle = `rgba(${200 + rng.int(0, 55)},${215 + rng.int(0, 40)},255,${clamp(a, 0, 1)})`;
    const s = rng.range(0.4, 1.5);
    ctx.fillRect(x, y, s, s);
  }

  tex.update();
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;

  const dome = MeshBuilder.CreateSphere('sky-dome', { diameter: 300, segments: 12, sideOrientation: Mesh.BACKSIDE }, scene);
  const skyMat = new StandardMaterial('sky-mat', scene);
  skyMat.emissiveTexture = tex;
  skyMat.emissiveColor = new Color3(1, 1, 1);
  skyMat.diffuseColor = new Color3(0, 0, 0);
  skyMat.specularColor = new Color3(0, 0, 0);
  skyMat.disableLighting = true;
  skyMat.emissiveTexture = tex;
  skyMat.backFaceCulling = false;
  dome.material = skyMat;
  dome.infiniteDistance = true;
  dome.applyFog = false;
  dome.parent = parent;
  dome.renderingGroupId = 0;
  dome.doNotSyncBoundingInfo = true;

  // Moon: an emissive disc with a soft halo drawn into one texture.
  const moonTex = new DynamicTexture('moon-tex', { width: 256, height: 256 }, scene, true);
  const mc = moonTex.getContext() as CanvasRenderingContext2D;
  mc.clearRect(0, 0, 256, 256);
  const halo = mc.createRadialGradient(128, 128, 18, 128, 128, 128);
  halo.addColorStop(0, 'rgba(196,214,222,0.55)');
  halo.addColorStop(0.28, 'rgba(120,150,166,0.2)');
  halo.addColorStop(1, 'rgba(60,90,110,0)');
  mc.fillStyle = halo;
  mc.fillRect(0, 0, 256, 256);
  mc.fillStyle = 'rgba(226,236,238,0.98)';
  mc.beginPath();
  mc.arc(128, 128, 34, 0, Math.PI * 2);
  mc.fill();
  // Craters, so it is not a flat white circle.
  mc.fillStyle = 'rgba(150,165,172,0.5)';
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * Math.PI * 2;
    mc.beginPath();
    mc.arc(128 + Math.cos(a) * 14, 128 + Math.sin(a) * 12, 3 + (i % 3) * 2, 0, Math.PI * 2);
    mc.fill();
  }
  moonTex.hasAlpha = true;
  moonTex.update();

  const moon = MeshBuilder.CreatePlane('moon', { size: 26 }, scene);
  const moonMat = new StandardMaterial('moon-mat', scene);
  moonMat.emissiveTexture = moonTex;
  moonMat.opacityTexture = moonTex;
  moonMat.diffuseColor = new Color3(0, 0, 0);
  moonMat.specularColor = new Color3(0, 0, 0);
  moonMat.disableLighting = true;
  moon.material = moonMat;
  moon.position.set(-70, 46, -120);
  moon.infiniteDistance = true;
  moon.applyFog = false;
  moon.billboardMode = Mesh.BILLBOARDMODE_ALL;
  moon.parent = parent;
}

/**
 * Ground mist: a few large alpha planes that slide slowly. Cheaper than a
 * volumetric pass and reads correctly for a dark-fantasy floor.
 */
export function buildMist(scene: Scene, parent: TransformNode): void {
  const tex = new DynamicTexture('mist-tex', { width: 256, height: 256 }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 256, 256);
  const rng = new Rng(WORLD.seed ^ 0x1155);
  for (let i = 0; i < 90; i += 1) {
    const x = rng.range(-40, 296);
    const y = rng.range(0, 256);
    const rx = rng.range(18, 70);
    const ry = rng.range(6, 20);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
    const a = rng.range(0.05, 0.16);
    g.addColorStop(0, `rgba(150,178,168,${a})`);
    g.addColorStop(1, 'rgba(150,178,168,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  tex.hasAlpha = true;
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;

  const mat = new StandardMaterial('mist-mat', scene);
  mat.diffuseTexture = tex;
  mat.opacityTexture = tex;
  mat.emissiveColor = new Color3(0.035, 0.05, 0.046);
  mat.diffuseColor = new Color3(0.15, 0.21, 0.19);
  mat.specularColor = new Color3(0, 0, 0);
  mat.useAlphaFromDiffuseTexture = true;
  mat.backFaceCulling = false;
  mat.transparencyMode = 2; // ALPHA
  mat.needAlphaBlendingForMesh = () => true;
  mat.alpha = 0.34;

  for (let i = 0; i < 4; i += 1) {
    const plane = MeshBuilder.CreateGround('mist-' + i, { width: 84, height: 84, subdivisions: 1 }, scene);
    plane.material = mat;
    plane.position.y = 0.32 + i * 0.42;
    // Fogged mist fades with distance instead of stacking into a bright wall
    // across the horizon, which is what made the far side of the arena glow.
    plane.applyFog = true;
    plane.parent = parent;
    plane.receiveShadows = false;
  }
}
