import { useRef, useEffect, useState, useCallback } from 'react';
import './ScreenShareViewer.css';

interface ScreenShareViewerProps {
  videoEl: HTMLVideoElement;
  sharerName: string;
  onClose: () => void;
}

export function ScreenShareViewer({ videoEl, sharerName, onClose }: ScreenShareViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    videoEl.className = 'screen-share-video';
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    container.appendChild(videoEl);

    return () => {
      videoEl.pause();
      videoEl.srcObject = null;
      if (container.contains(videoEl)) {
        container.removeChild(videoEl);
      }
    };
  }, [videoEl]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = setTimeout(() => setShowControls(false), 2000);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    setShowControls(false);
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, []);

  return (
    <div
      className={`screen-share-viewer ${showControls ? 'show-controls' : ''}`}
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div className="screen-share-overlay screen-share-overlay--name">
        {sharerName}'s screen
      </div>
      <div className="screen-share-overlay screen-share-overlay--controls">
        <button
          className="btn btn-ghost btn-icon screen-share-control-btn"
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          )}
        </button>
        <button
          className="btn btn-ghost btn-icon screen-share-control-btn"
          onClick={onClose}
          title="Close viewer"
          aria-label="Close screen share viewer"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
