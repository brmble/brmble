import type { CompanionOverlaySnapshot } from './overlayTypes';
import type { OverlaySettings } from '../SettingsModal/InterfaceSettingsTypes';
import { EventFeed } from './EventFeed';
import { SpeakerStack } from './SpeakerStack';

export function MinimalOverlay({
  snapshot,
  position,
}: {
  snapshot: CompanionOverlaySnapshot;
  position: OverlaySettings['position'];
}) {
  if (snapshot.activeSpeakers.length === 0 && snapshot.recentEvents.length === 0) {
    return null;
  }

  return (
    <section
      className={`companion-overlay companion-overlay--minimal companion-overlay--position-${position}`}
      data-testid="companion-overlay-root"
    >
      <SpeakerStack speakers={snapshot.activeSpeakers} />
      <EventFeed events={snapshot.recentEvents.slice(-3)} />
    </section>
  );
}
