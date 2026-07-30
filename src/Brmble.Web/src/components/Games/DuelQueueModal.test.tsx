import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DuelQueueSnapshot } from './useDuelQueueState';
import { DuelQueueModal } from './DuelQueueModal';
import { unknownEstimate } from './duelTestHarness';

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
            estimatedDuration: unknownEstimate,
          },
          {
            reservationId: 11,
            position: 2,
            players,
            gameType: 'deathroll',
            format: '1v1',
            rulesetVersion: 1,
            eta: { status: 'unknown', estimatedStartAt: null, milliseconds: null, approximate: true, segments: [] },
            estimatedDuration: unknownEstimate,
          },
        ],
      })}
      resolveName={resolveName}
      onClose={vi.fn()}
    />);

    expect(screen.getByText('1. Cara vs Dan')).toBeInTheDocument();
    expect(screen.getByText('Rock Paper Scissors · bo3 · v1')).toBeInTheDocument();
    expect(screen.getByText('About 24s')).toBeInTheDocument();
    expect(screen.getByText('2. Alice vs Bob')).toBeInTheDocument();
    expect(screen.getByText('Deathroll · 1v1 · v1')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('falls back to the user id, not the user-id session lookup, when a player has no session', () => {
    render(<DuelQueueModal
      snapshot={snapshot({
        active: {
          matchId: 3,
          status: 'live',
          startedAt: '2026-07-25T12:00:00Z',
          players: [
            { userId: 22, sessionId: 0, displayName: '', ready: false },
            { userId: 2, sessionId: 22, displayName: '', ready: false },
          ],
          gameType: 'rps',
          format: 'bo5',
          rulesetVersion: 2,
          remaining: { status: 'unknown', milliseconds: null, sampleCount: 0, method: 'insufficient', approximate: true },
          estimatedDuration: unknownEstimate,
        },
      })}
      resolveName={resolveName}
      onClose={vi.fn()}
    />);

    expect(screen.getByRole('region', { name: 'Active duel' })).toHaveTextContent('Player 22 vs Bob');
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
          estimatedDuration: unknownEstimate,
        },
      })}
      resolveName={resolveName}
      onClose={vi.fn()}
    />);

    expect(screen.getByRole('region', { name: 'Active duel' })).toHaveTextContent(status === 'starting' ? 'Starting' : 'Live');
    expect(screen.getByRole('region', { name: 'Active duel' })).toHaveTextContent('Alice vs Bob');
    expect(screen.getByRole('region', { name: 'Active duel' })).toHaveTextContent('Rock Paper Scissors · bo5 · v2');
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
          estimatedDuration: unknownEstimate,
        },
      })}
      resolveName={resolveName}
      onClose={vi.fn()}
    />);

    expect(screen.getByRole('region', { name: 'Ready check' })).toHaveTextContent('Alice Ready');
    expect(screen.getByRole('region', { name: 'Ready check' })).toHaveTextContent('Bob Waiting');
    expect(screen.getByRole('region', { name: 'Ready check' })).toHaveTextContent('Deathroll · 1v1 · v1');

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

  it('traps Tab and Shift+Tab inside the dialog', () => {
    const background = document.createElement('button');
    document.body.appendChild(background);
    const { unmount } = render(<DuelQueueModal snapshot={snapshot()} resolveName={resolveName} onClose={vi.fn()} />);
    const close = screen.getByRole('button', { name: 'Close duel activity' });

    background.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();

    background.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(close).toHaveFocus();

    close.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();

    unmount();
    background.remove();
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
      estimatedDuration: unknownEstimate,
    }));

    render(<DuelQueueModal snapshot={snapshot({ queue })} resolveName={resolveName} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Duel activity' });
    const content = screen.getByTestId('duel-activity-content');
    expect(dialog).toContainElement(content);
    expect(content).toContainElement(screen.getByText('20. Alice vs Bob'));
  });

  it('renders long player and format tokens inside wrapping content elements', () => {
    const longToken = 'A'.repeat(200);
    render(<DuelQueueModal snapshot={snapshot({ queue: [{
      reservationId: 1,
      position: 1,
      players: [{ ...players[0], displayName: longToken }, players[1]],
      gameType: 'rps',
      format: longToken,
      rulesetVersion: 1,
      eta: { status: 'unknown', estimatedStartAt: null, milliseconds: null, approximate: true, segments: [] },
      estimatedDuration: unknownEstimate,
    }] })} resolveName={resolveName} onClose={vi.fn()} />);

    expect(screen.getByText(`1. ${longToken} vs Bob`)).toBeInTheDocument();
    expect(screen.getByText(`Rock Paper Scissors · ${longToken} · v1`)).toBeInTheDocument();
  });
});
