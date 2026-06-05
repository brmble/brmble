import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

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
    expect(screen.getByRole('button', { name: 'More information about preferred capture source' })).toHaveClass('settings-info-btn');
    expect(screen.getByRole('button', { name: 'More information about viewer location' })).toHaveClass('settings-info-btn');
    expect(screen.queryByText('System audio is available on Windows and macOS. Audio capture requires browser support.')).not.toBeInTheDocument();
    expect(screen.queryByText('Choose Window for game sharing. Your system picker still asks which window to share.')).not.toBeInTheDocument();
    expect(screen.queryByText('Share audio from the selected screen, window, or browser tab when supported. Voice chat uses Brmble separately.')).not.toBeInTheDocument();

    fireEvent.focus(captureAudioHelp);
    act(() => { vi.advanceTimersByTime(400); });

    expect(screen.getByRole('tooltip')).toHaveTextContent('Voice chat uses Brmble separately');
  });

  it('turns system audio off and disables it when capture audio is turned off', () => {
    const onChange = vi.fn();

    render(<ScreenShareSettingsTab settings={{ ...settings, systemAudio: true }} onChange={onChange} />);

    const toggles = screen.getAllByRole('checkbox');
    const captureAudioToggle = toggles[0];
    const systemAudioToggle = toggles[1];

    fireEvent.click(captureAudioToggle);

    expect(onChange).toHaveBeenCalledWith({
      ...settings,
      captureAudio: false,
      systemAudio: false,
    });
    expect(systemAudioToggle).toBeDisabled();
  });

  it('orders capture source, quality, audio, then viewer location settings', () => {
    render(<ScreenShareSettingsTab settings={settings} onChange={vi.fn()} />);

    const labels = screen.getAllByText(/^(Preferred Capture Source|Resolution|Frame Rate|Capture Audio|System Audio|Viewer Location)$/).map((label) => label.textContent);

    expect(labels).toEqual([
      'Preferred Capture Source',
      'Resolution',
      'Frame Rate',
      'Capture Audio',
      'System Audio',
      'Viewer Location',
    ]);
  });

  it('updates preferred capture source through the themed select', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ScreenShareSettingsTab settings={settings} onChange={onChange} />);

    await user.click(screen.getByText('Application Window'));
    await user.click(screen.getByRole('option', { name: 'Full Screen' }));

    expect(onChange).toHaveBeenCalledWith({
      ...settings,
      preferredCaptureSource: 'screen',
    });
  });
});
