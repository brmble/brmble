import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaintSessionView } from './PaintSessionView';
import { paintApi } from '../../api/paint';

const { endMock, getSnapshotMock } = vi.hoisted(() => ({
  endMock: vi.fn(),
  getSnapshotMock: vi.fn(),
}));

vi.mock('../../api/paint', () => ({
  paintApi: {
    end: endMock,
    getSnapshot: getSnapshotMock,
  },
}));

vi.mock('./PaintEditor', () => ({
  PaintEditor: ({ onSave }: { onSave?: (png: Blob) => Promise<void> }) => (
    <button type="button" onClick={() => void onSave?.(new Blob([Uint8Array.from([1, 2, 3])], { type: 'image/png' }))}>
      Save from editor
    </button>
  ),
}));

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

const activeSnapshot = (sessionId = 'session-1') => ({
  ...terminalSnapshot('active'),
  sessionId,
  status: 'active',
  source: { mimeType: 'image/png', width: 1, height: 1, sizeBytes: 1 },
  expiresAt: '',
});

describe('PaintSessionView', () => {
  beforeEach(() => {
    refresh.mockReset().mockResolvedValue(undefined);
    endMock.mockReset().mockResolvedValue(undefined);
    getSnapshotMock.mockReset();
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

  it('closes paint when the local user leaves the session voice channel', async () => {
    sessionState = { snapshot: { ...activeSnapshot(), channelId: 5 }, previews: [], error: null };
    const onClose = vi.fn();
    const { rerender } = render(<PaintSessionView sessionId="session-1" currentVoiceChannelId={5} matrixClient={null} channelRoomMap={{ '5': '!chat:test' }} onClose={onClose} />);

    rerender(<PaintSessionView sessionId="session-1" currentVoiceChannelId={12} matrixClient={null} channelRoomMap={{ '5': '!chat:test' }} onClose={onClose} />);

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('closes paint when the local user has confirmed absence from voice', async () => {
    sessionState = { snapshot: { ...activeSnapshot(), channelId: 5 }, previews: [], error: null };
    const onClose = vi.fn();
    render(<PaintSessionView sessionId="session-1" currentVoiceChannelId={null} matrixClient={null} channelRoomMap={{ '5': '!chat:test' }} onClose={onClose} />);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('does not close paint while local voice membership is unknown', async () => {
    sessionState = { snapshot: { ...activeSnapshot(), channelId: 5 }, previews: [], error: null };
    const onClose = vi.fn();
    render(<PaintSessionView sessionId="session-1" currentVoiceChannelId={undefined} matrixClient={null} channelRoomMap={{ '5': '!chat:test' }} onClose={onClose} />);
    await Promise.resolve();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('uploads only the composed finished image to the normal channel before ending the session', async () => {
    sessionState = { snapshot: activeSnapshot('s1'), previews: [], error: null };
    const uploadContent = vi.fn().mockResolvedValue({ content_uri: 'mxc://test/final' });
    const sendMessage = vi.fn().mockResolvedValue({ event_id: '$final' });
    const getRoom = vi.fn().mockReturnValue({ timeline: [] });
    const onClose = vi.fn();

    render(
      <PaintSessionView
        sessionId="s1"
        matrixClient={{ uploadContent, sendMessage, getRoom } as never}
        channelRoomMap={{ '5': '!channel:test' }}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save from editor' }));

    await waitFor(() => {
      expect(uploadContent).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith(
        '!channel:test',
        expect.objectContaining({
          msgtype: 'm.image',
          url: 'mxc://test/final',
          info: expect.objectContaining({ mimetype: 'image/png', size: 3 }),
        }),
        expect.any(String),
      );
      expect(paintApi.end).toHaveBeenCalledWith('s1');
    });

    expect(getRoom).toHaveBeenCalledWith('!channel:test');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
