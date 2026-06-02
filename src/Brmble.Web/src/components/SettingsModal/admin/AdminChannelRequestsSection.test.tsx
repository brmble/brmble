import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { approveChannelRequest, listAdminChannelRequests } from '../../../api/channelRequests';
import { confirm, prompt } from '../../../hooks/usePrompt';
import { AdminChannelRequestsSection } from './AdminChannelRequestsSection';

vi.mock('../../../api/channelRequests', () => ({
  approveChannelRequest: vi.fn().mockResolvedValue({}),
  denyChannelRequest: vi.fn().mockResolvedValue({}),
  listAdminChannelRequests: vi.fn(),
}));

vi.mock('../../../hooks/usePrompt', () => ({
  confirm: vi.fn(),
  prompt: vi.fn(),
}));

describe('AdminChannelRequestsSection', () => {
  it('approves a pending request after confirmation', async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(prompt).mockResolvedValue(null);
    vi.mocked(listAdminChannelRequests).mockResolvedValue([
      {
        id: 1,
        channelName: 'Raid Team 2',
        reason: 'Weekly runs',
        status: 'pending',
        createdAtUtc: '2026-05-27T20:00:00Z',
        handledAtUtc: null,
        decisionReason: null,
        requesterDisplayName: 'Alice',
      },
    ]);

    render(<AdminChannelRequestsSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'Approve Raid Team 2' }));

    await waitFor(() => {
      expect(approveChannelRequest).toHaveBeenCalledWith(1);
    });
  });
});
