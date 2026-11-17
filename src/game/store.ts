/**
 * Minimal external store compatible with React 19 `useSyncExternalStore`.
 *
 * The game loop mutates state at up to 60 Hz; `set()` diffs shallowly and only
 * notifies when something actually changed, and `getSnapshot()` always returns
 * the same frozen object reference until it does — which is exactly what
 * `useSyncExternalStore` requires to avoid re-render loops.
 */

export type Listener = () => void;

export class Store<T extends object> {
  private state: Readonly<T>;
  private readonly listeners = new Set<Listener>();

  constructor(initial: T) {
    this.state = initial;
  }

  getSnapshot = (): Readonly<T> => this.state;

  set = (patch: Partial<T> | ((prev: Readonly<T>) => Partial<T>)): void => {
    const next = typeof patch === 'function' ? patch(this.state) : patch;
    let changed = false;
    for (const key of Object.keys(next) as (keyof T)[]) {
      if (this.state[key] !== next[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = Object.freeze({ ...this.state, ...next });
    for (const listener of this.listeners) listener();
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Read the current value without subscribing (used by the game loop). */
  peek = (): Readonly<T> => this.state;
}
