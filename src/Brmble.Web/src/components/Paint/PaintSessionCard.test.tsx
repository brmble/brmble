import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PaintSessionCard } from './PaintSessionCard';

describe('PaintSessionCard', () => {
  it('does not show join until the live snapshot confirms an active session', async () => {
    let resolveSnapshot!: (snapshot: { status: 'active' }) => void;
    const getSnapshot = vi.fn(() => new Promise<{ status: 'active' }>(resolve => { resolveSnapshot = resolve; }));
    render(<PaintSessionCard session={{ sessionId: 'session-1', status: 'active', hostUserId: 1, participantUserIds: [2], channelId: 5 }} canJoin onJoin={vi.fn()} getSnapshot={getSnapshot} />);

    expect(screen.queryByRole('button', { name: /join/i })).toBeNull();
    resolveSnapshot({ status: 'active' });
    expect(await screen.findByRole('button', { name: /join/i })).toBeEnabled();
  });

  it('uses the current session status instead of stale invitation metadata', async () => {
    const getSnapshot = vi.fn().mockResolvedValue({ status: 'ended' });
    render(<PaintSessionCard session={{ sessionId: 'session-1', status: 'active', hostUserId: 1, participantUserIds: [2], channelId: 5 }} canJoin onJoin={vi.fn()} getSnapshot={getSnapshot} />);

    await waitFor(() => expect(screen.getByText('Session ended')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /join/i })).toBeNull();
  });
});
