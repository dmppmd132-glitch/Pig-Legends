import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { GameEngine } from './game/GameEngine';
import { DEFAULTS, GAME_VERSION, QUALITY, WORLD } from './game/config';
import type { QualityLevel } from './game/config';
import { initialHud } from './game/types';
import type { HudState, Phase, Profile, Settings } from './game/types';
import {
  clearProgress,
  isStorageAvailable,
  loadProfile,
  loadSettings,
  saveProfile,
} from './storage/db';

import { Hud } from './react/components/Hud';
import { TouchControls } from './react/components/TouchControls';
import { InstallPrompt } from './react/components/InstallPrompt';
import { LoadingScreen } from './react/screens/LoadingScreen';
import { MainMenu } from './react/screens/MainMenu';
import { PauseMenu } from './react/screens/PauseMenu';
import { DeathScreen } from './react/screens/DeathScreen';
import { ClearScreen } from './react/screens/ClearScreen';
import { SettingsPanel } from './react/screens/SettingsPanel';
import { FatalScreen } from './react/screens/FatalScreen';
import { dismissBootShell } from './main';

const NO_SUBSCRIBE = () => () => {};

/**
 * Owns the engine's whole life cycle: created once, booted once, disposed on
 * unmount. React only reads `hud` and calls the engine's command surface, so a
 * re-render can never restart or duplicate the simulation.
 */
export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);

  /** Set once the engine exists, so the HUD store can be subscribed to. */
  const [hudStore, setHudStore] = useState<{
    subscribe: (cb: () => void) => () => void;
    getSnapshot: () => Readonly<HudState>;
  } | null>(null);

  const [fatal, setFatal] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [boot, setBoot] = useState({ pct: 0, label: 'Waking the Dimwood' });

  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULTS }));
  const [profile, setProfile] = useState<Profile | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isTouch] = useState(
    () =>
      typeof window !== 'undefined' &&
      ('ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0),
  );

  const hud = useSyncExternalStore(
    hudStore?.subscribe ?? NO_SUBSCRIBE,
    hudStore?.getSnapshot ?? (() => initialHud),
    () => initialHud,
  );

  const phase: Phase = fatal ? 'boot' : booting ? 'boot' : hud.phase;

  // ---------------------------------------------------------------- boot
  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;

    let alive = true;
    let engine: GameEngine | null = null;
    let progressTimer = 0;

    void (async () => {
      // Read persisted settings *before* boot so quality and volumes are right
      // on the first frame instead of flickering in a beat later.
      let stored: Settings | null = null;
      let storedProfile: Profile | null = null;
      if (isStorageAvailable()) {
        [stored, storedProfile] = await Promise.all([loadSettings(), loadProfile()]);
      }
      if (!alive) return;
      if (stored) setSettings(stored);
      if (storedProfile) setProfile(storedProfile);

      const chosen = stored ?? settings;
      engine = new GameEngine(
        canvas,
        overlay,
        { quality: pickQuality(chosen.quality), settings: chosen, isTouch },
        {
          onRunEnd: (result) => {
            void recordRun(result.kills, result.timeMs, result.died).then((next) => {
              if (alive) setProfile(next);
            });
          },
        },
      );
      engineRef.current = engine;

      setHudStore({
        subscribe: (cb) => engine!.hud.subscribe(cb),
        getSnapshot: () => engine!.hud.getSnapshot(),
      });

      // The engine reports its own staged progress; mirror it into the pre-React
      // boot bar so the bar keeps moving while Babylon builds the scene.
      progressTimer = window.setInterval(() => {
        if (!engine || !alive) return;
        const s = engine.hud.peek();
        setBoot((prev) =>
          prev.pct === s.loadingPct && prev.label === s.loadingLabel
            ? prev
            : { pct: Math.max(prev.pct, s.loadingPct), label: s.loadingLabel },
        );
      }, 100);

      try {
        await engine.boot();
        if (!alive) return;
        setBooting(false);
        dismissBootShell();
        // `?debug=1` hands the engine to the console. It is the only way to
        // answer "what is that mesh" on a build served from a hashed bundle,
        // and it stays opt-in so no shipped player ever carries the hook.
        if (new URLSearchParams(window.location.search).has('debug')) {
          (window as unknown as { pigDebug: unknown }).pigDebug = engine;
        }
        // The manifest's "New Hunt" shortcut opens `?mode=hunt`, so a tapped
        // app icon goes straight to the clearing instead of the title card.
        if (new URLSearchParams(window.location.search).get('mode') === 'hunt') {
          engine.start();
        }
      } catch (err) {
        if (!alive) return;
        setFatal(err instanceof Error ? err.message : String(err));
        dismissBootShell();
      } finally {
        window.clearInterval(progressTimer);
      }
    })();

    return () => {
      alive = false;
      window.clearInterval(progressTimer);
      engineRef.current = null;
      engine?.dispose();
    };
    // Mount-once by design: setting changes are pushed through `applySettings`.
  }, []);

  useEffect(() => {
    engineRef.current?.applySettings(settings);
  }, [settings]);

  // ---------------------------------------------------------------- input
  // A pointer press on the canvas should hand focus back to the game, which is
  // what makes the keyboard work again after clicking a menu button.
  const focusGame = useCallback(() => {
    canvasRef.current?.focus({ preventScroll: true });
  }, []);

  const commands = useMemo(
    () => ({
      start: () => {
        engineRef.current?.start();
        focusGame();
      },
      pause: () => engineRef.current?.pause(),
      resume: () => {
        engineRef.current?.resume();
        focusGame();
      },
      restart: () => {
        engineRef.current?.restart();
        focusGame();
      },
    }),
    [focusGame],
  );

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && hud.phase === 'playing') engineRef.current?.pause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [hud.phase]);

  if (fatal) return <FatalScreen message={fatal} />;

  const showTouch =
    settings.touchControls === 'always' ||
    (settings.touchControls === 'auto' && (isTouch || hud.isTouch));

  return (
    <div className="app-root" onPointerDown={focusGame}>
      <div className="canvas-wrap">
        <canvas
          ref={canvasRef}
          className="game-canvas"
          tabIndex={0}
          aria-label="Pig Legends play field"
        />
        {/* World-anchored combat numbers live here, moved by the engine. */}
        <div ref={overlayRef} className="world-overlay" />
      </div>

      {(phase === 'playing' || phase === 'dead') && (
        <Hud hud={hud} onPause={commands.pause} />
      )}

      {phase === 'playing' && showTouch && (
        <TouchControls
          engineRef={engineRef}
          hud={hud}
          joystickSize={settings.joystickSize}
          buttonSize={settings.buttonSize}
        />
      )}

      {phase === 'boot' && <LoadingScreen pct={boot.pct} label={boot.label} />}
      {phase === 'menu' && (
        <MainMenu
          hud={hud}
          profile={profile}
          onPlay={commands.start}
          onSettings={() => setShowSettings(true)}
        />
      )}
      {phase === 'paused' && (
        <PauseMenu
          hud={hud}
          onResume={commands.resume}
          onRestart={commands.restart}
          onSettings={() => setShowSettings(true)}
        />
      )}
      {phase === 'dead' && <DeathScreen hud={hud} profile={profile} onRetry={commands.restart} />}
      {phase === 'cleared' && (
        <ClearScreen
          hud={hud}
          profile={profile}
          onContinue={commands.resume}
          onRestart={commands.restart}
        />
      )}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onChange={setSettings}
          onClose={() => setShowSettings(false)}
          onResetProgress={async () => setProfile((await clearProgress()).profile)}
        />
      )}

      <InstallPrompt />

      <div className="perf" aria-hidden="true">
        v{GAME_VERSION} · {WORLD.name} · {QUALITY[hud.quality].label}
        {hud.phase === 'playing' ? ` · ${hud.fps} fps` : ''}
      </div>
    </div>
  );
}

/**
 * Devices that report a very large `devicePixelRatio` on few cores are usually
 * cheap phones; starting them at Low keeps the first run playable. Anything the
 * player picks explicitly in Settings is always respected.
 */
function pickQuality(preferred: QualityLevel): QualityLevel {
  if (preferred !== DEFAULTS.quality) return preferred;
  const dpr = window.devicePixelRatio || 1;
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  if (cores <= 3 || memory <= 3 || (dpr > 2.6 && cores <= 4)) return 'low';
  if (cores >= 8 && memory >= 8 && dpr <= 2) return 'high';
  return 'medium';
}

/** Fold one finished run into the stored profile. */
async function recordRun(kills: number, timeMs: number, died: boolean): Promise<Profile> {
  const base = await loadProfile();
  const now = Date.now();
  const next: Profile = {
    ...base,
    totalKills: base.totalKills + kills,
    bestRunKills: Math.max(base.bestRunKills, kills),
    // A cleared run's time only counts if it beat the previous best.
    bestRunMs: died
      ? base.bestRunMs
      : base.bestRunMs === 0
        ? timeMs
        : Math.min(base.bestRunMs, timeMs),
    runs: base.runs + 1,
    deaths: base.deaths + (died ? 1 : 0),
    firstPlayedAt: base.firstPlayedAt || now,
    lastPlayedAt: now,
    playMs: base.playMs + timeMs,
  };
  await saveProfile(next);
  return next;
}
