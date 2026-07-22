import { useEffect, useRef, useState } from 'react';
import { getStats, type GameStats as GameStatsData } from '../../api/games';
import './GameStats.css';

type StatsWindow = 'week' | 'month' | 'all';

const WINDOWS: { id: StatsWindow; label: string }[] = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'all', label: 'All time' },
];

interface GameStatsProps {
  /** Game type to fetch stats for. Defaults to `deathroll`. */
  gameType?: string;
}

/**
 * Per-user game stats for the local user, sliceable by time window.
 * Server resolves identity from the client certificate, so this always
 * reflects the currently connected user.
 */
export function GameStats({ gameType = 'deathroll' }: GameStatsProps) {
  const [window, setWindow] = useState<StatsWindow>('all');
  const [stats, setStats] = useState<GameStatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track the latest request so out-of-order responses don't clobber state.
  const requestSeq = useRef(0);

  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    getStats(gameType, window)
      .then((result) => {
        if (requestSeq.current !== seq) return;
        setStats(result);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (requestSeq.current !== seq) return;
        setError(e instanceof Error ? e.message : 'Failed to load stats.');
        setLoading(false);
      });
  }, [gameType, window]);

  const winRatioPct = stats ? Math.round(stats.winRatio * 100) : 0;

  return (
    <div className="game-stats">
      <div className="game-stats-toggle">
        {WINDOWS.map((w) => (
          <button
            key={w.id}
            type="button"
            className={`game-stats-toggle-btn ${window === w.id ? 'active' : ''}`}
            onClick={() => setWindow(w.id)}
          >
            {w.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="game-stats-message game-stats-error">{error}</div>
      ) : loading ? (
        <div className="game-stats-message">Loading…</div>
      ) : stats && stats.gamesPlayed > 0 ? (
        <>
          <div className="game-stats-grid">
            <div className="game-stats-cell">
              <span className="game-stats-value">{stats.wins}</span>
              <span className="game-stats-label">Wins</span>
            </div>
            <div className="game-stats-cell">
              <span className="game-stats-value">{stats.losses}</span>
              <span className="game-stats-label">Losses</span>
            </div>
            <div className="game-stats-cell">
              <span className="game-stats-value">{stats.draws}</span>
              <span className="game-stats-label">Draws</span>
            </div>
            <div className="game-stats-cell">
              <span className="game-stats-value">{stats.abandons}</span>
              <span className="game-stats-label">Abandoned</span>
            </div>
          </div>
          <div className="game-stats-ratio">
            <span className="game-stats-ratio-value">{winRatioPct}%</span>
            <span className="game-stats-ratio-label">
              Win ratio over {stats.gamesPlayed} game{stats.gamesPlayed === 1 ? '' : 's'}
            </span>
          </div>
        </>
      ) : (
        <div className="game-stats-message">No games played yet.</div>
      )}
    </div>
  );
}

export default GameStats;
