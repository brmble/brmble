import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScreenShareSettingsTab } from './ScreenShareSettingsTab';
import type { ScreenShareSettings } from './SettingsModal';

const settings: ScreenShareSettings = {
  captureAudio: true,
  resolution: '1080p',
  fps: 30,
  systemAudio: false,
  viewerMode: 'in-app',
};

describe('ScreenShareSettingsTab', () => {
  it('uses shared settings help buttons and no inline note', () => {
    render(<ScreenShareSettingsTab settings={settings} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'More information about capture audio' })).toHaveClass('settings-info-btn');
    expect(screen.getByRole('button', { name: 'More information about system audio' })).toHaveClass('settings-info-btn');
    expect(screen.getByRole('button', { name: 'More information about viewer location' })).toHaveClass('settings-info-btn');
    expect(screen.queryByText('System audio is available on Windows and macOS. Audio capture requires browser support.')).not.toBeInTheDocument();
  });
});
