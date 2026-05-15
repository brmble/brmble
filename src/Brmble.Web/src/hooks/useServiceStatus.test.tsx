import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ServiceStatusProvider, useServiceStatus } from './useServiceStatus';

function wrapper({ children }: { children: React.ReactNode }) {
  return <ServiceStatusProvider>{children}</ServiceStatusProvider>;
}

describe('useServiceStatus', () => {
  it('derives chat and screenshare as idle while Brmble is reconnecting', () => {
    const { result } = renderHook(() => useServiceStatus(), { wrapper });

    act(() => {
      result.current.updateStatus('server', { state: 'connecting', error: 'Session reconnecting: connection-lost' });
      result.current.updateStatus('chat', { state: 'connected' });
      result.current.updateStatus('livekit', { state: 'connected' });
    });

    expect(result.current.effectiveStatuses.chat).toEqual({ state: 'idle' });
    expect(result.current.effectiveStatuses.livekit).toEqual({ state: 'idle' });
  });

  it('derives chat and screenshare as connecting after Brmble connects before they are ready', () => {
    const { result } = renderHook(() => useServiceStatus(), { wrapper });

    act(() => {
      result.current.updateStatus('server', { state: 'connected' });
      result.current.updateStatus('chat', { state: 'idle' });
      result.current.updateStatus('livekit', { state: 'idle' });
    });

    expect(result.current.effectiveStatuses.chat).toEqual({ state: 'connecting' });
    expect(result.current.effectiveStatuses.livekit).toEqual({ state: 'connecting' });
  });

  it('keeps ready chat and screenshare statuses when Brmble is connected', () => {
    const { result } = renderHook(() => useServiceStatus(), { wrapper });

    act(() => {
      result.current.updateStatus('server', { state: 'connected' });
      result.current.updateStatus('chat', { state: 'connecting' });
      result.current.updateStatus('livekit', { state: 'connected' });
    });

    expect(result.current.effectiveStatuses.chat).toEqual({ state: 'connecting' });
    expect(result.current.effectiveStatuses.livekit).toEqual({ state: 'connected' });
  });
});
