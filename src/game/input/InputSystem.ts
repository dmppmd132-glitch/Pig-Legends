import { Vector2 } from '../babylon';
import { PLAYER } from '../config';
import { clamp } from '../math';

export type VirtualAction = 'attack' | 'dodge' | 'run' | 'lock' | 'pause' | 'jump' | 'skill';

/** Actions that fire from a single press instead of from being held. */
type TapAction = 'attack' | 'dodge' | 'lock' | 'pause' | 'restart' | 'jump' | 'skill';

/** One frame's worth of resolved intent, in a device-independent shape. */
export interface InputFrame {
  /** -1..1. x = strafe (right +), y = forward (+). Camera-relative. */
  move: Vector2;
  run: boolean;
  /** True only on the frame the button went down. */
  attack: boolean;
  dodge: boolean;
  jump: boolean;
  skill: boolean;
  lock: boolean;
  pause: boolean;
  restart: boolean;
  /** Camera look delta in radians, already scaled by sensitivity. */
  look: Vector2;
  /** Wheel zoom delta; consumed and zeroed each frame. */
  zoom: number;
}

const KEY_MAP: Record<string, keyof Bindings | undefined> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'run',
  ShiftRight: 'run',
  KeyJ: 'attack',
  KeyZ: 'attack',
  Space: 'dodge',
  KeyK: 'dodge',
  KeyX: 'dodge',
  KeyL: 'jump',
  KeyC: 'jump',
  KeyF: 'skill',
  KeyQ: 'lock',
  Tab: 'lock',
  Escape: 'pause',
  KeyP: 'pause',
  KeyR: 'restart',
};

interface Bindings {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  run: boolean;
  attack: boolean;
  dodge: boolean;
  jump: boolean;
  skill: boolean;
  lock: boolean;
  pause: boolean;
  restart: boolean;
}

/** Which bound actions are press-driven; these fill the input buffer. */
const TAP_ACTIONS = new Set<string>(['attack', 'dodge', 'lock', 'pause', 'restart', 'jump', 'skill']);

const emptyBindings = (): Bindings => ({
  forward: false,
  back: false,
  left: false,
  right: false,
  run: false,
  attack: false,
  dodge: false,
  jump: false,
  skill: false,
  lock: false,
  pause: false,
  restart: false,
});

/** Keys whose default browser behaviour must be suppressed while playing. */
const SWALLOW = new Set([
  'Space',
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'KeyJ',
  'KeyK',
  'KeyL',
  'KeyC',
  'KeyF',
  'KeyQ',
  'KeyR',
  'Escape',
]);

export class InputSystem {
  private readonly bindings: Bindings = emptyBindings();
  private readonly prev: Bindings = emptyBindings();

  /** Virtual (touch) state, merged after the keyboard. */
  private vMove = new Vector2(0, 0);
  private vRun = false;
  private vPressed: Record<VirtualAction, boolean> = {
    attack: false,
    dodge: false,
    run: false,
    lock: false,
    pause: false,
    jump: false,
    skill: false,
  };
  private vWasPressed: Record<VirtualAction, boolean> = {
    attack: false,
    dodge: false,
    run: false,
    lock: false,
    pause: false,
    jump: false,
    skill: false,
  };

  /**
   * Press timestamps waiting to be sampled, in `performance.now()` ms.
   *
   * Edges are detected once per frame, so a key that goes down and up inside
   * a single frame would never be seen at all — on a hitching laptop, or the
   * instant after hit-stop, a player's swing would silently vanish (a
   * software-rendered playthrough logged 370 keypresses and zero hits before
   * this existed). The buffer keeps the intent alive for
   * `PLAYER.inputBufferMs`, then drops it, which also stops a mash during a
   * menu from firing the moment play resumes.
   */
  private readonly pressBuffer: Partial<Record<TapAction, number>> = {};

  private rawLook = new Vector2(0, 0);
  private zoomDelta = 0;

  private dragging = false;
  private dragId: number | null = null;
  private lastPointer = new Vector2(0, 0);
  private primaryDown = false;
  private secondaryDown = false;

  private gamepadIndex: number | null = null;

  sensitivity = 1;
  invertY = false;
  /** Set false while a menu owns the keyboard so gameplay does not eat keys. */
  enabled = true;

  readonly frame: InputFrame = {
    move: new Vector2(0, 0),
    run: false,
    attack: false,
    dodge: false,
    jump: false,
    skill: false,
    lock: false,
    pause: false,
    restart: false,
    look: new Vector2(0, 0),
    zoom: 0,
  };

  private detach: Array<() => void> = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.attach();
  }

  private attach(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!this.enabled) return;
      // Ignore auto-repeat: attack/dodge are edge-triggered.
      if (e.repeat) {
        if (SWALLOW.has(e.code)) e.preventDefault();
        return;
      }
      const bound = KEY_MAP[e.code];
      if (bound) {
        if (SWALLOW.has(e.code)) e.preventDefault();
        this.bindings[bound] = true;
        if (TAP_ACTIONS.has(bound)) this.pressBuffer[bound as TapAction] = performance.now();
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
          // Shift is also the browser's modifier; never let it stick.
          e.preventDefault();
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const bound = KEY_MAP[e.code];
      if (bound) this.bindings[bound] = false;
      if (SWALLOW.has(e.code) && this.enabled) e.preventDefault();
    };

    const onBlur = () => this.reset();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') this.reset();
    };

    // ---- Pointer look / mouse buttons -------------------------------
    const onPointerDown = (e: PointerEvent) => {
      if (!this.enabled) return;
      if (e.pointerType === 'mouse') {
        if (e.button === 0) {
          this.primaryDown = true;
          this.pressBuffer.attack = performance.now();
        }
        if (e.button === 2) {
          this.secondaryDown = true;
          this.pressBuffer.dodge = performance.now();
        }
      }
      // One finger drags the view. Multi-touch gestures are ignored so a
      // player resting a thumb on the joystick cannot spin the camera.
      if (this.dragId === null) {
        this.dragId = e.pointerId;
        this.dragging = true;
        this.lastPointer.set(e.clientX, e.clientY);
        try {
          this.canvas.setPointerCapture(e.pointerId);
        } catch {
          /* capture unsupported; events still arrive while over the canvas */
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!this.enabled || !this.dragging || e.pointerId !== this.dragId) return;
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.lastPointer.set(e.clientX, e.clientY);
      const scale = e.pointerType === 'mouse' ? 0.0034 : 0.0062;
      this.rawLook.x += dx * scale;
      this.rawLook.y += dy * scale;
    };

    const endDrag = (e: PointerEvent) => {
      if (e.pointerId === this.dragId) {
        this.dragId = null;
        this.dragging = false;
        try {
          this.canvas.releasePointerCapture(e.pointerId);
        } catch {
          /* already released */
        }
      }
      if (e.pointerType === 'mouse') {
        if (e.button === 0) this.primaryDown = false;
        if (e.button === 2) this.secondaryDown = false;
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.zoomDelta += clamp(e.deltaY, -60, 60) * 0.006;
    };

    const onContextMenu = (e: Event) => e.preventDefault();

    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp, { passive: false });
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    this.canvas.addEventListener('pointerdown', onPointerDown);
    this.canvas.addEventListener('pointermove', onPointerMove);
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);
    this.canvas.addEventListener('wheel', onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', onContextMenu);

    this.detach.push(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      this.canvas.removeEventListener('pointerdown', onPointerDown);
      this.canvas.removeEventListener('pointermove', onPointerMove);
      this.canvas.removeEventListener('pointerup', endDrag);
      this.canvas.removeEventListener('pointercancel', endDrag);
      this.canvas.removeEventListener('wheel', onWheel);
      this.canvas.removeEventListener('contextmenu', onContextMenu);
    });
  }

  // ---- Virtual (touch) API, called by React controls ----------------

  setVirtualMove(x: number, y: number): void {
    this.vMove.set(clamp(x, -1, 1), clamp(y, -1, 1));
  }

  /** Held buttons from the touch layer; `run` is a toggle, not an edge. */
  setVirtualHold(action: VirtualAction, down: boolean): void {
    if (action === 'run') {
      this.vRun = down;
    } else if (down) {
      // Actions latch until the next poll, including the one-shot jump/skill taps.
      this.vPressed[action] = true;
    }
  }

  /** Convenience for on-screen buttons that fire and forget. */
  tap(action: VirtualAction): void {
    this.setVirtualHold(action, true);
  }

  // ---- Frame resolution ---------------------------------------------

  /** Poll gamepads and merge all sources into `frame`. Call once per tick. */
  update(): InputFrame {
    const f = this.frame;

    // Keyboard axis
    let kx = (this.bindings.right ? 1 : 0) - (this.bindings.left ? 1 : 0);
    let ky = (this.bindings.forward ? 1 : 0) - (this.bindings.back ? 1 : 0);
    let magnitude = 1;
    if (kx !== 0 || ky !== 0) magnitude = Math.min(1, Math.hypot(kx, ky) / Math.SQRT2) * 1.4142;

    // Virtual axis wins when the stick is engaged.
    let ax = kx * magnitude;
    let ay = ky * magnitude;
    if (this.vMove.x !== 0 || this.vMove.y !== 0) {
      ax = this.vMove.x;
      ay = this.vMove.y;
    }

    const pad = this.pollGamepad();
    if (pad) {
      ax += pad.x;
      ay += pad.y;
    }

    const len = Math.hypot(ax, ay);
    if (len < PLAYER.deadzone) {
      ax = 0;
      ay = 0;
    } else if (len > 1) {
      ax /= len;
      ay /= len;
    }
    f.move.set(ax, ay);

    f.run = this.bindings.run || this.vRun || (pad?.run ?? false);

    // Press order: an on-screen button the player is holding, then a buffered
    // key press, then a plain rising edge. Only one can win, because `f.*` is
    // a boolean and every source clears itself on read.
    const now = performance.now();
    f.attack =
      this.consumeTap('attack') ||
      this.take('attack', now) ||
      this.firedEdge('attack', this.primaryDown) ||
      (pad?.attack ?? false);
    f.dodge =
      this.consumeTap('dodge') ||
      this.take('dodge', now) ||
      this.firedEdge('dodge', this.secondaryDown) ||
      (pad?.dodge ?? false);
    f.jump = this.consumeTap('jump') || this.take('jump', now) || this.firedEdge('jump') || (pad?.jump ?? false);
    f.skill = this.consumeTap('skill') || this.take('skill', now) || this.firedEdge('skill') || (pad?.skill ?? false);
    f.lock =
      this.consumeTap('lock') || this.take('lock', now) || this.firedEdge('lock') || (pad?.lock ?? false);
    f.pause = this.consumeTap('pause') || this.take('pause', now) || this.firedEdge('pause');
    f.restart = this.take('restart', now) || this.firedEdge('restart');

    f.look.set(this.rawLook.x * this.sensitivity, this.rawLook.y * this.sensitivity * (this.invertY ? -1 : 1));
    this.rawLook.set(0, 0);

    f.zoom = this.zoomDelta;
    this.zoomDelta = 0;

    // Remember keyboard state for next-frame edge detection.
    this.prev.forward = this.bindings.forward;
    this.prev.back = this.bindings.back;
    this.prev.left = this.bindings.left;
    this.prev.right = this.bindings.right;
    this.prev.run = this.bindings.run;
    this.prev.attack = this.primaryDown;
    this.prev.dodge = this.secondaryDown;
    this.prev.lock = this.bindings.lock;
    this.prev.pause = this.bindings.pause;
    this.prev.restart = this.bindings.restart;

    return f;
  }

  private firedEdge(key: keyof Bindings, overrideCurrent?: boolean): boolean {
    const current = overrideCurrent ?? this.bindings[key];
    const previous = key === 'attack' ? this.prev.attack : key === 'dodge' ? this.prev.dodge : this.prev[key];
    return current && !previous;
  }

  /** Claims a buffered press, honouring the freshness window. */
  private take(action: TapAction, now: number): boolean {
    const at = this.pressBuffer[action];
    if (at === undefined) return false;
    delete this.pressBuffer[action];
    return now - at <= PLAYER.inputBufferMs;
  }

  private consumeTap(action: VirtualAction): boolean {
    const pressed = this.vPressed[action];
    const was = this.vWasPressed[action];
    this.vWasPressed[action] = pressed;
    if (pressed && !was) {
      // Reset the latch so a held touch button is still a single tap.
      this.vPressed[action] = false;
      return true;
    }
    if (!pressed) this.vWasPressed[action] = false;
    return false;
  }

  private pollGamepad():
    | {
        x: number;
        y: number;
        run: boolean;
        attack: boolean;
        dodge: boolean;
        jump: boolean;
        skill: boolean;
        lock: boolean;
        lookX: number;
        lookY: number;
      }
    | null {
    if (typeof navigator === 'undefined' || !('getGamepads' in navigator)) return null;
    let gp: Gamepad | null = null;
    if (this.gamepadIndex !== null) {
      gp = navigator.getGamepads()[this.gamepadIndex] ?? null;
    }
    if (!gp) {
      for (const candidate of navigator.getGamepads()) {
        if (candidate && candidate.mapping === 'standard') {
          gp = candidate;
          this.gamepadIndex = candidate.index;
          break;
        }
      }
    }
    if (!gp) return null;

    const dz = 0.18;
    const ax = gp.axes[0] ?? 0;
    const ay = gp.axes[1] ?? 0;
    const rx = gp.axes[2] ?? 0;
    const ry = gp.axes[3] ?? 0;

    const dead = (v: number) => (Math.abs(v) < dz ? 0 : v);

    return {
      x: dead(ax),
      y: -dead(ay),
      run: (gp.buttons[7]?.value ?? 0) > 0.4 || (gp.buttons[10]?.pressed ?? false),
      attack: gp.buttons[2]?.pressed ?? false,
      dodge: gp.buttons[1]?.pressed ?? false,
      jump: gp.buttons[0]?.pressed ?? false,
      skill: gp.buttons[3]?.pressed ?? false,
      lock: gp.buttons[15]?.pressed ?? false,
      lookX: dead(rx),
      lookY: dead(ry),
    };
  }

  /** Clear everything; call on pause, blur or scene teardown. */
  reset(): void {
    for (const key of Object.keys(this.bindings) as (keyof Bindings)[]) this.bindings[key] = false;
    // A press queued before a blur or a menu must not fire when play resumes.
    for (const key of Object.keys(this.pressBuffer) as TapAction[]) delete this.pressBuffer[key];
    for (const key of Object.keys(this.prev) as (keyof Bindings)[]) this.prev[key] = false;
    this.vMove.set(0, 0);
    this.vRun = false;
    for (const key of Object.keys(this.vPressed) as VirtualAction[]) {
      this.vPressed[key] = false;
      this.vWasPressed[key] = false;
    }
    this.rawLook.set(0, 0);
    this.zoomDelta = 0;
    this.dragging = false;
    this.dragId = null;
    this.primaryDown = false;
    this.secondaryDown = false;
    this.frame.move.set(0, 0);
    this.frame.look.set(0, 0);
    this.frame.attack = false;
    this.frame.dodge = false;
    this.frame.jump = false;
    this.frame.skill = false;
    this.frame.lock = false;
    this.frame.pause = false;
    this.frame.restart = false;
    this.frame.run = false;
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.detach = [];
  }
}
