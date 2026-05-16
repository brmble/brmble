import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAclAdmin } from './useAclAdmin';
import bridge from '../bridge';

vi.mock('../bridge', () => ({
  default: {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

describe('useAclAdmin', () => {
  it('requests channel ACL and stores bridge snapshot', () => {
    let channelHandler: ((data: unknown) => void) | undefined;
    vi.mocked(bridge.on).mockImplementation((type, handler) => {
      if (type === 'acl.channel') channelHandler = handler;
    });
    const { result } = renderHook(() => useAclAdmin(4));

    act(() => result.current.refresh());
    expect(bridge.send).toHaveBeenCalledWith('acl.getChannel', { channelId: 4 });

    act(() => channelHandler?.({
      channelId: 4,
      body: JSON.stringify({
        snapshot: {
          channelId: 4,
          inheritAcls: true,
          groups: [],
          acls: [],
          fetchedAt: '2026-05-15T12:00:00Z',
          stale: false,
          warning: null,
          snapshotHash: 'known-hash',
        },
      }),
    }));

    expect(result.current.snapshot?.channelId).toBe(4);
    expect(result.current.error).toBeNull();
  });
});
