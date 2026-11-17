import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from '../babylon';

/**
 * Tiny rig helpers.
 *
 * A "bone" here is a `TransformNode` acting as a joint plus one visual mesh
 * hanging off it. The mesh is offset by `-length/2` along the joint's local
 * axis so rotating the joint pivots the limb at its attachment point, exactly
 * like a real skeleton — which is what makes the procedural walk and swing
 * cycles read as articulated rather than as a sliding blob.
 */

export interface Bone {
  joint: TransformNode;
  mesh: Mesh;
  length: number;
}

export type BoneAxis = 'down' | 'forward' | 'back' | 'left' | 'right';

const AXIS_SIGN: Record<BoneAxis, Vector3> = {
  down: new Vector3(0, -1, 0),
  forward: new Vector3(0, 0, 1),
  back: new Vector3(0, 0, -1),
  left: new Vector3(-1, 0, 0),
  right: new Vector3(1, 0, 0),
};

/** A tapered capsule-ish limb segment built from one cylinder. */
export function limb(
  name: string,
  parent: TransformNode,
  at: Vector3,
  length: number,
  diameterTop: number,
  diameterBottom: number,
  mat: StandardMaterial,
  axis: BoneAxis = 'down',
  tessellation = 8,
): Bone {
  const joint = new TransformNode(`${name}-joint`, parent.getScene());
  joint.parent = parent;
  joint.position.copyFrom(at);

  const dir = AXIS_SIGN[axis];
  const mesh = MeshBuilder.CreateCylinder(
    name,
    { diameterTop, diameterBottom, height: length, tessellation },
    parent.getScene(),
  );
  mesh.material = mat;
  mesh.parent = joint;
  // Lay the cylinder along the bone axis: its native axis is +Y.
  if (axis === 'forward' || axis === 'back') {
    mesh.rotation.x = axis === 'forward' ? Math.PI / 2 : -Math.PI / 2;
  } else if (axis === 'left' || axis === 'right') {
    mesh.rotation.z = axis === 'left' ? Math.PI / 2 : -Math.PI / 2;
  }
  mesh.position.copyFrom(dir.scale(length / 2));
  mesh.receiveShadows = true;
  return { joint, mesh, length };
}

export function ball(
  name: string,
  parent: TransformNode,
  at: Vector3,
  diameter: number,
  mat: StandardMaterial,
  scale?: Vector3,
): Mesh {
  const mesh = MeshBuilder.CreateSphere(name, { diameter, segments: 10 }, parent.getScene());
  mesh.material = mat;
  mesh.parent = parent;
  mesh.position.copyFrom(at);
  if (scale) mesh.scaling.copyFrom(scale);
  mesh.receiveShadows = true;
  return mesh;
}

export function brick(
  name: string,
  parent: TransformNode,
  at: Vector3,
  size: Vector3,
  mat: StandardMaterial,
  rot?: Vector3,
): Mesh {
  const mesh = MeshBuilder.CreateBox(name, { size: 1 }, parent.getScene());
  mesh.material = mat;
  mesh.parent = parent;
  mesh.position.copyFrom(at);
  mesh.scaling.copyFrom(size);
  if (rot) mesh.rotation.copyFrom(rot);
  mesh.receiveShadows = true;
  return mesh;
}

/** Flattened, tapered slab used for pauldrons, cheek guards and cape panels. */
export function plate(
  name: string,
  parent: TransformNode,
  at: Vector3,
  diameter: number,
  flatten: number,
  mat: StandardMaterial,
  rot?: Vector3,
): Mesh {
  const mesh = MeshBuilder.CreateSphere(name, { diameter, segments: 8, slice: 1 }, parent.getScene());
  mesh.material = mat;
  mesh.parent = parent;
  mesh.position.copyFrom(at);
  mesh.scaling.set(1, flatten, 1);
  if (rot) mesh.rotation.copyFrom(rot);
  mesh.receiveShadows = true;
  return mesh;
}

export const v3 = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

/** A named joint registry, so poses are data and not 60 positional writes. */
export class Rig {
  readonly joints = new Map<string, TransformNode>();
  readonly meshes: Mesh[] = [];
  /**
   * Rotation each joint had when the model was finished. Poses are authored as
   * deltas from this, so a built-in rest angle (the pig's digitigrade ankle,
   * the wolf's hocked stifle) is never silently zeroed by an animation.
   */
  private rest = new Map<string, Vector3>();

  constructor(
    readonly root: TransformNode,
    readonly scene: Scene,
  ) {}

  add(name: string, node: TransformNode): TransformNode {
    this.joints.set(name, node);
    return node;
  }

  /** Snapshot every joint's current rotation as the neutral pose. Call once
   *  after the model is built and before any animation runs. */
  captureRest(): this {
    this.rest = new Map();
    for (const [name, node] of this.joints) {
      this.rest.set(name, node.rotation.clone());
    }
    return this;
  }

  restOf(name: string): Vector3 | undefined {
    return this.rest.get(name);
  }

  register(mesh: Mesh): Mesh {
    this.meshes.push(mesh);
    return mesh;
  }

  get(name: string): TransformNode {
    const node = this.joints.get(name);
    if (!node) throw new Error(`rig: unknown joint "${name}"`);
    return node;
  }

  /** Apply a pose delta on top of the captured rest angle. */
  pose(name: string, x: number, y: number, z: number): void {
    const node = this.joints.get(name);
    if (!node) return;
    const base = this.rest.get(name);
    if (base) node.rotation.set(base.x + x, base.y + y, base.z + z);
    else node.rotation.set(x, y, z);
  }

  /**
   * Like `pose`, but eases toward the target instead of snapping to it, so a
   * state switch (idle into a slash, slash into a roll) blends over a frame
   * or two rather than popping. `k` is a pre-computed 0..1 blend fraction.
   */
  smoothPose(name: string, x: number, y: number, z: number, k: number): void {
    const node = this.joints.get(name);
    if (!node) return;
    const base = this.rest.get(name);
    const tx = (base?.x ?? 0) + x;
    const ty = (base?.y ?? 0) + y;
    const tz = (base?.z ?? 0) + z;
    node.rotation.x += (tx - node.rotation.x) * k;
    node.rotation.y += (ty - node.rotation.y) * k;
    node.rotation.z += (tz - node.rotation.z) * k;
  }

  setPosition(name: string, x: number, y: number, z: number): void {
    const p = this.joints.get(name)?.position;
    if (p) p.set(x, y, z);
  }

  /**
   * Write the *absolute* rotation, bypassing the rest offset. Used only for
   * nodes whose model-space angle is meaningless, like the roll pivot.
   */
  setAbsolute(name: string, x: number, y: number, z: number): void {
    const node = this.joints.get(name);
    if (node) node.rotation.set(x, y, z);
  }

  castShadows(shadowCaster?: { addShadowCaster(mesh: unknown): unknown }): void {
    if (!shadowCaster) return;
    for (const mesh of this.meshes) shadowCaster.addShadowCaster(mesh);
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose();
    for (const node of this.joints.values()) node.dispose();
    this.root.dispose();
  }
}

/** Utility colour for debug silhouettes; kept so no stray literal escapes. */
export const RIG_DEBUG_COLOR = new Color3(0.6, 0.1, 0.1);
