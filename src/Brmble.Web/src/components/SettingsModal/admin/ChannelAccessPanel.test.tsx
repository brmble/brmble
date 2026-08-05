import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelAccessPanel } from './ChannelAccessPanel';

const channelSave = vi.fn();
const channelRefresh = vi.fn();
const rootRefresh = vi.fn();

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

vi.mock('../../../hooks/useAclAdmin', () => ({
  useAclAdmin: (channelId: number) => channelId === 0
    ? {
        snapshot: { channelId: 0, inheritAcls: true, groups: [{ name: 'Classleaders', inherited: false, inherit: true, inheritable: true, add: [], remove: [], members: [42] }], acls: [], fetchedAt: '2026-08-04T18:00:00Z', stale: false, warning: null, snapshotHash: 'root-hash' },
        loading: false, saving: false, error: null, refresh: rootRefresh, save: vi.fn(),
      }
    : {
        snapshot: { channelId: 7, inheritAcls: true, groups: [], acls: [], fetchedAt: '2026-08-04T18:00:00Z', stale: false, warning: null, snapshotHash: 'channel-hash' },
        loading: false, saving: false, error: null, refresh: channelRefresh, save: channelSave,
      },
}));

vi.mock('./useAdminRegisteredUsers', () => ({
  useAdminRegisteredUsers: () => ({
    registeredUsers: [
      { registrationUserId: 42, registeredName: 'Alice' },
      { registrationUserId: 77, registeredName: 'Bob' },
    ],
    loading: false,
    error: null,
  }),
}));

const channel = { id: 7, name: 'ChannelA', parent: 2, description: 'Class A voice' } as never;

describe('ChannelAccessPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refreshes channel and root ACL state when opened', () => {
    render(<ChannelAccessPanel channel={channel} parentName="Classes" onOpenAdvancedPermissions={vi.fn()} />);
    expect(channelRefresh).toHaveBeenCalled();
    expect(rootRefresh).toHaveBeenCalled();
  });

  it('shows channel information and the administrator-visible password label', () => {
    render(<ChannelAccessPanel channel={channel} parentName="Classes" onOpenAdvancedPermissions={vi.fn()} />);
    expect(screen.getByText('Class A voice')).toBeInTheDocument();
    expect(screen.getByText('Classes')).toBeInTheDocument();
    expect(screen.getByLabelText('Channel password — visible to administrators')).toBeInTheDocument();
  });

  it('assigns a root group and registered user then saves one merged ACL update', () => {
    render(<ChannelAccessPanel channel={channel} parentName="Classes" onOpenAdvancedPermissions={vi.fn()} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Group to add' }));
    fireEvent.click(screen.getByRole('option', { name: 'Classleaders' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add group' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Registered user to add' }));
    fireEvent.click(screen.getByRole('option', { name: 'Bob' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save access settings' }));

    expect(channelSave).toHaveBeenCalledWith(expect.objectContaining({
      acls: expect.arrayContaining([
        expect.objectContaining({ group: 'Classleaders' }),
        expect.objectContaining({ userId: 77 }),
      ]),
    }));
  });

  it('sets and clears a channel password through the same hash-protected save', () => {
    render(<ChannelAccessPanel channel={channel} parentName="Classes" onOpenAdvancedPermissions={vi.fn()} />);
    const input = screen.getByLabelText('Channel password — visible to administrators');
    fireEvent.change(input, { target: { value: 'class-a-voice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save access settings' }));
    expect(channelSave).toHaveBeenLastCalledWith(expect.objectContaining({
      acls: expect.arrayContaining([expect.objectContaining({ group: '#class-a-voice' })]),
    }));
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save access settings' }));
    expect(channelSave).toHaveBeenCalledTimes(2);
  });

  it('opens the existing advanced ACL editor', () => {
    const openAdvanced = vi.fn();
    render(<ChannelAccessPanel channel={channel} parentName="Classes" onOpenAdvancedPermissions={openAdvanced} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open advanced permissions' }));
    expect(openAdvanced).toHaveBeenCalled();
  });
});
