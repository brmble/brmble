import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createOverlaySnapshot } from './overlayModel';
import { OverlayApp } from './OverlayApp';

describe('OverlayApp', () => {
  it('renders nothing when the overlay is disabled', () => {
    render(<OverlayApp initialState={{ enabled: false, mode: 'minimal', settings: null, snapshot: null }} />);
    expect(screen.queryByTestId('companion-overlay-root')).toBeNull();
  });

  it('falls back to bottom-right when the sync payload has no position yet', () => {
    const snapshot = {
      ...createOverlaySnapshot('7', 'Raid'),
      visualState: 'speaking-nearby' as const,
      lastActivityAt: 100,
      activeSpeakers: [
        { session: 1, name: 'Milo', channelId: 7, isSpeaking: true, startedAt: 1, lastSpokeAt: 5, expiresAt: 10 },
      ],
    };

    render(
      <OverlayApp
        initialState={{
          enabled: true,
          mode: 'minimal',
          settings: null,
          snapshot,
        }}
      />
    );

    expect(screen.getByTestId('companion-overlay-root')).toHaveClass('companion-overlay--position-bottom-right');
  });
});
