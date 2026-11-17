import { MeshBuilder, Scene, TransformNode } from '../babylon';
import type { CharacterMaterials } from '../materials';
import { Rig, ball, brick, limb, plate, v3 } from './parts';

/**
 * The Dimwood wolf: low, long, underfed. Built from primitives with a
 * four-joint-per-leg rig so the gallop can use a real canter phase order
 * (FL, FR+BL, BR, suspension) instead of a two-leg seesaw.
 */
export interface WolfRig extends Rig {
  jaw: TransformNode;
  tailBase: TransformNode;
  muzzle: TransformNode;
  ears: TransformNode[];
  body: TransformNode;
}

export function buildWolf(scene: Scene, mats: CharacterMaterials, parent: TransformNode): WolfRig {
  const root = new TransformNode('wolf', scene);
  root.parent = parent;
  const rig = new Rig(root, scene);

  // Spine runs front-to-back; the whole body articulates off three nodes so
  // the topline flexes while galloping.
  const hips = rig.add('hips', new TransformNode('wolf-hips', scene));
  hips.parent = root;
  hips.position.set(0, 0.56, -0.42);

  const mid = rig.add('mid', new TransformNode('wolf-mid', scene));
  mid.parent = hips;
  mid.position.set(0, 0.02, 0.42);

  const body = rig.add('body', new TransformNode('wolf-body', scene));
  body.parent = mid;
  body.position.set(0, 0.02, 0.34);

  // Ribcage and haunches.
  const ribcage = ball('ribcage', body, v3(0, 0, 0.02), 0.62, mats.wolfFur, v3(0.66, 0.74, 1.1));
  rig.register(ribcage);

  const loin = ball('loin', mid, v3(0, -0.02, 0), 0.5, mats.wolfFur, v3(0.6, 0.6, 1.1));
  rig.register(loin);

  const haunch = ball('haunch', hips, v3(0, -0.02, 0.02), 0.56, mats.wolfFur, v3(0.72, 0.72, 0.9));
  rig.register(haunch);

  const belly = ball('belly', mid, v3(0, -0.16, 0.1), 0.42, mats.wolfBelly, v3(0.62, 0.5, 1.3));
  rig.register(belly);

  // Hackles along the topline — the dark fantasy silhouette cue.
  for (let i = 0; i < 7; i += 1) {
    const spike = MeshBuilder.CreateCylinder(
      `hackle-${i}`,
      { diameterTop: 0, diameterBottom: 0.07, height: 0.16, tessellation: 4 },
      scene,
    );
    spike.material = mats.wolfFur;
    const anchor = i < 3 ? body : i < 5 ? mid : hips;
    spike.parent = anchor;
    const local = i < 3 ? 0.24 - i * 0.16 : i < 5 ? 0.14 - (i - 3) * 0.2 : 0.06 - (i - 5) * 0.16;
    spike.position.set(0, 0.28 - Math.abs(i - 3) * 0.02, local);
    spike.rotation.x = -0.2 + i * 0.02;
    rig.register(spike);
  }

  // ---------------- neck + head ----------------
  const neck = rig.add('neck', new TransformNode('wolf-neck', scene));
  neck.parent = body;
  neck.position.set(0, 0.08, 0.3);
  neck.rotation.x = 0.42;

  const neckMesh = limb('neck-flesh', neck, v3(0, 0, 0), 0.34, 0.2, 0.34, mats.wolfFur, 'forward', 8);
  rig.register(neckMesh.mesh);

  const head = rig.add('head', new TransformNode('wolf-head', scene));
  head.parent = neck;
  head.position.set(0, -0.04, 0.36);

  const skull = ball('wolf-skull', head, v3(0, 0.02, 0.02), 0.32, mats.wolfFur, v3(0.85, 0.9, 1));
  rig.register(skull);

  const brow = ball('wolf-brow', head, v3(0, 0.08, 0.12), 0.24, mats.wolfFur, v3(1, 0.55, 0.7));
  rig.register(brow);

  // Muzzle pivots separately so the snarl and the bite are readable.
  const muzzle = rig.add('muzzle', new TransformNode('wolf-muzzle', scene));
  muzzle.parent = head;
  muzzle.position.set(0, -0.03, 0.18);

  const snout = MeshBuilder.CreateCylinder(
    'wolf-snout',
    { diameterTop: 0.09, diameterBottom: 0.16, height: 0.26, tessellation: 8 },
    scene,
  );
  snout.material = mats.wolfFur;
  snout.parent = muzzle;
  snout.position.set(0, -0.01, 0.13);
  snout.rotation.x = Math.PI / 2 + 0.1;
  rig.register(snout);

  const nose = ball('wolf-nose', muzzle, v3(0, -0.01, 0.27), 0.08, mats.wolfNose);
  rig.register(nose);

  const jaw = rig.add('jaw', new TransformNode('wolf-jaw', scene));
  jaw.parent = muzzle;
  jaw.position.set(0, -0.06, 0.06);

  const jawMesh = brick('jaw-bone', jaw, v3(0, -0.02, 0.09), v3(0.12, 0.045, 0.22), mats.wolfBelly);
  rig.register(jawMesh);

  // Fangs: four on the top, two below, visible the moment the mouth opens.
  for (const side of [-1, 1] as const) {
    for (const [i, len] of [0.11, 0.07].entries()) {
      const fang = MeshBuilder.CreateCylinder(
        `fang-up-${side}-${i}`,
        { diameterTop: 0, diameterBottom: 0.032, height: len, tessellation: 5 },
        scene,
      );
      fang.material = mats.bone;
      fang.parent = muzzle;
      fang.position.set(0.05 * side * (i === 0 ? 1 : 1.5), -0.055, 0.16 - i * 0.05);
      fang.rotation.x = Math.PI;
      rig.register(fang);
    }
    const lower = MeshBuilder.CreateCylinder(
      `fang-low-${side}`,
      { diameterTop: 0, diameterBottom: 0.026, height: 0.075, tessellation: 5 },
      scene,
    );
    lower.material = mats.bone;
    lower.parent = jaw;
    lower.position.set(0.04 * side, 0.02, 0.12);
    rig.register(lower);
  }

  const ears: TransformNode[] = [];
  for (const side of [-1, 1] as const) {
    const ear = new TransformNode(`wolf-ear-${side}`, scene);
    ear.parent = head;
    ear.position.set(0.11 * side, 0.16, -0.02);
    rig.add(`ear${side}`, ear);
    const pinna = plate(
      `pinna-${side}`,
      ear,
      v3(0, 0.07, 0),
      0.2,
      0.3,
      mats.wolfFur,
      v3(0.1, 0, 0.45 * side),
    );
    pinna.scaling.set(0.5, 0.3, 0.7);
    rig.register(pinna);
    ears.push(ear);
  }

  for (const side of [-1, 1] as const) {
    const eye = ball(`wolf-eye-${side}`, head, v3(0.1 * side, 0.05, 0.15), 0.045, mats.wolfEye);
    rig.register(eye);
  }

  // ---------------- legs ----------------
  const legDefs = [
    { tag: 'FL', x: 1, z: 1, front: true },
    { tag: 'FR', x: -1, z: 1, front: true },
    { tag: 'BL', x: 1, z: -1, front: false },
    { tag: 'BR', x: -1, z: -1, front: false },
  ] as const;

  for (const def of legDefs) {
    const shoulder = new TransformNode(`wolf-shoulder-${def.tag}`, scene);
    shoulder.parent = def.front ? body : hips;
    shoulder.position.set(0.17 * def.x, -0.12, def.front ? 0.02 : 0.04);
    rig.add(`leg${def.tag}`, shoulder);

    const upper = limb(
      `wolf-upper-${def.tag}`,
      shoulder,
      v3(0, 0, 0),
      0.3,
      0.11,
      0.14,
      mats.wolfFur,
      'down',
      6,
    );
    rig.register(upper.mesh);

    const knee = new TransformNode(`wolf-knee-${def.tag}`, scene);
    knee.parent = upper.joint;
    knee.position.set(0, -0.3, def.front ? -0.04 : 0.06);
    knee.rotation.x = def.front ? -0.3 : 0.42;
    rig.add(`knee${def.tag}`, knee);

    const lower = limb(
      `wolf-lower-${def.tag}`,
      knee,
      v3(0, 0, 0),
      0.3,
      0.06,
      0.1,
      mats.wolfFur,
      'down',
      6,
    );
    rig.register(lower.mesh);

    const paw = brick(
      `wolf-paw-${def.tag}`,
      knee,
      v3(0, -0.31, def.front ? 0.05 : -0.04),
      v3(0.11, 0.06, 0.17),
      mats.wolfNose,
    );
    rig.register(paw);
  }

  // ---------------- tail ----------------
  const tailBase = rig.add('tail', new TransformNode('wolf-tail', scene));
  tailBase.parent = hips;
  tailBase.position.set(0, 0.1, -0.26);
  tailBase.rotation.x = -0.9;

  let anchor: TransformNode = tailBase;
  for (let i = 0; i < 3; i += 1) {
    const seg = limb(`tail-${i}`, anchor, v3(0, 0, 0), 0.22, 0.07 - i * 0.015, 0.11 - i * 0.02, mats.wolfFur, 'back', 6);
    rig.register(seg.mesh);
    const next = new TransformNode(`tail-joint-${i}`, scene);
    next.parent = seg.joint;
    next.position.set(0, 0.02, -0.22);
    rig.add(`tail${i}`, next);
    anchor = next;
  }

  return Object.assign(rig, { jaw, tailBase, muzzle, ears, body }) as WolfRig;
}

export const WOLF_SIZES = {
  shoulderHeight: 0.78,
  bodyLength: 1.5,
  biteRange: 1.5,
} as const;
