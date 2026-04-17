import React, { useState } from 'react';
import { Select } from '../Select';

const BUILTIN_FIXTURES = [
  'near_speech.wav',
  'far_end.wav',
  'noise_speech.wav',
];

interface Props {
  onChange: (path: string | null) => void;
}

export const VirtualMicControls: React.FC<Props> = ({ onChange }) => {
  const [enabled, setEnabled] = useState(false);
  const [fixture, setFixture] = useState<string>(BUILTIN_FIXTURES[0]);

  const toggle = (on: boolean) => {
    setEnabled(on);
    onChange(on ? `fixtures/apm/${fixture}` : null);
  };

  const pickFixture = (f: string) => {
    setFixture(f);
    if (enabled) onChange(`fixtures/apm/${f}`);
  };

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <span className="settings-dev-label">DEV</span>
        <span className="settings-section-title">Testing</span>
      </div>
      <div className="settings-item">
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => toggle(e.target.checked)}
            style={{ marginRight: '0.5rem' }}
          />
          Replay test fixture instead of microphone
        </label>
      </div>
      <div className="settings-item">
        <label>Fixture</label>
        <Select
          value={fixture}
          onChange={(v) => pickFixture(v)}
          disabled={!enabled}
          options={BUILTIN_FIXTURES.map((f) => ({ value: f, label: f }))}
        />
      </div>
      <div className="settings-item">
        <small style={{ color: 'var(--text-muted)', fontSize: '0.8em' }}>
          Replaces the live microphone with a pre-recorded fixture for A/B comparison.
          Resets to off on every launch.
        </small>
      </div>
    </div>
  );
};
