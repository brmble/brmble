import { useCallback, useRef, useState, type ReactNode } from 'react';
import './VerticalSplitPane.css';

interface VerticalSplitPaneProps {
  top: ReactNode | null;
  children: ReactNode;
  storageKey: string;
  label: string;
  topClassName?: string;
}

const DEFAULT_SPLIT = 50;
const MIN_SPLIT = 20;
const MAX_SPLIT = 80;
const KEYBOARD_STEP = 5;

function clampSplit(value: number): number {
  return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, value));
}

export function VerticalSplitPane({
  top,
  children,
  storageKey,
  label,
  topClassName,
}: VerticalSplitPaneProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [splitPercent, setSplitPercent] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    const parsed = stored ? Number(stored) : DEFAULT_SPLIT;
    return Number.isFinite(parsed) ? clampSplit(parsed) : DEFAULT_SPLIT;
  });

  const persist = useCallback((next: number) => {
    const clamped = clampSplit(next);
    setSplitPercent(clamped);
    localStorage.setItem(storageKey, String(clamped));
  }, [storageKey]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const root = rootRef.current;
    if (!root) return;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const rect = root.getBoundingClientRect();
      if (rect.height === 0) return;
      const next = ((moveEvent.clientY - rect.top) / rect.height) * 100;
      setSplitPercent(clampSplit(next));
    };

    const handlePointerUp = () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerUp);
      window.removeEventListener('blur', handlePointerUp);
      setSplitPercent(current => {
        localStorage.setItem(storageKey, String(current));
        return current;
      });
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerUp);
    window.addEventListener('blur', handlePointerUp);
  }, [storageKey]);

  return (
    <div className="vertical-split-pane" ref={rootRef}>
      {top && (
        <>
          <div
            className={['vertical-split-pane__top', topClassName].filter(Boolean).join(' ')}
            style={{ flex: `0 0 ${splitPercent}%` }}
          >
            {top}
          </div>
          <div
            className="vertical-split-pane__divider"
            role="separator"
            aria-label={label}
            aria-orientation="horizontal"
            aria-valuemin={MIN_SPLIT}
            aria-valuemax={MAX_SPLIT}
            aria-valuenow={Math.round(splitPercent)}
            tabIndex={0}
            onPointerDown={handlePointerDown}
            onKeyDown={event => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
              event.preventDefault();
              persist(splitPercent + (event.key === 'ArrowUp' ? -KEYBOARD_STEP : KEYBOARD_STEP));
            }}
          />
        </>
      )}
      <div className="vertical-split-pane__bottom">
        {children}
      </div>
    </div>
  );
}
