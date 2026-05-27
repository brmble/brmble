import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminSectionPlaceholder } from './AdminSectionPlaceholder';
import { AdminChannelsSection } from './AdminChannelsSection';
import type { Channel } from '../../../types';

const { promptMock, aclEditorDialogMock } = vi.hoisted(() => ({
  promptMock: vi.fn(),
  aclEditorDialogMock: vi.fn(),
}));
const { bridgeMock, usePermissionsMock } = vi.hoisted(() => ({
  bridgeMock: {
    send: vi.fn(),
  },
  usePermissionsMock: vi.fn(),
}));

vi.mock('../../../hooks/usePrompt', () => ({
  prompt: promptMock,
}));

vi.mock('../../AclEditor/AclEditorDialog', () => ({
  AclEditorDialog: (props: unknown) => {
    aclEditorDialogMock(props);
    return <div data-testid="acl-editor-dialog" />;
  },
}));

vi.mock('../../../bridge', () => ({
  default: bridgeMock,
}));

vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => usePermissionsMock(),
}));

const liveChannels: Channel[] = [
  { id: 7, name: 'General', position: 2 },
  { id: 9, name: 'Raid Planning', parent: 7, position: 1 },
];

describe('Admin workspace sections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePermissionsMock.mockReturnValue({
      permissions: new Map<number, number>([[0, 0x40], [7, 0x40], [9, 0x40], [10, 0x40], [20, 0x40]]),
      hasPermission: vi.fn((_channelId: number, permission: number) => permission === 0x40),
      requestPermissions: vi.fn(),
      Permission: { MakeChannel: 0x40 },
    });
  });

  it('renders guide-compliant placeholder copy without fake actions', () => {
    render(
      <AdminSectionPlaceholder
        title="Audit Log"
        body="Audit history is not available yet."
        actionLabel="Export"
        disabledActionReason="Export will unlock when audit events are wired."
      />,
    );

    expect(screen.getByRole('heading', { name: 'Audit Log' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    expect(screen.getByText('Export will unlock when audit events are wired.')).toBeInTheDocument();
  });

  it('renders the channels management overview and request queue', () => {
    render(<AdminChannelsSection channels={liveChannels} />);

    expect(screen.getByRole('heading', { name: 'Channels' })).toBeInTheDocument();
    expect(screen.getByText('Existing Channels')).toBeInTheDocument();
    expect(screen.getByText('Channel Requests')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: 'General' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: 'Raid Planning' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Channel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete Channel' })).toBeInTheDocument();
  });

  it('renders inline approve and deny actions for each channel request row', () => {
    render(<AdminChannelsSection channels={liveChannels} />);

    expect(screen.getByRole('button', { name: 'Approve Mike request' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny Mike request' })).toBeInTheDocument();
  });

  it('opens the shared ACL editor for the selected channel when its Edit action is clicked', () => {
    render(<AdminChannelsSection channels={[
      { id: 7, name: 'General' },
      { id: 9, name: 'Raid Planning', parent: 7, isEnterRestricted: true },
    ]} />);

    const raidPlanningRow = screen.getByRole('row', { name: 'Raid Planning' });
    fireEvent.click(within(raidPlanningRow).getByRole('button', { name: 'Edit Raid Planning' }));

    expect(screen.getByTestId('acl-editor-dialog')).toBeInTheDocument();
    expect(aclEditorDialogMock).toHaveBeenLastCalledWith(expect.objectContaining({
      isOpen: true,
      channelId: 9,
      channelName: 'Raid Planning',
      isNativePasswordProtected: true,
      onClose: expect.any(Function),
    }));
  });

  it('updates the selected channel when Edit is clicked so follow-up actions target the same row', async () => {
    promptMock.mockResolvedValue('Raid Planning');

    render(<AdminChannelsSection channels={[
      { id: 7, name: 'General' },
      { id: 9, name: 'Raid Planning', parent: 7, isEnterRestricted: true },
    ]} />);

    const raidPlanningRow = screen.getByRole('row', { name: 'Raid Planning' });
    fireEvent.click(within(raidPlanningRow).getByRole('button', { name: 'Edit Raid Planning' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Channel' }));

    await waitFor(() => {
      expect(promptMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Delete Channel',
          message: expect.stringContaining('Raid Planning'),
          placeholder: 'Raid Planning',
        }),
      );
    });
  });

  it('reorders sibling channels when a channel row is dragged onto another row', () => {
    const onChannelsChange = vi.fn();
    render(
      <AdminChannelsSection
        channels={[
          { id: 0, name: 'Root', position: 0 },
          { id: 10, name: 'General', parent: 0, position: 0 },
          { id: 20, name: 'Raid', parent: 0, position: 1 },
        ]}
        onChannelsChange={onChannelsChange}
      />,
    );

    const generalRow = screen.getByRole('row', { name: 'General' });
    const raidRow = screen.getByRole('row', { name: 'Raid' });

    fireEvent.dragStart(raidRow);
    fireEvent.dragOver(generalRow);
    fireEvent.drop(generalRow);

    expect(onChannelsChange).toHaveBeenCalledWith([
      { id: 0, name: 'Root', position: 0 },
      { id: 20, name: 'Raid', parent: 0, position: 0 },
      { id: 10, name: 'General', parent: 0, position: 10 },
    ]);
    expect(bridgeMock.send).toHaveBeenCalledWith('admin.updateChannel', {
      channelId: 20,
      name: 'Raid',
      description: '',
      position: 0,
    });
    expect(bridgeMock.send).toHaveBeenCalledWith('admin.updateChannel', {
      channelId: 10,
      name: 'General',
      description: '',
      position: 10,
    });
  });

  it('highlights the dragged channel during reorder and keeps a recently-moved highlight after drop', () => {
    render(
      <AdminChannelsSection
        channels={[
          { id: 0, name: 'Root', position: 0 },
          { id: 10, name: 'General', parent: 0, position: 0 },
          { id: 20, name: 'Raid', parent: 0, position: 1 },
        ]}
      />,
    );

    const generalRow = screen.getByRole('row', { name: 'General' });
    const raidRow = screen.getByRole('row', { name: 'Raid' });

    fireEvent.dragStart(raidRow);
    expect(raidRow).toHaveClass('admin-channel-row--dragging');

    fireEvent.dragOver(generalRow);
    fireEvent.drop(generalRow);

    expect(screen.getByRole('row', { name: 'Raid' })).toHaveClass('admin-channel-row--recently-moved');
  });

  it('opens a typed confirmation before deleting the selected channel', async () => {
    promptMock.mockResolvedValue('General');
    render(<AdminChannelsSection channels={liveChannels} />);

    fireEvent.click(screen.getByRole('row', { name: /General/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Channel' }));

    await waitFor(() => {
      expect(promptMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Delete Channel',
          message: expect.stringContaining('General'),
          placeholder: 'General',
          confirmLabel: 'Delete',
        }),
      );
    });
  });

  it('keeps disabled admin actions paired with visible explanatory text', () => {
    render(<AdminChannelsSection channels={liveChannels} />);
    expect(screen.getByRole('button', { name: 'Create Channel' })).toBeDisabled();
    expect(screen.getByText('Create Channel is not available yet. Request actions and safe delete are available.')).toBeInTheDocument();
  });

  it('shows an empty-state message when no live channels are available', () => {
    render(<AdminChannelsSection channels={[]} />);

    expect(screen.getByText('No channels are available yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Channel' })).toBeDisabled();
  });

  it('sorts admin channels by the same Mumble order as the sidebar', () => {
    render(<AdminChannelsSection channels={[
      { id: 7, name: 'Zulu', position: 3 },
      { id: 8, name: 'Bravo', position: 1 },
      { id: 9, name: 'Alpha', position: 1 },
    ]} />);

    expect(screen.getAllByRole('row').map(row => row.getAttribute('aria-label'))).toEqual(['Alpha', 'Bravo', 'Zulu']);
  });

  it('does not show the Mumble position values in the admin channel rows', () => {
    render(<AdminChannelsSection channels={[{ id: 7, name: 'General', position: 3 }]} />);

    expect(screen.getByRole('row', { name: 'General' })).toBeInTheDocument();
    expect(screen.queryByText(/Position\s+3/i)).not.toBeInTheDocument();
  });
});
