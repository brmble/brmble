import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { listMyChannelRequests } from '../../api/channelRequests';
import { MyChannelRequests } from './MyChannelRequests';

vi.mock('../../api/channelRequests', () => ({
  listMyChannelRequests: vi.fn(),
}));

describe('MyChannelRequests', () => {
  it('renders the requester history with status text', async () => {
    vi.mocked(listMyChannelRequests).mockResolvedValue([
      {
        id: 1,
        channelName: 'Raid Team 2',
        reason: 'Weekly runs',
        status: 'denied',
        createdAtUtc: '2026-05-27T20:00:00Z',
        handledAtUtc: '2026-05-28T08:00:00Z',
        decisionReason: 'Duplicate of existing team room',
      },
    ]);

    render(<MyChannelRequests refreshKey={0} connected />);

    expect(await screen.findByText('Raid Team 2')).toBeInTheDocument();
    expect(screen.getByText('Denied')).toBeInTheDocument();
    expect(screen.getByText('Duplicate of existing team room')).toBeInTheDocument();
  });
});
