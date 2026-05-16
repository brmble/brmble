import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AudioSettingsTab, DEFAULT_NOISE_SUPPRESSION, type AudioSettings } from './AudioSettingsTab';

const { bridgeMock } = vi.hoisted(() => ({
  bridgeMock: {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('../../bridge', () => ({
  default: bridgeMock,
}));

const baseSettings: AudioSettings = {
  inputDevice: 'mic-1',
  outputDevice: 'spk-1',
  inputVolume: 100,
  outputVolume: 100,
  transmissionMode: 'pushToTalk',
  pushToTalkKey: null,
  opusBitrate: 72000,
  opusFrameSize: 20,
  voiceHoldMs: 200,
  captureApi: 'wasapi',
  vadSensitivity: 'balanced',
};

describe('AudioSettingsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests audio devices on mount and renders returned device labels', () => {
    const onChange = vi.fn();
    render(
      <AudioSettingsTab
        settings={baseSettings}
        noiseSuppression={DEFAULT_NOISE_SUPPRESSION}
        onChange={onChange}
        onNoiseSuppressionChange={vi.fn()}
        allBindings={{ pushToTalkKey: null }}
        onClearBinding={vi.fn()}
      />
    );

    expect(bridgeMock.send).toHaveBeenCalledWith('voice.getAudioDevices');

    const handler = bridgeMock.on.mock.calls.find(([type]) => type === 'voice.audioDevices')?.[1] as ((data: unknown) => void);
    act(() => {
      handler({
        input: [{ id: 'mic-1', name: 'USB Mic' }],
        output: [{ id: 'spk-1', name: 'Desk Speakers' }],
      });
    });

    expect(screen.getByText('USB Mic')).toBeInTheDocument();
    expect(screen.getByText('Desk Speakers')).toBeInTheDocument();
  });

  it('coerces the input device to default when switching to waveIn', () => {
    const onChange = vi.fn();
    render(
      <AudioSettingsTab
        settings={baseSettings}
        noiseSuppression={DEFAULT_NOISE_SUPPRESSION}
        onChange={onChange}
        onNoiseSuppressionChange={vi.fn()}
        allBindings={{ pushToTalkKey: null }}
        onClearBinding={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'WaveIn (Legacy)' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      captureApi: 'waveIn',
      inputDevice: 'default',
    }));
    expect(screen.queryByText('WaveIn uses the system default microphone only. Switch to WASAPI to choose a specific input device.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More information about input device' })).toHaveClass('settings-info-btn');
  });

  it('uses shared settings help buttons instead of CSS-only tooltip spans', () => {
    const { rerender } = render(
      <AudioSettingsTab
        settings={baseSettings}
        noiseSuppression={DEFAULT_NOISE_SUPPRESSION}
        onChange={vi.fn()}
        onNoiseSuppressionChange={vi.fn()}
        allBindings={{ pushToTalkKey: null }}
        onClearBinding={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'More information about hold time' })).toHaveClass('settings-info-btn');
    expect(screen.getByRole('button', { name: 'More information about noise suppression' })).toHaveClass('settings-info-btn');
    expect(screen.getByRole('button', { name: 'More information about bitrate' })).toHaveClass('settings-info-btn');
    expect(screen.getByRole('button', { name: 'More information about audio per packet' })).toHaveClass('settings-info-btn');

    rerender(
      <AudioSettingsTab
        settings={{ ...baseSettings, transmissionMode: 'voiceActivity' }}
        noiseSuppression={DEFAULT_NOISE_SUPPRESSION}
        onChange={vi.fn()}
        onNoiseSuppressionChange={vi.fn()}
        allBindings={{ pushToTalkKey: null }}
        onClearBinding={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'More information about sensitivity' })).toHaveClass('settings-info-btn');
    expect(document.querySelector('.tooltip-icon')).not.toBeInTheDocument();
    expect(document.querySelector('[data-tooltip]')).not.toBeInTheDocument();
  });
});
