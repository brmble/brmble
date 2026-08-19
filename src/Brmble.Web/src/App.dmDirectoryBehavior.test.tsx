import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appHarnessMocks,
  overrideComponent,
  renderConnectedApp as renderApp,
  renderDisconnectedApp,
  resetAppHarness,
  type HarnessProps,
} from './testing/appHarness';
import bridge from './bridge';
import type { MediaAttachment } from './types';

const paintSourceMocks = vi.hoisted(() => ({
  prepare: vi.fn(),
}));

vi.mock('./utils/chatImagePaintSource', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('./utils/chatImagePaintSource')
  >();
  return {
    ...actual,
    prepareChatImagePaintSource: paintSourceMocks.prepare,
  };
});

// The shared harness owns every App mock; this suite only needs the recorded props and
// the simplified stubs it has always asserted against.
const mockValues = {
  matrixClient: appHarnessMocks.matrixClient,
  dmStore: appHarnessMocks.dmStore,
  unreadTracker: appHarnessMocks.unreadTracker,
  screenShare: appHarnessMocks.screenShare,
  notificationQueue: appHarnessMocks.notificationQueue,
  notificationQueueIds: appHarnessMocks.notificationQueueIds,
  get headerProps(): HarnessProps | undefined { return appHarnessMocks.captured.get('Header'); },
  get channelChatPanelProps(): HarnessProps | undefined { return appHarnessMocks.captured.get('ChatPanel:channel'); },
  get dmChatPanelProps(): HarnessProps | undefined { return appHarnessMocks.captured.get('ChatPanel:dm'); },
  get dmContactListProps(): HarnessProps | undefined { return appHarnessMocks.captured.get('DMContactList'); },
  get dmStoreOptions(): HarnessProps | undefined { return appHarnessMocks.captured.get('useDMStore'); },
};

function installStubs() {
  overrideComponent('Header', () => <header />);
  overrideComponent('Sidebar', (props: HarnessProps) => (
    <>
      <button type="button" data-testid="sidebar-select-channel" onClick={() => (props.onSelectChannel as ((channelId: number) => void) | undefined)?.(1)} />
      <button type="button" data-testid="sidebar-select-server" onClick={() => (props.onSelectServer as (() => void) | undefined)?.()} />
    </>
  ));
  overrideComponent('ChatPanel', (props: HarnessProps) => (
    <section data-testid={props.isDM ? 'dm-chat-panel' : 'channel-chat-panel'} />
  ));
  overrideComponent('DMContactList', () => null);
}

function renderConnectedApp() {
  return renderApp({
    joinedChannelId: '1',
    channels: [{ id: 1, name: 'General' }],
    users: [],
    matrixRoomMap: {},
  });
}

function renderPaintReadyApp() {
  return renderApp({
    joinedChannelId: '1',
    channels: [{ id: 1, name: 'General' }],
    users: [{ session: 7, name: 'Me', self: true, channelId: 1 }],
    matrixRoomMap: { '1': '!general:example.com' },
  });
}

const sharedImage: MediaAttachment = {
  type: 'image',
  url: 'https://matrix.example/shared.png',
  filename: 'shared.png',
  mimetype: 'image/png',
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe('DM route Matrix isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paintSourceMocks.prepare.mockReset();
    mockValues.notificationQueueIds.clear();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn().mockReturnValue('blob:setup-preview'),
      revokeObjectURL: vi.fn(),
    });
    localStorage.clear();
    resetAppHarness();
    installStubs();
    mockValues.matrixClient.dmRoomMap.clear();
    mockValues.dmStore.selectedContact = null;
    mockValues.dmStore.messages = [];
    mockValues.screenShare.isSharing = false;
    mockValues.screenShare.remoteWatchCount = 0;
    mockValues.screenShare.pendingViewerShares = [];
    mockValues.screenShare.watchingShares = [];
    mockValues.screenShare.focusedShare = null;
    mockValues.screenShare.remoteVideoEls = new Map();
    mockValues.screenShare.roomQuality = undefined;
    mockValues.screenShare.shareQualities = new Map();
    mockValues.screenShare.viewerQualities = new Map();
    mockValues.unreadTracker.totalDmUnreadCount = 0;
    mockValues.unreadTracker.roomUnreads = new Map();
    mockValues.unreadTracker.getRoomUnread.mockReturnValue({ notificationCount: 0, highlightCount: 0, fullyReadEventId: null });
    mockValues.unreadTracker.getMarkerTimestamp.mockReturnValue(null);
    mockValues.matrixClient.client.getRoom.mockReturnValue(undefined);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('offers chat-image paint setup only on the normal channel panel', async () => {
    renderPaintReadyApp();

    await waitFor(() => {
      expect(mockValues.channelChatPanelProps
        ?.onUseAsPaintBackground).toEqual(expect.any(Function));
    });

    act(() => {
      (mockValues.dmContactListProps?.onSelectContact as (id: string) => void)('@val:example.com');
    });

    await waitFor(() => expect(mockValues.dmChatPanelProps).toBeDefined());
    expect(mockValues.dmChatPanelProps)
      .not.toHaveProperty('onUseAsPaintBackground');
  });

  it('withholds the chat-image action while a paint session is active', async () => {
    renderPaintReadyApp();

    await waitFor(() => {
      expect(mockValues.channelChatPanelProps
        ?.onUseAsPaintBackground).toEqual(expect.any(Function));
    });
    const staleAction = mockValues.channelChatPanelProps
      ?.onUseAsPaintBackground as (attachment: MediaAttachment) => Promise<void>;

    act(() => {
      (mockValues.channelChatPanelProps?.onOpenPaint as (sessionId: string) => void)(
        'active-paint-session',
      );
    });

    await waitFor(() => {
      expect(mockValues.channelChatPanelProps)
        .not.toHaveProperty('onUseAsPaintBackground');
    });

    act(() => {
      void staleAction(sharedImage);
    });

    expect(screen.queryByRole('dialog', {
      name: 'Use image as paint background?',
    })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', {
      name: 'Start collaborative paint',
    })).not.toBeInTheDocument();
  });

  it('does nothing when the user chooses No', async () => {
    const user = userEvent.setup();
    renderPaintReadyApp();
    const channelChat = screen.getByTestId('channel-chat-panel');

    await act(async () => {
      void (mockValues.channelChatPanelProps
        ?.onUseAsPaintBackground as (
          attachment: MediaAttachment,
        ) => Promise<void>)(sharedImage);
    });

    expect(await screen.findByRole('dialog', {
      name: 'Use image as paint background?',
    })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', {
      name: 'Start collaborative paint',
    })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'No' }));

    expect(paintSourceMocks.prepare).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', {
      name: 'Start collaborative paint',
    })).not.toBeInTheDocument();
    expect(screen.getByTestId('channel-chat-panel')).toBe(channelChat);
  });

  it('prepares after Yes and opens setup with the exact chat image', async () => {
    const user = userEvent.setup();
    const prepared = new File(
      ['prepared'],
      'shared.png',
      { type: 'image/png' },
    );
    paintSourceMocks.prepare.mockResolvedValue(prepared);
    renderPaintReadyApp();

    await act(async () => {
      void (mockValues.channelChatPanelProps
        ?.onUseAsPaintBackground as (
          attachment: MediaAttachment,
        ) => Promise<void>)(sharedImage);
    });

    await user.click(await screen.findByRole('button', {
      name: 'Yes',
    }));

    expect(paintSourceMocks.prepare).toHaveBeenCalledWith(sharedImage);
    expect(await screen.findByRole('dialog', {
      name: 'Start collaborative paint',
    })).toBeInTheDocument();
    expect(screen.getByText('shared.png')).toBeInTheDocument();
  });

  it('shows a retryable error and leaves setup closed when preparation fails', async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    paintSourceMocks.prepare.mockRejectedValue(
      new Error('download failed'),
    );
    renderPaintReadyApp();

    await act(async () => {
      void (mockValues.channelChatPanelProps
        ?.onUseAsPaintBackground as (
          attachment: MediaAttachment,
        ) => Promise<void>)(sharedImage);
    });
    await user.click(await screen.findByRole('button', {
      name: 'Yes',
    }));

    expect(await screen.findByRole('alert'))
      .toHaveTextContent('Paint background unavailable');
    expect(screen.getByRole('alert')).toHaveTextContent(
      "This image couldn't be prepared. Try again from the chat image.",
    );
    expect(screen.queryByRole('dialog', {
      name: 'Start collaborative paint',
    })).not.toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(
      '[Paint] Failed to prepare chat image background:',
      expect.any(Error),
    );
    expect(mockValues.notificationQueue.register)
      .toHaveBeenCalledWith('paint-background-error', 'error');

    paintSourceMocks.prepare.mockResolvedValue(
      new File(['prepared'], 'shared.png', { type: 'image/png' }),
    );
    await act(async () => {
      void (mockValues.channelChatPanelProps
        ?.onUseAsPaintBackground as (
          attachment: MediaAttachment,
        ) => Promise<void>)(sharedImage);
    });
    await user.click(await screen.findByRole('button', {
      name: 'Yes',
    }));

    expect(await screen.findByRole('dialog', {
      name: 'Start collaborative paint',
    })).toBeInTheDocument();
  });

  it('does not reopen setup when a chat-image preparation succeeds after newer header setup is cancelled', async () => {
    const user = userEvent.setup();
    const pending = createDeferred<File>();
    paintSourceMocks.prepare.mockReturnValue(pending.promise);
    renderPaintReadyApp();

    act(() => {
      void (mockValues.channelChatPanelProps
        ?.onUseAsPaintBackground as (attachment: MediaAttachment) => Promise<void>)(
        sharedImage,
      );
    });
    await user.click(await screen.findByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(paintSourceMocks.prepare).toHaveBeenCalledWith(sharedImage));

    act(() => {
      (mockValues.headerProps?.onStartPaint as () => void)();
    });
    expect(await screen.findByRole('dialog', {
      name: 'Start collaborative paint',
    })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', {
      name: 'Start collaborative paint',
    })).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve(new File(['prepared'], 'shared.png', { type: 'image/png' }));
      await pending.promise;
    });

    expect(screen.queryByRole('dialog', {
      name: 'Start collaborative paint',
    })).not.toBeInTheDocument();
  });

  it('does not report a stale chat-image preparation failure after newer header setup', async () => {
    const user = userEvent.setup();
    const pending = createDeferred<File>();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    paintSourceMocks.prepare.mockReturnValue(pending.promise);
    renderPaintReadyApp();

    act(() => {
      void (mockValues.channelChatPanelProps
        ?.onUseAsPaintBackground as (attachment: MediaAttachment) => Promise<void>)(
        sharedImage,
      );
    });
    await user.click(await screen.findByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(paintSourceMocks.prepare).toHaveBeenCalledWith(sharedImage));

    act(() => {
      (mockValues.headerProps?.onStartPaint as () => void)();
    });

    await act(async () => {
      pending.reject(new Error('download failed'));
      await pending.promise.catch(() => undefined);
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalledWith(
      '[Paint] Failed to prepare chat image background:',
      expect.any(Error),
    );
  });

  it('omits Matrix state from an online Mumble DM route', () => {
    mockValues.dmStore.selectedContact = { id: 'cert-val', displayName: 'Vanilla Val', unreadCount: 0, isEphemeral: true, mumbleSessionId: 42 };
    renderConnectedApp();

    act(() => {
      (mockValues.dmContactListProps?.onSelectContact as (id: string) => void)('cert-val');
    });

    expect(mockValues.matrixClient.setActiveDmContact).toHaveBeenLastCalledWith(null);
    expect(mockValues.dmChatPanelProps).toEqual(expect.objectContaining({
      channelId: 'dm-cert-val', channelName: 'Vanilla Val', matrixClient: null, matrixRoomId: null, readMarkerTs: null,
      disabled: false, topNotice: 'This is a Mumble direct message. Chat history will be lost when you disconnect.',
      typingIndicatorText: undefined, typingTargetId: undefined, onTypingStart: undefined, onTypingStop: undefined,
      onToggleReaction: undefined, currentUserMatrixId: undefined,
    }));
  });

  it('keeps an offline Mumble DM route separate from Matrix state', () => {
    mockValues.dmStore.selectedContact = { id: 'cert-val', displayName: 'Vanilla Val', unreadCount: 0, isEphemeral: true, mumbleSessionId: null };
    renderConnectedApp();

    act(() => {
      (mockValues.dmContactListProps?.onSelectContact as (id: string) => void)('cert-val');
    });

    expect(mockValues.dmChatPanelProps).toEqual(expect.objectContaining({
      channelId: 'dm-cert-val', matrixClient: null, matrixRoomId: null, disabled: true, typingTargetId: undefined,
    }));
  });

  it('preserves Matrix props for a Matrix DM route', () => {
    mockValues.dmStore.selectedContact = { id: '@val:example.com', displayName: 'Vanilla Val', unreadCount: 0 };
    mockValues.matrixClient.dmRoomMap.set('@val:example.com', '!val:example.com');
    renderConnectedApp();

    act(() => {
      (mockValues.dmContactListProps?.onSelectContact as (id: string) => void)('@val:example.com');
    });

    expect(mockValues.matrixClient.setActiveDmContact).toHaveBeenLastCalledWith('@val:example.com');
    expect(mockValues.dmChatPanelProps).toEqual(expect.objectContaining({
      channelId: 'dm-@val:example.com', channelName: 'Vanilla Val', matrixClient: mockValues.matrixClient.client,
      matrixRoomId: '!val:example.com', topNotice: undefined, typingTargetId: '@val:example.com',
      onTypingStart: mockValues.matrixClient.startTyping, onTypingStop: mockValues.matrixClient.stopTyping,
      onToggleReaction: expect.any(Function), currentUserMatrixId: '@me:example.com',
    }));
  });

  it('reports an unread foreground only when the workspace and selected contact match', () => {
    mockValues.dmStore.selectedContact = { id: '@val:example.com', displayName: 'Vanilla Val', unreadCount: 0 };

    renderConnectedApp();

    expect((mockValues.dmStoreOptions?.isSelectedConversationForeground as () => boolean)()).toBe(false);
  });

  it('does not expose stale selected DM messages when no DM is foreground', () => {
    mockValues.dmStore.selectedContact = null;
    mockValues.dmStore.messages = [{
      id: 'stale',
      channelId: 'dm-stale',
      sender: 'Val',
      content: 'stale',
      timestamp: new Date(),
    }];

    renderConnectedApp();

    // With one tab-driven ChatPanel there is no DM panel at all while a channel is
    // active, so stale DM messages have nowhere to leak to.
    expect(mockValues.dmChatPanelProps).toBeUndefined();
    expect(screen.queryByTestId('dm-chat-panel')).not.toBeInTheDocument();
  });

  it('requests channel chat access when the active non-root channel is missing from roomMap', async () => {
    renderDisconnectedApp();

    act(() => {
      (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('brmble.serviceStatus', {
        service: 'server',
        state: 'connected',
      });
      (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('server.credentials', {
        matrix: { homeserverUrl: 'https://example.com', accessToken: 'token', userId: '@me:example.com', roomMap: {} },
      });
      (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('voice.connected', {
        username: 'Me',
        channelId: 2,
        channels: [{ id: 2, name: 'Gaming' }],
        users: [{ session: 7, name: 'Me', self: true, channelId: 2 }],
      });
    });

    await waitFor(() => {
      expect(vi.mocked(bridge.send).mock.calls.some(([type, payload]) =>
        type === 'chat.getChannelAccess'
        && (payload as { channelIds?: number[] } | undefined)
          ?.channelIds?.includes(2))).toBe(true);
    });
  });

  it('routes DMContactList visibility through the shared Messages panel toggle', () => {
    renderConnectedApp();

    expect(mockValues.dmContactListProps?.onToggleVisibility).toBe(mockValues.headerProps?.onToggleDM);
  });

  it('resets the Messages panel when reconnecting', async () => {
    renderConnectedApp();
    act(() => {
      (mockValues.headerProps?.onToggleDM as () => void)();
      (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('voice.disconnected', { reconnectAvailable: true });
    });

    await waitFor(() => expect(mockValues.headerProps?.dmActive).toBe(false));

    act(() => {
      (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('voice.connected', { username: 'Me', channelId: 0, users: [] });
    });

    await waitFor(() => expect(mockValues.headerProps?.dmActive).toBe(true));
  });

  it('returns to channel chat and clears Matrix DM routing after reconnecting with a retained selection', async () => {
    mockValues.dmStore.selectedContact = { id: '@val:example.com', displayName: 'Vanilla Val', unreadCount: 0 };
    mockValues.matrixClient.dmRoomMap.set('@val:example.com', '!val:example.com');
    renderConnectedApp();

    act(() => {
      (mockValues.dmContactListProps?.onSelectContact as (id: string) => void)('@val:example.com');
    });
    expect(mockValues.matrixClient.setActiveDmContact).toHaveBeenLastCalledWith('@val:example.com');

    act(() => {
      (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('voice.disconnected', { reconnectAvailable: true });
    });
    await waitFor(() => expect(screen.queryByTestId('channel-chat-panel')).not.toBeInTheDocument());

    act(() => {
      (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('voice.connected', { username: 'Me', channelId: 0, users: [] });
    });

    await waitFor(() => expect(mockValues.matrixClient.setActiveDmContact).toHaveBeenLastCalledWith(null));
    expect(screen.queryByTestId('dm-chat-panel')).not.toBeInTheDocument();
  });

  it('lands on channel chat after connecting', async () => {
    renderConnectedApp();

    expect(screen.getByTestId('channel-chat-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('dm-chat-panel')).not.toBeInTheDocument();
    await waitFor(() => expect(mockValues.matrixClient.setActiveChannel).toHaveBeenCalledWith(null));
  });

  it('keeps a selected DM foreground while remote watches start and end', async () => {
    mockValues.dmStore.selectedContact = { id: '@val:example.com', displayName: 'Vanilla Val', unreadCount: 0 };
    const view = renderConnectedApp();

    act(() => {
      (mockValues.dmContactListProps?.onSelectContact as (id: string) => void)('@val:example.com');
    });

    await waitFor(() => expect(screen.getByTestId('dm-chat-panel')).toBeInTheDocument());

    mockValues.screenShare.remoteWatchCount = 1;
    view.rerenderApp();
    await waitFor(() => {
      expect(screen.getByTestId('dm-chat-panel')).toBeInTheDocument();
    });

    mockValues.screenShare.remoteWatchCount = 0;
    view.rerenderApp();
    await waitFor(() => {
      expect(screen.getByTestId('dm-chat-panel')).toBeInTheDocument();
    });
  });

  it('falls back to the channel foreground when a selected conversation closes during a remote watch', async () => {
    mockValues.dmStore.selectedContact = { id: '@val:example.com', displayName: 'Vanilla Val', unreadCount: 0 };
    const view = renderConnectedApp();

    act(() => {
      (mockValues.dmContactListProps?.onSelectContact as (id: string) => void)('@val:example.com');
    });
    await waitFor(() => expect(screen.getByTestId('dm-chat-panel')).toBeInTheDocument());

    mockValues.screenShare.remoteWatchCount = 1;
    view.rerenderApp();

    act(() => {
      (mockValues.dmContactListProps?.onCloseConversation as (id: string) => void)('@val:example.com');
    });

    expect(mockValues.dmStore.closeDM).toHaveBeenCalledWith('@val:example.com');
    expect(screen.queryByTestId('dm-chat-panel')).not.toBeInTheDocument();
  });

  it('updates the unread DM badge without leaving the foreground channel', async () => {
    const view = renderConnectedApp();

    act(() => view.getByTestId('sidebar-select-channel').click());
    await waitFor(() => expect(screen.queryByTestId('dm-chat-panel')).not.toBeInTheDocument());
    mockValues.unreadTracker.totalDmUnreadCount = 3;
    view.rerenderApp();

    await waitFor(() => expect(mockValues.headerProps?.unreadDMCount).toBe(3));
    expect(screen.queryByTestId('dm-chat-panel')).not.toBeInTheDocument();
  });

  it('does not mark a selected Matrix DM as read when a channel is in the foreground', async () => {
    mockValues.dmStore.selectedContact = { id: '@val:example.com', displayName: 'Vanilla Val', unreadCount: 0 };
    mockValues.matrixClient.dmRoomMap.set('@val:example.com', '!val:example.com');
    mockValues.matrixClient.client.getRoom.mockReturnValue({
      getLiveTimeline: () => ({
        getEvents: () => [{ getId: () => '$latest-dm-event' }],
      }),
    });
    const view = renderConnectedApp();

    act(() => {
      (mockValues.dmContactListProps?.onSelectContact as (id: string) => void)('@val:example.com');
    });
    await waitFor(() => expect(screen.getByTestId('dm-chat-panel')).toBeInTheDocument());
    mockValues.unreadTracker.markRoomRead.mockClear();

    act(() => view.getByTestId('sidebar-select-channel').click());
    await waitFor(() => expect(screen.queryByTestId('dm-chat-panel')).not.toBeInTheDocument());

    mockValues.unreadTracker.roomUnreads = new Map([['!val:example.com', { notificationCount: 1 }]]);
    mockValues.unreadTracker.getRoomUnread.mockReturnValue({ notificationCount: 1, highlightCount: 0, fullyReadEventId: null });
    mockValues.unreadTracker.getMarkerTimestamp.mockReturnValue(1234);
    view.rerenderApp();

    await waitFor(() => expect(mockValues.headerProps?.dmActive).toBe(true));
    expect(mockValues.unreadTracker.markRoomRead).not.toHaveBeenCalledWith('!val:example.com', '$latest-dm-event');
  });

  it('keeps active remote watches connected when selecting channel chat or server chat', async () => {
    const view = renderConnectedApp();
    mockValues.screenShare.remoteWatchCount = 1;
    view.rerenderApp();
    mockValues.screenShare.disconnectViewer.mockClear();

    act(() => view.getByTestId('sidebar-select-channel').click());
    act(() => view.getByTestId('sidebar-select-server').click());

    expect(mockValues.screenShare.disconnectViewer).not.toHaveBeenCalled();
  });

  it.each([
    ['server list', () => {
      (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('cert.status', { exists: true });
    }],
    ['onboarding', () => {
      (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('cert.status', { exists: false });
    }],
    ['disconnected', () => {
      (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('voice.connected', {
        username: 'Me', channelId: 1, channels: [{ id: 1, name: 'General' }], users: [],
      });
      (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('voice.disconnected', { reconnectAvailable: true });
    }],
  ])('does not reserve Messages panel space on the %s screen', async (_label, enterScreen) => {
    renderDisconnectedApp();

    act(() => enterScreen());

    await waitFor(() => {
      expect(document.querySelector('.workspace-conversation')).not.toHaveClass('workspace-conversation--with-panel');
    });
    expect(mockValues.dmContactListProps).toBeUndefined();
  });
});
