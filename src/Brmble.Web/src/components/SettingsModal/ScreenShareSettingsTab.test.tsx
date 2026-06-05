import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenShareSettingsTab } from './ScreenShareSettingsTab';
import type { ScreenShareSettings } from './SettingsModal';

const settings: ScreenShareSettings = {
  captureAudio: true,
  resolution: '1080p',
  fps: 30,
  systemAudio: false,
  viewerMode: 'in-app',
  preferredCaptureSource: 'window',
};

describe('ScreenShareSettingsTab', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses shared settings help buttons and no inline note', () => {
    render(<ScreenShareSettingsTab settings={settings} onChange={vi.fn()} />);

    const captureAudioHelp = screen.getByRole('button', { name: 'More information about capture audio' });

    expect(captureAudioHelp).toHaveClass('settings-info-btn');
    expect(screen.getByRole('button', { name: 'More information about resolution' })).toHaveClass('settings-info-btn');
    expect(screen.getByRole('button', { name: 'More information about frame rate' })).toHaveClass('settings-info-btn');
    expect(screen.getByRole('button', { name: 'More information about system audio' })).toHaveClass('settings-info-btn');
    expect(screen.getByRole('button', { name: 'More information about viewer location' })).toHaveClass('settings-info-btn');
    expect(screen.queryByText('System audio is available on Windows and macOS. Audio capture requires browser support.')).not.toBeInTheDocument();

    fireEvent.focus(captureAudioHelp);
    act(() => { vi.advanceTimersByTime(400); });

    expect(screen.getByRole('tooltip')).toHaveTextContent('browser support');
  });
});
