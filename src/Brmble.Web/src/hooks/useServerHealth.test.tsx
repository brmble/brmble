import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceStatusProvider, useServiceStatus } from './useServiceStatus';
import { useServerHealth } from './useServerHealth';

const { bridgeMock, handlers } = vi.hoisted(() => {
  const handlers = new Map<string, (data: unknown) => void>();
  return {
    handlers,
    bridgeMock: {
      send: vi.fn(),
      on: vi.fn((type: string, handler: (data: unknown) => void) => {
        handlers.set(type, handler);
      }),
      off: vi.fn((type: string, handler: (data: unknown) => void) => {
        if (handlers.get(type) === handler) {
          handlers.delete(type);
        }
      }),
    },
  };
});

vi.mock('../bridge', () => ({
  default: bridgeMock,
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(ServiceStatusProvider, null, children);
}

function emitHealthStatus(data: unknown) {
  const handler = handlers.get('server.healthStatus');
  if (!handler) throw new Error('server.healthStatus handler was not registered');
  handler(data);
}

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
});

describe('useServerHealth', () => {
  it('updates server status, version, and label when health is connected', () => {
    const { result } = renderHook(() => {
      useServerHealth();
      return useServiceStatus();
    }, { wrapper });

    act(() => {
      emitHealthStatus({
        state: 'connected',
        label: 'brmble.example',
        version: '1.2.3',
      });
    });

    expect(result.current.statuses.server).toEqual({
      state: 'connected',
      error: undefined,
      label: 'brmble.example',
      version: '1.2.3',
    });
  });

  it('ignores disconnected health status from the default server state', () => {
    const { result } = renderHook(() => {
      useServerHealth();
      return useServiceStatus();
    }, { wrapper });

    act(() => {
      emitHealthStatus({
        state: 'disconnected',
        error: 'Health check failed',
      });
    });

    expect(result.current.statuses.server).toEqual({
      state: 'idle',
    });
  });
});
