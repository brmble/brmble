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
    let errorHandler: ((data: unknown) => void) | undefined;
    vi.mocked(bridge.on).mockImplementation((type, handler) => {
      if (type === 'acl.channel') channelHandler = handler;
      if (type === 'acl.error') errorHandler = handler;
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

    act(() => result.current.save({ inheritAcls: true, groups: [], acls: [] }));
    act(() => errorHandler?.({
      channelId: 4,
      statusCode: 409,
      body: JSON.stringify({
        success: false,
        snapshot: {
          channelId: 4,
          inheritAcls: false,
          groups: [],
          acls: [],
          fetchedAt: '2026-05-15T12:05:00Z',
          stale: false,
          warning: null,
          snapshotHash: 'canonical-hash',
        },
        error: 'ACL changed since it was opened.',
      }),
    }));

    expect(result.current.snapshot?.snapshotHash).toBe('canonical-hash');
    expect(result.current.error).toContain('ACL changed since it was opened.');
  });
});
