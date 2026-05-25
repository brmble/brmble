import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminSectionPlaceholder } from './AdminSectionPlaceholder';
import { AdminChannelsSection } from './AdminChannelsSection';
import type { Channel } from '../../../types';
import bridge from '../../../bridge';

const { promptMock } = vi.hoisted(() => ({
  promptMock: vi.fn(),
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
  AclEditorDialog: () => <div data-testid="admin-acl-editor" />,
}));

vi.mock('../../../bridge', () => ({
  default: {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

const liveChannels: Channel[] = [
  { id: 7, name: 'General', position: 2 },
  { id: 9, name: 'Raid Planning', parent: 7, position: 1 },
];

describe('Admin workspace sections', () => {
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
    expect(screen.queryByRole('button', { name: 'Delete Channel' })).not.toBeInTheDocument();
  });

  it('renders inline approve and deny actions for each channel request row', () => {
    render(<AdminChannelsSection channels={liveChannels} />);

    expect(screen.getByRole('button', { name: 'Approve Mike request' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny Mike request' })).toBeInTheDocument();
  });

  it('opens a typed confirmation before deleting the selected channel', async () => {
    promptMock.mockResolvedValue('General');
    render(<AdminChannelsSection channels={liveChannels} />);

    fireEvent.contextMenu(screen.getByRole('row', { name: /General/i }));
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
    expect(screen.getByText('Create Channel is not available yet. Right-click a channel for admin actions.')).toBeInTheDocument();
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

    expect(screen.getAllByRole('row').map(row => row.getAttribute('aria-label'))).toEqual(['Alpha', 'Bravo', 'Zulu']);
  });

  it('opens admin channel actions from a right-click context menu', () => {
    render(<AdminChannelsSection channels={liveChannels} />);

    fireEvent.contextMenu(screen.getByRole('row', { name: 'General' }));

    expect(screen.getByTestId('admin-channel-menu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Channel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Permissions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Channel' })).toBeInTheDocument();
    expect(within(screen.getByTestId('admin-channel-menu')).queryByRole('button', { name: 'Create Channel' })).not.toBeInTheDocument();
  });

  it('sends edited channel position through the admin edit action', () => {
    render(<AdminChannelsSection channels={[{ id: 7, name: 'General', position: 3 }]} />);

    fireEvent.contextMenu(screen.getByRole('row', { name: 'General' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Channel' }));

    expect(screen.getByText('position enabled')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save Admin Edit Channel' }));

    expect(vi.mocked(bridge.send)).toHaveBeenCalledWith('voice.editChannel', {
      channelId: 7,
      name: 'General',
      description: 'Updated',
      position: 12,
    });
  });
});
