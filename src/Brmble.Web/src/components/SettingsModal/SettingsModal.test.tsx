import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SettingsModal } from './SettingsModal';

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

vi.mock('../../hooks/useServerlist', () => ({
  useServerlist: () => ({ servers: [] }),
}));

vi.mock('../../hooks/usePermissions', () => ({
  Permission: { Ban: 4, Kick: 2 },
  usePermissions: () => ({ hasPermission: () => false }),
}));

describe('SettingsModal tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('labels the messages settings tab as Notifications', () => {
    render(<SettingsModal isOpen onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Messages' })).not.toBeInTheDocument();
  });

  it('registers native shortcut changes for every shortcut action', async () => {
    render(<SettingsModal isOpen onClose={vi.fn()} initialTab="shortcuts" />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Not bound' }).at(-1)!);
    fireEvent.keyDown(window, { code: 'KeyG' });

    await waitFor(() => {
      expect(bridgeMock.send).toHaveBeenCalledWith('voice.setShortcut', {
        action: 'toggleGame',
        key: 'KeyG',
      });
    });
  });
});
