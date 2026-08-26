import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActiveDuel, QueuedDuel } from '../../api/games';
import type { DuelQueueSnapshot } from './useDuelQueueState';
import { SERVER_ROOT_CHANNEL_ID } from '../../workspace/presence';
import { DuelQueueModal } from './DuelQueueModal';
import { knownEstimate, unknownEstimate } from './duelTestHarness';

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

function activeEntry(overrides: Partial<ActiveDuel> = {}): ActiveDuel {
  return {
    matchId: 3,
    status: 'live',
    startedAt: '2026-07-29T00:00:00Z',
    players,
    gameType: 'rps',
    format: 'bo5',
    rulesetVersion: 2,
    remaining: unknownEstimate,
    estimatedDuration: unknownEstimate,
    ...overrides,
  };
}

function queuedEntry(overrides: Partial<QueuedDuel> = {}): QueuedDuel {
  return {
    reservationId: 10,
    position: 1,
    players,
    gameType: 'rps',
    format: 'bo3',
    rulesetVersion: 1,
    eta: { status: 'known', estimatedStartAt: null, milliseconds: 24_000, approximate: true, segments: [] },
    estimatedDuration: unknownEstimate,
    ...overrides,
  };
}

const resolveName = (id: number) => id === 22 ? 'Bob' : `Player ${id}`;

describe('DuelQueueModal', () => {
  /** Opt in per test, so a future async assertion in this file can't silently hang. */
  const useFakeClock = (isoTime: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(isoTime));
  };
  afterEach(() => vi.useRealTimers());

  it('renders ordered pairs, game metadata, and static server ETAs', () => {
    render(<DuelQueueModal
      snapshot={snapshot({
        queue: [
          queuedEntry({
            players: [
              { userId: 3, sessionId: 33, displayName: 'Cara', ready: false },
              { userId: 4, sessionId: 44, displayName: 'Dan', ready: false },
            ],
          }),
          queuedEntry({
            reservationId: 11,
            position: 2,
            gameType: 'deathroll',
            format: '1v1',
            eta: { status: 'unknown', estimatedStartAt: null, milliseconds: null, approximate: true, segments: [] },
          }),
        ],
      })}
      resolveName={resolveName}
      joinedChannelId="7"
      onWatch={vi.fn()}
      onClose={vi.fn()}
    />);

    expect(screen.getByText('1. Cara vs Dan')).toBeInTheDocument();
    expect(screen.getByText('Rock Paper Scissors · bo3 · v1')).toBeInTheDocument();
    expect(screen.getByText('Starts in about 24s')).toBeInTheDocument();
    expect(screen.getByText('2. Alice vs Bob')).toBeInTheDocument();
    expect(screen.getByText('Deathroll · 1v1 · v1')).toBeInTheDocument();
    expect(screen.getByText('Starts in: Unknown')).toBeInTheDocument();
  });

  it('falls back to the user id, not the user-id session lookup, when a player has no session', () => {
    render(<DuelQueueModal
      snapshot={snapshot({
        active: activeEntry({
          players: [
            { userId: 22, sessionId: 0, displayName: '', ready: false },
            { userId: 2, sessionId: 22, displayName: '', ready: false },
          ],
        }),
      })}
      resolveName={resolveName}
      joinedChannelId="7"
      onWatch={vi.fn()}
      onClose={vi.fn()}
    />);

    expect(screen.getByRole('region', { name: 'Active duel' })).toHaveTextContent('Player 22 vs Bob');
  });

  it.each(['starting', 'live'] as const)('renders an %s active duel', (status) => {
    render(<DuelQueueModal
      snapshot={snapshot({
        active: activeEntry({ status }),
      })}
      resolveName={resolveName}
      joinedChannelId="7"
      onWatch={vi.fn()}
      onClose={vi.fn()}
    />);

    expect(screen.getByRole('region', { name: 'Active duel' })).toHaveTextContent(status === 'starting' ? 'Starting' : 'Live');
    expect(screen.getByRole('region', { name: 'Active duel' })).toHaveTextContent('Alice vs Bob');
    expect(screen.getByRole('region', { name: 'Active duel' })).toHaveTextContent('Rock Paper Scissors · bo5 · v2');
    expect(screen.getByText('Estimated duration: Unknown')).toBeInTheDocument();
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
          estimatedDuration: knownEstimate(45_000),
        },
      })}
      resolveName={resolveName}
      joinedChannelId="7"
      onWatch={vi.fn()}
      onClose={vi.fn()}
    />);

    expect(screen.getByRole('region', { name: 'Ready check' })).toHaveTextContent('Alice Ready');
    expect(screen.getByRole('region', { name: 'Ready check' })).toHaveTextContent('Bob Waiting');
    expect(screen.getByRole('region', { name: 'Ready check' })).toHaveTextContent('Deathroll · 1v1 · v1');
    expect(screen.getByRole('region', { name: 'Ready check' })).toHaveTextContent('Estimated duration: ~45s');

    rerender(<DuelQueueModal snapshot={snapshot()} resolveName={resolveName} joinedChannelId="7" onWatch={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('No duel activity in this channel.')).toBeInTheDocument();
  });

  it('is an accessible dialog closed by Escape or the overlay', () => {
    const onClose = vi.fn();
    render(<DuelQueueModal snapshot={snapshot()} resolveName={resolveName} joinedChannelId="7" onWatch={vi.fn()} onClose={onClose} />);
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

    const { unmount } = render(<DuelQueueModal snapshot={snapshot()} resolveName={resolveName} joinedChannelId="7" onWatch={vi.fn()} onClose={onClose} />);

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
    const { unmount } = render(<DuelQueueModal snapshot={snapshot()} resolveName={resolveName} joinedChannelId="7" onWatch={vi.fn()} onClose={vi.fn()} />);
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
    const queue = Array.from({ length: 20 }, (_, index) => queuedEntry({
      reservationId: index + 1,
      position: index + 1,
      eta: { status: 'unknown', estimatedStartAt: null, milliseconds: null, approximate: true, segments: [] },
    }));

    render(<DuelQueueModal snapshot={snapshot({ queue })} resolveName={resolveName} joinedChannelId="7" onWatch={vi.fn()} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Duel activity' });
    const content = screen.getByTestId('duel-activity-content');
    expect(dialog).toContainElement(content);
    expect(content).toContainElement(screen.getByText('20. Alice vs Bob'));
  });

  it('renders long player and format tokens inside wrapping content elements', () => {
    const longToken = 'A'.repeat(200);
    render(<DuelQueueModal snapshot={snapshot({ queue: [queuedEntry({
      reservationId: 1,
      players: [{ ...players[0], displayName: longToken }, players[1]],
      format: longToken,
      eta: { status: 'unknown', estimatedStartAt: null, milliseconds: null, approximate: true, segments: [] },
    })] })} resolveName={resolveName} joinedChannelId="7" onWatch={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText(`1. ${longToken} vs Bob`)).toBeInTheDocument();
    expect(screen.getByText(`Rock Paper Scissors · ${longToken} · v1`)).toBeInTheDocument();
  });

  it('shows estimated duration, elapsed time, and remaining time for a live duel', () => {
    useFakeClock('2026-07-29T00:00:12Z');
    render(<DuelQueueModal
      snapshot={snapshot({ active: activeEntry({ estimatedDuration: knownEstimate(25_000) }) })}
      resolveName={resolveName}
      joinedChannelId="7"
      onWatch={vi.fn()}
      onClose={vi.fn()}
    />);

    expect(screen.getByText(/Estimated duration: ~25s/)).toBeInTheDocument();
    expect(screen.getByText(/Elapsed: 12s/)).toBeInTheDocument();
    expect(screen.getByText(/Ends in about 13s/)).toBeInTheDocument();
  });

  it('shows time over estimate once a live duel passes its estimate', () => {
    useFakeClock('2026-07-29T00:00:31Z');
    render(<DuelQueueModal
      snapshot={snapshot({ active: activeEntry({ estimatedDuration: knownEstimate(25_000) }) })}
      resolveName={resolveName}
      joinedChannelId="7"
      onWatch={vi.fn()}
      onClose={vi.fn()}
    />);

    expect(screen.getByText(/6s over estimate/)).toBeInTheDocument();
  });

  it('ticks the elapsed time every second', () => {
    useFakeClock('2026-07-29T00:00:05Z');
    render(<DuelQueueModal
      snapshot={snapshot({ active: activeEntry({ estimatedDuration: knownEstimate(25_000) }) })}
      resolveName={resolveName}
      joinedChannelId="7"
      onWatch={vi.fn()}
      onClose={vi.fn()}
    />);

    act(() => { vi.advanceTimersByTime(2000); });

    expect(screen.getByText(/Elapsed: 7s/)).toBeInTheDocument();
  });

  it('shows each queued duel its own estimate and an unknown start when blocked', () => {
    render(<DuelQueueModal
      snapshot={snapshot({
        queue: [queuedEntry({
          estimatedDuration: knownEstimate(25_000),
          eta: { status: 'unknown', estimatedStartAt: null, milliseconds: null, approximate: true, segments: [] },
        })],
      })}
      resolveName={resolveName}
      joinedChannelId="7"
      onWatch={vi.fn()}
      onClose={vi.fn()}
    />);

    expect(screen.getByText(/Estimated duration: ~25s/)).toBeInTheDocument();
    expect(screen.getByText(/Starts in: Unknown/)).toBeInTheDocument();
  });

  it('shows elapsed time without a prediction when the duration is unknown', () => {
    useFakeClock('2026-07-29T00:00:09Z');
    render(<DuelQueueModal
      snapshot={snapshot({ active: activeEntry({ estimatedDuration: unknownEstimate }) })}
      resolveName={resolveName}
      joinedChannelId="7"
      onWatch={vi.fn()}
      onClose={vi.fn()}
    />);

    expect(screen.getByText(/Estimated duration: Unknown/)).toBeInTheDocument();
    expect(screen.getByText(/Elapsed: 9s/)).toBeInTheDocument();
    expect(screen.queryByText(/over estimate/)).toBeNull();
    expect(screen.queryByText(/Ends in/)).toBeNull();
  });

  it('formats minute durations', () => {
    const { rerender } = render(<DuelQueueModal
      snapshot={snapshot({ queue: [queuedEntry({ estimatedDuration: knownEstimate(65_000) })] })}
      resolveName={resolveName}
      joinedChannelId="7"
      onWatch={vi.fn()}
      onClose={vi.fn()}
    />);

    expect(screen.getByText(/Estimated duration: ~1m 5s/)).toBeInTheDocument();

    rerender(<DuelQueueModal
      snapshot={snapshot({ queue: [queuedEntry({ estimatedDuration: knownEstimate(60_000) })] })}
      resolveName={resolveName}
      joinedChannelId="7"
      onWatch={vi.fn()}
      onClose={vi.fn()}
    />);

    expect(screen.getByText(/Estimated duration: ~1m$/)).toBeInTheDocument();
  });

  it('seeds elapsed time when a duel starts while the modal is already open', () => {
    useFakeClock('2026-07-29T00:00:00Z');
    const { rerender } = render(<DuelQueueModal
      snapshot={snapshot({ queue: [queuedEntry()] })}
      resolveName={resolveName}
      joinedChannelId="7"
      onWatch={vi.fn()}
      onClose={vi.fn()}
    />);

    // Nothing is live, so no interval is refreshing `now` while time passes.
    act(() => { vi.advanceTimersByTime(120_000); });
    rerender(<DuelQueueModal
      snapshot={snapshot({ active: activeEntry({ startedAt: '2026-07-29T00:01:52Z' }) })}
      resolveName={resolveName}
      joinedChannelId="7"
      onWatch={vi.fn()}
      onClose={vi.fn()}
    />);

    expect(screen.getByText(/Elapsed: 8s/)).toBeInTheDocument();
  });

  const snapshotWithActive = (channelId: number) => snapshot({ channelId, active: activeEntry() });
  const emptySnapshot = (channelId: number) => snapshot({ channelId });

  it('offers Watch on the active duel when it is in the joined channel', () => {
    const onWatch = vi.fn();
    render(
      <DuelQueueModal
        snapshot={snapshotWithActive(7)}
        resolveName={resolveName}
        joinedChannelId="7"
        onWatch={onWatch}
        onClose={vi.fn()}
      />,
    );

    const watch = screen.getByRole('button', { name: 'Watch' });
    expect(watch).toBeEnabled();
    fireEvent.click(watch);
    expect(onWatch).toHaveBeenCalledTimes(1);
  });

  it('disables Watch for a duel in another channel', () => {
    render(
      <DuelQueueModal
        snapshot={snapshotWithActive(8)}
        resolveName={resolveName}
        joinedChannelId="7"
        onWatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Watch' })).toBeDisabled();
  });

  it('disables Watch when no channel is joined', () => {
    render(
      <DuelQueueModal
        snapshot={snapshotWithActive(7)}
        resolveName={resolveName}
        joinedChannelId={null}
        onWatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Watch' })).toBeDisabled();
  });

  it('offers no Watch button when no duel is active', () => {
    render(
      <DuelQueueModal
        snapshot={emptySnapshot(7)}
        resolveName={resolveName}
        joinedChannelId="7"
        onWatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Watch' })).not.toBeInTheDocument();
  });

  it('remains read-only apart from Watch and Close', () => {
    render(
      <DuelQueueModal
        snapshot={snapshotWithActive(7)}
        resolveName={resolveName}
        joinedChannelId="7"
        onWatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const names = screen.getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent);
    expect(new Set(names)).toEqual(new Set(['Close duel activity', 'Watch']));
  });

  it('disables Watch while standing in server-root, which owns no activities', () => {
    render(
      <DuelQueueModal
        snapshot={snapshotWithActive(7)}
        resolveName={resolveName}
        joinedChannelId={SERVER_ROOT_CHANNEL_ID}
        onWatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Watch' })).toBeDisabled();
  });

  it('explains the same-channel constraint on hover in both states', () => {
    useFakeClock('2026-07-29T00:00:12Z');
    const { rerender } = render(
      <DuelQueueModal
        snapshot={snapshotWithActive(8)}
        resolveName={resolveName}
        joinedChannelId="7"
        onWatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.mouseEnter(screen.getByTestId('duel-watch-trigger'));
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.getByRole('tooltip')).toHaveTextContent('You can only watch a duel in the channel you have joined');

    fireEvent.mouseLeave(screen.getByTestId('duel-watch-trigger'));
    rerender(
      <DuelQueueModal
        snapshot={snapshotWithActive(7)}
        resolveName={resolveName}
        joinedChannelId="7"
        onWatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.mouseEnter(screen.getByTestId('duel-watch-trigger'));
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Watch this duel');
  });

  it('makes the tooltip wrapper focusable while Watch is disabled', () => {
    // A disabled button takes no focus, and Tooltip shows on the trigger's focus, so
    // without a focusable wrapper the same-channel explanation is hover-only.
    render(
      <DuelQueueModal
        snapshot={snapshotWithActive(8)}
        resolveName={resolveName}
        joinedChannelId="7"
        onWatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Watch' })).toBeDisabled();
    expect(screen.getByTestId('duel-watch-trigger')).toHaveAttribute('tabindex', '0');
  });

  it('leaves the tooltip wrapper out of the tab order while Watch is enabled', () => {
    // The enabled button already provides the tab stop; a second one on a role-less
    // span would be an unnamed stop, so the wrapper must not be focusable here.
    render(
      <DuelQueueModal
        snapshot={snapshotWithActive(7)}
        resolveName={resolveName}
        joinedChannelId="7"
        onWatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Watch' })).toBeEnabled();
    expect(screen.getByTestId('duel-watch-trigger')).not.toHaveAttribute('tabindex');
  });
});
