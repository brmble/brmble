import type { CompanionOverlayEvent } from './overlayTypes';

export function EventFeed({ events }: { events: CompanionOverlayEvent[] }) {
  if (events.length === 0) {
    return null;
  }

  return (
    <ol className="overlay-event-feed" aria-label="Recent events">
      {events.map((event) => (
        <li key={event.id} className="overlay-event-line">{event.line}</li>
      ))}
    </ol>
  );
}
