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

const { confirmMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(),
}));

vi.mock('../../bridge', () => ({
  default: bridgeMock,
}));

vi.mock('../../hooks/usePrompt', () => ({
  confirm: confirmMock,
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
    confirmMock.mockResolvedValue(false);
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

  it('keeps audio settings sliders accessible by name', () => {
    render(
      <AudioSettingsTab
        settings={baseSettings}
        noiseSuppression={DEFAULT_NOISE_SUPPRESSION}
        onChange={vi.fn()}
        onNoiseSuppressionChange={vi.fn()}
        allBindings={{ pushToTalkKey: null }}
        onClearBinding={vi.fn()}
      />
    );

    expect(screen.getByRole('slider', { name: 'Hold Time' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Bitrate' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Audio per packet' })).toBeInTheDocument();
  });

  it('allows clearing an existing push to talk binding', () => {
    const onClearBinding = vi.fn();
    render(
      <AudioSettingsTab
        settings={{ ...baseSettings, pushToTalkKey: 'KeyV' }}
        noiseSuppression={DEFAULT_NOISE_SUPPRESSION}
        onChange={vi.fn()}
        onNoiseSuppressionChange={vi.fn()}
        allBindings={{ pushToTalkKey: 'KeyV' }}
        onClearBinding={onClearBinding}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear Push to Talk Key binding' }));

    expect(onClearBinding).toHaveBeenCalledWith('pushToTalkKey');
  });

  it('places clear before a highlighted bound push to talk key', () => {
    render(
      <AudioSettingsTab
        settings={{ ...baseSettings, pushToTalkKey: 'KeyV' }}
        noiseSuppression={DEFAULT_NOISE_SUPPRESSION}
        onChange={vi.fn()}
        onNoiseSuppressionChange={vi.fn()}
        allBindings={{ pushToTalkKey: 'KeyV' }}
        onClearBinding={vi.fn()}
      />
    );

    const clearButton = screen.getByRole('button', { name: 'Clear Push to Talk Key binding' });
    const keyButton = screen.getByRole('button', { name: 'KeyV' });

    expect(clearButton.compareDocumentPosition(keyButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(keyButton).toHaveClass('btn-primary');
    expect(keyButton).not.toHaveClass('btn-secondary');
  });

  it('hides push to talk clear when the binding is already empty', () => {
    render(
      <AudioSettingsTab
        settings={baseSettings}
        noiseSuppression={DEFAULT_NOISE_SUPPRESSION}
        onChange={vi.fn()}
        onNoiseSuppressionChange={vi.fn()}
        allBindings={{ pushToTalkKey: null }}
        onClearBinding={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Clear Push to Talk Key binding' })).not.toBeInTheDocument();
  });

  it('captures recorded keys without allowing app shortcut listeners to handle them', () => {
    const appShortcutListener = vi.fn();
    window.addEventListener('keydown', appShortcutListener);

    try {
      render(
        <AudioSettingsTab
          settings={baseSettings}
          noiseSuppression={DEFAULT_NOISE_SUPPRESSION}
          onChange={vi.fn()}
          onNoiseSuppressionChange={vi.fn()}
          allBindings={{ pushToTalkKey: null }}
          onClearBinding={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Not bound' }));
      fireEvent.keyDown(window, { code: 'KeyM' });

      expect(appShortcutListener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', appShortcutListener);
    }
  });

  it('keeps hotkeys suspended until the recorded keyboard input is released', () => {
    render(
      <AudioSettingsTab
        settings={baseSettings}
        noiseSuppression={DEFAULT_NOISE_SUPPRESSION}
        onChange={vi.fn()}
        onNoiseSuppressionChange={vi.fn()}
        allBindings={{ pushToTalkKey: null }}
        onClearBinding={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Not bound' }));
    fireEvent.keyDown(window, { code: 'KeyM' });

    expect(bridgeMock.send).toHaveBeenCalledWith('voice.suspendHotkeys');
    expect(bridgeMock.send).not.toHaveBeenCalledWith('voice.resumeHotkeys');

    fireEvent.keyUp(window, { code: 'KeyM' });

    expect(bridgeMock.send).toHaveBeenCalledWith('voice.resumeHotkeys');
  });

  it('shows the rebound push to talk key immediately after confirming a conflict', async () => {
    confirmMock.mockResolvedValue(true);
    const onChange = vi.fn();

    render(
      <AudioSettingsTab
        settings={baseSettings}
        noiseSuppression={DEFAULT_NOISE_SUPPRESSION}
        onChange={onChange}
        onNoiseSuppressionChange={vi.fn()}
        allBindings={{ pushToTalkKey: null, toggleMuteKey: 'KeyM' }}
        onClearBinding={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Not bound' }));
    fireEvent.keyDown(window, { code: 'KeyM' });

    expect(await screen.findByRole('button', { name: 'KeyM' })).toHaveClass('btn-primary');
    expect(screen.queryByRole('button', { name: 'Press any key...' })).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ pushToTalkKey: 'KeyM' }));
  });

  it('returns to the previous push to talk key immediately after canceling a conflict', async () => {
    confirmMock.mockResolvedValue(false);
    const onChange = vi.fn();

    render(
      <AudioSettingsTab
        settings={{ ...baseSettings, pushToTalkKey: 'KeyV' }}
        noiseSuppression={DEFAULT_NOISE_SUPPRESSION}
        onChange={onChange}
        onNoiseSuppressionChange={vi.fn()}
        allBindings={{ pushToTalkKey: 'KeyV', toggleMuteKey: 'KeyM' }}
        onClearBinding={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'KeyV' }));
    fireEvent.keyDown(window, { code: 'KeyM' });

    expect(await screen.findByRole('button', { name: 'KeyV' })).toHaveClass('btn-primary');
    expect(screen.queryByRole('button', { name: 'Press any key...' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ pushToTalkKey: 'KeyM' }));
  });

  it('uses shared settings help buttons instead of CSS-only tooltip spans', () => {
    render(
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
    expect(screen.getByRole('button', { name: 'More information about bitrate' })).toHaveClass('settings-info-btn');
    expect(screen.getByRole('button', { name: 'More information about audio per packet' })).toHaveClass('settings-info-btn');
    expect(document.querySelector('.tooltip-icon')).not.toBeInTheDocument();
    expect(document.querySelector('[data-tooltip]')).not.toBeInTheDocument();
  });
});
