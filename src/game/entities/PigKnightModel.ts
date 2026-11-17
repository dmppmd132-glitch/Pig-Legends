import { Mesh, MeshBuilder, Scene, TransformNode, Vector3 } from '../babylon';
import type { CharacterMaterials } from '../materials';
import { Rig, ball, brick, limb, plate, v3 } from './parts';

/**
 * ARNO, the pig knight — built entirely from primitives.
 *
 * Deliberation: a hand-modelled boar knight would mean a runtime .glb fetch
 * (offline risk, licence bookkeeping, bundle bloat). The brief explicitly
 * allows a procedural stand-in, so the silhouette is authored in code:
 * drop-shouldered iron over a heavy pork barrel, a pig snout punched through
 * the visor, two crooked tusks, and an outsized sword. It reads as a character
 * rather than a capsule, and `docs/ASSETS.md` describes how to swap a real
 * model into the same joint names later without touching the animation code.
 *
 * Units are metres; the rig stands 1.75 m to the top of the helm.
 */
export interface PigKnightRig extends Rig {
  /** Empty node at the blade point — hit sparks and the arc mesh hang off it. */
  swordTip: TransformNode;
  /** Right hand: everything the sword does is authored relative to this. */
  handR: TransformNode;
  /** Left buckler, used for the guard pose on combo step 3. */
  buckler: Mesh;
  head: TransformNode;
  cape: Mesh;
  blade: Mesh;
}

export function buildPigKnight(scene: Scene, mats: CharacterMaterials, parent: TransformNode): PigKnightRig {
  const root = new TransformNode('arno', scene);
  root.parent = parent;
  const rig = new Rig(root, scene);

  const hips = rig.add('hips', new TransformNode('hips', scene));
  hips.parent = root;
  hips.position.set(0, 0.6, 0);

  // ---------------- legs ----------------
  for (const side of [-1, 1] as const) {
    const tag = side < 0 ? 'L' : 'R';
    const thigh = limb(
      `thigh${tag}`,
      hips,
      v3(0.15 * side, -0.02, 0),
      0.3,
      0.15,
      0.21,
      mats.armour,
    );
    rig.add(`thigh${tag}`, thigh.joint);
    rig.register(thigh.mesh);

    const knee = new TransformNode(`knee${tag}`, scene);
    knee.parent = thigh.joint;
    knee.position.set(0, -0.3, 0);
    rig.add(`knee${tag}`, knee);

    const shin = limb(`shin${tag}`, knee, v3(0, 0, 0), 0.29, 0.11, 0.15, mats.hide);
    rig.register(shin.mesh);

    // Digitigrade pig stance: the hoof breaks forward at the ankle.
    const ankle = new TransformNode(`ankle${tag}`, scene);
    ankle.parent = knee;
    ankle.position.set(0, -0.29, -0.05);
    ankle.rotation.x = 0.5;
    rig.add(`ankle${tag}`, ankle);

    const hoof = brick(`hoof${tag}`, ankle, v3(0, -0.06, 0.05), v3(0.15, 0.11, 0.24), mats.bone);
    rig.register(hoof);
  }

  // ---------------- torso ----------------
  const spine = new TransformNode('spine', scene);
  spine.parent = hips;
  spine.position.set(0, 0.06, 0);
  rig.add('spine', spine);

  // The barrel of a pig: wide, deep, low.
  const belly = ball('belly', spine, v3(0, 0.16, 0.01), 0.62, mats.hide, v3(0.78, 0.72, 0.92));
  rig.register(belly);

  const chest = new TransformNode('chest', scene);
  chest.parent = spine;
  chest.position.set(0, 0.34, 0);
  rig.add('chest', chest);

  const breastplate = ball('breastplate', chest, v3(0, 0.02, 0.02), 0.62, mats.armour, v3(0.92, 0.78, 0.82));
  rig.register(breastplate);

  // Boar-bristle ridge along the spine, visible over the pauldrons.
  const bristles = MeshBuilder.CreateCylinder(
    'bristles',
    { diameterTop: 0.02, diameterBottom: 0.12, height: 0.5, tessellation: 4 },
    scene,
  );
  bristles.material = mats.leather;
  bristles.parent = spine;
  bristles.position.set(0, 0.28, -0.26);
  bristles.rotation.x = -0.32;
  rig.register(bristles);

  const belt = MeshBuilder.CreateCylinder(
    'belt',
    { diameter: 0.58, height: 0.1, tessellation: 12 },
    scene,
  );
  belt.material = mats.leather;
  belt.parent = spine;
  belt.position.set(0, 0.03, 0);
  belt.scaling.set(1, 1, 0.9);
  rig.register(belt);

  const beltClasp = brick('clasp', spine, v3(0, 0.03, 0.27), v3(0.12, 0.1, 0.05), mats.armourTrim);
  rig.register(beltClasp);

  // ---------------- arms ----------------
  for (const side of [-1, 1] as const) {
    const tag = side < 0 ? 'L' : 'R';
    const shoulder = new TransformNode(`shoulder${tag}`, scene);
    shoulder.parent = chest;
    shoulder.position.set(0.3 * side, 0.1, 0);
    rig.add(`shoulder${tag}`, shoulder);

    const pauldron = plate(`pauldron${tag}`, shoulder, v3(0.02 * side, 0.04, 0), 0.34, 0.62, mats.armour);
    rig.register(pauldron);

    const upper = limb(`upper${tag}`, shoulder, v3(0, -0.02, 0), 0.26, 0.13, 0.15, mats.armour);
    rig.add(`upper${tag}`, upper.joint);
    rig.register(upper.mesh);

    const elbow = new TransformNode(`elbow${tag}`, scene);
    elbow.parent = upper.joint;
    elbow.position.set(0, -0.26, 0);
    rig.add(`elbow${tag}`, elbow);

    const fore = limb(`fore${tag}`, elbow, v3(0, 0, 0), 0.24, 0.1, 0.13, mats.hide);
    rig.register(fore.mesh);

    const wrist = new TransformNode(`wrist${tag}`, scene);
    wrist.parent = elbow;
    wrist.position.set(0, -0.25, 0);
    rig.add(`wrist${tag}`, wrist);

    const glove = ball(`glove${tag}`, wrist, v3(0, -0.03, 0), 0.15, mats.armourTrim, v3(1, 0.9, 1));
    rig.register(glove);
  }

  // ---------------- head ----------------
  const neck = new TransformNode('neck', scene);
  neck.parent = chest;
  neck.position.set(0, 0.16, 0.02);
  rig.add('neck', neck);

  const head = rig.add('head', new TransformNode('head', scene));
  head.parent = neck;
  head.position.set(0, 0.1, 0);

  const skull = ball('skull', head, v3(0, 0.06, 0), 0.4, mats.hide, v3(0.92, 0.88, 1));
  rig.register(skull);

  // Snout: the pig, punched straight through the helm's visor slit.
  const snout = MeshBuilder.CreateCylinder(
    'snout',
    { diameterTop: 0.17, diameterBottom: 0.22, height: 0.22, tessellation: 10 },
    scene,
  );
  snout.material = mats.hide;
  snout.parent = head;
  snout.position.set(0, 0.02, 0.24);
  snout.rotation.x = Math.PI / 2;
  rig.register(snout);

  const noseDisc = MeshBuilder.CreateDisc('nose-disc', { radius: 0.09, tessellation: 10 }, scene);
  noseDisc.material = mats.leather;
  noseDisc.parent = head;
  noseDisc.position.set(0, 0.02, 0.352);
  rig.register(noseDisc);

  for (const side of [-1, 1] as const) {
    const nostril = ball(`nostril${side}`, head, v3(0.038 * side, 0.02, 0.356), 0.028, mats.leather);
    rig.register(nostril);

    // Crooked tusks rising from the lower jaw.
    const tusk = MeshBuilder.CreateCylinder(
      `tusk${side}`,
      { diameterTop: 0.008, diameterBottom: 0.055, height: 0.2, tessellation: 6 },
      scene,
    );
    tusk.material = mats.bone;
    tusk.parent = head;
    tusk.position.set(0.1 * side, -0.06, 0.2);
    tusk.rotation.set(-0.9, 0, 0.34 * side);
    rig.register(tusk);

    const ear = plate(`ear${side}`, head, v3(0.17 * side, 0.17, -0.02), 0.2, 0.22, mats.hide);
    ear.rotation.set(0.1, 0.4 * side, 0.9 * side);
    ear.scaling.set(0.7, 0.22, 0.6);
    rig.register(ear);

    const eye = ball(`eye${side}`, head, v3(0.1 * side, 0.08, 0.17), 0.05, mats.eyeGlow);
    rig.register(eye);
  }

  const jaw = brick('jaw', head, v3(0, -0.09, 0.16), v3(0.2, 0.07, 0.16), mats.hide);
  rig.register(jaw);

  // Helm: a brow band, a dome, and a battered crest.
  const helm = plate('helm', head, v3(0, 0.1, 0.01), 0.44, 0.72, mats.armour);
  rig.register(helm);
  const brow = MeshBuilder.CreateTorus('brow', { diameter: 0.4, thickness: 0.05, tessellation: 12 }, scene);
  brow.material = mats.armourTrim;
  brow.parent = head;
  brow.position.set(0, 0.06, 0.01);
  brow.rotation.x = 0.12;
  rig.register(brow);

  const crest = MeshBuilder.CreateCylinder(
    'crest',
    { diameterTop: 0.01, diameterBottom: 0.14, height: 0.26, tessellation: 4 },
    scene,
  );
  crest.material = mats.cloth;
  crest.parent = head;
  crest.position.set(0, 0.3, -0.02);
  crest.rotation.x = -0.25;
  crest.scaling.set(0.32, 1, 1);
  rig.register(crest);

  // ---------------- cape ----------------
  const cape = MeshBuilder.CreateGround(
    'cape',
    { width: 0.62, height: 0.92, subdivisions: 4, updatable: true },
    scene,
  );
  const capePositions = cape.getVerticesData('position');
  if (capePositions) {
    // Curve the panel so it hugs the back instead of lying like a sheet.
    for (let i = 0; i < capePositions.length; i += 3) {
      const x = capePositions[i];
      capePositions[i + 2] = -Math.pow(Math.abs(x) / 0.31, 2) * 0.1;
    }
    cape.updateVerticesData('position', capePositions);
  }
  cape.material = mats.cloth;
  cape.parent = chest;
  cape.position.set(0, -0.16, -0.3);
  cape.rotation.x = Math.PI / 2 - 0.16;
  rig.register(cape);

  const clasp = ball('cape-clasp', chest, v3(0, 0.14, -0.24), 0.1, mats.armourTrim);
  rig.register(clasp);

  // ---------------- sword ----------------
  const handR = rig.get('wristR');
  const sword = new TransformNode('sword', scene);
  sword.parent = handR;
  sword.position.set(0, -0.04, 0.02);
  // Neutral guard: blade up and slightly back over the shoulder.
  sword.rotation.set(-0.5, 0, 0.12);

  const grip = MeshBuilder.CreateCylinder(
    'grip',
    { diameter: 0.055, height: 0.24, tessellation: 6 },
    scene,
  );
  grip.material = mats.leather;
  grip.parent = sword;
  grip.position.y = -0.06;
  rig.register(grip);

  const pommel = ball('pommel', sword, v3(0, -0.2, 0), 0.08, mats.armourTrim);
  rig.register(pommel);

  const quillons = brick('quillons', sword, v3(0, 0.07, 0), v3(0.28, 0.04, 0.05), mats.armourTrim);
  rig.register(quillons);

  const blade = MeshBuilder.CreateBox('blade', { size: 1 }, scene);
  blade.material = mats.steel;
  blade.parent = sword;
  blade.position.y = 0.63;
  // Long, wide, thin: a cleaver for a cleaver of a pig.
  blade.scaling.set(0.115, 1.12, 0.026);
  rig.register(blade);

  const point = MeshBuilder.CreateCylinder(
    'blade-point',
    { diameterTop: 0, diameterBottom: 0.115, height: 0.2, tessellation: 4 },
    scene,
  );
  point.material = mats.steel;
  point.parent = sword;
  point.position.y = 1.29;
  point.scaling.set(1, 1, 0.24);
  rig.register(point);

  const fuller = brick('fuller', sword, v3(0, 0.63, 0.016), v3(0.03, 1.02, 0.006), mats.steelEdge);
  rig.register(fuller);

  const swordTip = new TransformNode('sword-tip', scene);
  swordTip.parent = sword;
  swordTip.position.set(0, 1.4, 0);

  // ---------------- buckler ----------------
  const handL = rig.get('wristL');
  const buckler = MeshBuilder.CreateCylinder(
    'buckler',
    { diameter: 0.42, height: 0.05, tessellation: 12 },
    scene,
  );
  buckler.material = mats.armour;
  buckler.parent = handL;
  buckler.position.set(0, -0.05, 0.14);
  buckler.rotation.x = Math.PI / 2;
  rig.register(buckler);

  const boss = ball('buckler-boss', handL, v3(0, -0.05, 0.19), 0.1, mats.armourTrim);
  rig.register(boss);

  rig.get('hips');
  return Object.assign(rig, {
    swordTip,
    handR,
    buckler,
    head,
    cape,
    blade,
  }) as PigKnightRig;
}

/** Convenience for the engine: the same Vector3 shape a capsule collider wants. */
export const PIG_KNIGHT_SIZES = {
  height: 1.62,
  girth: 0.58,
  swordReach: 1.35,
} as const;

export const V3_ZERO = new Vector3(0, 0, 0);
