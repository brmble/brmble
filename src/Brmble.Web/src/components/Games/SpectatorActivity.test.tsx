import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SpectatorActivity } from './SpectatorActivity';
import { REVEAL_SECONDS } from './rpsShared';
import { snapshot as spectatorSnapshot } from './spectatorTestHarness';
import type { DuelQueueSnapshot, SpectatorSnapshot } from '../../api/games';

const resolveName = (sessionId: number) => ({ 10: 'Qy', 20: 'Broan', 30: 'Mo' }[sessionId] ?? String(sessionId));

const deathrollMatch: SpectatorSnapshot = {
  schemaVersion: 1, matchId: 91, channelId: 7, gameType: 'deathroll', format: '1v1', rulesetVersion: 1,
  players: [
    { userId: 100, sessionId: 10, displayName: 'Qy', ready: false },
    { userId: 200, sessionId: 20, displayName: 'Broan', ready: false },
  ],
  sequence: 3, generatedAt: '2026-08-24T14:30:04.000Z',
  view: { kind: 'deathroll', players: [10, 20], currentPlayer: 20, ceiling: 50, lastRoll: 73, lastRollBy: 10, finished: false, loserId: null },
};

const rpsMatch: SpectatorSnapshot = {
  ...deathrollMatch, gameType: 'rps', format: 'bo3',
  view: {
    kind: 'rps', players: [10, 20], bestOf: 3, targetWins: 2, roundNumber: 2,
    roundWins: [1, 0], committed: [true, false], finished: false, winnerId: null, lastRound: null,
  },
};

const queue = (over: Partial<DuelQueueSnapshot> = {}): DuelQueueSnapshot => ({
  schemaVersion: 1, generation: 1, revision: 1, channelId: 7,
  generatedAt: '2026-08-24T14:30:04.000Z', calculationTimeMs: 0,
  active: null, readyCheck: null, queue: [], ...over,
});

describe('SpectatorActivity', () => {
  it('renders an explicit unsupported notice rather than the Deathroll board', () => {
    render(
      <SpectatorActivity
        match={spectatorSnapshot({ gameType: 'arena-knockoff' })}
        ended={null}
        queueSnapshot={null}
        resolveName={() => 'Someone'}
        onStopWatching={() => {}}
      />,
    );

    expect(screen.getByTestId('spectator-unsupported-game')).toHaveTextContent(/arena-knockoff/);
    expect(screen.queryByTestId('deathroll-spectator-board')).toBeNull();
  });

  it('Live: renders the deathroll board', () => {
    render(<SpectatorActivity match={deathrollMatch} ended={null} queueSnapshot={null} resolveName={resolveName} onStopWatching={vi.fn()} />);
    expect(screen.getByText('Qy')).toBeInTheDocument();
    expect(screen.getByTestId('spectator-roll-10')).toHaveTextContent(/^73$/);
  });

  it('Live: names the watched game in the heading', () => {
    render(<SpectatorActivity match={deathrollMatch} ended={null} queueSnapshot={null} resolveName={resolveName} onStopWatching={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Deathroll');
  });

  it('Live: names an rps match in the heading', () => {
    render(<SpectatorActivity match={rpsMatch} ended={null} queueSnapshot={null} resolveName={resolveName} onStopWatching={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/rock|rps/i);
  });

  it('Idle: heads the panel Spectating, naming no game', () => {
    render(<SpectatorActivity match={null} ended={null} queueSnapshot={queue()} resolveName={resolveName} onStopWatching={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Spectating');
  });

  it('Live: renders the rps board for an rps view', () => {
    render(<SpectatorActivity match={rpsMatch} ended={null} queueSnapshot={null} resolveName={resolveName} onStopWatching={vi.fn()} />);
    expect(screen.getByTestId('spectator-commit-10')).toHaveTextContent(/thrown/i);
  });

  it('Ended: keeps the same board and shows the result', () => {
    render(
      <SpectatorActivity
        match={deathrollMatch}
        ended={{ schemaVersion: 1, matchId: 91, channelId: 7, reason: 'completed', finalSequence: 3, outcome: { winnerId: 10, loserId: 20, draw: false } }}
        queueSnapshot={null}
        resolveName={resolveName}
        onStopWatching={vi.fn()}
      />
    );
    expect(screen.getByTestId('spectator-roll-10')).toHaveTextContent(/^73$/);
    expect(screen.getByText(/Qy wins/)).toBeInTheDocument();
    // The board is HELD, not replaced by the Idle card.
    expect(screen.queryByTestId('spectator-next-up')).not.toBeInTheDocument();
  });

  it('Ended: plumbs the outcome into the rps board too', () => {
    render(
      <SpectatorActivity
        match={rpsMatch}
        ended={{ schemaVersion: 1, matchId: 91, channelId: 7, reason: 'completed', finalSequence: 3, outcome: { winnerId: 10, loserId: 20, draw: false } }}
        queueSnapshot={null}
        resolveName={resolveName}
        onStopWatching={vi.fn()}
      />
    );
    expect(screen.getByTestId('spectator-score-10')).toBeInTheDocument();
    expect(screen.getByText(/Qy wins/)).toBeInTheDocument();
    expect(screen.queryByTestId('spectator-next-up')).not.toBeInTheDocument();
  });

  it('Idle: shows the next-up pair, game and format from the queue snapshot', () => {
    render(
      <SpectatorActivity
        match={null} ended={null}
        queueSnapshot={queue({
          queue: [{
            reservationId: 5, position: 1,
            players: [
              { userId: 100, sessionId: 10, displayName: 'Qy', ready: true },
              { userId: 300, sessionId: 30, displayName: 'Mo', ready: true },
            ],
            gameType: 'rps', format: 'bo3', rulesetVersion: 1,
            eta: { status: 'unknown', estimatedStartAt: null, milliseconds: null, approximate: true, segments: [] },
            estimatedDuration: { status: 'unknown', milliseconds: null, sampleCount: 0, method: 'insufficient', approximate: true },
          }],
        })}
        resolveName={resolveName}
        onStopWatching={vi.fn()}
      />
    );
    const card = screen.getByTestId('spectator-next-up');
    expect(card).toHaveTextContent('Qy');
    expect(card).toHaveTextContent('Mo');
    expect(card).toHaveTextContent(/bo3/);
  });

  it('Idle: shows the ready-check waiting line when one is running', () => {
    render(
      <SpectatorActivity
        match={null} ended={null}
        queueSnapshot={queue({
          readyCheck: {
            reservationId: 5, expiresAt: '2026-08-24T14:31:04.000Z',
            players: [
              { userId: 100, sessionId: 10, displayName: 'Qy', ready: true },
              { userId: 300, sessionId: 30, displayName: 'Mo', ready: false },
            ],
            gameType: 'deathroll', format: '1v1', rulesetVersion: 1,
            estimatedDuration: { status: 'unknown', milliseconds: null, sampleCount: 0, method: 'insufficient', approximate: true },
          },
        })}
        resolveName={resolveName}
        onStopWatching={vi.fn()}
      />
    );
    expect(screen.getByTestId('spectator-next-up')).toHaveTextContent(/ready check/i);
  });

  it('Idle: says the channel is quiet when nothing is queued', () => {
    render(<SpectatorActivity match={null} ended={null} queueSnapshot={queue()} resolveName={resolveName} onStopWatching={vi.fn()} />);
    expect(screen.getByTestId('spectator-next-up')).toHaveTextContent(/waiting/i);
  });

  it('Idle: never lists the whole queue or an ETA', () => {
    const { container } = render(
      <SpectatorActivity
        match={null} ended={null}
        queueSnapshot={queue({
          queue: [
            { reservationId: 5, position: 1, players: [{ userId: 100, sessionId: 10, displayName: 'Qy', ready: true }, { userId: 300, sessionId: 30, displayName: 'Mo', ready: true }], gameType: 'rps', format: 'bo3', rulesetVersion: 1, eta: { status: 'known', estimatedStartAt: null, milliseconds: 60_000, approximate: false, segments: [] }, estimatedDuration: { status: 'unknown', milliseconds: null, sampleCount: 0, method: 'insufficient', approximate: true } },
            { reservationId: 6, position: 2, players: [{ userId: 200, sessionId: 20, displayName: 'Broan', ready: true }, { userId: 300, sessionId: 30, displayName: 'Mo', ready: true }], gameType: 'rps', format: 'bo3', rulesetVersion: 1, eta: { status: 'known', estimatedStartAt: null, milliseconds: 120_000, approximate: false, segments: [] }, estimatedDuration: { status: 'unknown', milliseconds: null, sampleCount: 0, method: 'insufficient', approximate: true } },
          ],
        })}
        resolveName={resolveName}
        onStopWatching={vi.fn()}
      />
    );
    // Container scope, not card scope: a regression that renders queue[1] as a
    // SIBLING of the next-up card would pass a card-scoped assertion.
    expect(screen.getByTestId('spectator-next-up')).toHaveTextContent('Qy');
    expect(screen.queryByText('Broan')).not.toBeInTheDocument();
    // The fixture's eta is 60_000ms, which the queue modal renders as
    // "Starts in about 1m" via formatDuration. Assert no such duration text
    // appears anywhere — that is what a real ETA regression would produce.
    expect(container.textContent).not.toMatch(/starts in/i);
    expect(container.textContent).not.toMatch(/estimated/i);
    expect(container.textContent).not.toMatch(/\b1m\b|\b60s\b/);
  });

  it.each([
    ['Live', deathrollMatch, null],
    ['Idle', null, null],
  ])('%s: offers Stop watching', (_label, match, ended) => {
    const onStopWatching = vi.fn();
    render(<SpectatorActivity match={match} ended={ended} queueSnapshot={null} resolveName={resolveName} onStopWatching={onStopWatching} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop watching' }));
    expect(onStopWatching).toHaveBeenCalledTimes(1);
  });

  it('Ended: still offers Stop watching', () => {
    const onStopWatching = vi.fn();
    render(
      <SpectatorActivity
        match={deathrollMatch}
        ended={{ schemaVersion: 1, matchId: 91, channelId: 7, reason: 'forfeited', finalSequence: 3, outcome: { winnerId: 10, loserId: 20, draw: false } }}
        queueSnapshot={null} resolveName={resolveName} onStopWatching={onStopWatching}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop watching' }));
    expect(onStopWatching).toHaveBeenCalledTimes(1);
  });

  it('offers no collapse or minimise affordance', () => {
    render(<SpectatorActivity match={deathrollMatch} ended={null} queueSnapshot={null} resolveName={resolveName} onStopWatching={vi.fn()} />);
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Stop watching']);
  });

  describe('match identity', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    const round1 = { roundNumber: 1, sequence: 1, pick0: 'rock', pick1: 'scissors', winnerId: 10, tie: false };
    const round2 = { roundNumber: 2, sequence: 2, pick0: 'paper', pick1: 'rock', winnerId: 10, tie: false };

    const rpsWith = (matchId: number, lastRound: unknown): SpectatorSnapshot => ({
      ...rpsMatch, matchId, view: { ...rpsMatch.view, lastRound } as SpectatorSnapshot['view'],
    });

    /*
     * The property the `key={match.matchId}` makes expressible at all. The board's
     * own null-`lastRound` backstop CANNOT cover this case: match 2's first DELIVERED
     * frame already carries a resolved round, so the backstop never fires and the
     * stale sequence mark from match 1 survives. Without the key, match 2's round 2
     * (sequence 2) fails `seq > shown` against match 1's mark and is adopted through
     * the ungated setter — revealed instantly, with no beat.
     */
    it('resets the reveal gate when the match id changes', () => {
      const { rerender } = render(
        <SpectatorActivity match={rpsWith(91, round2)} ended={null} queueSnapshot={null} resolveName={resolveName} onStopWatching={vi.fn()} />
      );
      expect(screen.getByTestId('spectator-pick-10')).toHaveAttribute('data-pick', 'paper');

      // New match, and its first delivered frame already has a resolved round.
      rerender(
        <SpectatorActivity match={rpsWith(92, round1)} ended={null} queueSnapshot={null} resolveName={resolveName} onStopWatching={vi.fn()} />
      );
      expect(screen.getByTestId('spectator-pick-10')).toHaveAttribute('data-pick', 'rock');

      // Match 2's round 2. Only a gate reset makes this hold for the beat.
      rerender(
        <SpectatorActivity match={rpsWith(92, round2)} ended={null} queueSnapshot={null} resolveName={resolveName} onStopWatching={vi.fn()} />
      );
      expect(screen.getByTestId('spectator-pick-10')).toHaveAttribute('data-pick', 'rock');
      expect(screen.getByTestId('spectator-last-round')).toHaveTextContent(/round 1/i);

      act(() => { vi.advanceTimersByTime(REVEAL_SECONDS * 1000); });

      expect(screen.getByTestId('spectator-pick-10')).toHaveAttribute('data-pick', 'paper');
      expect(screen.getByTestId('spectator-last-round')).toHaveTextContent(/round 2/i);
    });

    /*
     * The other half of the contract, and the reason the remount is safe:
     * `useSpectatorState` deliberately does not null `match` on
     * `game.spectatorMatchEnded`, so `matchId` is STABLE across the end of a match.
     * A remount here would drop the in-flight reveal and flash the end banner early.
     */
    it('does not remount when only the outcome arrives, so the end banner stays gated', () => {
      const { rerender } = render(
        <SpectatorActivity match={rpsWith(91, round1)} ended={null} queueSnapshot={null} resolveName={resolveName} onStopWatching={vi.fn()} />
      );

      // Deciding frame and the ended signal land together, same matchId.
      rerender(
        <SpectatorActivity
          match={rpsWith(91, round2)}
          ended={{ schemaVersion: 1, matchId: 91, channelId: 7, reason: 'completed', finalSequence: 2, outcome: { winnerId: 10, loserId: 20, draw: false } }}
          queueSnapshot={null} resolveName={resolveName} onStopWatching={vi.fn()}
        />
      );

      // Held: the reveal survived, so the banner is still gated.
      expect(screen.queryByText(/wins/i)).not.toBeInTheDocument();
      expect(screen.getByTestId('spectator-pick-10')).toHaveAttribute('data-pick', 'rock');

      act(() => { vi.advanceTimersByTime(REVEAL_SECONDS * 1000); });

      expect(screen.getByText(/Qy wins/)).toBeInTheDocument();
      expect(screen.getByTestId('spectator-pick-10')).toHaveAttribute('data-pick', 'paper');
    });
  });
});
