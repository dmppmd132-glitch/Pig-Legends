import type { AbstractEngine, Camera, Scene } from '../babylon';
import { Matrix, Vector3, Viewport } from '../babylon';
import { HUD } from '../config';

type FloaterKind = 'player-hit' | 'crit' | 'player-hurt' | 'miss';

interface Floater {
  el: HTMLSpanElement;
  world: Vector3;
  bornAt: number;
  life: number;
  drift: number;
  scale: number;
}

/**
 * Combat numbers as DOM, positioned imperatively.
 *
 * Routing 60 Hz label movement through React state would re-render the HUD
 * every frame; this writes `transform` straight onto pooled spans instead, and
 * the React tree only ever sees the discrete HP/stamina values.
 */
export class FloaterLayer {
  private readonly pool: Floater[] = [];
  private readonly active: Floater[] = [];
  private width = 1;
  private height = 1;

  constructor(
    private readonly container: HTMLElement,
    private readonly scene: Scene,
    private readonly engine: AbstractEngine,
  ) {
    for (let i = 0; i < 14; i += 1) {
      const el = document.createElement('span');
      el.className = 'dmg-num';
      el.style.opacity = '0';
      container.appendChild(el);
      this.pool.push({ el, world: null as unknown as Vector3, bornAt: 0, life: 1, drift: 0, scale: 1 });
    }
  }

  spawn(text: string, world: Vector3, kind: FloaterKind = 'player-hit'): void {
    const slot = this.pool.pop();
    if (!slot) return;
    slot.el.textContent = text;
    slot.el.className = `dmg-num ${kind}`;
    slot.world = world.clone();
    slot.bornAt = performance.now();
    slot.life = HUD.damageNumberMs + (kind === 'crit' ? 260 : 0);
    slot.drift = (Math.random() - 0.5) * 46;
    slot.scale = kind === 'crit' ? 1 : 0.85 + Math.random() * 0.25;
    slot.el.style.opacity = '1';
    this.active.push(slot);
  }

  /** Project every live label; called from the render loop after `scene.render`. */
  update(camera: Camera): void {
    const now = performance.now();
    const renderW = this.engine.getRenderWidth();
    const renderH = this.engine.getRenderHeight();
    const rect = this.container.getBoundingClientRect();
    this.width = rect.width || 1;
    this.height = rect.height || 1;
    const scaleX = this.width / (renderW || 1);
    const scaleY = this.height / (renderH || 1);
    const vp = new Viewport(0, 0, 1, 1).toGlobal(renderW, renderH);

    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const f = this.active[i];
      const age = now - f.bornAt;
      if (age >= f.life) {
        f.el.style.opacity = '0';
        this.active.splice(i, 1);
        this.pool.push(f);
        continue;
      }
      const t = age / f.life;
      const projected = projectToScreen(f.world, this.scene, camera, vp);
      if (!projected) {
        f.el.style.opacity = '0';
        continue;
      }
      const rise = -60 * Math.sqrt(t);
      const x = projected.x * scaleX + f.drift * t;
      const y = projected.y * scaleY + rise;
      const pop = t < 0.12 ? 1.35 - (t / 0.12) * 0.35 : 1;
      const fade = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
      f.el.style.transform = `translate(-50%,-50%) translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${(f.scale * pop).toFixed(3)})`;
      f.el.style.opacity = fade.toFixed(3);
    }
  }

  clear(): void {
    for (const f of this.active) {
      f.el.style.opacity = '0';
      this.pool.push(f);
    }
    this.active.length = 0;
  }

  dispose(): void {
    for (const f of this.active) f.el.remove();
    for (const f of this.pool) f.el.remove();
    this.active.length = 0;
    this.pool.length = 0;
  }
}

/**
 * World → screen. `Vector3.Project` returns pixels with a bottom-up origin, so
 * the Y is flipped here rather than at every call site.
 */
function projectToScreen(
  world: Vector3,
  scene: Scene,
  camera: Camera,
  viewport: Viewport,
): { x: number; y: number } | null {
  // Drop labels that are behind the lens: Project still yields a number there.
  const facing = camera.getForwardRay().direction;
  if (Vector3.Dot(world.subtract(camera.position), facing) < 0) return null;
  const projected = Vector3.Project(world, Matrix.Identity(), scene.getTransformMatrix(), viewport);
  return { x: projected.x, y: viewport.height - projected.y };
}
