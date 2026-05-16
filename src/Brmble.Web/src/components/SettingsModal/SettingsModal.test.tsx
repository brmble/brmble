import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsModal } from './SettingsModal';

vi.mock('../../hooks/useServerlist', () => ({
  useServerlist: () => ({ servers: [] }),
}));

vi.mock('../../hooks/usePermissions', () => ({
  Permission: { Ban: 4, Kick: 2 },
  usePermissions: () => ({ hasPermission: () => false }),
}));

describe('SettingsModal tabs', () => {
  it('labels the messages settings tab as Notifications', () => {
    render(<SettingsModal isOpen onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Messages' })).not.toBeInTheDocument();
  });
});
