import { useEffect, useState } from 'react';
import bridge from '../../bridge';
import './WindowResizeHandles.css';

// Edge codes must match Win32 WMSZ_* values (see Win32Window.cs).
const WMSZ_LEFT = 1;
const WMSZ_RIGHT = 2;
const WMSZ_TOP = 3;
const WMSZ_TOPLEFT = 4;
const WMSZ_TOPRIGHT = 5;
const WMSZ_BOTTOM = 6;
const WMSZ_BOTTOMLEFT = 7;
const WMSZ_BOTTOMRIGHT = 8;

const HANDLES: ReadonlyArray<{ edge: number; cls: string }> = [
  { edge: WMSZ_TOP,         cls: 'wrh-top' },
  { edge: WMSZ_BOTTOM,      cls: 'wrh-bottom' },
  { edge: WMSZ_LEFT,        cls: 'wrh-left' },
  { edge: WMSZ_RIGHT,       cls: 'wrh-right' },
  { edge: WMSZ_TOPLEFT,     cls: 'wrh-top-left' },
  { edge: WMSZ_TOPRIGHT,    cls: 'wrh-top-right' },
  { edge: WMSZ_BOTTOMLEFT,  cls: 'wrh-bottom-left' },
  { edge: WMSZ_BOTTOMRIGHT, cls: 'wrh-bottom-right' },
];

export function WindowResizeHandles() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const handler = (data: unknown) => {
      const d = data as { maximized?: boolean } | null | undefined;
      if (d && typeof d.maximized === 'boolean') setMaximized(d.maximized);
    };
    bridge.on('window.stateChanged', handler);
    return () => bridge.off('window.stateChanged', handler);
  }, []);

  if (maximized) return null;

  return (
    <div className="window-resize-handles" aria-hidden="true">
      {HANDLES.map(({ edge, cls }) => (
        <div
          key={edge}
          className={`wrh ${cls}`}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            bridge.send('window.beginResize', { edge });
          }}
        />
      ))}
    </div>
  );
}
