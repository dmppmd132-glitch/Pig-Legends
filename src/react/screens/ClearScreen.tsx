import { HUNT_TARGET } from '../../game/GameEngine';
import type { HudState, Profile } from '../../game/types';

interface Props {
  hud: HudState;
  profile: Profile | null;
  onContinue: () => void;
  onRestart: () => void;
}

/**
 * Reaching the target does not end the run — the wolves keep coming and get
 * faster, which is where the dodge windows start to matter. This card is the
 * moment to say that out loud, then get out of the way.
 */
export function ClearScreen({ hud, profile, onContinue, onRestart }: Props) {
  return (
    <div className="screen">
      <div className="plate" style={{ textAlign: 'center' }}>
        <p className="death-word win">The wood is quiet</p>
        <p className="lede" style={{ margin: '0 auto 18px' }}>
          {HUNT_TARGET} wolves down in {clock(hud.timeMs)}. Press on and the pack grows bolder:
          three at a time, quicker into the bite.
        </p>

        <div className="stat-grid" style={{ textAlign: 'left' }}>
          <Stat label="Hunt time" value={clock(hud.timeMs)} />
          <Stat label="Best ever" value={profile?.bestRunKills ?? HUNT_TARGET} />
          <Stat label="Vitality left" value={`${hud.hp} / ${hud.maxHp}`} />
          <Stat label="Still breathing" value={hud.wolvesAlive} />
        </div>

        <div className="btn-row" style={{ justifyContent: 'center', marginTop: 20 }}>
          <button type="button" className="btn primary" onClick={onContinue}>
            Keep hunting
          </button>
          <button type="button" className="btn ghost" onClick={onRestart}>
            New hunt
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
