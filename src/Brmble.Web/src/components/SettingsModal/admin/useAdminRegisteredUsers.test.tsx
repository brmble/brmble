import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminRegisteredUsers } from './useAdminRegisteredUsers';
const { bridgeHandlers, bridgeSend } = vi.hoisted(() => {
  const bridgeHandlers = new Map<string, ((data: unknown) => void)[]>();
  const bridgeSend = vi.fn((type: string) => {
    if (type === 'voice.getRegisteredUsers') {
      for (const handler of bridgeHandlers.get('voice.registeredUsers') ?? []) {
        handler({ 12: 'Alice', 34: 'Bob' });
      }
    }
  });

  return { bridgeHandlers, bridgeSend };
});

vi.mock('../../../bridge', () => ({
  default: {
    on: (type: string, handler: (data: unknown) => void) => {
      const handlers = bridgeHandlers.get(type) ?? [];
      handlers.push(handler);
      bridgeHandlers.set(type, handlers);
    },
    off: (type: string, handler: (data: unknown) => void) => {
      const handlers = bridgeHandlers.get(type) ?? [];
      bridgeHandlers.set(type, handlers.filter(candidate => candidate !== handler));
    },
    once: (type: string, handler: (data: unknown) => void) => {
      const wrappedHandler = (data: unknown) => {
        const handlers = bridgeHandlers.get(type) ?? [];
        bridgeHandlers.set(type, handlers.filter(candidate => candidate !== wrappedHandler));
        handler(data);
      };
      const handlers = bridgeHandlers.get(type) ?? [];
      handlers.push(wrappedHandler);
      bridgeHandlers.set(type, handlers);
    },
    send: bridgeSend,
  },
}));

describe('useAdminRegisteredUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridgeHandlers.clear();
  });

  afterEach(() => {
    bridgeHandlers.clear();
  });

  it('loads registered users from the voice bridge', async () => {
    const { result } = renderHook(() => useAdminRegisteredUsers());

    await waitFor(() => {
      expect(result.current.registeredUsers).toHaveLength(2);
    });
    expect(bridgeSend).toHaveBeenCalledWith('voice.getRegisteredUsers');
    expect(result.current.error).toBeNull();
  });

  it('returns the bridge error message when loading fails', async () => {
    bridgeSend.mockImplementationOnce((type: string) => {
      if (type === 'voice.getRegisteredUsers') {
        for (const handler of bridgeHandlers.get('voice.registeredUsersError') ?? []) {
          handler({ message: 'Registered users lookup failed with status 403.' });
        }
        for (const handler of bridgeHandlers.get('voice.registeredUsers') ?? []) {
          handler([]);
        }
      }
    });

    const { result } = renderHook(() => useAdminRegisteredUsers());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBe('Registered users lookup failed with status 403.');
    expect(result.current.registeredUsers).toHaveLength(0);
  });
});
