import { useEffect, useRef, useState } from 'react';
import { getHeadToHead, type HeadToHeadStats } from '../../api/games';
import { gameDisplayName } from '../../utils/games';
import './HeadToHead.css';

interface HeadToHeadProps {
  /** Live Mumble session id of the opponent to compare against. */
  opponentSession: number;
  /** Opponent display name, for the summary copy. */
  opponentName: string;
}

/**
 * Lifetime head-to-head record versus one opponent, from the local user's
 * perspective, with a per-game breakdown. Reads via {@link getHeadToHead} (the
 * server resolves the local identity from the client certificate).
 */
export function HeadToHead({ opponentSession, opponentName }: HeadToHeadProps) {
  const [stats, setStats] = useState<HeadToHeadStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track the latest request so out-of-order responses don't clobber state.
  const requestSeq = useRef(0);

  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    getHeadToHead(opponentSession)
      .then((result) => {
        if (requestSeq.current !== seq) return;
        setStats(result);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (requestSeq.current !== seq) return;
        setError(e instanceof Error ? e.message : 'Failed to load head-to-head record.');
        setLoading(false);
      });
  }, [opponentSession]);

  const winRatioPct = stats ? Math.round(stats.winRatio * 100) : 0;

  if (error) {
    return <div className="head-to-head-message head-to-head-error">{error}</div>;
  }
  if (loading) {
    return <div className="head-to-head-message">Loading…</div>;
  }
  if (!stats || stats.gamesPlayed === 0) {
    return <div className="head-to-head-message">No games played against {opponentName} yet.</div>;
  }

  return (
    <div className="head-to-head">
      <div className="head-to-head-grid">
        <div className="head-to-head-cell">
          <span className="head-to-head-value">{stats.wins}</span>
          <span className="head-to-head-label">Wins</span>
        </div>
        <div className="head-to-head-cell">
          <span className="head-to-head-value">{stats.losses}</span>
          <span className="head-to-head-label">Losses</span>
        </div>
        <div className="head-to-head-cell">
          <span className="head-to-head-value">{stats.draws}</span>
          <span className="head-to-head-label">Draws</span>
        </div>
      </div>

      <div className="head-to-head-ratio">
        <span className="head-to-head-ratio-value">{winRatioPct}%</span>
        <span className="head-to-head-ratio-label">
          Win ratio over {stats.gamesPlayed} game{stats.gamesPlayed === 1 ? '' : 's'} vs {opponentName}
        </span>
      </div>

      {stats.games.length > 0 && (
        <div className="head-to-head-breakdown">
          {stats.games.map((g) => (
            <div key={g.gameType} className="head-to-head-breakdown-row">
              <span className="head-to-head-breakdown-game">{gameDisplayName(g.gameType)}</span>
              <span className="head-to-head-breakdown-record">
                {g.wins}W · {g.losses}L · {g.draws}D
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default HeadToHead;
