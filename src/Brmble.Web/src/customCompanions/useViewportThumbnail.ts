import { useCallback, useEffect, useRef, useState, type RefCallback } from 'react';
import type { CustomCompanionEntry, ThumbnailConsumer } from './customCompanionTypes';

export type ViewportThumbnailStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ViewportThumbnailController {
  requestThumbnail(entry: CustomCompanionEntry, consumer: ThumbnailConsumer): Promise<string>;
  releaseThumbnail(entry: CustomCompanionEntry, consumer: ThumbnailConsumer): void;
}

export interface ViewportThumbnail {
  ref: RefCallback<HTMLElement>;
  thumbnailUrl: string | null;
  status: ViewportThumbnailStatus;
  showPlaceholder: boolean;
}

export function useViewportThumbnail(
  entry: CustomCompanionEntry,
  controller: ViewportThumbnailController,
): ViewportThumbnail {
  const { requestThumbnail, releaseThumbnail } = controller;
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ViewportThumbnailStatus>('idle');
  const ref = useCallback<RefCallback<HTMLElement>>(node => setElement(node), []);
  const entryRef = useRef(entry);
  const consumer = useRef<ThumbnailConsumer>(Symbol('viewport-thumbnail')).current;
  entryRef.current = entry;

  useEffect(() => {
    if (!element) return;

    let active = false;
    let requestGeneration = 0;
    let leasedEntry: CustomCompanionEntry | null = null;
    const release = () => {
      if (!active) return;
      active = false;
      requestGeneration += 1;
      if (leasedEntry) releaseThumbnail(leasedEntry, consumer);
      leasedEntry = null;
      setThumbnailUrl(null);
      setStatus('idle');
    };
    const observer = new IntersectionObserver(entries => {
      const isIntersecting = entries.some(observed => observed.isIntersecting);
      if (!isIntersecting) {
        release();
        return;
      }
      if (active) return;

      active = true;
      const generation = ++requestGeneration;
      const requestedEntry = entryRef.current;
      leasedEntry = requestedEntry;
      setStatus('loading');
      void requestThumbnail(requestedEntry, consumer).then(url => {
        if (!active || requestGeneration !== generation) return;
        setThumbnailUrl(url);
        setStatus('ready');
      }).catch(() => {
        if (!active || requestGeneration !== generation) return;
        setThumbnailUrl(null);
        setStatus('error');
      });
    }, { rootMargin: '200px' });

    observer.observe(element);
    return () => {
      observer.disconnect();
      release();
    };
  }, [consumer, element, entry.atlasCacheKey, releaseThumbnail, requestThumbnail]);

  return {
    ref,
    thumbnailUrl,
    status,
    showPlaceholder: status !== 'ready',
  };
}
