import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PaintSessionCard } from './PaintSessionCard';
import type { PaintSessionSummary } from '../../types/paint';

const activeSession = {
  sessionId: 'session-1',
  status: 'active' as const,
  hostUserId: 1,
  participantUserIds: [2],
  channelId: 5,
};

const summary = (overrides: Partial<PaintSessionSummary> = {}): PaintSessionSummary => ({
  sessionId: 'session-1',
  channelId: 5,
  hostUserId: 1,
  status: 'active',
  canJoin: true,
  isParticipant: false,
  ...overrides,
});

describe('PaintSessionCard', () => {
  it('does not show join until the summary confirms an active session', async () => {
    let resolveSummary!: (value: PaintSessionSummary) => void;
    const getSummary = vi.fn(() => new Promise<PaintSessionSummary>(resolve => { resolveSummary = resolve; }));

    render(<PaintSessionCard session={activeSession} getSummary={getSummary} onJoin={vi.fn()} onOpen={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /join/i })).toBeNull();
    await act(async () => resolveSummary(summary()));
    expect(await screen.findByRole('button', { name: 'Join paint' })).toBeEnabled();
  });

  it('uses the current session status instead of stale invitation metadata', async () => {
    render(<PaintSessionCard session={activeSession} getSummary={vi.fn().mockResolvedValue(summary({ status: 'ended', canJoin: false }))} onJoin={vi.fn()} onOpen={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Session has ended')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /join/i })).toBeNull();
  });

  it('joins an eligible session, refreshes summary, and does not open paint', async () => {
    const onJoin = vi.fn().mockResolvedValue(undefined);
    const onOpen = vi.fn();
    const getSummary = vi.fn()
      .mockResolvedValueOnce(summary())
      .mockResolvedValueOnce(summary({ isParticipant: true }));

    render(<PaintSessionCard session={activeSession} getSummary={getSummary} onJoin={onJoin} onOpen={onOpen} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Join paint' }));

    await waitFor(() => expect(getSummary).toHaveBeenCalledTimes(2));
    expect(onJoin).toHaveBeenCalledWith('session-1');
    expect(onOpen).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Open paint' })).toBeEnabled();
  });

  it('opens paint only from the participant action', async () => {
    const onOpen = vi.fn();
    render(<PaintSessionCard session={activeSession} getSummary={vi.fn().mockResolvedValue(summary({ isParticipant: true }))} onJoin={vi.fn()} onOpen={onOpen} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open paint' }));

    expect(onOpen).toHaveBeenCalledWith('session-1');
  });

  it('removes Join paint and shows ended copy for ended sessions', async () => {
    render(<PaintSessionCard session={activeSession} getSummary={vi.fn().mockResolvedValue(summary({ status: 'ended', canJoin: false }))} onJoin={vi.fn()} onOpen={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Session has ended')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Join paint' })).toBeNull();
  });

  it('removes Join paint and shows expired copy for expired sessions', async () => {
    render(<PaintSessionCard session={activeSession} getSummary={vi.fn().mockResolvedValue(summary({ status: 'expired', canJoin: false }))} onJoin={vi.fn()} onOpen={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Session has expired')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Join paint' })).toBeNull();
  });

  it('removes Join paint and shows unavailable copy when the summary request fails', async () => {
    render(<PaintSessionCard session={activeSession} getSummary={vi.fn().mockRejectedValue(new Error('gone'))} onJoin={vi.fn()} onOpen={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Session is unavailable')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Join paint' })).toBeNull();
  });

  it('removes Join paint and shows unavailable copy for unavailable live status', async () => {
    const getSummary = vi.fn(() => new Promise<PaintSessionSummary>(() => {}));

    render(<PaintSessionCard session={activeSession} getSummary={getSummary} onJoin={vi.fn()} onOpen={vi.fn()} liveStatus="unavailable" />);

    await waitFor(() => expect(screen.getByText('Session is unavailable')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Join paint' })).toBeNull();
  });

  it('keeps a participant session reopenable when a stale unavailable live status arrives', async () => {
    const onOpen = vi.fn();

    render(<PaintSessionCard session={activeSession} getSummary={vi.fn().mockResolvedValue(summary({ isParticipant: true }))} onJoin={vi.fn()} onOpen={onOpen} liveStatus="unavailable" />);

    const open = await screen.findByRole('button', { name: 'Open paint' });
    expect(screen.getByText('Session is available')).toBeInTheDocument();
    fireEvent.click(open);

    expect(onOpen).toHaveBeenCalledWith('session-1');
  });

  it('keeps an active invite joinable when a stale unavailable live status arrives', async () => {
    render(<PaintSessionCard session={activeSession} getSummary={vi.fn().mockResolvedValue(summary())} onJoin={vi.fn()} onOpen={vi.fn()} liveStatus="unavailable" />);

    expect(await screen.findByRole('button', { name: 'Join paint' })).toBeEnabled();
    expect(screen.getByText('Session is available')).toBeInTheDocument();
  });

  it('updates when parent receives a newer live status', async () => {
    const getSummary = vi.fn().mockResolvedValue(summary());
    const { rerender } = render(<PaintSessionCard session={activeSession} getSummary={getSummary} onJoin={vi.fn()} onOpen={vi.fn()} liveStatus="active" />);

    expect(await screen.findByRole('button', { name: 'Join paint' })).toBeEnabled();

    rerender(<PaintSessionCard session={activeSession} getSummary={getSummary} onJoin={vi.fn()} onOpen={vi.fn()} liveStatus="ended" />);

    expect(screen.queryByRole('button', { name: 'Join paint' })).toBeNull();
    expect(screen.getByText('Session has ended')).toBeInTheDocument();
  });

  it('does not show Join paint for unauthorized viewers', async () => {
    render(<PaintSessionCard session={activeSession} getSummary={vi.fn().mockResolvedValue(summary({ canJoin: false }))} onJoin={vi.fn()} onOpen={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Not available to you')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Join paint' })).toBeNull();
  });

  it('shows Join paint again when reconnect removes participation', async () => {
    render(<PaintSessionCard session={activeSession} getSummary={vi.fn().mockResolvedValue(summary({ isParticipant: false }))} onJoin={vi.fn()} onOpen={vi.fn()} liveStatus="active" />);

    expect(await screen.findByRole('button', { name: 'Join paint' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Open paint' })).toBeNull();
  });
});
