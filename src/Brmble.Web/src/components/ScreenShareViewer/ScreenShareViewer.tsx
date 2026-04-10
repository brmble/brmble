import { useRef, useEffect, useState, useCallback } from 'react';
import { Icon } from '../Icon/Icon';
import { Tooltip } from '../Tooltip/Tooltip';
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
        <Tooltip content={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
        <button
          className="btn btn-ghost btn-icon screen-share-control-btn"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? (
            <Icon name="minimize-2" size={16} />
          ) : (
            <Icon name="maximize-2" size={16} />
          )}
        </button>
        </Tooltip>
        <Tooltip content="Close viewer">
        <button
          className="btn btn-ghost btn-icon screen-share-control-btn"
          onClick={onClose}
          aria-label="Close screen share viewer"
        >
          <Icon name="x" size={16} />
        </button>
        </Tooltip>
      </div>
    </div>
  );
}
