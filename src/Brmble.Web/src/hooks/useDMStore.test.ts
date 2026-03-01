import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDMStore } from './useDMStore';

// Polyfill localStorage for Node 22+ where built-in localStorage lacks standard API
const storageMap = new Map<string, string>();
const storageMock: Storage = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, value: string) => { storageMap.set(key, value); },
  removeItem: (key: string) => { storageMap.delete(key); },
  clear: () => { storageMap.clear(); },
  get length() { return storageMap.size; },
  key: (index: number) => [...storageMap.keys()][index] ?? null,
};
Object.defineProperty(globalThis, 'localStorage', { value: storageMock, writable: true });

// Mock bridge
const mockBridge = {
  send: vi.fn(),
};

// Mock Matrix functions
const mockSendMatrixDM = vi.fn().mockResolvedValue(undefined);
const mockFetchDMHistory = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  storageMap.clear();
});

const defaultProps = {
  bridge: mockBridge as any,
  users: [],
  username: 'TestUser',
  sendMatrixDM: mockSendMatrixDM,
  fetchDMHistory: mockFetchDMHistory,
};

describe('useDMStore', () => {
  it('initializes with channels mode and no selection', () => {
    const { result } = renderHook(() => useDMStore(defaultProps));
    expect(result.current.appMode).toBe('channels');
    expect(result.current.selectedDMUserId).toBeNull();
    expect(result.current.dmContacts).toEqual([]);
  });

  it('toggleDMMode switches between channels and dm', () => {
    const { result } = renderHook(() => useDMStore(defaultProps));
    act(() => result.current.toggleDMMode());
    expect(result.current.appMode).toBe('dm');
    act(() => result.current.toggleDMMode());
    expect(result.current.appMode).toBe('channels');
  });

  it('selectDM sets selected user, switches to dm mode, creates contact', () => {
    const { result } = renderHook(() => useDMStore(defaultProps));
    act(() => result.current.selectDM('5', 'Alice'));
    expect(result.current.selectedDMUserId).toBe('5');
    expect(result.current.selectedDMUserName).toBe('Alice');
    expect(result.current.appMode).toBe('dm');
    expect(result.current.dmContacts.some(c => c.userId === '5')).toBe(true);
  });

  it('selectDM clears unread for that contact', () => {
    const { result } = renderHook(() => useDMStore(defaultProps));
    // Receive a DM first to create unread
    act(() => result.current.receiveDM(5, 'Alice', 'hello'));
    expect(result.current.dmContacts.find(c => c.userId === '5')?.unread).toBe(1);
    // Select that DM
    act(() => result.current.selectDM('5', 'Alice'));
    expect(result.current.dmContacts.find(c => c.userId === '5')?.unread).toBe(0);
  });

  it('sendDM to Mumble-only user sends via bridge', () => {
    const users = [{ session: 5, name: 'MumbleUser', self: false }];
    const { result } = renderHook(() => useDMStore({ ...defaultProps, users: users as any }));
    act(() => result.current.selectDM('5', 'MumbleUser'));
    act(() => result.current.sendDM('hello'));
    expect(mockBridge.send).toHaveBeenCalledWith('voice.sendPrivateMessage', {
      message: 'hello',
      targetSession: 5,
    });
    expect(mockSendMatrixDM).not.toHaveBeenCalled();
  });

  it('sendDM to Brmble user sends via Matrix only', () => {
    const users = [{ session: 5, name: 'BrmbleUser', self: false, matrixUserId: '@bob:matrix.org' }];
    const { result } = renderHook(() => useDMStore({ ...defaultProps, users: users as any }));
    act(() => result.current.selectDM('5', 'BrmbleUser'));
    act(() => result.current.sendDM('hello'));
    expect(mockSendMatrixDM).toHaveBeenCalledWith('@bob:matrix.org', 'hello');
    expect(mockBridge.send).not.toHaveBeenCalledWith('voice.sendPrivateMessage', expect.anything());
  });

  it('sendDM adds local echo for Mumble path', () => {
    const users = [{ session: 5, name: 'MumbleUser', self: false }];
    const { result } = renderHook(() => useDMStore({ ...defaultProps, users: users as any }));
    act(() => result.current.selectDM('5', 'MumbleUser'));
    act(() => result.current.sendDM('hello'));
    expect(result.current.activeDMMessages.some(m => m.content === 'hello')).toBe(true);
  });

  it('sendDM adds local echo for Matrix path', () => {
    const users = [{ session: 5, name: 'BrmbleUser', self: false, matrixUserId: '@bob:matrix.org' }];
    const { result } = renderHook(() => useDMStore({ ...defaultProps, users: users as any }));
    act(() => result.current.selectDM('5', 'BrmbleUser'));
    act(() => result.current.sendDM('hello'));
    expect(result.current.activeDMMessages.some(m => m.content === 'hello')).toBe(true);
  });

  it('receiveDM increments unread when not viewing that DM', () => {
    const { result } = renderHook(() => useDMStore(defaultProps));
    act(() => result.current.receiveDM(5, 'Alice', 'hello'));
    expect(result.current.dmContacts.find(c => c.userId === '5')?.unread).toBe(1);
  });

  it('receiveDM does not increment unread when viewing that DM', () => {
    const { result } = renderHook(() => useDMStore(defaultProps));
    act(() => result.current.selectDM('5', 'Alice'));
    act(() => result.current.receiveDM(5, 'Alice', 'hello'));
    expect(result.current.dmContacts.find(c => c.userId === '5')?.unread).toBe(0);
  });

  it('receiveMatrixDMUpdate only processes new messages', () => {
    const users = [{ session: 5, name: 'BrmbleUser', self: false, matrixUserId: '@bob:matrix.org' }];
    const { result } = renderHook(() => useDMStore({ ...defaultProps, users: users as any }));

    const msg1 = { id: 'evt1', channelId: 'dm', sender: 'BrmbleUser', content: 'hi', timestamp: new Date() };
    act(() => result.current.receiveMatrixDMUpdate('@bob:matrix.org', [msg1]));
    expect(result.current.dmContacts.find(c => c.userId === '5')?.unread).toBe(1);

    // Same messages again — should NOT increment unread
    act(() => result.current.receiveMatrixDMUpdate('@bob:matrix.org', [msg1]));
    expect(result.current.dmContacts.find(c => c.userId === '5')?.unread).toBe(1);
  });

  it('receiveDM updates React state when selected DM user sends while in channels mode', () => {
    const { result } = renderHook(() => useDMStore(defaultProps));
    // Open DM, then toggle back to channels
    act(() => result.current.selectDM('5', 'Alice'));
    act(() => result.current.toggleDMMode()); // back to channels
    expect(result.current.appMode).toBe('channels');
    // Receive DMs while in channels mode — selectedDMUserId is still '5'
    act(() => result.current.receiveDM(5, 'Alice', 'msg1'));
    act(() => result.current.receiveDM(5, 'Alice', 'msg2'));
    // Toggle back to DM mode — should see both messages in active DM
    act(() => result.current.toggleDMMode());
    expect(result.current.appMode).toBe('dm');
    expect(result.current.activeDMMessages.filter(m => m.sender === 'Alice').length).toBeGreaterThanOrEqual(2);
  });

  it('unreadDMUserCount counts contacts with unread > 0', () => {
    const { result } = renderHook(() => useDMStore(defaultProps));
    act(() => result.current.receiveDM(5, 'Alice', 'hello'));
    act(() => result.current.receiveDM(6, 'Bob', 'hi'));
    expect(result.current.unreadDMUserCount).toBe(2);
  });
});
