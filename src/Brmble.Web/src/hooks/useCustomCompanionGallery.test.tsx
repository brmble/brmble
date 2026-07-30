import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import type { MatrixCredentials } from './useMatrixClient';
import { useCustomCompanionGallery } from './useCustomCompanionGallery';
import bridge from '../bridge';

const {
  deleteAtlas,
  ensureAtlas,
  loadThumbnail,
  cancel,
  cancelAll,
  cancelAtlas,
  cancelThumbnail,
} = vi.hoisted(() => ({
  deleteAtlas: vi.fn(),
  ensureAtlas: vi.fn(),
  loadThumbnail: vi.fn(),
  cancel: vi.fn(),
  cancelAll: vi.fn(),
  cancelAtlas: vi.fn(),
  cancelThumbnail: vi.fn(),
}));
vi.mock('../customCompanions/customCompanionAtlasStore', () => ({
  deleteAtlas,
}));

vi.mock('../customCompanions/customCompanionMediaLoader', () => ({
  CustomCompanionMediaLoader: vi.fn(function MockMediaLoader() {
    return { ensureAtlas, loadThumbnail, cancel, cancelAll, cancelAtlas, cancelThumbnail };
  }),
}));

type Handler = (...args: unknown[]) => void;

function event(index: number, overrides: Record<string, unknown> = {}) {
  const raw = {
    type: 'im.brmble.sprite',
    eventId: `$sprite-${index}:test`,
    roomId: '!gallery:test',
    sender: '@brmble:test',
    createdAt: index,
    content: {
      schemaVersion: 1,
      name: `Sprite ${index}`,
      mediaUri: `mxc://test/${index}`,
      mimeType: 'image/png',
      width: 800,
      height: 900,
      frameCount: 1,
      byteSize: 4096,
      uploaderMatrixUserId: '@alice:test',
      uploaderDisplayName: 'Alice',
    },
    ...overrides,
  };
  return {
    ...raw,
    getType: () => raw.type,
    getId: () => raw.eventId,
    getRoomId: () => raw.roomId,
    getSender: () => raw.sender,
    getTs: () => raw.createdAt,
    getContent: () => raw.content,
    getRedacts: () => (raw as { redacts?: string }).redacts,
    isRedacted: () => Boolean((raw as { redacted?: boolean }).redacted),
  };
}

function setupClient(initialEvents = Array.from({ length: 100 }, (_, index) => event(index))) {
  const handlers = new Map<string, Set<Handler>>();
  const room = {
    currentState: {
      getStateEvents: vi.fn(() => initialEvents),
    },
  };
  const client = {
    getRoom: vi.fn<() => typeof room | null>(() => room),
    on: vi.fn((name: string, handler: Handler) => {
      const current = handlers.get(name) ?? new Set();
      current.add(handler);
      handlers.set(name, current);
    }),
    off: vi.fn((name: string, handler: Handler) => handlers.get(name)?.delete(handler)),
    mxcUrlToHttp: vi.fn((uri: string) => `https://matrix.test/${encodeURIComponent(uri)}`),
  };
  return {
    client,
    room,
    emit(name: string, ...args: unknown[]) {
      handlers.get(name)?.forEach(handler => handler(...args));
    },
  };
}

function asMatrixClient(client: ReturnType<typeof setupClient>['client']): MatrixClient {
  return client as unknown as MatrixClient;
}

const credentials: MatrixCredentials = {
  homeserverUrl: 'https://matrix.test',
  accessToken: 'token',
  userId: '@me:test',
  roomMap: {},
  customCompanions: {
    enabled: true,
    schemaVersion: 1,
    galleryRoomId: '!gallery:test',
    trustedSender: '@brmble:test',
    canModerate: true,
    selectedCompanionId: 'floppy',
    maxActivePerUser: 10,
    maxActiveTotal: 100,
  },
};

describe('useCustomCompanionGallery', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => `blob:${blob.size}`),
      revokeObjectURL: vi.fn(),
    });
    deleteAtlas.mockReset().mockResolvedValue(undefined);
    ensureAtlas.mockReset();
    loadThumbnail.mockReset();
    cancel.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as Window & { chrome?: unknown }).chrome;
  });

  it('synchronizes metadata without requesting any media', async () => {
    const { client } = setupClient();
    const { result } = renderHook(() => useCustomCompanionGallery(asMatrixClient(client), credentials));

    await waitFor(() => expect(result.current.entries).toHaveLength(100));
    expect(result.current.status).toBe('ready');
    expect(fetch).not.toHaveBeenCalled();
    expect(ensureAtlas).not.toHaveBeenCalled();
    expect(loadThumbnail).not.toHaveBeenCalled();
  });

  it('re-reads complete current state on sync and converges duplicate delivery', async () => {
    const harness = setupClient([event(1)]);
    const { result } = renderHook(() => useCustomCompanionGallery(asMatrixClient(harness.client), credentials));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    act(() => harness.emit('Room.timeline', event(1), { roomId: '!gallery:test' }));
    expect(result.current.entries).toHaveLength(1);

    harness.room.currentState.getStateEvents.mockReturnValue([event(1), event(2)]);
    act(() => harness.emit('sync', 'SYNCING'));
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps a tombstone for redaction-before-addition', async () => {
    const harness = setupClient([]);
    const { result } = renderHook(() => useCustomCompanionGallery(asMatrixClient(harness.client), credentials));
    await waitFor(() => expect(result.current.status).toBe('empty'));

    act(() => harness.emit('Room.timeline', event(99, {
      type: 'm.room.redaction',
      eventId: '$redaction:test',
      redacts: '$sprite-1:test',
      content: {},
    }), { roomId: '!gallery:test' }));
    act(() => harness.emit('Room.timeline', event(1), { roomId: '!gallery:test' }));

    expect(result.current.entries).toEqual([]);
    expect(result.current.redactedEventIds).toContain('$sprite-1:test');
  });

  it('cancels requests, revokes URLs, and deletes the cached atlas on redaction', async () => {
    const harness = setupClient([event(1)]);
    ensureAtlas.mockResolvedValue(new Blob(['atlas']));
    loadThumbnail.mockResolvedValue(new Blob(['thumb']));
    const { result } = renderHook(() => useCustomCompanionGallery(asMatrixClient(harness.client), credentials));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    await act(async () => {
      await result.current.requestAtlas(result.current.entries[0], new Set());
      await result.current.requestThumbnail(result.current.entries[0]);
    });
    act(() => harness.emit('Room.timeline', event(99, {
      type: 'm.room.redaction',
      eventId: '$redaction:test',
      redacts: '$sprite-1:test',
      content: {},
    }), { roomId: '!gallery:test' }));

    await waitFor(() => expect(deleteAtlas).toHaveBeenCalledWith('!gallery:test\u0000$sprite-1:test'));
    expect(cancel).toHaveBeenCalledWith('!gallery:test\u0000$sprite-1:test');
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('exposes explicit media requests and retries failures only on demand', async () => {
    const harness = setupClient([event(1)]);
    ensureAtlas.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Blob(['atlas']));
    loadThumbnail.mockResolvedValue(new Blob(['thumb']));
    const { result } = renderHook(() => useCustomCompanionGallery(asMatrixClient(harness.client), credentials));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    await expect(result.current.requestAtlas(result.current.entries[0], new Set())).rejects.toThrow('offline');
    expect(ensureAtlas).toHaveBeenCalledTimes(1);
    await expect(result.current.requestAtlas(result.current.entries[0], new Set())).resolves.toBe('blob:5');
    await expect(result.current.requestThumbnail(result.current.entries[0])).resolves.toBe('blob:5');
  });

  it('reports disabled and unavailable states without media requests', async () => {
    const harness = setupClient([]);
    const disabled = renderHook(() => useCustomCompanionGallery(
      asMatrixClient(harness.client),
      { ...credentials, customCompanions: undefined },
    ));
    expect(disabled.result.current.status).toBe('disabled');

    harness.client.getRoom.mockReturnValue(null);
    const unavailable = renderHook(() => useCustomCompanionGallery(asMatrixClient(harness.client), credentials));
    await waitFor(() => expect(unavailable.result.current.status).toBe('unavailable'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('creates gallery metadata through the correlated native bridge request', async () => {
    const harness = setupClient([]);
    const postMessage = vi.fn();
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: { webview: { postMessage } },
    });
    const { result } = renderHook(() => useCustomCompanionGallery(asMatrixClient(harness.client), credentials));
    await waitFor(() => expect(result.current.status).toBe('empty'));

    const pending = result.current.createCompanion('Orbit', 'mxc://test/orbit');
    const sent = postMessage.mock.calls[0][0];
    expect(sent).toMatchObject({
      type: 'companions.request',
      data: { action: 'create', name: 'Orbit', mediaUri: 'mxc://test/orbit' },
    });
    act(() => bridge._handleMessage({ data: {
      type: 'companions.response',
      data: { requestId: sent.data.requestId, success: true, body: '{"eventId":"$sprite:test"}' },
    } }));

    await expect(pending).resolves.toEqual({ eventId: '$sprite:test' });
  });

  it('deletes gallery metadata by event ID through the native bridge', async () => {
    const harness = setupClient([event(1)]);
    const postMessage = vi.fn();
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: { webview: { postMessage } },
    });
    const { result } = renderHook(() => useCustomCompanionGallery(asMatrixClient(harness.client), credentials));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    const pending = result.current.deleteCompanion(result.current.entries[0]);
    const sent = postMessage.mock.calls[0][0];
    expect(sent).toMatchObject({
      type: 'companions.request',
      data: { action: 'delete', eventId: '$sprite-1:test' },
    });
    act(() => bridge._handleMessage({ data: {
      type: 'companions.response',
      data: { requestId: sent.data.requestId, success: true, statusCode: 204 },
    } }));

    await expect(pending).resolves.toBeUndefined();
  });
});
