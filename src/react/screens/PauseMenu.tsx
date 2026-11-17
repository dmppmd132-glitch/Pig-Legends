import { HUNT_TARGET } from '../../game/GameEngine';
import type { HudState } from '../../game/types';

interface Props {
  hud: HudState;
  onResume: () => void;
  onRestart: () => void;
  onSettings: () => void;
}

export function PauseMenu({ hud, onResume, onRestart, onSettings }: Props) {
  return (
    <div className="screen">
      <div className="plate">
        <p className="eyebrow">Halt</p>
        <h1 className="title" style={{ fontSize: 'clamp(24px,6vw,40px)' }}>
          Paused
        </h1>

        <div className="stat-grid" style={{ marginBottom: 18 }}>
          <Stat label="Wolves down" value={`${hud.kills} / ${HUNT_TARGET}`} />
          <Stat label="This run" value={hud.runKills} />
          <Stat label="Vitality" value={`${hud.hp} / ${hud.maxHp}`} />
          <Stat label="Elapsed" value={clock(hud.timeMs)} />
        </div>

        <div className="btn-row">
          <button type="button" className="btn primary" onClick={onResume}>
            Resume
          </button>
          <button type="button" className="btn ghost" onClick={onSettings}>
            Settings
          </button>
          <button type="button" className="btn ghost" onClick={onRestart}>
            Restart hunt
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function clock(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
