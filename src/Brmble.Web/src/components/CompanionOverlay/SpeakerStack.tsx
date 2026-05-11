import type { CompanionSpeakerEntry } from './overlayTypes';

export function SpeakerStack({ speakers }: { speakers: CompanionSpeakerEntry[] }) {
  return (
    <ol className="overlay-speaker-stack" aria-label="Active speakers">
      {speakers.slice(0, 3).map((speaker) => (
        <li
          key={speaker.session}
          className={`overlay-speaker-pill ${speaker.isSpeaking ? 'overlay-speaker-pill--speaking' : 'overlay-speaker-pill--silent'}`}
        >
          <span className="overlay-speaker-dot" />
          <span>{speaker.name}</span>
        </li>
      ))}
    </ol>
  );
}
