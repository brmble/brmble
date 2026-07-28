import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaintSessionView } from './PaintSessionView';

const refresh = vi.fn();
let sessionState: { snapshot: unknown; previews: unknown[]; error: Error | null } = {
  snapshot: null,
  previews: [],
  error: new Error('Snapshot unavailable'),
};

vi.mock('../../hooks/usePaintSession', () => ({
  usePaintSession: () => ({ ...sessionState, refresh }),
}));

const terminalSnapshot = (status: string) => ({
  sessionId: 'session-1',
  channelId: status === 'unavailable' ? 0 : 5,
  matrixRoomId: '!paint:test',
  hostUserId: 7,
  currentUserId: 8,
  isHost: false,
  status,
  generation: 1,
  revision: 1,
  source: null,
  participants: [],
  strokes: [],
});

describe('PaintSessionView', () => {
  beforeEach(() => {
    refresh.mockReset().mockResolvedValue(undefined);
    sessionState = { snapshot: null, previews: [], error: new Error('Snapshot unavailable') };
  });

  it('shows an initial snapshot failure with a retry action', () => {
    render(<PaintSessionView sessionId="session-1" matrixClient={null} channelRoomMap={undefined} onClose={vi.fn()} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Snapshot unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('keeps the retry failure in the hook state without leaking a rejected click promise', async () => {
    refresh.mockRejectedValueOnce(new Error('Still unavailable'));
    render(<PaintSessionView sessionId="session-1" matrixClient={null} channelRoomMap={undefined} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await Promise.resolve();

    expect(refresh).toHaveBeenCalledOnce();
  });

  it.each([
    ['ended', 'This paint session has ended.'],
    ['expired', 'This paint session expired after inactivity.'],
    ['unavailable', 'You no longer have access to this paint session.'],
  ])('replaces the editor with a reason when the session is %s', (status, reason) => {
    // A terminal session must not keep a live canvas: every stroke would be rejected by the
    // server and roll back, one error banner at a time.
    sessionState = { snapshot: terminalSnapshot(status), previews: [], error: null };
    const onClose = vi.fn();

    render(<PaintSessionView sessionId="session-1" matrixClient={null} channelRoomMap={{ '5': '!chat:test' }} onClose={onClose} />);

    expect(screen.getByRole('alert')).toHaveTextContent(reason);
    expect(screen.queryByRole('img', { name: /paint/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close paint' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('reports lost access rather than a missing chat channel for an unavailable session', () => {
    // The synthesised unavailable snapshot carries channelId 0, which has no room mapping, so
    // the terminal check must run before the channel-room check.
    sessionState = { snapshot: terminalSnapshot('unavailable'), previews: [], error: null };

    render(<PaintSessionView sessionId="session-1" matrixClient={null} channelRoomMap={{ '5': '!chat:test' }} onClose={vi.fn()} />);

    expect(screen.queryByText(/chat channel is unavailable/)).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('You no longer have access');
  });
});
