import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createOverlaySnapshot } from './overlayModel';
import { MinimalOverlay } from './MinimalOverlay';

describe('MinimalOverlay', () => {
  it('shows the top three speakers and recent event lines', () => {
    const snapshot = {
      ...createOverlaySnapshot('7', 'Raid'),
      visualState: 'speaking-nearby' as const,
      lastActivityAt: 100,
      activeSpeakers: [
        { session: 1, name: 'Milo', channelId: 7, isSpeaking: true, startedAt: 1, lastSpokeAt: 5, expiresAt: 10 },
        { session: 2, name: 'Qy', channelId: 7, isSpeaking: false, startedAt: 1, lastSpokeAt: 4, expiresAt: 10 },
        { session: 3, name: 'Kira', channelId: 7, isSpeaking: true, startedAt: 1, lastSpokeAt: 3, expiresAt: 10 },
      ],
      recentEvents: [
        { id: 'e1', kind: 'direct-message' as const, actorName: 'Qy', line: 'DM from Qy: how are you', timestamp: 99 },
      ],
    };

    render(
      <MinimalOverlay
        snapshot={snapshot}
        position="top-left"
      />
    );

    expect(screen.getByText('Milo')).toBeInTheDocument();
    expect(screen.getByText('Qy')).toBeInTheDocument();
    expect(screen.getByText('Kira')).toBeInTheDocument();
    expect(screen.getByText('DM from Qy: how are you')).toBeInTheDocument();
    expect(screen.getByTestId('companion-overlay-root')).toHaveClass('companion-overlay--position-top-left');
    expect(screen.getByText('Qy').closest('.overlay-speaker-pill')).toHaveClass('overlay-speaker-pill--silent');
    expect(screen.queryByText('Brmblegotchi')).toBeNull();
    expect(screen.queryByText('Raid')).toBeNull();
  });

  it('renders nothing when there is no active speaker or fresh text', () => {
    const snapshot = {
      ...createOverlaySnapshot('7', 'Raid'),
      visualState: 'quiet' as const,
      lastActivityAt: 100,
    };

    const { container } = render(
      <MinimalOverlay
        snapshot={snapshot}
        position="bottom-right"
      />
    );

    expect(screen.queryByTestId('companion-overlay-root')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('does not render full companion active display data', () => {
    const baseSnapshot = createOverlaySnapshot('7', 'Raid');
    const snapshot = {
      ...baseSnapshot,
      fullCompanion: {
        ...baseSnapshot.fullCompanion,
        activeDisplay: {
          id: 'chat-1',
          kind: 'chat' as const,
          representedSession: 99,
          representedName: 'Milo',
          companionId: 'clip' as const,
          row: 4 as const,
          bubble: 'Milo: full mode only',
          startedAt: 1_000,
          expiresAt: 6_000,
          isProxy: false,
          badges: {
            muted: false,
            live: false,
          },
        },
      },
      recentEvents: [
        { id: 'e1', kind: 'user-joined' as const, actorName: 'Kira', line: 'Kira joined the channel', timestamp: 1_000, channelId: '7' },
      ],
    };

    render(<MinimalOverlay snapshot={snapshot} position="top-left" />);

    expect(screen.queryByText('Milo: full mode only')).toBeNull();
    expect(screen.queryByTestId('companion-sprite')).toBeNull();
    expect(screen.getByText('Kira joined the channel')).toBeInTheDocument();
  });
});
