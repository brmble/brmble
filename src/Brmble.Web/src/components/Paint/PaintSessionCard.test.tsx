import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PaintSessionCard } from './PaintSessionCard';

const activeSession = {
  sessionId: 'session-1',
  status: 'active' as const,
  hostUserId: 1,
  participantUserIds: [2],
  channelId: 5,
};

describe('PaintSessionCard', () => {
  it('does not show join until the live snapshot confirms an active session', async () => {
    let resolveSnapshot!: (snapshot: { status: 'active' }) => void;
    const getSnapshot = vi.fn(() => new Promise<{ status: 'active' }>(resolve => { resolveSnapshot = resolve; }));
    render(<PaintSessionCard session={activeSession} canJoin onJoin={vi.fn()} getSnapshot={getSnapshot} />);

    expect(screen.queryByRole('button', { name: /join/i })).toBeNull();
    resolveSnapshot({ status: 'active' });
    expect(await screen.findByRole('button', { name: /join/i })).toBeEnabled();
  });

  it('uses the current session status instead of stale invitation metadata', async () => {
    const getSnapshot = vi.fn().mockResolvedValue({ status: 'ended' });
    render(<PaintSessionCard session={activeSession} canJoin onJoin={vi.fn()} getSnapshot={getSnapshot} />);

    await waitFor(() => expect(screen.getByText('Session has ended')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /join/i })).toBeNull();
  });

  it('shows Join paint for an eligible active session after live snapshot loads', async () => {
    const onJoin = vi.fn();

    render(<PaintSessionCard session={activeSession} canJoin onJoin={onJoin} getSnapshot={vi.fn().mockResolvedValue({ status: 'active' })} />);

    const button = await screen.findByRole('button', { name: 'Join paint' });
    fireEvent.click(button);
    expect(onJoin).toHaveBeenCalledTimes(1);
  });

  it('removes Join paint and shows ended copy for ended sessions', async () => {
    render(<PaintSessionCard session={activeSession} canJoin onJoin={vi.fn()} getSnapshot={vi.fn().mockResolvedValue({ status: 'ended' })} />);

    await waitFor(() => expect(screen.getByText('Session has ended')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Join paint' })).toBeNull();
  });

  it('removes Join paint and shows expired copy for expired sessions', async () => {
    render(<PaintSessionCard session={activeSession} canJoin onJoin={vi.fn()} getSnapshot={vi.fn().mockResolvedValue({ status: 'expired' })} />);

    await waitFor(() => expect(screen.getByText('Session has expired')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Join paint' })).toBeNull();
  });

  it('removes Join paint and shows unavailable copy when the snapshot request fails', async () => {
    render(<PaintSessionCard session={activeSession} canJoin onJoin={vi.fn()} getSnapshot={vi.fn().mockRejectedValue(new Error('gone'))} />);

    await waitFor(() => expect(screen.getByText('Session is unavailable')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Join paint' })).toBeNull();
  });

  it('removes Join paint and shows unavailable copy for unavailable live status', async () => {
    render(<PaintSessionCard session={activeSession} canJoin onJoin={vi.fn()} getSnapshot={vi.fn().mockResolvedValue({ status: 'active' })} liveStatus="unavailable" />);

    await waitFor(() => expect(screen.getByText('Session is unavailable')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Join paint' })).toBeNull();
  });

  it('updates when parent receives a newer live status', async () => {
    const getSnapshot = vi.fn().mockResolvedValue({ status: 'active' });
    const { rerender } = render(<PaintSessionCard session={activeSession} canJoin onJoin={vi.fn()} getSnapshot={getSnapshot} liveStatus="active" />);

    expect(await screen.findByRole('button', { name: 'Join paint' })).toBeEnabled();

    rerender(<PaintSessionCard session={activeSession} canJoin onJoin={vi.fn()} getSnapshot={getSnapshot} liveStatus="ended" />);

    expect(screen.queryByRole('button', { name: 'Join paint' })).toBeNull();
    expect(screen.getByText('Session has ended')).toBeInTheDocument();
  });

  it('does not show Join paint for unauthorized viewers', async () => {
    render(<PaintSessionCard session={activeSession} canJoin={false} onJoin={vi.fn()} getSnapshot={vi.fn().mockResolvedValue({ status: 'active' })} />);

    await waitFor(() => expect(screen.getByText('Not available to you')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Join paint' })).toBeNull();
  });
});
