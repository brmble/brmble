import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FullCompanionOverlay } from './FullCompanionOverlay';

describe('FullCompanionOverlay', () => {
  it('renders the companion bubble and nearby speakers', () => {
    render(
      <FullCompanionOverlay
        snapshot={{
          currentChannelId: '7',
          currentChannelName: 'Raid',
          visualState: 'dm',
          lastActivityAt: 100,
          activeSpeakers: [
            { session: 1, name: 'Milo', channelId: 7, startedAt: 1, lastSpokeAt: 5, expiresAt: 10 },
          ],
          recentEvents: [
            { id: 'e1', kind: 'direct-message', actorName: 'Qy', line: 'DM from Qy: how are you', timestamp: 99 },
          ],
        }}
      />
    );

    expect(screen.getByText('DM from Qy: how are you')).toBeInTheDocument();
    expect(screen.getByText('Milo')).toBeInTheDocument();
    expect(screen.getByAltText('Brmblegotchi companion')).toBeInTheDocument();
  });
});
