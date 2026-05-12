import type { OverlaySettings } from '../SettingsModal/InterfaceSettingsTypes';
import { CompanionSprite } from './CompanionSprite';
import { SpeakerStack } from './SpeakerStack';
import type { CompanionOverlaySnapshot } from './overlayTypes';

export function FullCompanionOverlay({
  snapshot,
  position,
}: {
  snapshot: CompanionOverlaySnapshot;
  position: OverlaySettings['position'];
}) {
  const display = snapshot.fullCompanion.activeDisplay;

  if (!display) {
    return null;
  }

  return (
    <section
      className={`companion-overlay companion-overlay--full companion-overlay--position-${position}`}
      data-testid="companion-overlay-root"
    >
      <div className="companion-anchor">
        <CompanionSprite companionId={display.companionId} row={display.row} badges={display.badges} />
        {display.bubble && (
          <aside
            className="companion-bubble"
            data-testid="companion-speech-balloon"
            role="status"
            aria-live="polite"
          >
            <p>{display.bubble}</p>
          </aside>
        )}
      </div>
      <SpeakerStack speakers={snapshot.activeSpeakers} />
    </section>
  );
}
