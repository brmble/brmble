import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RpsSpectatorBoard } from './RpsSpectatorBoard';
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
});
