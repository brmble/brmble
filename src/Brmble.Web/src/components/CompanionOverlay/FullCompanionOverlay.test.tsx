import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createOverlaySnapshot, resolveFullCompanionDisplay, updateFullCompanionContext } from './overlayModel';
import { FullCompanionOverlay } from './FullCompanionOverlay';

describe('FullCompanionOverlay', () => {
  it('renders one idle local companion from atlas row 1 without a bubble', () => {
    const snapshot = resolveFullCompanionDisplay(createOverlaySnapshot('7', 'Raid'), 1_000);

    render(<FullCompanionOverlay snapshot={snapshot} position="bottom-left" />);

    expect(screen.getByTestId('companion-overlay-root')).toHaveClass('companion-overlay--position-bottom-left');
    expect(screen.getAllByTestId('companion-sprite')).toHaveLength(1);
    expect(screen.getByTestId('companion-sprite')).toHaveAttribute('data-row', '1');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders the speech balloon contract and badges for active chat display', () => {
    let snapshot = updateFullCompanionContext(createOverlaySnapshot('7', 'Raid'), {
      localMuted: true,
      liveUserSessions: [0],
    });
    snapshot = {
      ...snapshot,
      fullCompanion: {
        ...snapshot.fullCompanion,
        activeDisplay: {
          id: 'chat-1',
          kind: 'chat' as const,
          representedSession: 0,
          representedName: 'You',
          companionId: 'clip' as const,
          row: 4 as const,
          bubble: 'You: hello',
          startedAt: 1_000,
          expiresAt: 6_000,
          isProxy: false,
          badges: {
            muted: true,
            live: true,
          },
        },
      },
    };

    render(<FullCompanionOverlay snapshot={snapshot} position="bottom-left" />);

    const status = screen.getByRole('status');

    expect(screen.getByTestId('companion-sprite')).toHaveAttribute('data-row', '4');
    expect(status).toHaveAttribute('data-testid', 'companion-speech-balloon');
    expect(status).toHaveTextContent('You: hello');
    expect(screen.getByLabelText('Muted')).toBeInTheDocument();
    expect(screen.getByLabelText('Live')).toBeInTheDocument();
  });

  it('renders the speech balloon and speaker stack on right-positioned roots', () => {
    const snapshot = {
      ...createOverlaySnapshot('7', 'Raid'),
      fullCompanion: {
        ...createOverlaySnapshot('7', 'Raid').fullCompanion,
        activeDisplay: {
          id: 'chat-right',
          kind: 'chat' as const,
          representedSession: 0,
          representedName: 'You',
          companionId: 'clip' as const,
          row: 4 as const,
          bubble: 'Right side check',
          startedAt: 1_000,
          expiresAt: 6_000,
          isProxy: false,
          badges: {
            muted: false,
            live: true,
          },
        },
      },
    };

    render(<FullCompanionOverlay snapshot={snapshot} position="bottom-right" />);

    expect(screen.getByTestId('companion-overlay-root')).toHaveClass('companion-overlay--position-bottom-right');
    expect(screen.getByRole('status')).toHaveAttribute('data-testid', 'companion-speech-balloon');
    expect(screen.getByText('Right side check')).toBeInTheDocument();
  });
});
