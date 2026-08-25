import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { RpsSpectatorBoard } from './RpsSpectatorBoard';
import { REVEAL_SECONDS } from './rpsShared';
import type { DuelPlayer, RpsSpectatorView } from '../../api/games';

const players: DuelPlayer[] = [
  { userId: 100, sessionId: 10, displayName: 'Qy', ready: false },
  { userId: 200, sessionId: 20, displayName: 'Broan', ready: false },
];

const unresolved: RpsSpectatorView = {
  kind: 'rps',
  players: [10, 20],
  bestOf: 3,
  targetWins: 2,
  roundNumber: 2,
  roundWins: [1, 0],
  committed: [true, false],
  finished: false,
  winnerId: null,
  lastRound: null,
};

describe('RpsSpectatorBoard', () => {
  it('renders commitment as a state, never as a throw', () => {
    const { container } = render(
      <RpsSpectatorBoard view={unresolved} players={players} outcome={null} />,
    );

    expect(screen.getByTestId('spectator-commit-10')).toHaveTextContent(/thrown/i);
    expect(screen.getByTestId('spectator-commit-20')).toHaveTextContent(/choosing/i);

    const text = (container.textContent ?? '').toLowerCase();
    for (const throwName of ['rock', 'paper', 'scissors']) {
      expect(text).not.toContain(throwName);
    }
  });

  // The steady state of a live match is round N+1 in progress WITH round N sitting in
  // `lastRound`, so the throw names legitimately appear on screen. A whole-container scan is
  // unusable here — assert on the commit cells themselves, which is where a leak would land.
  it('keeps the commit cells free of throws even while a resolved round is on screen', () => {
    render(
      <RpsSpectatorBoard
        view={{
          ...unresolved,
          lastRound: {
            roundNumber: 1,
            sequence: 1,
            pick0: 'rock',
            pick1: 'scissors',
            winnerId: 10,
            tie: false,
          },
        }}
        players={players}
        outcome={null}
      />,
    );

    for (const sessionId of [10, 20]) {
      const commit = (screen.getByTestId(`spectator-commit-${sessionId}`).textContent ?? '')
        .toLowerCase();
      for (const throwName of ['rock', 'paper', 'scissors']) {
        expect(commit).not.toContain(throwName);
      }
    }

    // ...and they still carry their real state, so this cannot pass by blanking.
    expect(screen.getByTestId('spectator-commit-10')).toHaveTextContent(/thrown/i);
    expect(screen.getByTestId('spectator-commit-20')).toHaveTextContent(/choosing/i);
  });

  it('shows the running score against bestOf and targetWins', () => {
    render(<RpsSpectatorBoard view={unresolved} players={players} outcome={null} />);
    expect(screen.getByTestId('spectator-score-10')).toHaveTextContent('1');
    expect(screen.getByTestId('spectator-score-20')).toHaveTextContent('0');
    expect(screen.getByText(/best of 3/i)).toBeInTheDocument();
  });

  it('reveals both throws only from lastRound', () => {
    render(
      <RpsSpectatorBoard
        view={{
          ...unresolved,
          lastRound: {
            roundNumber: 1,
            sequence: 1,
            pick0: 'rock',
            pick1: 'scissors',
            winnerId: 10,
            tie: false,
          },
        }}
        players={players}
        outcome={null}
      />,
    );
    const lastRound = screen.getByTestId('spectator-last-round');
    expect(lastRound).toHaveTextContent(/rock/i);
    expect(lastRound).toHaveTextContent(/scissors/i);
    expect(lastRound).toHaveTextContent(/Qy/);
  });

  it('labels a tied round', () => {
    render(
      <RpsSpectatorBoard
        view={{
          ...unresolved,
          lastRound: {
            roundNumber: 1,
            sequence: 1,
            pick0: 'rock',
            pick1: 'rock',
            winnerId: null,
            tie: true,
          },
        }}
        players={players}
        outcome={null}
      />,
    );
    expect(screen.getByTestId('spectator-last-round')).toHaveTextContent(/tie/i);
  });

  it('renders "no throw" for an idle timeout without inventing a pick', () => {
    render(
      <RpsSpectatorBoard
        view={{
          ...unresolved,
          lastRound: {
            roundNumber: 1,
            sequence: 1,
            pick0: 'none',
            pick1: 'scissors',
            winnerId: 20,
            tie: false,
          },
        }}
        players={players}
        outcome={null}
      />,
    );
    expect(screen.getByTestId('spectator-last-round')).toHaveTextContent(/no throw/i);
  });

  it('renders no interactive control at all', () => {
    render(<RpsSpectatorBoard view={unresolved} players={players} outcome={null} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('carries no dialog semantics', () => {
    const { container } = render(
      <RpsSpectatorBoard view={unresolved} players={players} outcome={null} />,
    );
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
    expect(container.querySelector('[aria-modal]')).toBeNull();
  });

  it('falls back to the session id when a name cannot be resolved', () => {
    render(<RpsSpectatorBoard view={unresolved} players={[]} outcome={null} />);
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  it('announces the winner once the match has ended', () => {
    render(
      <RpsSpectatorBoard
        view={{
          ...unresolved,
          finished: true,
          winnerId: 10,
          roundWins: [2, 0],
          committed: [false, false],
        }}
        players={players}
        outcome={{ winnerId: 10, loserId: 20, draw: false }}
      />,
    );
    expect(screen.getByText(/Qy wins/)).toBeInTheDocument();
  });

  it('announces a bare end when the match finished without a winner or a draw', () => {
    render(
      <RpsSpectatorBoard
        view={{ ...unresolved, finished: true, winnerId: null, committed: [false, false] }}
        players={players}
        outcome={{ winnerId: null, loserId: null, draw: false }}
      />,
    );
    expect(screen.getByText('The match has ended.')).toBeInTheDocument();
  });

  it('degrades safely when roundWins and committed are shorter than players', () => {
    render(
      <RpsSpectatorBoard
        view={{ ...unresolved, roundWins: [1], committed: [true] }}
        players={players}
        outcome={null}
      />,
    );
    expect(screen.getByTestId('spectator-score-20')).toHaveTextContent('0');
    expect(screen.getByTestId('spectator-commit-20')).toHaveTextContent(/choosing/i);
  });

  it("shows each player's throw from the resolved round on their own card", () => {
    render(
      <RpsSpectatorBoard
        view={{
          ...unresolved,
          lastRound: { roundNumber: 1, sequence: 1, pick0: 'rock', pick1: 'scissors', winnerId: 10, tie: false },
        }}
        players={players}
        outcome={null}
      />,
    );
    expect(screen.getByTestId('spectator-pick-10')).toHaveAttribute('data-pick', 'rock');
    expect(screen.getByTestId('spectator-pick-20')).toHaveAttribute('data-pick', 'scissors');
  });

  it('shows no throw on either card before the first round resolves', () => {
    render(<RpsSpectatorBoard view={unresolved} players={players} outcome={null} />);
    expect(screen.queryByTestId('spectator-pick-10')).not.toBeInTheDocument();
    expect(screen.queryByTestId('spectator-pick-20')).not.toBeInTheDocument();
  });

  it('renders an idle timeout as no-throw rather than inventing an icon', () => {
    render(
      <RpsSpectatorBoard
        view={{
          ...unresolved,
          lastRound: { roundNumber: 1, sequence: 1, pick0: 'none', pick1: 'scissors', winnerId: 20, tie: false },
        }}
        players={players}
        outcome={null}
      />,
    );
    const idle = screen.getByTestId('spectator-pick-10');
    expect(idle).toHaveAttribute('data-pick', 'none');
    expect(idle).toHaveTextContent(/no throw/i);
    expect(idle.querySelector('svg')).toBeNull();
  });

  it('never shows an icon for the round currently in progress', () => {
    // The dangerous state: round 2 is being played while round 1's reveal is on screen.
    // Round 1 was rock/scissors; if a card ever showed 'paper' it could only have come
    // from the live round, which the wire does not carry and the board must not invent.
    render(
      <RpsSpectatorBoard
        view={{
          ...unresolved,
          roundNumber: 2,
          committed: [true, false],
          lastRound: { roundNumber: 1, sequence: 1, pick0: 'rock', pick1: 'scissors', winnerId: 10, tie: false },
        }}
        players={players}
        outcome={null}
      />,
    );
    for (const sessionId of [10, 20]) {
      const pick = screen.getByTestId(`spectator-pick-${sessionId}`).getAttribute('data-pick');
      expect(pick).toBe(sessionId === 10 ? 'rock' : 'scissors');
    }
  });

  it('names a throw as an image so the label is actually exposed', () => {
    render(
      <RpsSpectatorBoard
        view={{
          ...unresolved,
          lastRound: { roundNumber: 1, sequence: 1, pick0: 'rock', pick1: 'scissors', winnerId: 10, tie: false },
        }}
        players={players}
        outcome={null}
      />,
    );
    expect(screen.getByRole('img', { name: 'Qy threw Rock' })).toHaveAttribute('data-pick', 'rock');
  });

  it('does not double the label on a no-throw card', () => {
    render(
      <RpsSpectatorBoard
        view={{
          ...unresolved,
          lastRound: { roundNumber: 1, sequence: 1, pick0: 'none', pick1: 'scissors', winnerId: 20, tie: false },
        }}
        players={players}
        outcome={null}
      />,
    );
    const idle = screen.getByTestId('spectator-pick-10');
    expect(idle).toHaveTextContent(/no throw/i);
    // The accessible name states the fact once; it does not repeat the visible text.
    expect(idle.getAttribute('aria-label')).toBe('Qy did not throw');
  });

  it('attributes no throw to a player beyond the two the round carries', () => {
    render(
      <RpsSpectatorBoard
        view={{
          ...unresolved,
          players: [10, 20, 30],
          lastRound: { roundNumber: 1, sequence: 1, pick0: 'rock', pick1: 'scissors', winnerId: 10, tie: false },
        }}
        players={players}
        outcome={null}
      />,
    );
    expect(screen.getByTestId('spectator-pick-20')).toHaveAttribute('data-pick', 'scissors');
    expect(screen.queryByTestId('spectator-pick-30')).not.toBeInTheDocument();
  });

  describe('reveal beat', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    const round1 = { roundNumber: 1, sequence: 1, pick0: 'rock', pick1: 'scissors', winnerId: 10, tie: false };
    const round2 = { roundNumber: 2, sequence: 2, pick0: 'paper', pick1: 'rock', winnerId: 10, tie: false };

    it('adopts the first view immediately, without suspense', () => {
      render(<RpsSpectatorBoard view={{ ...unresolved, lastRound: round1 }} players={players} outcome={null} />);
      expect(screen.getByTestId('spectator-pick-10')).toHaveAttribute('data-pick', 'rock');
    });

    it('holds a newly resolved round, icons included, then reveals it', () => {
      const { rerender } = render(
        <RpsSpectatorBoard view={{ ...unresolved, lastRound: round1 }} players={players} outcome={null} />,
      );

      rerender(<RpsSpectatorBoard view={{ ...unresolved, lastRound: round2 }} players={players} outcome={null} />);

      // Still showing round 1 — the icons must not run ahead of the rest of the board.
      expect(screen.getByTestId('spectator-pick-10')).toHaveAttribute('data-pick', 'rock');
      expect(screen.getByTestId('spectator-last-round')).toHaveTextContent(/round 1/i);

      act(() => { vi.advanceTimersByTime(REVEAL_SECONDS * 1000); });

      expect(screen.getByTestId('spectator-pick-10')).toHaveAttribute('data-pick', 'paper');
      expect(screen.getByTestId('spectator-last-round')).toHaveTextContent(/round 2/i);
    });

    it('holds the score and commit cells too, not just the round text', () => {
      const { rerender } = render(
        <RpsSpectatorBoard
          view={{ ...unresolved, roundWins: [1, 0], committed: [true, true], lastRound: round1 }}
          players={players}
          outcome={null}
        />,
      );

      rerender(
        <RpsSpectatorBoard
          view={{ ...unresolved, roundWins: [2, 0], committed: [false, false], lastRound: round2 }}
          players={players}
          outcome={null}
        />,
      );

      expect(screen.getByTestId('spectator-score-10')).toHaveTextContent('1');
      expect(screen.getByTestId('spectator-commit-20')).toHaveTextContent(/thrown/i);

      act(() => { vi.advanceTimersByTime(REVEAL_SECONDS * 1000); });

      expect(screen.getByTestId('spectator-score-10')).toHaveTextContent('2');
      expect(screen.getByTestId('spectator-commit-20')).toHaveTextContent(/choosing/i);
    });

    it('lets a frame arriving mid-reveal supersede without revealing early', () => {
      const { rerender } = render(
        <RpsSpectatorBoard view={{ ...unresolved, lastRound: round1 }} players={players} outcome={null} />,
      );

      rerender(<RpsSpectatorBoard view={{ ...unresolved, lastRound: round2 }} players={players} outcome={null} />);

      act(() => { vi.advanceTimersByTime((REVEAL_SECONDS - 1) * 1000); });

      // A later frame for the same resolution (round 3's commit state landing).
      rerender(
        <RpsSpectatorBoard
          view={{ ...unresolved, roundNumber: 3, committed: [true, false], lastRound: round2 }}
          players={players}
          outcome={null}
        />,
      );

      // It must not have jumped the queue: round 1 is still on screen.
      expect(screen.getByTestId('spectator-pick-10')).toHaveAttribute('data-pick', 'rock');

      act(() => { vi.advanceTimersByTime(1000); });

      // One reveal, latest-wins: round 2's throws with round 3's commit state.
      expect(screen.getByTestId('spectator-pick-10')).toHaveAttribute('data-pick', 'paper');
      expect(screen.getByTestId('spectator-commit-10')).toHaveTextContent(/thrown/i);
    });

    it('resets the gate for a new match so its early rounds still get the beat', () => {
      const { rerender } = render(
        <RpsSpectatorBoard view={{ ...unresolved, lastRound: round2 }} players={players} outcome={null} />,
      );

      // A new match starts: same component, fresh view, no resolved round yet.
      rerender(
        <RpsSpectatorBoard
          view={{ ...unresolved, roundNumber: 1, roundWins: [0, 0], lastRound: null }}
          players={players}
          outcome={null}
        />,
      );
      expect(screen.queryByTestId('spectator-pick-10')).not.toBeInTheDocument();

      // Match 2 round 1 has sequence 1 — lower than match 1's. It must still reveal.
      rerender(<RpsSpectatorBoard view={{ ...unresolved, lastRound: round1 }} players={players} outcome={null} />);

      // With the gate reset, match 2's round 1 is held; without it, it is adopted ungated.
      expect(screen.queryByTestId('spectator-pick-10')).not.toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(REVEAL_SECONDS * 1000); });

      expect(screen.getByTestId('spectator-pick-10')).toHaveAttribute('data-pick', 'rock');
      expect(screen.getByTestId('spectator-last-round')).toHaveTextContent(/round 1/i);
    });

    it('holds the end banner until the deciding round has been revealed', () => {
      // The server publishes the deciding round's frame and the match-ended signal back
      // to back, so both land in one render. Without gating the banner too, the watcher
      // reads "Qy wins!" over a board still showing the previous round.
      const { rerender } = render(
        <RpsSpectatorBoard view={{ ...unresolved, lastRound: round1 }} players={players} outcome={null} />,
      );

      rerender(
        <RpsSpectatorBoard
          view={{ ...unresolved, finished: true, winnerId: 10, roundWins: [2, 0], committed: [false, false], lastRound: round2 }}
          players={players}
          outcome={{ winnerId: 10, loserId: 20, draw: false }}
        />,
      );

      expect(screen.queryByText(/wins/i)).not.toBeInTheDocument();
      expect(screen.getByTestId('spectator-pick-10')).toHaveAttribute('data-pick', 'rock');

      act(() => { vi.advanceTimersByTime(REVEAL_SECONDS * 1000); });

      expect(screen.getByText(/Qy wins/)).toBeInTheDocument();
      expect(screen.getByTestId('spectator-pick-10')).toHaveAttribute('data-pick', 'paper');
    });
  });
});
