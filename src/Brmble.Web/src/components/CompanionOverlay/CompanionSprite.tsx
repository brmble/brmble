import { useEffect, useState } from 'react';
import beeAtlas from '../../assets/Sprites/Bee/Bee.webp';
import engineerAtlas from '../../assets/Sprites/Engineer/Engineer.webp';
import floppyAtlas from '../../assets/Sprites/Floppy/Floppy.webp';
import patchAtlas from '../../assets/Sprites/Patch/Patch.webp';
import pipAtlas from '../../assets/Sprites/Pip/Pip.webp';
import retroAtlas from '../../assets/Sprites/Retro/Retro.webp';
import type { CSSProperties } from 'react';
import type { CompanionAtlasRow, CompanionId } from './overlayTypes';

const COMPANION_FRAME_MS = 1000;
const ATLAS_COLUMN_COUNT = 8;
const frameCountByRow: Record<CompanionAtlasRow, number> = {
  1: 6,
  2: 8,
  3: 8,
  4: 4,
  5: 5,
  6: 8,
  7: 6,
  8: 6,
  9: 6,
};

const atlasByCompanion: Record<CompanionId, string> = {
  bee: beeAtlas,
  engineer: engineerAtlas,
  floppy: floppyAtlas,
  patch: patchAtlas,
  pip: pipAtlas,
  retro: retroAtlas,
};

function percentForFrameIndex(frameIndex: number): string {
  return `${((frameIndex / (ATLAS_COLUMN_COUNT - 1)) * 100).toFixed(6)}%`;
}

export function CompanionSprite({
  companionId,
  row,
  badges,
}: {
  companionId: CompanionId;
  row: CompanionAtlasRow;
  badges: {
    muted: boolean;
    live: boolean;
  };
}) {
  const frameCount = frameCountByRow[row];
  const frameStepCount = Math.max(frameCount - 1, 0);
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    setFrameIndex(0);

    if (frameCount <= 1) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % frameCount);
    }, COMPANION_FRAME_MS);

    return () => window.clearInterval(intervalId);
  }, [frameCount, row]);

  const lastFramePosition = percentForFrameIndex(frameCount - 1);
  const currentFramePosition = percentForFrameIndex(frameIndex);
  const spriteStyle = {
    '--companion-frame-count': String(frameCount),
    '--companion-frame-step-count': String(frameStepCount),
    '--companion-cycle-duration': `${frameCount * COMPANION_FRAME_MS}ms`,
    '--companion-last-frame-position': lastFramePosition,
    backgroundImage: `url(${atlasByCompanion[companionId]})`,
    backgroundPositionX: currentFramePosition,
    backgroundPositionY: `${((row - 1) / (9 - 1)) * 100}%`,
  } as CSSProperties;

  return (
    <div className="companion-sprite-frame">
      <div
        className="companion-sprite companion-sprite--atlas companion-sprite--animated"
        data-testid="companion-sprite"
        data-companion-id={companionId}
        data-frame-count={frameCount}
        data-frame-step-count={frameStepCount}
        data-current-frame={frameIndex}
        data-row={row}
        role="img"
        aria-label="Brmblegotchi companion"
        style={spriteStyle}
      />
      <div className="companion-badges" aria-label="Companion badges">
        {badges.muted && <span className="companion-badge companion-badge--muted" aria-label="Muted">M</span>}
        {badges.live && <span className="companion-badge companion-badge--live" aria-label="Live">LIVE</span>}
      </div>
    </div>
  );
}
