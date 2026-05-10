import type { CompanionOverlaySnapshot } from './overlayTypes';
import { CompanionSprite } from './CompanionSprite';
import { SpeakerStack } from './SpeakerStack';

export function FullCompanionOverlay({ snapshot }: { snapshot: CompanionOverlaySnapshot }) {
  const latestEvent = snapshot.recentEvents[snapshot.recentEvents.length - 1] ?? null;

  return (
    <section className="companion-overlay companion-overlay--full" data-testid="companion-overlay-root">
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
