import { useState, useRef, useCallback, useEffect } from 'react';

interface UseResizableOptions {
  minWidth: number;
  maxWidth: number;
  defaultWidth: number;
  storageKey: string;
  fingerprint: string;
}

interface UseResizableReturn {
  width: number;
  isDragging: boolean;
  handleProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onDoubleClick: () => void;
    ref: React.RefObject<HTMLDivElement | null>;
  };
}

function getScopedKey(storageKey: string, fingerprint: string): string {
  return fingerprint ? `${storageKey}_${fingerprint}` : storageKey;
}

function loadWidth(storageKey: string, fingerprint: string, defaultWidth: number): number {
  try {
    const key = getScopedKey(storageKey, fingerprint);
    const stored = localStorage.getItem(key);
    if (stored !== null) {
      const parsed = Number(stored);
      if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    }
  } catch {
    // localStorage unavailable
  }
  return defaultWidth;
}

function saveWidth(storageKey: string, fingerprint: string, width: number): void {
  try {
    const key = getScopedKey(storageKey, fingerprint);
    localStorage.setItem(key, String(width));
  } catch {
    // localStorage unavailable
  }
}

export function useResizable({
  minWidth,
  maxWidth,
  defaultWidth,
  storageKey,
  fingerprint,
}: UseResizableOptions): UseResizableReturn {
  const [width, setWidth] = useState(() => {
    const loaded = loadWidth(storageKey, fingerprint, defaultWidth);
    return Math.min(Math.max(loaded, minWidth), maxWidth);
  });
  const [isDragging, setIsDragging] = useState(false);
  const handleRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(width);

  // Keep ref in sync for use in pointer event handlers
  widthRef.current = width;

  // Reload width when profile (fingerprint) changes
  useEffect(() => {
    const loaded = loadWidth(storageKey, fingerprint, defaultWidth);
    const clamped = Math.min(Math.max(loaded, minWidth), maxWidth);
    setWidth(clamped);
  }, [fingerprint, storageKey, defaultWidth, minWidth, maxWidth]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return; // only primary button
      e.preventDefault();

      const handle = handleRef.current;
      if (!handle) return;

      handle.setPointerCapture(e.pointerId);
      setIsDragging(true);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      const onPointerMove = (ev: PointerEvent) => {
        const clamped = Math.min(Math.max(ev.clientX, minWidth), maxWidth);
        widthRef.current = clamped;
        setWidth(clamped);
      };

      const onPointerUp = () => {
        handle.removeEventListener('pointermove', onPointerMove);
        handle.removeEventListener('pointerup', onPointerUp);
        handle.removeEventListener('pointercancel', onPointerUp);
        setIsDragging(false);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        saveWidth(storageKey, fingerprint, widthRef.current);
      };

      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', onPointerUp);
      handle.addEventListener('pointercancel', onPointerUp);
    },
    [minWidth, maxWidth, storageKey, fingerprint]
  );

  const onDoubleClick = useCallback(() => {
    setWidth(defaultWidth);
    saveWidth(storageKey, fingerprint, defaultWidth);
  }, [defaultWidth, storageKey, fingerprint]);

  return {
    width,
    isDragging,
    handleProps: {
      onPointerDown,
      onDoubleClick,
      ref: handleRef,
    },
  };
}
