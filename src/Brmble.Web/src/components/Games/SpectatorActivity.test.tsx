import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SpectatorActivity } from './SpectatorActivity';
import type { DuelQueueSnapshot, SpectatorSnapshot } from '../../api/games';

const resolveName = (sessionId: number) => ({ 10: 'Qy', 20: 'Broan', 30: 'Mo' }[sessionId] ?? String(sessionId));

const deathrollMatch: SpectatorSnapshot = {
  schemaVersion: 1, matchId: 91, channelId: 7, gameType: 'deathroll', format: '1v1', rulesetVersion: 1,
  players: [
    { userId: 100, sessionId: 10, displayName: 'Qy', ready: false },
    { userId: 200, sessionId: 20, displayName: 'Broan', ready: false },
  ],
  sequence: 3, generatedAt: '2026-08-24T14:30:04.000Z',
  view: { kind: 'deathroll', players: [10, 20], currentPlayer: 20, ceiling: 50, lastRoll: 73, finished: false, loserId: null },
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
  it('Live: renders the deathroll board', () => {
    render(<SpectatorActivity match={deathrollMatch} ended={null} queueSnapshot={null} resolveName={resolveName} onStopWatching={vi.fn()} />);
    expect(screen.getByText('Qy')).toBeInTheDocument();
    expect(screen.getByText('73')).toBeInTheDocument();
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
    expect(screen.getByText('73')).toBeInTheDocument();
    expect(screen.getByText(/Qy wins/)).toBeInTheDocument();
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
    render(
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
    const card = screen.getByTestId('spectator-next-up');
    expect(card).not.toHaveTextContent('Broan');
    expect(card).not.toHaveTextContent(/starts in/i);
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
});
