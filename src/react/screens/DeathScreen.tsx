import type { HudState, Profile } from '../../game/types';

interface Props {
  hud: HudState;
  profile: Profile | null;
  onRetry: () => void;
}

/**
 * Death is a state to read, not a punishment: the numbers that matter are on
 * screen and the retry is one tap away. `R` also works, handled by the engine.
 */
export function DeathScreen({ hud, profile, onRetry }: Props) {
  const personal = profile ? Math.max(profile.bestRunKills, hud.runKills) : hud.runKills;
  const isBest = profile !== null && hud.runKills > 0 && hud.runKills >= profile.bestRunKills;

  return (
    <div className="screen tint-blood">
      <div className="plate" style={{ textAlign: 'center' }}>
        <p className="death-word">Yielded</p>
        <p className="lede" style={{ margin: '0 auto 18px' }}>
          The Dimwood keeps what it takes. ARNO rises again at the clearing edge.
        </p>

        <div className="stat-grid" style={{ textAlign: 'left' }}>
          <Stat label="Wolves in this hunt" value={hud.runKills} />
          <Stat label="Best hunt" value={personal} />
          <Stat label="Total felled" value={profile?.totalKills ?? hud.kills} />
          <Stat label="Time" value={clock(hud.timeMs)} />
        </div>

        {isBest && (
          <p className="eyebrow" style={{ marginTop: 16, color: 'var(--brass-lit)' }}>
            A new personal best
          </p>
        )}

        <div className="btn-row" style={{ justifyContent: 'center', marginTop: 20 }}>
          <button type="button" className="btn primary" onClick={onRetry}>
            Hunt again
          </button>
        </div>
        <p className="lede" style={{ margin: '14px auto 0', fontSize: 11 }}>
          or press <kbd>R</kbd>
        </p>
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
