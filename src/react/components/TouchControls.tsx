import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import type { GameEngine } from '../../game/GameEngine';
import type { VirtualAction } from '../../game/input/InputSystem';
import type { HudState } from '../../game/types';

interface Props {
  engineRef: RefObject<GameEngine | null>;
  hud: HudState;
  joystickSize: number;
  buttonSize: number;
}

/**
 * On-screen controls.
 *
 * Pointer Events, not Touch Events: a stylus, a trackpad and a mouse then work
 * through the same code path, and `setPointerCapture` gives us the one thing a
 * joystick actually needs — continued move events after the finger slides off
 * the pad's own box, which is most of the time on a small phone screen.
 */
export function TouchControls({ engineRef, hud, joystickSize, buttonSize }: Props) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(false);
  const [running, setRunning] = useState(false);
  const pointerId = useRef<number | null>(null);

  const send = useCallback(
    (x: number, y: number) => {
      engineRef.current?.touch.move(x, y);
      const knob = knobRef.current;
      if (knob) {
        const r = (joystickSize * 0.29) as number;
        knob.style.transform = `translate3d(${(x * r).toFixed(1)}px, ${(-y * r).toFixed(1)}px, 0)`;
      }
    },
    [engineRef, joystickSize],
  );

  // A dropped pointer must never leave ARNO walking: reset on unmount too.
  useEffect(() => {
    return () => send(0, 0);
  }, [send]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== null) return;
    pointerId.current = event.pointerId;
    padRef.current?.setPointerCapture(event.pointerId);
    setActive(true);
    updateFromEvent(event);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== event.pointerId) return;
    updateFromEvent(event);
  };

  const endPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = null;
    try {
      padRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      /* already released by the browser */
    }
    setActive(false);
    send(0, 0);
    const knob = knobRef.current;
    if (knob) knob.style.transform = 'translate3d(0,0,0)';
  };

  const updateFromEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    const pad = padRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = event.clientX - cx;
    const dy = event.clientY - cy;
    // Dead zone kills the jitter a resting thumb produces, and the 1.05 divisor
    // lets a full throw reach exactly 1 without a clamp artefact.
    const dead = rect.width * 0.08;
    const mag = Math.hypot(dx, dy);
    if (mag < dead) {
      send(0, 0);
      return;
    }
    const scale = Math.min(1, mag / (rect.width * 0.46)) / 1.05;
    send((dx / mag) * scale * 1.05, (-dy / mag) * scale * 1.05);
  };

  const hold = (action: VirtualAction, down: boolean) => {
    engineRef.current?.touch.hold(action, down);
    if (action === 'run') setRunning(down);
  };

  return (
    <>
      <div
        ref={padRef}
        className={`joystick${active ? ' active' : ''}`}
        style={{ ['--joy-size' as string]: `${joystickSize}px` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onLostPointerCapture={() => {
          pointerId.current = null;
          setActive(false);
          send(0, 0);
        }}
        role="application"
        aria-label="Movement joystick"
      >
        <div className="ring" />
        <div ref={knobRef} className="knob" />
      </div>

      <div className={`run-flag${running && hud.stamina > 5 ? ' on' : ''}`}>SPRINT</div>

      <div className="actions" style={{ ['--btn-size' as string]: `${buttonSize}px` }}>
        <ActButton
          area="run"
          label="RUN"
          pressed={running}
          disabled={hud.staminaLocked}
          onDown={() => hold('run', true)}
          onUp={() => hold('run', false)}
        >
          <path d="M4 12h7M8 8l4 4-4 4M13 6v12" />
        </ActButton>

        <ActButton area="lock" label="LOCK" onDown={() => engineRef.current?.touch.tap('lock')}>
          <circle cx="11" cy="11" r="5.2" />
          <path d="M11 3v3M11 16v3M3 11h3M16 11h3" />
        </ActButton>

        <ActButton
          area="dodge"
          label="DODGE"
          disabled={!hud.dodgeReady}
          onDown={() => engineRef.current?.touch.tap('dodge')}
        >
          <path d="M5 17c0-5 4-8 9-8" />
          <path d="M11 5l4 4-4 4" />
        </ActButton>

        <ActButton
          area="atk"
          label="ATK"
          disabled={hud.staminaLocked}
          onDown={() => engineRef.current?.touch.hold('attack', true)}
          onUp={() => engineRef.current?.touch.hold('attack', false)}
        >
          <path d="M3 18l6-6M9 9l6-6 3 3-6 6z" />
          <path d="M6 15l3 3" />
        </ActButton>
      </div>
    </>
  );
}

interface ActProps {
  area: 'run' | 'lock' | 'dodge' | 'atk';
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  onDown: () => void;
  onUp?: () => void;
  children: React.ReactNode;
}

function ActButton({ area, label, disabled, pressed, onDown, onUp, children }: ActProps) {
  const [down, setDown] = useState(false);

  return (
    <button
      type="button"
      className={`act ${area}${down || pressed ? ' press' : ''}${disabled ? ' cool' : ''}`}
      aria-label={label}
      onPointerDown={(event) => {
        event.preventDefault();
        if (disabled) return;
        setDown(true);
        onDown();
      }}
      onPointerUp={() => {
        setDown(false);
        onUp?.();
      }}
      onPointerCancel={() => {
        setDown(false);
        onUp?.();
      }}
      onLostPointerCapture={() => {
        setDown(false);
        onUp?.();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <svg viewBox="0 0 22 22" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}
