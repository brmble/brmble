import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminSectionPlaceholder } from './AdminSectionPlaceholder';
import { AdminChannelsSection } from './AdminChannelsSection';
import type { Channel } from '../../../types';

const { promptMock } = vi.hoisted(() => ({
  promptMock: vi.fn(),
}));

vi.mock('../../../hooks/usePrompt', () => ({
  prompt: promptMock,
}));

const liveChannels: Channel[] = [
  { id: 7, name: 'General' },
  { id: 9, name: 'Raid Planning', parent: 7 },
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
    expect(screen.getByRole('button', { name: 'Delete Channel' })).toBeInTheDocument();
  });

  it('renders inline approve and deny actions for each channel request row', () => {
    render(<AdminChannelsSection channels={liveChannels} />);

    expect(screen.getByRole('button', { name: 'Approve Mike request' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny Mike request' })).toBeInTheDocument();
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
});
