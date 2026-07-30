import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewportThumbnail } from './useViewportThumbnail';
import type { CustomCompanionEntry } from './customCompanionTypes';

const entry: CustomCompanionEntry = {
  id: 'custom:$sprite:test',
  eventId: '$sprite:test',
  roomId: '!gallery:test',
  name: 'Orbit',
  mediaUri: 'mxc://test/orbit',
  mimeType: 'image/png',
  width: 800,
  height: 900,
  frameCount: 1,
  byteSize: 4096,
  uploaderMatrixUserId: '@alice:test',
  uploaderDisplayName: 'Alice',
  createdAt: 1,
  atlasCacheKey: '!gallery:test\u0000$sprite:test',
};

interface ObserverRecord {
  callback: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

let observers: ObserverRecord[];

function intersect(isIntersecting: boolean): void {
  const observer = observers.at(-1);
  if (!observer) throw new Error('IntersectionObserver was not created.');
  observer.callback(
    [{
      isIntersecting,
      target: document.createElement('div'),
    } as unknown as IntersectionObserverEntry],
    {} as IntersectionObserver,
  );
}

describe('useViewportThumbnail', () => {
  beforeEach(() => {
    observers = [];
    vi.stubGlobal('IntersectionObserver', class {
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds = [];
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      takeRecords = vi.fn(() => []);

      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        observers.push({ callback, options, observe: this.observe, disconnect: this.disconnect });
      }
    });
  });

  it('requests only after entering the 200px observation window', async () => {
    const requestThumbnail = vi.fn().mockResolvedValue('blob:thumbnail');
    const releaseThumbnail = vi.fn();
    const { result } = renderHook(() =>
      useViewportThumbnail(entry, { requestThumbnail, releaseThumbnail }));
    const element = document.createElement('div');

    act(() => result.current.ref(element));

    expect(observers[0].options).toEqual({ rootMargin: '200px' });
    expect(observers[0].observe).toHaveBeenCalledWith(element);
    expect(requestThumbnail).not.toHaveBeenCalled();

    act(() => intersect(true));

    await waitFor(() => expect(result.current.thumbnailUrl).toBe('blob:thumbnail'));
    expect(result.current.status).toBe('ready');
    expect(requestThumbnail).toHaveBeenCalledTimes(1);
  });

  it('releases on leave, requests again on re-entry, and releases on unmount', async () => {
    const requestThumbnail = vi.fn()
      .mockResolvedValueOnce('blob:first')
      .mockResolvedValueOnce('blob:second');
    const releaseThumbnail = vi.fn();
    const { result, unmount } = renderHook(() =>
      useViewportThumbnail(entry, { requestThumbnail, releaseThumbnail }));

    act(() => result.current.ref(document.createElement('div')));
    act(() => intersect(true));
    await waitFor(() => expect(result.current.thumbnailUrl).toBe('blob:first'));

    act(() => intersect(false));
    expect(result.current.thumbnailUrl).toBeNull();
    expect(releaseThumbnail).toHaveBeenCalledTimes(1);

    act(() => intersect(true));
    await waitFor(() => expect(result.current.thumbnailUrl).toBe('blob:second'));
    expect(requestThumbnail).toHaveBeenCalledTimes(2);

    unmount();
    expect(releaseThumbnail).toHaveBeenCalledTimes(2);
    expect(observers[0].disconnect).toHaveBeenCalled();
  });

  it('requests each row only as scrolling brings that row into view', async () => {
    const secondEntry: CustomCompanionEntry = {
      ...entry,
      id: 'custom:$sprite:second',
      eventId: '$sprite:second',
      atlasCacheKey: '!gallery:test\u0000$sprite:second',
    };
    const requestThumbnail = vi.fn(async requestedEntry => `blob:${requestedEntry.eventId}`);
    const releaseThumbnail = vi.fn();
    const { result } = renderHook(() => [
      useViewportThumbnail(entry, { requestThumbnail, releaseThumbnail }),
      useViewportThumbnail(secondEntry, { requestThumbnail, releaseThumbnail }),
    ]);

    act(() => {
      result.current[0].ref(document.createElement('div'));
      result.current[1].ref(document.createElement('div'));
    });
    expect(requestThumbnail).not.toHaveBeenCalled();

    act(() => observers[0].callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));
    await waitFor(() => expect(result.current[0].status).toBe('ready'));
    expect(requestThumbnail).toHaveBeenCalledTimes(1);
    expect(requestThumbnail).toHaveBeenLastCalledWith(entry);

    act(() => observers[1].callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));
    await waitFor(() => expect(result.current[1].status).toBe('ready'));
    expect(requestThumbnail).toHaveBeenCalledTimes(2);
    expect(requestThumbnail).toHaveBeenLastCalledWith(secondEntry);
  });

  it('keeps a placeholder state after failure without requesting a full atlas', async () => {
    const requestThumbnail = vi.fn().mockRejectedValue(new Error('offline'));
    const requestAtlas = vi.fn();
    const releaseThumbnail = vi.fn();
    const controller = { requestThumbnail, requestAtlas, releaseThumbnail };
    const { result } = renderHook(() =>
      useViewportThumbnail(entry, controller));

    act(() => result.current.ref(document.createElement('div')));
    act(() => intersect(true));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.thumbnailUrl).toBeNull();
    expect(result.current.showPlaceholder).toBe(true);
    expect(requestAtlas).not.toHaveBeenCalled();
  });
});
