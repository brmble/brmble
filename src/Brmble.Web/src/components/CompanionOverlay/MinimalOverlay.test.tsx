import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MinimalOverlay } from './MinimalOverlay';

describe('MinimalOverlay', () => {
  it('shows the top three speakers and recent event lines', () => {
    render(
      <MinimalOverlay
        snapshot={{
          currentChannelId: '7',
          currentChannelName: 'Raid',
          visualState: 'speaking-nearby',
          lastActivityAt: 100,
          activeSpeakers: [
            { session: 1, name: 'Milo', channelId: 7, isSpeaking: true, startedAt: 1, lastSpokeAt: 5, expiresAt: 10 },
            { session: 2, name: 'Qy', channelId: 7, isSpeaking: false, startedAt: 1, lastSpokeAt: 4, expiresAt: 10 },
            { session: 3, name: 'Kira', channelId: 7, isSpeaking: true, startedAt: 1, lastSpokeAt: 3, expiresAt: 10 },
          ],
          recentEvents: [
            { id: 'e1', kind: 'direct-message', actorName: 'Qy', line: 'DM from Qy: how are you', timestamp: 99 },
          ],
        }}
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
    const { container } = render(
      <MinimalOverlay
        snapshot={{
          currentChannelId: '7',
          currentChannelName: 'Raid',
          visualState: 'quiet',
          lastActivityAt: 100,
          activeSpeakers: [],
          recentEvents: [],
        }}
        position="bottom-right"
      />
    );

    expect(screen.queryByTestId('companion-overlay-root')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });
});
