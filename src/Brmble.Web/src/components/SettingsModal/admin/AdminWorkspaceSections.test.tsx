import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminSectionPlaceholder } from './AdminSectionPlaceholder';
import { AdminChannelsSection } from './AdminChannelsSection';
import type { Channel } from '../../../types';
import bridge from '../../../bridge';

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

vi.mock('../../ContextMenu/ContextMenu', () => ({
  ContextMenu: ({ items }: { items: Array<{ label?: string; type: string; onClick?: () => void }> }) => (
    <div data-testid="admin-channel-menu">
      {items.map((item, index) =>
        item.type === 'item' ? <button key={`${item.label}-${index}`} onClick={item.onClick}>{item.label}</button> : <hr key={`divider-${index}`} />
      )}
    </div>
  ),
}));

vi.mock('../../EditChannelDialog/EditChannelDialog', () => ({
  EditChannelDialog: (props: Record<string, unknown>) => (
    <div data-testid="admin-edit-channel-dialog">
      <span>{String(props.initialPosition)}</span>
      <span>{props.showPosition ? 'position enabled' : 'position hidden'}</span>
      <button onClick={() => (props.onSave as (name: string, description: string, position: number) => void)('General', 'Updated', 12)}>
        Save Admin Edit Channel
      </button>
    </div>
  ),
}));

vi.mock('../../AclEditor/AclEditorDialog', () => ({
  AclEditorDialog: (props: unknown) => {
    aclEditorDialogMock(props);
    return <div data-testid="acl-editor-dialog" />;
  },
}));

vi.mock('../SettingsHelp', () => ({
  SettingsHelp: ({ content, label }: { content: string; label: string }) => (
    <button type="button" aria-label={label} data-help-content={content}>?</button>
  ),
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
    expect(screen.getByRole('row', { name: 'General Position 2' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: 'Raid Planning Position 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Channel' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Delete Channel' })).not.toBeInTheDocument();
  });

  it('renders inline approve and deny actions for each channel request row', () => {
    render(<AdminChannelsSection channels={liveChannels} />);

    expect(screen.getByRole('button', { name: 'Approve Mike request' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny Mike request' })).toBeInTheDocument();
  });

  it('opens the shared ACL editor via right-click context menu', () => {
    render(<AdminChannelsSection channels={[
      { id: 7, name: 'General' },
      { id: 9, name: 'Raid Planning', parent: 7, isEnterRestricted: true },
    ]} />);

    fireEvent.contextMenu(screen.getByRole('row', { name: 'Raid Planning Position 0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Permissions' }));

    expect(screen.getByTestId('acl-editor-dialog')).toBeInTheDocument();
    expect(aclEditorDialogMock).toHaveBeenLastCalledWith(expect.objectContaining({
      isOpen: true,
      channelId: 9,
      channelName: 'Raid Planning',
      isNativePasswordProtected: true,
      onClose: expect.any(Function),
    }));
  });

  it('opens a typed confirmation before deleting the selected channel from context menu', async () => {
    promptMock.mockResolvedValue('General');

    render(<AdminChannelsSection channels={[
      { id: 7, name: 'General' },
      { id: 9, name: 'Raid Planning', parent: 7, isEnterRestricted: true },
    ]} />);

    fireEvent.contextMenu(screen.getByRole('row', { name: /General Position 0/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Channel' }));

    await waitFor(() => {
      expect(promptMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Delete Channel',
          message: expect.stringContaining('General'),
          placeholder: 'General',
        }),
      );
    });
  });

  it('reorders sibling channels when a channel row is dragged onto another row', () => {
    const onChannelsChange = vi.fn();
    const dataTransfer = { effectAllowed: '', setData: vi.fn() };

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

    const generalRow = screen.getByRole('row', { name: 'General Position 0' });
    const raidRow = screen.getByRole('row', { name: 'Raid Position 1' });

    fireEvent.dragStart(raidRow, { dataTransfer });
    fireEvent.dragOver(generalRow, { dataTransfer });
    fireEvent.drop(generalRow, { dataTransfer });

    expect(bridgeMock.send).toHaveBeenCalledWith('admin.updateChannel', expect.objectContaining({
      channelId: 20,
      position: 0,
    }));
    expect(bridgeMock.send).toHaveBeenCalledWith('admin.updateChannel', expect.objectContaining({
      channelId: 10,
      position: 10,
    }));
  });

  it('highlights the dragged channel during reorder and keeps a recently-moved highlight after drop', () => {
    const dataTransfer = { effectAllowed: '', setData: vi.fn() };

    render(
      <AdminChannelsSection
        channels={[
          { id: 0, name: 'Root', position: 0 },
          { id: 10, name: 'General', parent: 0, position: 0 },
          { id: 20, name: 'Raid', parent: 0, position: 1 },
        ]}
      />,
    );

    const generalRow = screen.getByRole('row', { name: 'General Position 0' });
    const raidRow = screen.getByRole('row', { name: 'Raid Position 1' });

    fireEvent.dragStart(raidRow, { dataTransfer });
    expect(raidRow).toHaveClass('admin-channel-row--dragging');

    fireEvent.dragOver(generalRow, { dataTransfer });
    fireEvent.drop(generalRow, { dataTransfer });

    expect(screen.getByRole('row', { name: 'Raid Position 0' })).toHaveClass('admin-channel-row--recently-moved');
  });

  it('opens a typed confirmation before deleting the selected channel', async () => {
    promptMock.mockResolvedValue('General');
    render(<AdminChannelsSection channels={liveChannels} />);

    fireEvent.contextMenu(screen.getByRole('row', { name: /General Position 2/i }));
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
    expect(screen.getByText(/Create Channel is not available yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More information about channel admin actions' })).toHaveAttribute(
      'data-help-content',
      'Right-click a channel for admin actions.',
    );
  });

  it('shows an empty-state message when no live channels are available', () => {
    render(<AdminChannelsSection channels={[]} />);

    expect(screen.getByText('No channels are available yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Channel' })).not.toBeInTheDocument();
  });

  it('sorts admin channels by the same Mumble order as the sidebar', () => {
    render(<AdminChannelsSection channels={[
      { id: 7, name: 'Zulu', position: 3 },
      { id: 8, name: 'Bravo', position: 1 },
      { id: 9, name: 'Alpha', position: 1 },
    ]} />);

    expect(screen.getAllByRole('row').map(row => row.getAttribute('aria-label'))).toEqual(['Alpha Position 1', 'Bravo Position 1', 'Zulu Position 3']);
  });

  it('shows each admin channel position in row labels and visible pills', () => {
    render(<AdminChannelsSection channels={[
      { id: 7, name: 'Root' },
      { id: 8, name: 'Raid', position: 12 },
      { id: 9, name: 'No Position', position: undefined },
    ]} />);

    expect(screen.getByRole('row', { name: 'Root Position 0' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: 'Raid Position 12' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: 'No Position Position 0' })).toBeInTheDocument();
    expect(screen.getAllByText('Position 0')).toHaveLength(2);
    expect(screen.getByText('Position 12')).toBeInTheDocument();
  });

  it('opens admin channel actions from a right-click context menu', () => {
    render(<AdminChannelsSection channels={liveChannels} />);

    fireEvent.contextMenu(screen.getByRole('row', { name: 'General Position 2' }));

    expect(screen.getByTestId('admin-channel-menu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Channel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Permissions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Channel' })).toBeInTheDocument();
    expect(within(screen.getByTestId('admin-channel-menu')).queryByRole('button', { name: 'Create Channel' })).not.toBeInTheDocument();
  });

  it('sends edited channel position through the admin edit action', () => {
    render(<AdminChannelsSection channels={[{ id: 7, name: 'General', position: 3 }]} />);

    fireEvent.contextMenu(screen.getByRole('row', { name: 'General Position 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Channel' }));

    expect(screen.getByText('position enabled')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save Admin Edit Channel' }));

    expect(vi.mocked(bridge.send)).toHaveBeenCalledWith('admin.updateChannel', {
      channelId: 7,
      name: 'General',
      description: 'Updated',
      position: 12,
    });
  });
});
