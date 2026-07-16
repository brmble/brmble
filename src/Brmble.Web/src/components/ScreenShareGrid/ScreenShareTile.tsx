import { useRef, useEffect, useState, useCallback } from 'react';
import { Icon } from '../Icon/Icon';
import { Tooltip } from '../Tooltip/Tooltip';
import { Select } from '../Select';
import type { ScreenShareQuality } from '../../utils/screenShareQuality';
import type { ViewerQuality } from '../../hooks/useScreenShare';
import './ScreenShareTile.css';

const VIEWER_QUALITY_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

interface ScreenShareTileProps {
  videoEl: HTMLVideoElement;
  sharerName: string;
  isFocused: boolean;
  isThumbnail: boolean;
  quality?: ScreenShareQuality;
  viewerQuality?: ViewerQuality;
  onViewerQualityChange?: (quality: ViewerQuality) => void;
  onClick: () => void;
  onClose: () => void;
}

export function ScreenShareTile({ videoEl, sharerName, isFocused, isThumbnail, quality = 'unknown', viewerQuality = 'auto', onViewerQualityChange, onClick, onClose }: ScreenShareTileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    videoEl.className = 'screen-share-tile-video';
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    container.appendChild(videoEl);

    return () => {
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

  const toggleFullscreen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
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

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  }, [onClose]);

  const className = [
    'screen-share-tile',
    isFocused ? 'screen-share-tile--focused' : '',
    isThumbnail ? 'screen-share-tile--thumbnail' : '',
    showControls ? 'show-controls' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={className}
      ref={containerRef}
      data-testid="screen-share-tile"
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div className="screen-share-tile-overlay screen-share-tile-overlay--name">
        {sharerName}'s screen
      </div>
      {quality === 'reconnecting' && (
        <div className="screen-share-tile-quality screen-share-tile-quality--reconnecting">
          Reconnecting...
        </div>
      )}
      {quality === 'poor' && (
        <div className="screen-share-tile-quality screen-share-tile-quality--poor">
          Poor connection
        </div>
      )}
      <div className="screen-share-tile-overlay screen-share-tile-overlay--close">
        <Tooltip content="Stop watching">
          <button
            className="btn btn-ghost btn-icon screen-share-tile-control-btn"
            onClick={handleClose}
            aria-label="Stop watching"
          >
            <Icon name="x" size={16} />
          </button>
        </Tooltip>
      </div>
      {!isThumbnail && (
        <div className="screen-share-tile-overlay screen-share-tile-overlay--controls">
          {onViewerQualityChange && (
            <div
              className="screen-share-tile-quality-select-wrapper"
              onClick={(e) => e.stopPropagation()}
            >
              <Select
                className="screen-share-tile-quality-select"
                value={viewerQuality}
                onChange={(value) => onViewerQualityChange(value as ViewerQuality)}
                options={VIEWER_QUALITY_OPTIONS}
              />
            </div>
          )}
          <Tooltip content={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            <button
              className="btn btn-ghost btn-icon screen-share-tile-control-btn"
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
        </div>
      )}
    </div>
  );
}
