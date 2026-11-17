import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  VertexData,
} from '../babylon';
import { WORLD, type QualityLevel } from '../config';
import { Rng, clamp, terrainHeight } from '../math';

/**
 * The Dimwood floor: a subdivided plane displaced by `terrainHeight`, shaded
 * with baked vertex colour instead of textures so the whole world fits in the
 * service-worker precache and loads offline with no asset requests.
 */
export function createGround(scene: Scene, parent: TransformNode, quality: QualityLevel): Mesh {
  const extent = WORLD.groundExtent;
  // Subdivision density follows quality: a 120 m plane needs ~1 m quads at
  // high, coarser elsewhere, and the characters sample the analytic height
  // field anyway, so stepping errors stay invisible.
  const subdivisions = quality === 'high' ? 128 : quality === 'medium' ? 96 : 64;

  const ground = MeshBuilder.CreateGround(
    'dimwood-ground',
    { width: extent, height: extent, subdivisions, updatable: true },
    scene,
  );

  const positions = ground.getVerticesData('position');
  const indices = ground.getIndices();
  if (!positions || !indices) throw new Error('ground: missing vertex buffers');

  const rng = new Rng(WORLD.seed ^ 0x51ed);
  const vertexCount = positions.length / 3;
  const colors = new Float32Array(vertexCount * 4);

  // Palette: dead moss under a moon that never quite rises.
  const mossDark = new Color3(0.05, 0.072, 0.052);
  const mossLit = new Color3(0.108, 0.15, 0.094);
  const mud = new Color3(0.072, 0.056, 0.04);
  const ash = new Color3(0.132, 0.146, 0.15);

  for (let v = 0; v < vertexCount; v += 1) {
    const i = v * 3;
    const x = positions[i];
    const z = positions[i + 2];
    const y = terrainHeight(x, z);
    positions[i + 1] = y;

    const radius = Math.hypot(x, z);

    // Hollows collect mud, crests bleach to ash, the slope between is moss.
    const t = clamp((y + 2.2) / 4.6, 0, 1);
    let c = Color3.Lerp(mud, mossDark, 0.3 + t * 0.45);
    c = Color3.Lerp(c, mossLit, t * 0.5);
    c = Color3.Lerp(c, ash, clamp((t - 0.74) * 2.6, 0, 1));

    // The fighting clearing is scoured bare and slightly cold.
    const clearing = clamp(1 - (radius - 3) / (WORLD.clearingRadius - 3), 0, 1);
    c = Color3.Lerp(c, new Color3(0.062, 0.058, 0.05), clearing * 0.55);

    // Per-vertex mottling breaks up banding on a large flat-shaded plane.
    const fleck = (rng.next() - 0.5) * 0.03;
    colors[v * 4] = clamp(c.r + fleck, 0, 1);
    colors[v * 4 + 1] = clamp(c.g + fleck, 0, 1);
    colors[v * 4 + 2] = clamp(c.b + fleck * 0.7, 0, 1);
    colors[v * 4 + 3] = 1;

    // Sink the rim below the fog line so the arena has no visible cliff.
    if (radius > WORLD.arenaRadius) {
      positions[i + 1] -= (radius - WORLD.arenaRadius) * 0.6;
    }
  }

  const normals = new Float32Array(positions.length);
  VertexData.ComputeNormals(positions, indices, normals);

  const vd = new VertexData();
  vd.positions = Array.from(positions);
  vd.normals = Array.from(normals);
  vd.colors = Array.from(colors);
  vd.indices = Array.from(indices);
  vd.applyToMesh(ground, true);

  ground.receiveShadows = true;
  ground.material = createGroundMaterial(scene);
  ground.freezeWorldMatrix();
  ground.parent = parent;
  return ground;
}

function createGroundMaterial(scene: Scene): StandardMaterial {
  const mat = new StandardMaterial('dimwood-ground-mat', scene);
  // Vertex colours carry the art direction, so diffuse stays a neutral 1.
  mat.diffuseColor = new Color3(1, 1, 1);
  mat.specularColor = new Color3(0.05, 0.07, 0.055);
  mat.specularPower = 40;
  mat.emissiveColor = new Color3(0.012, 0.02, 0.015);
  return mat;
}

/**
 * Ring of standing stones that reads as the hunt boundary long before the
 * invisible wall does. One template mesh, instances for every stone.
 */
export function createBoundaryMarkers(scene: Scene, parent: TransformNode): Mesh {
  const rng = new Rng(WORLD.seed ^ 0xbeef);
  const template = MeshBuilder.CreatePolyhedron('boundary-stone', { type: 1, size: 1 }, scene);
  template.material = stoneMaterial(scene);
  template.parent = parent;
  template.setEnabled(false);

  const count = 30;
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2 + rng.range(-0.06, 0.06);
    const r = WORLD.arenaRadius - rng.range(0.3, 2.6);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const stone = template.createInstance(`stone-${i}`);
    stone.parent = parent;
    stone.position.set(x, terrainHeight(x, z) - 0.4, z);
    stone.rotation.set(rng.range(-0.16, 0.16), a + rng.range(-0.6, 0.6), rng.range(-0.22, 0.22));
    const s = rng.range(0.75, 2);
    stone.scaling.set(s * 0.55, s * rng.range(1.4, 3.1), s * 0.5);
    stone.receiveShadows = true;
    stone.freezeWorldMatrix();
  }

  return template;
}

function stoneMaterial(scene: Scene): StandardMaterial {
  const mat = new StandardMaterial('stone-mat', scene);
  mat.diffuseColor = new Color3(0.128, 0.136, 0.134);
  mat.specularColor = new Color3(0.035, 0.04, 0.045);
  mat.specularPower = 22;
  mat.emissiveColor = new Color3(0.006, 0.011, 0.009);
  return mat;
}

export const FOG_COLOR = new Color3(WORLD.fogColor[0], WORLD.fogColor[1], WORLD.fogColor[2]);
export const MOONLIGHT = new Color3(0.44, 0.55, 0.68);
export const EMBER_LIGHT = new Color3(0.86, 0.42, 0.16);
