import type { CompanionOverlaySnapshot } from './overlayTypes';
import { EventFeed } from './EventFeed';
import { SpeakerStack } from './SpeakerStack';

export function MinimalOverlay({ snapshot }: { snapshot: CompanionOverlaySnapshot }) {
  if (snapshot.activeSpeakers.length === 0 && snapshot.recentEvents.length === 0) {
    return null;
  }

  return (
    <section className="companion-overlay companion-overlay--minimal" data-testid="companion-overlay-root">
      <SpeakerStack speakers={snapshot.activeSpeakers} />
      <EventFeed events={snapshot.recentEvents.slice(-3)} />
    </section>
  );
}
