import catHappySprite from '../../assets/Sprites/Cat/cat_happey.png';
import catIdleSprite from '../../assets/Sprites/Cat/cat_idle.png';
import catPlaySprite from '../../assets/Sprites/Cat/cat_play.png';
import catSleepSprite from '../../assets/Sprites/Cat/cat_sleep.png';
import catSmileSprite from '../../assets/Sprites/Cat/cat_smile.png';
import type { OverlayVisualState } from './overlayTypes';

export function CompanionSprite({ visualState }: { visualState: OverlayVisualState }) {
  const spriteByState: Record<OverlayVisualState, string> = {
    idle: catIdleSprite,
    message: catSmileSprite,
    dm: catHappySprite,
    'moderation-alert': catPlaySprite,
    'speaking-nearby': catIdleSprite,
    quiet: catSleepSprite,
  };

  return (
    <img
      className={`companion-sprite companion-sprite--${visualState}`}
      src={spriteByState[visualState]}
      alt="Brmblegotchi companion"
    />
  );
}
