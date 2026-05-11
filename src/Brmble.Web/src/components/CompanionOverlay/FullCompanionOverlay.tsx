import type { CompanionOverlaySnapshot } from './overlayTypes';
import type { OverlaySettings } from '../SettingsModal/InterfaceSettingsTypes';
import { CompanionSprite } from './CompanionSprite';
import { SpeakerStack } from './SpeakerStack';

export function FullCompanionOverlay({
  snapshot,
  position,
}: {
  snapshot: CompanionOverlaySnapshot;
  position: OverlaySettings['position'];
}) {
  const latestEvent = snapshot.recentEvents[snapshot.recentEvents.length - 1] ?? null;

  return (
    <section
      className={`companion-overlay companion-overlay--full companion-overlay--position-${position}`}
      data-testid="companion-overlay-root"
    >
      <div className="companion-anchor">
        <CompanionSprite visualState={snapshot.visualState} />
        {latestEvent && (
          <aside className="companion-bubble" aria-live="polite">
            <p>{latestEvent.line}</p>
          </aside>
        )}
      </div>
      <SpeakerStack speakers={snapshot.activeSpeakers} />
    </section>
  );
}
