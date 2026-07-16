import { useEffect, useCallback } from 'react';
import { ScreenShareTile } from './ScreenShareTile';
import type { ShareInfo, ViewerQuality } from '../../hooks/useScreenShare';
import type { ScreenShareQuality } from '../../utils/screenShareQuality';
import './ScreenShareGrid.css';

interface ScreenShareGridProps {
  watchingShares: ShareInfo[];
  focusedShare: ShareInfo | null;
  videoElements: Map<number, HTMLVideoElement>;
  roomQuality?: ScreenShareQuality;
  shareQualities?: Map<number, ScreenShareQuality>;
  viewerQualities?: Map<number, ViewerQuality>;
  onFocus: (share: ShareInfo | null) => void;
  onClose: (share: ShareInfo) => void;
  onViewerQualityChange?: (userId: number, quality: ViewerQuality) => void;
}

function getLayout(count: number, hasFocus: boolean): string {
  if (count === 0) return 'none';
  if (count === 1) return 'single';
  if (hasFocus) return `focused-${count}`;
  return `grid-${count}`;
}

export function ScreenShareGrid({ watchingShares, focusedShare, videoElements, roomQuality = 'unknown', shareQualities, viewerQualities, onFocus, onClose, onViewerQualityChange }: ScreenShareGridProps) {
  // Clear focus when only one stream remains (revert to single-stream view)
  useEffect(() => {
    if (watchingShares.length <= 1 && focusedShare) {
      onFocus(null);
    }
  }, [watchingShares.length, focusedShare, onFocus]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && focusedShare) {
        onFocus(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [focusedShare, onFocus]);

  const handleTileClick = useCallback((share: ShareInfo) => {
    if (watchingShares.length === 1) return;
    if (focusedShare?.userId === share.userId) {
      onFocus(null);
    } else {
      onFocus(share);
    }
  }, [watchingShares.length, focusedShare, onFocus]);

  if (watchingShares.length === 0) return null;

  const layout = getLayout(watchingShares.length, focusedShare !== null);

  const orderedShares = focusedShare
    ? [focusedShare, ...watchingShares.filter(s => s.userId !== focusedShare.userId)]
    : watchingShares;

  const qualityForShare = (userId: number): ScreenShareQuality => (
    roomQuality === 'reconnecting' ? 'reconnecting' : shareQualities?.get(userId) ?? 'unknown'
  );

  const viewerQualityFor = (userId: number): ViewerQuality => viewerQualities?.get(userId) ?? 'auto';
  const handleViewerQualityChange = onViewerQualityChange
    ? (userId: number) => (quality: ViewerQuality) => onViewerQualityChange(userId, quality)
    : undefined;

  return (
    <div className="screen-share-grid" data-layout={layout}>
      {focusedShare && (
        <div className="screen-share-grid-primary">
          {(() => {
            const videoEl = videoElements.get(focusedShare.userId);
            if (!videoEl) return null;
            return (
              <ScreenShareTile
                videoEl={videoEl}
                sharerName={focusedShare.userName}
                isFocused={true}
                isThumbnail={false}
                quality={qualityForShare(focusedShare.userId)}
                viewerQuality={viewerQualityFor(focusedShare.userId)}
                onViewerQualityChange={handleViewerQualityChange?.(focusedShare.userId)}
                onClick={() => handleTileClick(focusedShare)}
                onClose={() => onClose(focusedShare)}
              />
            );
          })()}
        </div>
      )}
      {focusedShare && (
        <div className="screen-share-grid-thumbnails">
          {orderedShares.slice(1).map(share => {
            const videoEl = videoElements.get(share.userId);
            if (!videoEl) return null;
            return (
              <ScreenShareTile
                key={share.userId}
                videoEl={videoEl}
                sharerName={share.userName}
                isFocused={false}
                isThumbnail={true}
                quality={qualityForShare(share.userId)}
                onClick={() => handleTileClick(share)}
                onClose={() => onClose(share)}
              />
            );
          })}
        </div>
      )}
      {!focusedShare && (
        <>
          {orderedShares.map(share => {
            const videoEl = videoElements.get(share.userId);
            if (!videoEl) return null;
            return (
              <ScreenShareTile
                key={share.userId}
                videoEl={videoEl}
                sharerName={share.userName}
                isFocused={false}
                isThumbnail={false}
                quality={qualityForShare(share.userId)}
                viewerQuality={viewerQualityFor(share.userId)}
                onViewerQualityChange={handleViewerQualityChange?.(share.userId)}
                onClick={() => handleTileClick(share)}
                onClose={() => onClose(share)}
              />
            );
          })}
        </>
      )}
    </div>
  );
}
