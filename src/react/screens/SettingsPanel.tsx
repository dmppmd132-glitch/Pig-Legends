import { useEffect, useState } from 'react';

import { QUALITY, type QualityLevel } from '../../game/config';
import type { Settings } from '../../game/types';
import { saveSettings } from '../../storage/db';

interface Props {
  settings: Settings;
  onChange: (next: Settings) => void;
  onClose: () => void;
  onResetProgress: () => void;
}

const QUALITY_ORDER: QualityLevel[] = ['low', 'medium', 'high'];

/**
 * Settings are held in local state and committed on close rather than on every
 * slider tick: the engine re-applies volumes live, but quality changes rebuild
 * render targets, which should happen once.
 */
export function SettingsPanel({ settings, onChange, onClose, onResetProgress }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => setDraft(settings), [settings]);

  const patch = (part: Partial<Settings>) => setDraft((prev) => ({ ...prev, ...part }));

  // Volume and sensitivity are cheap to apply immediately, so the sliders are
  // audible while dragging.
  useEffect(() => {
    onChange(draft);
    // Only when a value actually changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.masterVolume, draft.sfxVolume, draft.musicVolume, draft.cameraSensitivity, draft.invertY]);

  const commit = () => {
    onChange(draft);
    void saveSettings(draft);
    onClose();
  };

  return (
    <div className="screen">
      <div className="plate">
        <p className="eyebrow">Rites</p>
        <h1 className="title" style={{ fontSize: 'clamp(22px,5vw,34px)' }}>
          Settings
        </h1>

        <div className="rule" />

        <Field label="Graphics">
          <div className="seg">
            {QUALITY_ORDER.map((q) => (
              <button
                key={q}
                type="button"
                className={draft.quality === q ? 'on' : ''}
                onClick={() => patch({ quality: q })}
                title={qualityHint(q)}
              >
                {QUALITY[q].label}
              </button>
            ))}
          </div>
        </Field>
        <p className="lede" style={{ margin: '6px 0 4px', fontSize: 11 }}>
          {qualityHint(draft.quality)}
        </p>

        <Field label="Master">
          <Slider
            value={draft.masterVolume}
            onChange={(v) => patch({ masterVolume: v })}
            suffix={Math.round(draft.masterVolume * 100)}
          />
        </Field>
        <Field label="Blade &amp; claws">
          <Slider
            value={draft.sfxVolume}
            onChange={(v) => patch({ sfxVolume: v })}
            suffix={Math.round(draft.sfxVolume * 100)}
          />
        </Field>
        <Field label="Ambience">
          <Slider
            value={draft.musicVolume}
            onChange={(v) => patch({ musicVolume: v })}
            suffix={Math.round(draft.musicVolume * 100)}
          />
        </Field>

        <div className="rule" />

        <Field label="Camera sensitivity">
          <Slider
            value={draft.cameraSensitivity}
            min={0.35}
            max={2.5}
            step={0.05}
            onChange={(v) => patch({ cameraSensitivity: v })}
            suffix={draft.cameraSensitivity.toFixed(2)}
          />
        </Field>

        <Field label="Invert vertical look">
          <Seg
            options={[
              ['off', false],
              ['on', true],
            ]}
            value={draft.invertY}
            onChange={(v) => patch({ invertY: v })}
          />
        </Field>

        <Field label="Touch controls">
          <Seg
            options={[
              ['auto', 'auto'],
              ['always', 'always'],
              ['never', 'never'],
            ]}
            value={draft.touchControls}
            onChange={(v) => patch({ touchControls: v })}
          />
        </Field>

        <Field label="Stick size">
          <Slider
            value={draft.joystickSize}
            min={96}
            max={190}
            step={2}
            onChange={(v) => patch({ joystickSize: v })}
            suffix={`${draft.joystickSize}px`}
          />
        </Field>
        <Field label="Button size">
          <Slider
            value={draft.buttonSize}
            min={48}
            max={92}
            step={2}
            onChange={(v) => patch({ buttonSize: v })}
            suffix={`${draft.buttonSize}px`}
          />
        </Field>

        <Field label="Performance readout">
          <Seg
            options={[
              ['off', false],
              ['on', true],
            ]}
            value={draft.showFps}
            onChange={(v) => patch({ showFps: v })}
          />
        </Field>

        <div className="rule" />

        <div className="btn-row" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="btn primary" onClick={commit}>
            Done
          </button>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => {
              if (!confirmReset) {
                setConfirmReset(true);
                return;
              }
              onResetProgress();
              setConfirmReset(false);
            }}
          >
            {confirmReset ? 'Tap again to erase' : 'Erase progress'}
          </button>
        </div>
      </div>
    </div>
  );
}

function qualityHint(q: QualityLevel): string {
  const v = QUALITY[q];
  if (q === 'low') return 'Fewer trees and no shadows. Best battery life on older phones.';
  if (q === 'medium') return `Moon shadows at ${v.shadowMapSize}px, bloom on, ${v.maxFps} fps cap.`;
  return `Full ${v.shadowMapSize}px shadows, all ${v.grassScale * 100}% of the undergrowth.`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

function Slider({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.05,
  suffix = '',
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string | number;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={suffix ? `value ${suffix}` : 'value'}
      />
      <span style={{ font: '500 10px/1 var(--font-mono)', color: 'var(--bone-faint)', minWidth: 34 }}>
        {suffix}
      </span>
    </span>
  );
}

function Seg<T extends string | boolean>({
  options,
  value,
  onChange,
}: {
  options: Array<[string, T]>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map(([label, v]) => (
        <button
          key={String(v)}
          type="button"
          className={v === value ? 'on' : ''}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
