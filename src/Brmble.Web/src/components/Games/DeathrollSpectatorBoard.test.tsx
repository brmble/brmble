import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DeathrollSpectatorBoard } from './DeathrollSpectatorBoard';
import type { DeathrollSpectatorView, DuelPlayer } from '../../api/games';

const players: DuelPlayer[] = [
  { userId: 100, sessionId: 10, displayName: 'Qy', ready: false },
  { userId: 200, sessionId: 20, displayName: 'Broan', ready: false },
];

const live: DeathrollSpectatorView = {
  kind: 'deathroll',
  players: [10, 20],
  currentPlayer: 20,
  ceiling: 50,
  lastRoll: 73,
  lastRollBy: 10,
  finished: false,
  loserId: null,
};

describe('DeathrollSpectatorBoard', () => {
  it('names both players by resolving session ids', () => {
    render(<DeathrollSpectatorBoard view={live} players={players} outcome={null} />);
    expect(screen.getByText('Qy')).toBeInTheDocument();
    expect(screen.getByText('Broan')).toBeInTheDocument();
  });

  it('shows the ceiling and the last roll', () => {
    render(<DeathrollSpectatorBoard view={live} players={players} outcome={null} />);
    // Scoped to their own stat tiles: the roll number also appears on its
    // roller's card, so a bare getByText would be ambiguous — and asserting the
    // value sits under the right label is the stronger claim anyway. `within` +
    // getByText rather than toHaveTextContent, because the latter is a substring
    // match and would accept a ceiling of 500 for '50'.
    expect(within(screen.getByText('Ceiling').parentElement!).getByText('50')).toBeInTheDocument();
    expect(within(screen.getByText('Last roll').parentElement!).getByText('73')).toBeInTheDocument();
  });

  it('marks whose turn it is', () => {
    render(<DeathrollSpectatorBoard view={live} players={players} outcome={null} />);
    expect(screen.getByTestId('spectator-player-20')).toHaveAttribute('data-current', 'true');
    expect(screen.getByTestId('spectator-player-10')).toHaveAttribute('data-current', 'false');
  });

  it('renders no interactive control at all', () => {
    render(<DeathrollSpectatorBoard view={live} players={players} outcome={null} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('carries no dialog semantics', () => {
    const { container } = render(
      <DeathrollSpectatorBoard view={live} players={players} outcome={null} />,
    );
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
    expect(container.querySelector('[aria-modal]')).toBeNull();
  });

  it('falls back to the session id when a name cannot be resolved', () => {
    render(<DeathrollSpectatorBoard view={live} players={[]} outcome={null} />);
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('announces the winner once the match has ended', () => {
    render(
      <DeathrollSpectatorBoard
        view={{ ...live, currentPlayer: null, finished: true, loserId: 20, lastRoll: 1, lastRollBy: 20 }}
        players={players}
        outcome={{ winnerId: 10, loserId: 20, draw: false }}
      />,
    );
    expect(screen.getByText(/Qy wins/)).toBeInTheDocument();
  });

  it('announces a draw', () => {
    render(
      <DeathrollSpectatorBoard
        view={{ ...live, currentPlayer: null, finished: true }}
        players={players}
        outcome={{ winnerId: null, loserId: null, draw: true }}
      />,
    );
    expect(screen.getByText(/draw/i)).toBeInTheDocument();
  });

  it('announces a bare end when the match finished without a winner or a draw', () => {
    render(
      <DeathrollSpectatorBoard
        view={{ ...live, currentPlayer: null, finished: true }}
        players={players}
        outcome={{ winnerId: null, loserId: null, draw: false }}
      />,
    );
    expect(screen.getByText('The match has ended.')).toBeInTheDocument();
  });

  it('shows a placeholder before the first roll', () => {
    render(
      <DeathrollSpectatorBoard
        view={{ ...live, lastRoll: null, lastRollBy: null }}
        players={players}
        outcome={null}
      />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it("shows the roll on its roller's card, not the player to move", () => {
    render(
      <DeathrollSpectatorBoard
        view={{ ...live, lastRoll: 73, lastRollBy: 10, currentPlayer: 20 }}
        players={players}
        outcome={null}
      />,
    );
    expect(screen.getByTestId('spectator-roll-10')).toHaveTextContent(/^73$/);
    expect(screen.queryByTestId('spectator-roll-20')).not.toBeInTheDocument();
  });

  // `lastRollBy: 10` deliberately contradicts `lastRoll: null` — a state the
  // server cannot emit. It is the only way to exercise the `lastRoll != null`
  // guard on its own: with lastRollBy null too, the id guard suppresses both
  // cards by itself and the null-roll guard could be deleted unnoticed.
  it('shows no roll on any card before the first roll', () => {
    render(
      <DeathrollSpectatorBoard
        view={{ ...live, lastRoll: null, lastRollBy: 10 }}
        players={players}
        outcome={null}
      />,
    );
    expect(screen.queryByTestId('spectator-roll-10')).not.toBeInTheDocument();
    expect(screen.queryByTestId('spectator-roll-20')).not.toBeInTheDocument();
  });

  it("keeps the losing roll on the loser's card after the match ends", () => {
    render(
      <DeathrollSpectatorBoard
        view={{ ...live, lastRoll: 1, lastRollBy: 20, currentPlayer: null, finished: true, loserId: 20 }}
        players={players}
        outcome={{ winnerId: 10, loserId: 20, draw: false }}
      />,
    );
    expect(screen.getByTestId('spectator-roll-20')).toHaveTextContent(/^1$/);
  });
});
