import { useEffect, useState, type ComponentProps } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import bridge from './bridge';
import { paintApi } from './api/paint';
import { ChatPanel } from './components/ChatPanel/ChatPanel';
import { PaintSessionSetupModal } from './components/Paint/PaintSessionSetupModal';
import { PaintSessionView } from './components/Paint/PaintSessionView';
import { VerticalSplitPane } from './components/VerticalSplitPane/VerticalSplitPane';
import type { ChatMessage } from './types';
import type { PaintSessionSnapshot, PaintSessionStatus } from './types/paint';

const paint = vi.hoisted(() => ({
  createSession: vi.fn(), attachSource: vi.fn(), getSnapshot: vi.fn(), getSummary: vi.fn(), join: vi.fn(), end: vi.fn(),
}));

type TestBridge = typeof bridge & {
  __emit: (event: string, data: unknown) => void;
  __reset: () => void;
};
type PaintFlowMatrixClient =
  ComponentProps<typeof PaintSessionSetupModal>['matrixClient']
  & NonNullable<ComponentProps<typeof PaintSessionView>['matrixClient']>;
type PaintFlowMatrixClientMock = PaintFlowMatrixClient & {
  getMediaConfig: ReturnType<typeof vi.fn>;
  joinRoom: ReturnType<typeof vi.fn>;
  uploadContent: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  getRoom: ReturnType<typeof vi.fn>;
};

vi.mock('./bridge', () => {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  return { default: {
    on: vi.fn((event: string, handler: (data: unknown) => void) => (handlers.get(event) ?? handlers.set(event, new Set()).get(event)!).add(handler)),
    off: vi.fn((event: string, handler: (data: unknown) => void) => handlers.get(event)?.delete(handler)),
    __emit: (event: string, data: unknown) => handlers.get(event)?.forEach(handler => handler(data)),
    __reset: () => handlers.clear(),
  } };
});

vi.mock('./api/paint', () => ({ paintApi: paint }));

vi.mock('./components/Paint/PaintEditor', () => ({
  PaintEditor: ({ snapshot, previews, onSave }: { snapshot: PaintSessionSnapshot; previews: unknown[]; onSave: (blob: Blob) => Promise<void> }) => {
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const save = async () => {
      if (saving) return;
      setSaving(true);
      setError(null);
      try {
        await onSave(new Blob(['png'], { type: 'image/png' }));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Unable to save');
      } finally {
        setSaving(false);
      }
    };
    return <section>
      <output data-testid="stroke-count">{snapshot.strokes.length}</output>
      <output data-testid="preview-count">{previews.length}</output>
      {error && <p role="alert">{error}</p>}
      <button onClick={() => void save()} disabled={saving}>{saving ? 'Saving...' : 'Save to chat'}</button>
    </section>;
  },
}));

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  class IntersectionObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);
  vi.stubGlobal('Image', class {
    src = '';
    naturalWidth = 1280;
    naturalHeight = 720;
    decode = vi.fn().mockResolvedValue(undefined);
  });
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

const initial: PaintSessionSnapshot = {
  sessionId: 'session-1', channelId: 5, hostUserId: 7, status: 'active', expiresAt: '',
  source: { mimeType: 'image/png', width: 1, height: 1, sizeBytes: 1 },
  participants: [], strokes: [], generation: 0, revision: 1, currentUserId: 7, isHost: true,
};

type VoiceUser = {
  session: number;
  name: string;
  channelId?: number;
  self?: boolean;
};

function PaintFlowApp({ matrixClient, initialUsers = [{ session: 7, name: 'Alice', channelId: 5, self: true }] }: { matrixClient: PaintFlowMatrixClientMock; initialUsers?: VoiceUser[] }) {
  const [setup, setSetup] = useState(false); const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [users, setUsers] = useState<VoiceUser[]>(initialUsers);
  const [paintSessionStatuses, setPaintSessionStatuses] = useState<Record<string, PaintSessionStatus>>({});

  useEffect(() => {
    const onMessage = (data: unknown) => {
      const event = data as { channelId?: string; message?: ChatMessage };
      if (event.channelId === '5' && event.message) setMessages(prev => [...prev, event.message!]);
    };
    const onUserJoined = (data: unknown) => {
      const user = data as VoiceUser;
      setUsers(prev => prev.some(existing => existing.session === user.session)
        ? prev.map(existing => existing.session === user.session ? { ...existing, ...user } : existing)
        : [...prev, user]);
    };
    const onPaintStatus = (data: unknown) => {
      const event = data as { sessionId?: string; status?: PaintSessionStatus };
      if (event.sessionId && event.status) {
        setPaintSessionStatuses(prev => ({ ...prev, [event.sessionId!]: event.status! }));
      }
    };
    const onConnectionStatus = (data: unknown) => {
      const event = data as { status?: 'connected' | 'reconnecting' };
      if (event.status) {
        if (event.status !== 'connected') setSessionId(null);
      }
    };
    bridge.on('matrix.message', onMessage);
    bridge.on('userJoined', onUserJoined);
    bridge.on('paint.sessionEnded', onPaintStatus);
    bridge.on('paint.sessionExpired', onPaintStatus);
    bridge.on('paint.sessionUnavailable', onPaintStatus);
    bridge.on('connection.statusChanged', onConnectionStatus);
    return () => {
      bridge.off('matrix.message', onMessage);
      bridge.off('userJoined', onUserJoined);
      bridge.off('paint.sessionEnded', onPaintStatus);
      bridge.off('paint.sessionExpired', onPaintStatus);
      bridge.off('paint.sessionUnavailable', onPaintStatus);
      bridge.off('connection.statusChanged', onConnectionStatus);
    };
  }, []);

  const currentUserId = users.find(user => user.self)?.session;

  return <><header><button onClick={() => setSetup(true)}>Start paint</button></header>
    {setup && <PaintSessionSetupModal channelId={5} channelRoomId="!channel:test" paintApi={paintApi} matrixClient={matrixClient} onComplete={id => { setSessionId(id); setSetup(false); }} />}
    <VerticalSplitPane
      top={sessionId ? <PaintSessionView sessionId={sessionId} matrixClient={matrixClient} channelRoomMap={{ '5': '!channel:test' }} onClose={() => setSessionId(null)} /> : null}
      storageKey="paint-flow-split"
      label="Resize paint and channel chat"
    >
      <ChatPanel
        channelId="5"
        channelName="Paint"
        messages={messages}
        currentUsername="Alice"
        onSendMessage={vi.fn()}
        matrixClient={matrixClient}
        users={users}
        currentUserId={currentUserId}
        paintSessionStatuses={paintSessionStatuses}
        onJoinPaint={async id => { await paintApi.join(id); }}
        onOpenPaint={id => setSessionId(id)}
      />
    </VerticalSplitPane>
  </>;
}

function fakeMatrixClient() {
  return {
    getMediaConfig: vi.fn().mockResolvedValue({}),
    joinRoom: vi.fn(),
    uploadContent: vi.fn().mockResolvedValue({ content_uri: 'mxc://test/image' }),
    sendMessage: vi.fn().mockResolvedValue({ event_id: '$source' }),
    getRoom: vi.fn((): { timeline: unknown[] } => ({ timeline: [] })),
  } as unknown as PaintFlowMatrixClientMock;
}

function paintInvitationMessage(content: string): ChatMessage {
  return {
    id: '$paint-invite',
    channelId: '5',
    sender: 'Alice',
    content,
    timestamp: new Date(),
  };
}

async function renderPaintInvitationMessage(content: string) {
  await act(async () => {
    (bridge as TestBridge).__emit('matrix.message', {
      channelId: '5',
      message: paintInvitationMessage(content),
    });
  });
}

async function openActivePaintSession(user: ReturnType<typeof userEvent.setup>, matrixClient: ReturnType<typeof fakeMatrixClient>) {
  paint.createSession.mockResolvedValue({ sessionId: 'session-1', channelId: 5 });
  paint.getSnapshot.mockResolvedValue(initial);

  await user.click(screen.getByRole('button', { name: 'Start paint' }));
  await user.upload(screen.getByLabelText('Source image'), new File(['source'], 'source.png', { type: 'image/png' }));
  expect(await screen.findByText('source.png')).toBeInTheDocument();
  await user.click(within(screen.getByRole('dialog', { name: 'Start collaborative paint' })).getByRole('button', { name: 'Start paint' }));
  expect(await screen.findByLabelText('Collaborative paint')).toBeInTheDocument();

  matrixClient.uploadContent.mockClear();
  matrixClient.sendMessage.mockClear();
  paint.end.mockClear();
}

describe('collaborative paint app flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (bridge as TestBridge).__reset();
    paint.getSummary.mockResolvedValue({
      sessionId: 'session-1',
      channelId: 5,
      hostUserId: 7,
      status: 'active',
      canJoin: true,
      isParticipant: false,
    });
  });

  it('opens setup, attaches after creation, applies events, refreshes gaps, and saves only the committed canvas', async () => {
    const user = userEvent.setup();
    const matrixClient = fakeMatrixClient();
    paint.createSession.mockResolvedValue({ sessionId: 'session-1', channelId: 5 });
    paint.getSnapshot.mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, revision: 4, strokes: [{ id: 'stroke-1', correlationId: 'c', authorUserId: 7, authorMatrixUserId: '@host:test', sequence: 1, generation: 0, tool: 'pen', color: '#EF4444', width: 6, points: [{ x: .1, y: .2 }], active: true }] });
    render(<PaintFlowApp matrixClient={matrixClient} />);

    await user.click(screen.getByRole('button', { name: 'Start paint' }));
    await user.upload(screen.getByLabelText('Source image'), new File(['source'], 'source.png', { type: 'image/png' }));
    expect(await screen.findByText('source.png')).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog', { name: 'Start collaborative paint' })).getByRole('button', { name: 'Start paint' }));
    await act(async () => {
      (bridge as TestBridge).__emit('paint.previewUpdated', { sessionId: 'session-1', generation: 0, authorUserId: 2, authorMatrixUserId: '@bob:test', input: { correlationId: 'preview', generation: 0, tool: 'pen', color: '#000000', width: 2, points: [{ x: 0, y: 0 }] } });
      (bridge as TestBridge).__emit('paint.strokeCommitted', { sessionId: 'session-1', revision: 2, generation: 0, stroke: { id: 'stroke-1', correlationId: 'commit', authorUserId: 7, authorMatrixUserId: '@host:test', sequence: 1, generation: 0, tool: 'pen', color: '#EF4444', width: 6, points: [{ x: .1, y: .2 }], active: true } });
    });
    await waitFor(() => expect(screen.getByTestId('stroke-count')).toHaveTextContent('1'));
    expect(screen.getByTestId('preview-count')).toHaveTextContent('1');

    await act(async () => { (bridge as TestBridge).__emit('paint.strokeUndone', { sessionId: 'session-1', revision: 4, generation: 0, undoneStrokeId: 'stroke-1' }); });
    await waitFor(() => expect(paint.getSnapshot).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'Save to chat' }));
    await waitFor(() => expect(matrixClient.sendMessage).toHaveBeenLastCalledWith(
      '!channel:test',
      expect.objectContaining({ msgtype: 'm.image', body: 'collaborative-paint.png' }),
      'brmble-paint-save-session-1-save-session-1',
    ));
    const savedMessage = matrixClient.sendMessage.mock.calls.at(-1)?.[1];
    expect(savedMessage).toBeDefined();
    expect(savedMessage).not.toHaveProperty('previews');
  });

  it('posts the final image before ending, closing, and returning to chat', async () => {
    const user = userEvent.setup();
    const matrixClient = fakeMatrixClient();
    render(<PaintFlowApp matrixClient={matrixClient} />);
    await openActivePaintSession(user, matrixClient);
    let resolvePost!: (value: { event_id: string }) => void;
    matrixClient.uploadContent.mockReset().mockResolvedValue({ content_uri: 'mxc://test/final' });
    matrixClient.sendMessage.mockReset().mockImplementation(() =>
      new Promise<{ event_id: string }>(resolve => { resolvePost = resolve; }));
    paint.end.mockReset().mockResolvedValue(undefined);

    const saveButton = screen.getByRole('button', { name: 'Save to chat' });
    await user.click(saveButton);
    await waitFor(() => expect(matrixClient.sendMessage).toHaveBeenCalledTimes(1));
    await user.click(saveButton);
    expect(matrixClient.sendMessage).toHaveBeenCalledTimes(1);
    resolvePost({ event_id: '$final' });

    await waitFor(() => expect(screen.queryByLabelText('Collaborative paint')).toBeNull());
    expect(matrixClient.uploadContent).toHaveBeenCalledTimes(1);
    expect(matrixClient.sendMessage).toHaveBeenCalledWith(
      '!channel:test',
      expect.objectContaining({
        msgtype: 'm.image',
        body: 'collaborative-paint.png',
        url: 'mxc://test/final',
        'org.brmble.paintSaveOperationId': 'save-session-1',
      }),
      'brmble-paint-save-session-1-save-session-1',
    );
    expect(paint.end).toHaveBeenCalledWith('session-1');
    expect(screen.queryByLabelText('Collaborative paint')).toBeNull();
    expect(matrixClient.sendMessage.mock.invocationCallOrder[0]).toBeLessThan(paint.end.mock.invocationCallOrder[0]);
  });

  it('does not end or close when chat posting fails after upload', async () => {
    const user = userEvent.setup();
    const matrixClient = fakeMatrixClient();
    render(<PaintFlowApp matrixClient={matrixClient} />);
    await openActivePaintSession(user, matrixClient);
    matrixClient.uploadContent.mockReset().mockResolvedValue({ content_uri: 'mxc://test/final' });
    matrixClient.sendMessage.mockReset().mockRejectedValueOnce(new Error('Chat post failed'));

    await user.click(screen.getByRole('button', { name: 'Save to chat' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Chat post failed');
    expect(paint.end).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Collaborative paint')).toBeInTheDocument();
  });

  it('reuses the same frozen file when retrying a failed upload', async () => {
    const user = userEvent.setup();
    const matrixClient = fakeMatrixClient();
    render(<PaintFlowApp matrixClient={matrixClient} />);
    await openActivePaintSession(user, matrixClient);
    matrixClient.uploadContent.mockReset()
      .mockRejectedValueOnce(new Error('Upload failed'))
      .mockResolvedValueOnce({ content_uri: 'mxc://test/final' });
    matrixClient.sendMessage.mockReset().mockResolvedValue({ event_id: '$final' });
    paint.end.mockReset().mockResolvedValue(undefined);

    await user.click(screen.getByRole('button', { name: 'Save to chat' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Upload failed');
    await user.click(screen.getByRole('button', { name: 'Save to chat' }));

    await waitFor(() => expect(screen.queryByLabelText('Collaborative paint')).toBeNull());
    expect(matrixClient.uploadContent).toHaveBeenCalledTimes(2);
    expect(matrixClient.uploadContent.mock.calls[1][0]).toBe(matrixClient.uploadContent.mock.calls[0][0]);
    expect(matrixClient.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('does not post a second image when ending fails after a confirmed chat post', async () => {
    const user = userEvent.setup();
    const matrixClient = fakeMatrixClient();
    render(<PaintFlowApp matrixClient={matrixClient} />);
    await openActivePaintSession(user, matrixClient);
    matrixClient.uploadContent.mockReset().mockResolvedValue({ content_uri: 'mxc://test/final' });
    matrixClient.sendMessage.mockReset().mockResolvedValue({ event_id: '$final' });
    paint.end.mockReset().mockRejectedValueOnce(new Error('End failed')).mockResolvedValueOnce(undefined);

    await user.click(screen.getByRole('button', { name: 'Save to chat' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('End failed');
    await user.click(screen.getByRole('button', { name: 'Save to chat' }));

    await waitFor(() => expect(screen.queryByLabelText('Collaborative paint')).toBeNull());
    expect(matrixClient.uploadContent).toHaveBeenCalledTimes(1);
    expect(matrixClient.sendMessage).toHaveBeenCalledTimes(1);
    expect(paint.end).toHaveBeenCalledTimes(2);
  });

  it('closes without reposting when a lost end response is confirmed by the terminal snapshot', async () => {
    const user = userEvent.setup();
    const matrixClient = fakeMatrixClient();
    render(<PaintFlowApp matrixClient={matrixClient} />);
    await openActivePaintSession(user, matrixClient);
    matrixClient.uploadContent.mockReset().mockResolvedValue({ content_uri: 'mxc://test/final' });
    matrixClient.sendMessage.mockReset().mockResolvedValue({ event_id: '$final' });
    paint.end.mockReset().mockRejectedValueOnce(new Error('Request timed out'));
    paint.getSnapshot.mockReset().mockResolvedValue({ ...initial, status: 'ended', revision: 2 });

    await user.click(screen.getByRole('button', { name: 'Save to chat' }));

    await waitFor(() => expect(screen.queryByLabelText('Collaborative paint')).toBeNull());
    expect(matrixClient.uploadContent).toHaveBeenCalledTimes(1);
    expect(matrixClient.sendMessage).toHaveBeenCalledTimes(1);
    expect(paint.end).toHaveBeenCalledTimes(1);
    expect(paint.getSnapshot).toHaveBeenCalledWith('session-1');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reuses the same Matrix transaction id and metadata when retrying a timed-out chat post', async () => {
    const user = userEvent.setup();
    const matrixClient = fakeMatrixClient();
    render(<PaintFlowApp matrixClient={matrixClient} />);
    await openActivePaintSession(user, matrixClient);
    matrixClient.uploadContent.mockReset().mockResolvedValue({ content_uri: 'mxc://test/final' });
    matrixClient.sendMessage.mockReset()
      .mockRejectedValueOnce(new Error('Request timed out'))
      .mockResolvedValueOnce({ event_id: '$final' });
    paint.end.mockReset().mockResolvedValue(undefined);

    await user.click(screen.getByRole('button', { name: 'Save to chat' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Request timed out');
    await user.click(screen.getByRole('button', { name: 'Save to chat' }));

    await waitFor(() => expect(screen.queryByLabelText('Collaborative paint')).toBeNull());
    expect(matrixClient.uploadContent).toHaveBeenCalledTimes(1);
    expect(matrixClient.sendMessage).toHaveBeenCalledTimes(2);
    expect(matrixClient.sendMessage.mock.calls[1][1]).toEqual(matrixClient.sendMessage.mock.calls[0][1]);
    expect(matrixClient.sendMessage.mock.calls[0][2]).toBe('brmble-paint-save-session-1-save-session-1');
    expect(matrixClient.sendMessage.mock.calls[1][2]).toBe('brmble-paint-save-session-1-save-session-1');
  });

  it('does not send a second Matrix message when a previous timed-out post is found in the room timeline', async () => {
    const user = userEvent.setup();
    const acceptedEvent = {
      getType: () => 'm.room.message',
      getId: () => '$final',
      getContent: () => ({ msgtype: 'm.image', url: 'mxc://test/final', info: { size: 3 }, 'org.brmble.paintSaveOperationId': 'save-session-1' }),
    };
    const room = { timeline: [] as typeof acceptedEvent[] };
    const matrixClient = fakeMatrixClient();
    matrixClient.getRoom.mockImplementation(() => room);
    render(<PaintFlowApp matrixClient={matrixClient} />);
    await openActivePaintSession(user, matrixClient);
    matrixClient.uploadContent.mockReset().mockResolvedValue({ content_uri: 'mxc://test/final' });
    matrixClient.sendMessage.mockReset().mockRejectedValueOnce(new Error('Request timed out'));
    paint.end.mockReset().mockResolvedValue(undefined);

    await user.click(screen.getByRole('button', { name: 'Save to chat' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Request timed out');
    room.timeline = [acceptedEvent];
    await user.click(screen.getByRole('button', { name: 'Save to chat' }));

    await waitFor(() => expect(screen.queryByLabelText('Collaborative paint')).toBeNull());
    expect(matrixClient.sendMessage).toHaveBeenCalledTimes(1);
    expect(paint.end).toHaveBeenCalledWith('session-1');
  });

  it('updates invitation cards when paint terminal events arrive through the app bridge', async () => {
    const matrixClient = fakeMatrixClient();
    render(<PaintFlowApp matrixClient={matrixClient} />);
    await renderPaintInvitationMessage('[brmble-paint]{"version":2,"sessionId":"session-1","channelId":5,"status":"active"}');

    expect(await screen.findByRole('button', { name: 'Join paint' })).toBeEnabled();

    await act(async () => {
      (bridge as TestBridge).__emit('paint.sessionEnded', { sessionId: 'session-1', status: 'ended', revision: 2, generation: 0 });
    });

    expect(screen.queryByRole('button', { name: 'Join paint' })).toBeNull();
    expect(screen.getByText('Session has ended')).toBeInTheDocument();
  });

  it('keeps chat mounted and opens paint when joining after reconnect', async () => {
    const user = userEvent.setup();
    const matrixClient = fakeMatrixClient();
    paint.getSummary
      .mockResolvedValueOnce({
        sessionId: 'session-1',
        channelId: 5,
        hostUserId: 7,
        status: 'active',
        canJoin: true,
        isParticipant: false,
      })
      .mockResolvedValueOnce({
        sessionId: 'session-1',
        channelId: 5,
        hostUserId: 7,
        status: 'active',
        canJoin: true,
        isParticipant: true,
      });
    paint.join.mockResolvedValue(undefined);
    paint.getSnapshot.mockResolvedValue({
      ...initial,
      currentUserId: 8,
      isHost: false,
    });
    render(<PaintFlowApp matrixClient={matrixClient} initialUsers={[{ session: 8, name: 'Bob', channelId: 5, self: true }]} />);
    await renderPaintInvitationMessage('[brmble-paint]{"version":2,"sessionId":"session-1","channelId":5,"status":"active"}');
    const composer = screen.getByPlaceholderText('Message #Paint');
    await user.type(composer, 'draft survives');

    await user.click(screen.getByRole('button', { name: 'Join paint' }));

    expect(paint.join).toHaveBeenCalledWith('session-1');
    expect(await screen.findByLabelText('Collaborative paint')).toBeInTheDocument();
    expect(composer).toHaveValue('draft survives');
    expect(screen.getByPlaceholderText('Message #Paint')).toBe(composer);
    expect(composer).toHaveValue('draft survives');

    await act(async () => {
      (bridge as TestBridge).__emit('connection.statusChanged', { status: 'reconnecting' });
    });
    await waitFor(() => expect(screen.queryByLabelText('Collaborative paint')).toBeNull());
    await act(async () => {
      (bridge as TestBridge).__emit('connection.statusChanged', { status: 'connected' });
    });

    expect(screen.queryByLabelText('Collaborative paint')).toBeNull();
    expect(screen.getByPlaceholderText('Message #Paint')).toBe(composer);
    expect(composer).toHaveValue('draft survives');
  });
});
