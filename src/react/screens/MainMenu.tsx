import { HUNT_TARGET } from '../../game/GameEngine';
import type { HudState, Profile } from '../../game/types';

interface Props {
  hud: HudState;
  profile: Profile | null;
  onPlay: () => void;
  onSettings: () => void;
}

/**
 * The title card. The scene behind it is already fully built and lit, so the
 * menu floats over a live forest rather than a flat background image.
 */
export function MainMenu({ profile, onPlay, onSettings }: Props) {
  return (
    <div className="screen">
      <div className="plate">
        <p className="eyebrow">A dark-fantasy hunt</p>
        <h1 className="title">
          Pig Legends
          <em>ARNO of the Dimwood</em>
        </h1>

        <p className="lede">
          The last knight of the Sowenmarch rides into a wood that eats sound. <b>Sword</b>,{' '}
          <b>dodge</b>, and bring down <b>{HUNT_TARGET} wolves</b> before the dark takes you.
          Everything here is procedural — no downloads, and it keeps working offline.
        </p>

        <div className="btn-row">
          <button type="button" className="btn primary" onClick={onPlay}>
            Begin the hunt
          </button>
          <button type="button" className="btn ghost" onClick={onSettings}>
            Settings
          </button>
        </div>

        <div className="rule" />

        <h2 className="eyebrow" style={{ letterSpacing: '0.3em' }}>
          Controls
        </h2>
        <div className="keypad">
          <div>
            <kbd>W</kbd>
            <kbd>A</kbd>
            <kbd>S</kbd>
            <kbd>D</kbd> Move
          </div>
          <div>
            <kbd>Shift</kbd> Sprint
          </div>
          <div>
            <kbd>J</kbd> / <kbd>Click</kbd> Slash (×3 chain)
          </div>
          <div>
          <kbd>Space</kbd> Roll
        </div>
        <div>
          <kbd>L</kbd> / <kbd>C</kbd> Jump · evade a pounce
        </div>
        <div>
          <kbd>F</kbd> Runic Burst · area attack (stamina / cooldown)
        </div>
        <div>
          <kbd>Q</kbd> Lock on
          </div>
          <div>
            <kbd>Esc</kbd> Pause
          </div>
          <div>Drag / wheel — camera · Touch stick appears automatically</div>
        </div>

        {profile && (profile.runs > 0 || profile.totalKills > 0) && (
          <>
            <div className="rule" />
            <div className="stat-grid">
              <Stat label="Wolves felled" value={profile.totalKills} />
              <Stat label="Best run" value={profile.bestRunKills} />
              <Stat label="Hunts" value={profile.runs} />
              <Stat label="Time in the wood" value={formatPlayTime(profile.playMs)} wide />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  wide,
}: {
  label: string;
  value: number | string;
  wide?: boolean;
}) {
  return (
    <div className="stat" style={wide ? { gridColumn: 'span 2' } : undefined}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function formatPlayTime(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}
