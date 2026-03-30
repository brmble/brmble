import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatStore, addMessageToStore, purgeEphemeralMessages, flushPendingWrites } from './useChatStore';

const STORAGE_KEY = 'brmble_chat_server-root';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  // Flush any leftover bgBuffer from previous tests
  flushPendingWrites('server-root');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useChatStore systemType', () => {
  it('stores systemType on messages added via addMessage', () => {
    const { result } = renderHook(() => useChatStore('server-root'));

    act(() => {
      result.current.addMessage('Server', 'Alice connected', 'system', false, undefined, 'userJoined');
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].systemType).toBe('userJoined');
  });

  it('stores systemType via addMessageToStore', () => {
    addMessageToStore('server-root', 'Server', 'Bob left', 'system', false, undefined, 'userLeft');

    // Flush debounce
    vi.advanceTimersByTime(600);

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toHaveLength(1);
    expect(stored[0].systemType).toBe('userLeft');
  });
});

describe('useChatStore hard cap (server-root)', () => {
  it('trims oldest messages when exceeding 200 via addMessage', () => {
    const { result } = renderHook(() => useChatStore('server-root'));

    act(() => {
      for (let i = 0; i < 210; i++) {
        result.current.addMessage('Server', `msg-${i}`, 'system', false, undefined, 'userJoined');
      }
    });

    expect(result.current.messages).toHaveLength(200);
    // Oldest messages trimmed — first message should be msg-10
    expect(result.current.messages[0].content).toBe('msg-10');
    expect(result.current.messages[199].content).toBe('msg-209');
  });

  it('does NOT cap non-server-root channels', () => {
    const { result } = renderHook(() => useChatStore('channel-5'));

    act(() => {
      for (let i = 0; i < 210; i++) {
        result.current.addMessage('User', `msg-${i}`);
      }
    });

    expect(result.current.messages).toHaveLength(210);
  });

  it('trims oldest messages when exceeding 200 via addMessageToStore', () => {
    // Pre-fill with 195 messages
    const existing = Array.from({ length: 195 }, (_, i) => ({
      id: `id-${i}`,
      channelId: 'server-root',
      sender: 'Server',
      content: `old-${i}`,
      timestamp: new Date().toISOString(),
      type: 'system',
      systemType: 'userJoined',
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));

    // Add 10 more (total 205 > 200)
    for (let i = 0; i < 10; i++) {
      addMessageToStore('server-root', 'Server', `new-${i}`, 'system', false, undefined, 'userLeft');
    }

    // Flush debounce
    vi.advanceTimersByTime(600);

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toHaveLength(200);
    // Oldest should have been trimmed
    expect(stored[0].content).toBe('old-5');
  });
});

describe('purgeEphemeralMessages', () => {
  it('removes ephemeral messages and keeps persistent ones', () => {
    const messages = [
      { id: '1', channelId: 'server-root', sender: 'Server', content: 'Connecting...', timestamp: new Date().toISOString(), type: 'system', systemType: 'connecting' },
      { id: '2', channelId: 'server-root', sender: 'Server', content: 'Welcome!', timestamp: new Date().toISOString(), type: 'system', systemType: 'welcome' },
      { id: '3', channelId: 'server-root', sender: 'Server', content: 'Alice joined', timestamp: new Date().toISOString(), type: 'system', systemType: 'userJoined' },
      { id: '4', channelId: 'server-root', sender: 'Server', content: 'You were kicked', timestamp: new Date().toISOString(), type: 'system', systemType: 'kicked' },
      { id: '5', channelId: 'server-root', sender: 'User', content: 'Hello', timestamp: new Date().toISOString() },
      { id: '6', channelId: 'server-root', sender: 'Server', content: 'Bob left', timestamp: new Date().toISOString(), type: 'system', systemType: 'userLeft' },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));

    purgeEphemeralMessages('server-root');

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toHaveLength(2);
    expect(stored[0].content).toBe('You were kicked');
    expect(stored[1].content).toBe('Hello');
  });

  it('purges legacy server messages without systemType', () => {
    const messages = [
      { id: '1', channelId: 'server-root', sender: 'Server', content: 'Alice disconnected from the server', timestamp: new Date().toISOString(), type: 'system' },
      { id: '2', channelId: 'server-root', sender: 'Server', content: 'Bob connected to the server', timestamp: new Date().toISOString(), type: 'system' },
      { id: '3', channelId: 'server-root', sender: 'User', content: 'Hello everyone', timestamp: new Date().toISOString() },
      { id: '4', channelId: 'server-root', sender: 'Server', content: 'You were kicked', timestamp: new Date().toISOString(), type: 'system', systemType: 'kicked' },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));

    purgeEphemeralMessages('server-root');

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toHaveLength(2);
    expect(stored[0].content).toBe('Hello everyone');
    expect(stored[1].content).toBe('You were kicked');
  });

  it('handles empty localStorage gracefully', () => {
    purgeEphemeralMessages('server-root');
    // Should not throw
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('flushes debounce buffer before purging', () => {
    // Add a message via background store (debounced)
    addMessageToStore('server-root', 'Server', 'Alice joined', 'system', false, undefined, 'userJoined');
    // Also add a persistent message
    addMessageToStore('server-root', 'Server', 'You were banned', 'system', false, undefined, 'banned');

    // Don't advance timers — buffer is not flushed yet
    // Purge should flush first, then purge ephemeral
    purgeEphemeralMessages('server-root');

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toHaveLength(1);
    expect(stored[0].content).toBe('You were banned');
  });
});

describe('debounced localStorage writes', () => {
  it('does not write to localStorage immediately for server-root', () => {
    const { result } = renderHook(() => useChatStore('server-root'));

    act(() => {
      result.current.addMessage('Server', 'test msg', 'system', false, undefined, 'userJoined');
    });

    // React state updated immediately
    expect(result.current.messages).toHaveLength(1);

    // localStorage not yet written (debounce pending)
    // Either null (never written) or stale (doesn't contain the new message)
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    expect(parsed.find((m: { content: string }) => m.content === 'test msg')).toBeUndefined();
  });

  it('writes to localStorage after debounce period', () => {
    const { result } = renderHook(() => useChatStore('server-root'));

    act(() => {
      result.current.addMessage('Server', 'test msg', 'system', false, undefined, 'userJoined');
    });

    act(() => {
      vi.advanceTimersByTime(600);
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toHaveLength(1);
    expect(stored[0].content).toBe('test msg');
  });

  it('writes immediately for non-server-root channels', () => {
    const { result } = renderHook(() => useChatStore('channel-5'));

    act(() => {
      result.current.addMessage('User', 'hello');
    });

    const stored = JSON.parse(localStorage.getItem('brmble_chat_channel-5')!);
    expect(stored).toHaveLength(1);
    expect(stored[0].content).toBe('hello');
  });

  it('flushPendingWrites forces immediate write', () => {
    addMessageToStore('server-root', 'Server', 'msg1', 'system', false, undefined, 'userJoined');
    addMessageToStore('server-root', 'Server', 'msg2', 'system', false, undefined, 'userLeft');

    // Not flushed yet
    flushPendingWrites('server-root');

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toHaveLength(2);
  });
});
