import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DuelQueueSnapshot } from './useDuelQueueState';
import { DuelQueueModal } from './DuelQueueModal';

const players = [
  { userId: 1, sessionId: 11, displayName: 'Alice', ready: true },
  { userId: 2, sessionId: 22, displayName: '', ready: false },
];

function snapshot(overrides: Partial<DuelQueueSnapshot> = {}): DuelQueueSnapshot {
  return {
    schemaVersion: 1,
    channelId: 7,
    generation: 1,
    revision: 2,
    generatedAt: '2026-07-25T12:00:00Z',
    calculationTimeMs: 2,
    active: null,
    readyCheck: null,
    queue: [],
    ...overrides,
  };
}

const resolveName = (id: number) => id === 22 ? 'Bob' : `Player ${id}`;

describe('DuelQueueModal', () => {
  it('renders ordered pairs, game metadata, and static server ETAs', () => {
    render(<DuelQueueModal
      snapshot={snapshot({
        queue: [
          {
            reservationId: 10,
            position: 1,
            players: [
              { userId: 3, sessionId: 33, displayName: 'Cara', ready: false },
              { userId: 4, sessionId: 44, displayName: 'Dan', ready: false },
            ],
            gameType: 'rps',
            format: 'bo3',
            rulesetVersion: 1,
            eta: { status: 'known', estimatedStartAt: null, milliseconds: 24_000, approximate: true, segments: [] },
          },
          {
            reservationId: 11,
            position: 2,
            players,
            gameType: 'deathroll',
            format: '1v1',
            rulesetVersion: 1,
            eta: { status: 'unknown', estimatedStartAt: null, milliseconds: null, approximate: true, segments: [] },
          },
        ],
      })}
      resolveName={resolveName}
      onClose={vi.fn()}
    />);

    expect(screen.getByText('1. Cara vs Dan')).toBeInTheDocument();
    expect(screen.getByText('Rock Paper Scissors · bo3')).toBeInTheDocument();
    expect(screen.getByText('About 24s')).toBeInTheDocument();
    expect(screen.getByText('2. Alice vs Bob')).toBeInTheDocument();
    expect(screen.getByText('Deathroll · 1v1')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it.each(['starting', 'live'] as const)('renders an %s active duel', (status) => {
    render(<DuelQueueModal
      snapshot={snapshot({
        active: {
          matchId: 3,
          status,
          startedAt: '2026-07-25T12:00:00Z',
          players,
          gameType: 'rps',
          format: 'bo5',
          rulesetVersion: 2,
          remaining: { status: 'known', milliseconds: 61_000, sampleCount: 20, method: 'fullMedian', approximate: true },
        },
      })}
      resolveName={resolveName}
      onClose={vi.fn()}
    />);

    expect(screen.getByRole('region', { name: 'Active duel' })).toHaveTextContent(status === 'starting' ? 'Starting' : 'Live');
    expect(screen.getByRole('region', { name: 'Active duel' })).toHaveTextContent('Alice vs Bob');
    expect(screen.getByText('About 1m 1s')).toBeInTheDocument();
  });

  it('renders ready state and a compact empty state', () => {
    const { rerender } = render(<DuelQueueModal
      snapshot={snapshot({
        readyCheck: {
          reservationId: 4,
          expiresAt: '2026-07-25T12:00:15Z',
          players,
          gameType: 'deathroll',
          format: '1v1',
          rulesetVersion: 1,
        },
      })}
      resolveName={resolveName}
      onClose={vi.fn()}
    />);

    expect(screen.getByRole('region', { name: 'Ready check' })).toHaveTextContent('Alice Ready');
    expect(screen.getByRole('region', { name: 'Ready check' })).toHaveTextContent('Bob Waiting');

    rerender(<DuelQueueModal snapshot={snapshot()} resolveName={resolveName} onClose={vi.fn()} />);
    expect(screen.getByText('No duel activity in this channel.')).toBeInTheDocument();
  });

  it('is an accessible dialog closed by Escape or the overlay', () => {
    const onClose = vi.fn();
    render(<DuelQueueModal snapshot={snapshot()} resolveName={resolveName} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Duel activity' });

    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(dialog.parentElement!);

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('focuses the close button and handles document Escape once', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const onClose = vi.fn();

    const { unmount } = render(<DuelQueueModal snapshot={snapshot()} resolveName={resolveName} onClose={onClose} />);

    expect(screen.getByRole('button', { name: 'Close duel activity' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();

    unmount();
    expect(outside).toHaveFocus();
    outside.remove();
  });

  it('keeps long queue content in a dedicated scroll region', () => {
    const queue = Array.from({ length: 20 }, (_, index) => ({
      reservationId: index + 1,
      position: index + 1,
      players,
      gameType: 'rps',
      format: 'bo3',
      rulesetVersion: 1,
      eta: { status: 'unknown' as const, estimatedStartAt: null, milliseconds: null, approximate: true as const, segments: [] },
    }));

    render(<DuelQueueModal snapshot={snapshot({ queue })} resolveName={resolveName} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Duel activity' });
    const content = screen.getByTestId('duel-activity-content');
    expect(dialog).toContainElement(content);
    expect(content).toContainElement(screen.getByText('20. Alice vs Bob'));
  });
});
