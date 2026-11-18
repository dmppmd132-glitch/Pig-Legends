import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

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
 * On-screen controls. Pointer capture keeps the stick/buttons responsive when a
 * thumb drifts outside their visual bounds, while the radial response curve
 * gives precise low-speed movement near centre and still reaches full sprint.
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
        const width = padRef.current?.getBoundingClientRect().width ?? joystickSize;
        const travel = width * 0.29;
        knob.style.transform = `translate3d(${(x * travel).toFixed(1)}px, ${(-y * travel).toFixed(1)}px, 0)`;
      }
    },
    [engineRef, joystickSize],
  );

  // A dropped pointer must never leave ARNO walking: reset on unmount too.
  useEffect(() => () => send(0, 0), [send]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== null) return;
    pointerId.current = event.pointerId;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* capture may be unavailable in an embedded browser */
    }
    setActive(true);
    updateFromEvent(event);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== event.pointerId) return;
    updateFromEvent(event);
  };

  const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = null;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      /* already released by the browser */
    }
    setActive(false);
    send(0, 0);
  };

  const updateFromEvent = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pad = padRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const magnitude = Math.hypot(dx, dy);
    const travel = rect.width * 0.39;
    const deadzone = travel * 0.11;
    if (magnitude <= deadzone) {
      send(0, 0);
      return;
    }

    // Radial deadzone + soft quadratic curve: thumb tremor is filtered without
    // making small corrections feel binary; the outer rim still means full input.
    const radial = Math.min(1, (magnitude - deadzone) / (travel - deadzone));
    const response = radial * (0.36 + radial * 0.64);
    send((dx / magnitude) * response, (-dy / magnitude) * response);
  };

  const hold = (action: VirtualAction, down: boolean) => {
    engineRef.current?.touch.hold(action, down);
    if (action === 'run') setRunning(down);
  };

  const skillCaption = hud.skillReady
    ? 'SKILL'
    : hud.skillCooldown > 0
      ? `${Math.ceil(hud.skillCooldown)}s`
      : 'WIND';

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
          if (pointerId.current === null) return;
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
          label="Sprint"
          caption="RUN"
          pressed={running}
          disabled={hud.staminaLocked}
          onDown={() => hold('run', true)}
          onUp={() => hold('run', false)}
        >
          <path d="M4 12h7M8 8l4 4-4 4M13 6v12" />
        </ActButton>

        <ActButton area="lock" label="Lock on" caption="LOCK" onDown={() => engineRef.current?.touch.tap('lock')}>
          <circle cx="11" cy="11" r="5.2" />
          <path d="M11 3v3M11 16v3M3 11h3M16 11h3" />
        </ActButton>

        <ActButton
          area="jump"
          label="Jump · evade wolf bites"
          caption="JUMP"
          disabled={!hud.jumpReady}
          onDown={() => engineRef.current?.touch.tap('jump')}
        >
          <path d="M11 18V5M6 10l5-5 5 5M4 19h14" />
        </ActButton>

        <ActButton
          area="skill"
          label="Runic burst · area attack"
          caption={skillCaption}
          disabled={!hud.skillReady}
          onDown={() => engineRef.current?.touch.tap('skill')}
        >
          <path d="m11 2 2.1 5.1L19 9l-5.9 1.9L11 17l-2.1-6.1L3 9l5.9-1.9z" />
          <path d="M18 15v5M15.5 17.5h5" />
        </ActButton>

        <ActButton
          area="dodge"
          label="Dodge roll"
          caption="DODGE"
          disabled={!hud.dodgeReady}
          onDown={() => engineRef.current?.touch.tap('dodge')}
        >
          <path d="M5 17c0-5 4-8 9-8" />
          <path d="M11 5l4 4-4 4" />
        </ActButton>

        <ActButton
          area="atk"
          label="Sword attack"
          caption="ATK"
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
  area: 'run' | 'lock' | 'jump' | 'skill' | 'dodge' | 'atk';
  label: string;
  caption: string;
  disabled?: boolean;
  pressed?: boolean;
  onDown: () => void;
  onUp?: () => void;
  children: React.ReactNode;
}

function ActButton({ area, label, caption, disabled, pressed, onDown, onUp, children }: ActProps) {
  const [down, setDown] = useState(false);

  const release = () => {
    setDown(false);
    onUp?.();
  };

  return (
    <button
      type="button"
      className={`act ${area}${down || pressed ? ' press' : ''}${disabled ? ' cool' : ''}`}
      aria-label={label}
      aria-disabled={disabled}
      disabled={disabled}
      onPointerDown={(event) => {
        event.preventDefault();
        if (disabled) return;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* pointer capture is best-effort */
        }
        setDown(true);
        onDown();
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        release();
      }}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(event) => event.preventDefault()}
    >
      <svg viewBox="0 0 22 22" aria-hidden="true">
        {children}
      </svg>
      <span className="act-caption" aria-hidden="true">{caption}</span>
    </button>
  );
}
