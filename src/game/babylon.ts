/**
 * Single re-export point for the Babylon runtime.
 *
 * Game modules import from here instead of `@babylonjs/core`. Two reasons:
 *
 * 1. The barrel pulls in the whole engine — 7.4 MB of JavaScript for a game
 *    that touches thirty-odd classes. Deep module paths cut the shipped bundle
 *    to what is actually used, which is the difference between a phone
 *    downloading the game over cellular and not.
 * 2. Swapping a Babylon feature later stays a one-file change.
 *
 * Value imports must name the exact module that declares them, or tree shaking
 * cannot prune. Type-only imports are erased at compile time, so they may come
 * from the barrel with no size cost.
 *
 * Paths below were verified against the installed @babylonjs/core 9.37:
 * `Matrix` lives in `Maths/math.vector`, `Viewport` in `Maths/math.viewport`,
 * and particle blend-mode constants on `BaseParticleSystem`, not `Constants`.
 */

// --- engine, scene, cameras ---
export { Engine } from '@babylonjs/core/Engines/engine.js';
export { Constants } from '@babylonjs/core/Engines/constants.js';
export { Scene } from '@babylonjs/core/scene.js';
export { Camera } from '@babylonjs/core/Cameras/camera.js';
export { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';

// --- maths ---
export { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
export { Matrix, Quaternion, Vector2, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
export { Viewport } from '@babylonjs/core/Maths/math.viewport.js';
export { Scalar } from '@babylonjs/core/Maths/math.scalar.js';

// --- meshes, materials, textures ---
export { Mesh } from '@babylonjs/core/Meshes/mesh.js';
export { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
export { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
export { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
export { Material } from '@babylonjs/core/Materials/material.js';
export { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
export { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
export { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';

// --- lights and shadows ---
export { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
export { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
export { PointLight } from '@babylonjs/core/Lights/pointLight.js';
export { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';

// --- particles and layers ---
export { BaseParticleSystem } from '@babylonjs/core/Particles/baseParticleSystem.js';
export { ParticleSystem } from '@babylonjs/core/Particles/particleSystem.js';
export { GlowLayer } from '@babylonjs/core/Layers/glowLayer.js';

// --- post processing ---
export { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.js';

// Side effects the deep imports above do not pull in by themselves: the shadow
// map shader is registered by a module side-effect, and without it a shadow
// generator silently produces an unlit scene instead of a shadow.
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent.js';
//
// `mesh.createInstance()` is implemented by a method that `mesh.pure.js` only
// installs once `InstancedMesh` registers itself. Without this line every tree,
// rock and tuft of grass in the forest throws at world build time:
//
//   InstancedMesh needs to be imported before as it contains a side-effect
//   required by your code.
//
// The glow layer is safe by contrast — `Layers/effectLayer.js` registers its
// own scene component — and `Meshes/meshBuilder.js` imports every builder, so
// no further registration is needed for the shapes used here.
import '@babylonjs/core/Meshes/instancedMesh.js';
//
// `camera.getForwardRay()` — used to cull damage labels that sit behind the
// lens — is a stub in `camera.pure.js` that throws until the `Ray` class
// registers itself. The floaters system runs every frame, so this one line is
// the difference between a working HUD and a console full of errors:
//
//   Ray needs to be imported before as it contains a side-effect required by
//   your code.
import '@babylonjs/core/Culling/ray.js';

/**
 * Types only — these lines emit no JavaScript, so the barrel costs nothing.
 */
export type {
  AbstractEngine,
  Animatable,
  Nullable,
  Observer,
  PickingInfo,
  SceneOptions,
} from '@babylonjs/core';
