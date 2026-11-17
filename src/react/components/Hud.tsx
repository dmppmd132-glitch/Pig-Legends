import type { HudState } from '../../game/types';

interface Props {
  hud: HudState;
  onPause: () => void;
}

/**
 * The in-game readout. Everything here is driven by the engine's throttled HUD
 * snapshot, so it re-renders at ~30 Hz rather than every frame, and nothing in
 * this tree may own a per-frame animation — those live in the DOM overlay that
 * the engine moves by hand.
 */
export function Hud({ hud, onPause }: Props) {
  const hpPct = clampPct(hud.hp, hud.maxHp);
  const stPct = clampPct(hud.stamina, hud.maxStamina);
  const lowHp = hpPct < 0.28;

  return (
    <div className="hud" aria-hidden={hud.phase !== 'playing'}>
      <div className={`hurt-edge${lowHp ? ' on' : ''}`} />

      <div className="vitals">
        <Sigil />

        <div className="bars">
          <div className="bar-line hp" role="img" aria-label={`Health ${hud.hp} of ${hud.maxHp}`}>
            <div className="ghost" style={{ width: `${hpPct}%` }} />
            <div className="fill" style={{ width: `${hpPct}%` }} />
          </div>

          <div className={`bar-line st${stPct < 12 ? ' empty' : ''}`} role="img" aria-label={`Stamina ${hud.stamina}`}>
            <div className="fill" style={{ width: `${stPct}%` }} />
          </div>

          <div className="vitals-label">
            <b>{hud.hp}</b>
            <span>/ {hud.maxHp} vitality</span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span>{hud.stamina} wind</span>
          </div>
        </div>
      </div>

      <div className="kills">
        Wolves felled
        <b>{hud.kills}</b>
        <span style={{ opacity: 0.6 }}>{formatTime(hud.timeMs)}</span>
      </div>

      {hud.comboCount >= 2 && (
        <div className="combo" key={hud.comboCount}>
          {hud.comboCount}
          <small>chain</small>
        </div>
      )}

      {hud.targetVisible && hud.targetName && (
        <div className="target">
          <div className="name">{hud.targetName}</div>
          <div className="bar-line">
            <div
              className="fill"
              style={{ width: `${clampPct(hud.targetHp, hud.targetMaxHp)}%` }}
            />
          </div>
        </div>
      )}

      {hud.toast && (
        <div className="toast" key={hud.toastId}>
          {hud.toast}
        </div>
      )}

      {/* The pause affordance has to be tappable on touch, where Esc does not
          exist; on keyboard builds it stays visually quiet. */}
      <button
        type="button"
        className="btn small"
        onClick={onPause}
        style={{
          position: 'absolute',
          top: 'max(12px, env(safe-area-inset-top))',
          right: 'calc(12px + env(safe-area-inset-right))',
          opacity: hud.isTouch ? 1 : 0.35,
        }}
        aria-label="Pause"
      >
        ‖
      </button>
    </div>
  );
}

function clampPct(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * ARNO's boar-helm crest, inlined so it needs no network fetch and inherits
 * the page's colour variables. Kept deliberately simple: at 44 px on a phone
 * only the silhouette and the two green eyes survive.
 */
function Sigil() {
  return (
    <div className="sigil">
      <svg viewBox="0 0 64 64" role="img" aria-label="Pig Legends crest">
        <path
          d="M32 5 56 12v22c0 12-10 21-24 25C18 55 8 46 8 34V12Z"
          fill="#10150f"
          stroke="#b8912f"
          strokeWidth="1.6"
          opacity="0.95"
        />
        <path
          d="M20 30c0-7 5-12 12-12s12 5 12 12c0 6-3 10-6 12h-12c-3-2-6-6-6-12Z"
          fill="#3a4238"
        />
        <ellipse cx="32" cy="36" rx="8.5" ry="6.5" fill="#7a5c60" />
        <ellipse cx="29" cy="36" rx="1.5" ry="2.4" fill="#0c100c" />
        <ellipse cx="35" cy="36" rx="1.5" ry="2.4" fill="#0c100c" />
        <path d="M23 41c-2 3-2 6 0 8" stroke="#e6dcc3" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        <path d="M41 41c2 3 2 6 0 8" stroke="#e6dcc3" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        <circle cx="26.5" cy="27" r="2" fill="#79e6a0" />
        <circle cx="37.5" cy="27" r="2" fill="#79e6a0" />
        <path d="M32 8c-3 3-4 6-4 9h8c0-3-1-6-4-9Z" fill="#d8492f" opacity="0.85" />
      </svg>
    </div>
  );
}
