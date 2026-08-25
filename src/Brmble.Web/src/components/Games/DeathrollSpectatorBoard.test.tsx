import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('73')).toBeInTheDocument();
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
        view={{ ...live, currentPlayer: null, finished: true, loserId: 20, lastRoll: 1 }}
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

  it('shows a placeholder before the first roll', () => {
    render(
      <DeathrollSpectatorBoard view={{ ...live, lastRoll: null }} players={players} outcome={null} />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
