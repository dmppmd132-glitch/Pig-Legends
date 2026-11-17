import { Color3, DynamicTexture, Scene, StandardMaterial, Texture } from './babylon';
import { Rng } from './math';

/**
 * All character materials in one place. Every texture here is painted into a
 * DynamicTexture at load: no image files, so GitHub Pages never 404s an asset
 * and the service worker precache covers the entire look of the game.
 */
export interface CharacterMaterials {
  hide: StandardMaterial;
  armour: StandardMaterial;
  armourTrim: StandardMaterial;
  leather: StandardMaterial;
  cloth: StandardMaterial;
  bone: StandardMaterial;
  steel: StandardMaterial;
  steelEdge: StandardMaterial;
  eyeGlow: StandardMaterial;
  wolfFur: StandardMaterial;
  wolfBelly: StandardMaterial;
  wolfEye: StandardMaterial;
  wolfNose: StandardMaterial;
  bloodIchor: StandardMaterial;
}

/** Soft radial sprite reused by every particle system. */
export function particleSprite(scene: Scene, name: string, rgb: [number, number, number]): DynamicTexture {
  const size = 64;
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const [r, gg, b] = rgb;
  g.addColorStop(0, `rgba(${r},${gg},${b},1)`);
  g.addColorStop(0.35, `rgba(${r},${gg},${b},0.62)`);
  g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.hasAlpha = true;
  tex.update();
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}

/** Brushed metal for the blade: directional streaks catch the moonlight. */
function bladeTexture(scene: Scene): DynamicTexture {
  const w = 32;
  const h = 256;
  const tex = new DynamicTexture('blade-tex', { width: w, height: h }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#8f9aa2';
  ctx.fillRect(0, 0, w, h);
  const rng = new Rng(0xba1);
  for (let i = 0; i < 140; i += 1) {
    const x = rng.range(0, w);
    ctx.strokeStyle = `rgba(${rng.int(120, 210)},${rng.int(130, 215)},${rng.int(140, 230)},0.16)`;
    ctx.lineWidth = rng.range(0.4, 1.6);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + rng.range(-1.5, 1.5), h);
    ctx.stroke();
  }
  // Fuller groove down the centre.
  ctx.fillStyle = 'rgba(30,36,42,0.5)';
  ctx.fillRect(w / 2 - 2, 0, 4, h);
  tex.update();
  return tex;
}

/** Coarse pig hide: mottled patches, slightly pink-grey under moonlight. */
function hideTexture(scene: Scene): DynamicTexture {
  const size = 128;
  const tex = new DynamicTexture('hide-tex', { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#6f5b60';
  ctx.fillRect(0, 0, size, size);
  const rng = new Rng(0x41de);
  for (let i = 0; i < 900; i += 1) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const dark = rng.next() < 0.5;
    ctx.fillStyle = dark ? 'rgba(48,38,42,0.3)' : 'rgba(126,106,110,0.22)';
    ctx.fillRect(x, y, rng.range(1, 3.5), rng.range(1, 3.5));
  }
  // Bristle strokes along the spine.
  ctx.strokeStyle = 'rgba(28,24,26,0.4)';
  for (let i = 0; i < 40; i += 1) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-2, 2), y - rng.range(3, 7));
    ctx.stroke();
  }
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.update();
  return tex;
}

/** Hammered, pitted iron. */
function armourTexture(scene: Scene): DynamicTexture {
  const size = 128;
  const tex = new DynamicTexture('armour-tex', { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#2c3138';
  ctx.fillRect(0, 0, size, size);
  const rng = new Rng(0xa705);
  for (let i = 0; i < 260; i += 1) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(2, 11);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(14,16,20,0.55)');
    g.addColorStop(1, 'rgba(70,78,88,0.05)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Scratches.
  ctx.strokeStyle = 'rgba(150,158,168,0.3)';
  for (let i = 0; i < 26; i += 1) {
    ctx.lineWidth = rng.range(0.4, 1.1);
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-24, 24), y + rng.range(-24, 24));
    ctx.stroke();
  }
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.update();
  return tex;
}

/** Matted fur, scratched with a comb-like noise so it is not a grey blob. */
function furTexture(scene: Scene, base: string, streak: string): DynamicTexture {
  const size = 128;
  const tex = new DynamicTexture('fur-tex', { width: size, height: size }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const rng = new Rng(991237);
  ctx.strokeStyle = streak;
  for (let i = 0; i < 700; i += 1) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    ctx.lineWidth = rng.range(0.4, 1.4);
    ctx.globalAlpha = rng.range(0.1, 0.4);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-1.5, 1.5), y + rng.range(3, 9));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.uScale = 3;
  tex.vScale = 3;
  tex.update();
  return tex;
}

function std(scene: Scene, name: string): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.specularColor = new Color3(0.05, 0.05, 0.05);
  m.emissiveColor = new Color3(0.01, 0.012, 0.012);
  return m;
}

export function createCharacterMaterials(scene: Scene): CharacterMaterials {
  const hideTex = hideTexture(scene);
  const armTex = armourTexture(scene);
  const bladeTex = bladeTexture(scene);
  const furTex = furTexture(scene, '#31362f', '#171a16');
  const bellyFur = furTexture(scene, '#4a4c42', '#2a2b25');

  const hide = std(scene, 'arno-hide');
  hide.diffuseTexture = hideTex;
  hide.specularColor = new Color3(0.11, 0.09, 0.1);
  hide.specularPower = 24;

  const armour = std(scene, 'arno-armour');
  armour.diffuseTexture = armTex;
  armour.specularColor = new Color3(0.22, 0.24, 0.27);
  armour.specularPower = 64;

  const armourTrim = std(scene, 'arno-trim');
  armourTrim.diffuseColor = new Color3(0.42, 0.32, 0.12);
  armourTrim.specularColor = new Color3(0.5, 0.42, 0.2);
  armourTrim.specularPower = 96;
  armourTrim.emissiveColor = new Color3(0.03, 0.022, 0.006);

  const leather = std(scene, 'arno-leather');
  leather.diffuseColor = new Color3(0.11, 0.075, 0.05);
  leather.specularColor = new Color3(0.06, 0.05, 0.04);

  const cloth = std(scene, 'arno-cloth');
  cloth.diffuseColor = new Color3(0.055, 0.1, 0.075);
  cloth.specularColor = new Color3(0.02, 0.03, 0.025);
  cloth.emissiveColor = new Color3(0.004, 0.009, 0.006);

  const bone = std(scene, 'arno-bone');
  bone.diffuseColor = new Color3(0.62, 0.58, 0.44);
  bone.specularColor = new Color3(0.16, 0.15, 0.12);
  bone.specularPower = 48;

  const steel = std(scene, 'blade-body');
  steel.diffuseTexture = bladeTex;
  steel.specularColor = new Color3(0.42, 0.46, 0.5);
  steel.specularPower = 128;

  const steelEdge = std(scene, 'blade-edge');
  steelEdge.diffuseColor = new Color3(0.62, 0.7, 0.74);
  steelEdge.emissiveColor = new Color3(0.1, 0.16, 0.17);
  steelEdge.specularColor = new Color3(0.6, 0.66, 0.7);
  steelEdge.specularPower = 160;

  const eyeGlow = std(scene, 'arno-eye');
  eyeGlow.diffuseColor = new Color3(0.1, 0.2, 0.12);
  eyeGlow.emissiveColor = new Color3(0.32, 0.9, 0.5);
  eyeGlow.specularColor = new Color3(0, 0, 0);

  const wolfFur = std(scene, 'wolf-fur');
  wolfFur.diffuseTexture = furTex;
  wolfFur.specularColor = new Color3(0.05, 0.06, 0.05);

  const wolfBelly = std(scene, 'wolf-belly');
  wolfBelly.diffuseTexture = bellyFur;
  wolfBelly.specularColor = new Color3(0.04, 0.04, 0.04);

  const wolfEye = std(scene, 'wolf-eye');
  wolfEye.diffuseColor = new Color3(0.2, 0.12, 0.02);
  wolfEye.emissiveColor = new Color3(1, 0.5, 0.08);
  wolfEye.specularColor = new Color3(0, 0, 0);

  const wolfNose = std(scene, 'wolf-nose');
  wolfNose.diffuseColor = new Color3(0.05, 0.045, 0.05);
  wolfNose.specularColor = new Color3(0.18, 0.18, 0.2);
  wolfNose.specularPower = 96;

  const bloodIchor = std(scene, 'ichor');
  bloodIchor.diffuseColor = new Color3(0.09, 0.02, 0.03);
  bloodIchor.emissiveColor = new Color3(0.16, 0.03, 0.04);
  bloodIchor.specularColor = new Color3(0.1, 0.02, 0.02);

  return {
    hide,
    armour,
    armourTrim,
    leather,
    cloth,
    bone,
    steel,
    steelEdge,
    eyeGlow,
    wolfFur,
    wolfBelly,
    wolfEye,
    wolfNose,
    bloodIchor,
  };
}
