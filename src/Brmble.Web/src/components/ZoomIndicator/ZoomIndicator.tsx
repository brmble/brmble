import { useState, useEffect, useRef } from 'react';
import bridge from '../../bridge';
import './ZoomIndicator.css';

const FADE_DELAY = 1500;

export function ZoomIndicator() {
  const [zoomPercent, setZoomPercent] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onZoomChanged = (data: unknown) => {
      const d = data as { zoomPercent?: number } | undefined;
      if (d?.zoomPercent == null) return;

      setZoomPercent(d.zoomPercent);
      setVisible(true);

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setVisible(false);
      }, FADE_DELAY);
    };

    bridge.on('window.zoomChanged', onZoomChanged);
    return () => {
      bridge.off('window.zoomChanged', onZoomChanged);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (zoomPercent == null) return null;

  return (
    <div className={`zoom-indicator ${visible ? 'zoom-indicator--visible' : ''}`}>
      {zoomPercent}%
    </div>
  );
}
