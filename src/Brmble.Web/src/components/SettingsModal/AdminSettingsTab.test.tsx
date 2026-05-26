import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AdminSettingsTab } from './AdminSettingsTab';
import { confirm } from '../../hooks/usePrompt';
import type { Channel } from '../../types';

const { bridgeMock } = vi.hoisted(() => ({
  bridgeMock: {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
  },
}));

const usePermissionsMock = vi.fn();

const saveSpy = vi.fn();

vi.mock('../../bridge', () => ({ default: bridgeMock }));
vi.mock('../../hooks/usePrompt', () => ({
  confirm: vi.fn().mockResolvedValue(true),
  prompt: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => usePermissionsMock(),
}));
vi.mock('../../hooks/useAclAdmin', () => ({
  useAclAdmin: () => ({
    snapshot: { inheritAcls: true, groups: [], acls: [], snapshotHash: 'x' },
    save: saveSpy,
  }),
}));

const ban = {
  address: '127.0.0.1',
  bits: 32,
  name: 'TroubleUser',
  hash: 'hash-1',
  reason: 'spam',
  start: 1700000000,
  duration: 0,
};

const channels: Channel[] = [
  { id: 0, name: 'Root', position: 0 },
  { id: 1, name: 'General', parent: 0, position: 0 },
  { id: 2, name: 'Raid Planning', parent: 1 },
];

function renderWithBan() {
  bridgeMock.once.mockImplementation((type: string, handler: (data: unknown) => void) => {
    if (type === 'voice.bans') handler([ban]);
  });
  return render(<AdminSettingsTab />);
}

describe('AdminSettingsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(confirm).mockResolvedValue(true);
    usePermissionsMock.mockReturnValue({
      permissions: new Map<number, number>(),
      hasPermission: vi.fn(() => false),
      requestPermissions: vi.fn(),
      Permission: { MakeChannel: 0x40 },
    });
  });

  it('renders the five admin workspace tabs', () => {
    render(<AdminSettingsTab />);

    expect(screen.getByRole('tab', { name: 'Channels' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Users' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Groups' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Moderation' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Audit Log' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ban List' })).not.toBeInTheDocument();
  });

  it('shows the moderation section by default with the ban list', async () => {
    renderWithBan();

    fireEvent.click(screen.getByRole('tab', { name: 'Moderation' }));

    expect(await screen.findByRole('heading', { name: 'Moderation' })).toBeInTheDocument();
    expect(screen.getByText('TroubleUser')).toBeInTheDocument();
  });

  it('keeps unban behavior working after the moderation move', async () => {
    renderWithBan();

    fireEvent.click(screen.getByRole('tab', { name: 'Moderation' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Unban' }));

    await waitFor(() => {
      expect(bridgeMock.send).toHaveBeenCalledWith('voice.unban', { index: 0 });
    });
  });

  it('exposes tablist accessibility state for admin sections', () => {
    render(<AdminSettingsTab />);
    expect(screen.getByRole('tablist', { name: 'Admin sections' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Channels' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Channels' })).toHaveClass('heading-section');
  });

  it('renders the live channel list in the channels tab', () => {
    render(<AdminSettingsTab channels={channels} />);

    expect(screen.getByRole('row', { name: 'Root' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: 'General' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: 'Raid Planning' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Channel' })).toBeDisabled();
  });
});
