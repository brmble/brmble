import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as AppModule from './App';
import { createQueuedScreenShareEndedNotification, getScreenShareEndedNotification } from './App';
import { useNotificationQueue } from './hooks/useNotificationQueue';

type ReplaceScreenShareEndedNotification = (
  current: ReturnType<typeof createQueuedScreenShareEndedNotification>,
  reason: 'manual' | 'source-closed' | 'interrupted' | 'error',
  sequence: number,
  notifQueue: { unregister: (id: string) => void },
) => ReturnType<typeof createQueuedScreenShareEndedNotification>;

describe('getScreenShareEndedNotification', () => {
  it('keeps manual share endings silent', () => {
    expect(getScreenShareEndedNotification('manual')).toBeNull();
  });

  it('maps source-closed to an info notification', () => {
    expect(getScreenShareEndedNotification('source-closed')).toEqual({
      status: 'info',
      title: 'Share ended',
      detail: 'Your screen share ended because the shared window or program was closed.',
    });
  });

  it('maps interrupted to an info notification', () => {
    expect(getScreenShareEndedNotification('interrupted')).toEqual({
      status: 'info',
      title: 'Share ended',
      detail: 'Your screen share ended because of an unexpected technical issue.',
    });
  });

  it('maps error to an error notification', () => {
    expect(getScreenShareEndedNotification('error')).toEqual({
      status: 'error',
      title: 'Screen share failed',
      detail: 'Brmble could not keep your screen share running because of a technical issue.',
    });
  });

  it('requeues share-ended notifications with fresh queue metadata', () => {
    const { result } = renderHook(() => useNotificationQueue());

    act(() => {
      result.current.register('warning-1', 'warning');
      result.current.register('warning-2', 'warning');
      result.current.register('warning-3', 'warning');
    });

    const interrupted = createQueuedScreenShareEndedNotification('interrupted', 0);
    expect(interrupted).not.toBeNull();

    act(() => {
      result.current.register(interrupted!.id, interrupted!.status);
    });

    expect(result.current.isVisible(interrupted!.id)).toBe(false);

    const errored = createQueuedScreenShareEndedNotification('error', 1);
    expect(errored).not.toBeNull();
    expect(errored!.id).not.toBe(interrupted!.id);

    act(() => {
      result.current.unregister(interrupted!.id);
      result.current.register(errored!.id, errored!.status);
    });

    expect(result.current.isVisible(errored!.id)).toBe(true);
    expect(result.current.isVisible('warning-3')).toBe(false);
  });

  it('automatically unregisters the previous share-ended queue id when App replaces it', () => {
    const replaceScreenShareEndedNotification = (AppModule as {
      replaceScreenShareEndedNotification?: ReplaceScreenShareEndedNotification;
    }).replaceScreenShareEndedNotification;
    const unregister = vi.fn();
    const interrupted = createQueuedScreenShareEndedNotification('interrupted', 0);

    expect(replaceScreenShareEndedNotification).toBeTypeOf('function');

    const errored = replaceScreenShareEndedNotification!(
      interrupted,
      'error',
      1,
      { unregister },
    );

    expect(unregister).toHaveBeenCalledWith(interrupted!.id);
    expect(errored).toEqual(createQueuedScreenShareEndedNotification('error', 1));
  });
});
