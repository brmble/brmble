import { useEffect, useState } from 'react';
import { GameStats } from '../Profile/GameStats';
import { getGameSettings, setGameSettings } from '../../api/games';
import './GamesSettingsTab.css';

export function GamesSettingsTab() {
  const [challengesBlocked, setChallengesBlocked] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getGameSettings()
      .then(s => { if (!cancelled) { setChallengesBlocked(s.challengesBlocked); setLoaded(true); } })
      .catch(() => {
        // Surface load failures instead of silently presenting the default (false),
        // which could mislead the user into thinking challenges are unblocked.
        if (!cancelled) { setError('Could not load your game settings.'); setLoaded(true); }
      });
    return () => { cancelled = true; };
  }, []);

  const toggle = (next: boolean) => {
    setChallengesBlocked(next); // optimistic
    setError(null);
    setGameSettings({ challengesBlocked: next }).catch(() => {
      // Roll back the optimistic toggle and tell the user it didn't save, rather
      // than silently reverting (which looks like the toggle is broken).
      setChallengesBlocked(!next);
      setError('Could not save that change. Please try again.');
    });
  };

  return (
    <div className="games-settings-tab">
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Challenges</h3>
        <div className="settings-item settings-toggle">
          <label htmlFor="games-block-challenges">Block all challenges</label>
          <label className="brmble-toggle">
            <input
              id="games-block-challenges"
              type="checkbox"
              checked={challengesBlocked}
              disabled={!loaded}
              onChange={e => toggle(e.target.checked)}
            />
            <span className="brmble-toggle-slider"></span>
          </label>
        </div>
        {error && <p className="games-settings-error" role="alert">{error}</p>}
      </div>

      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Deathroll Stats</h3>
        <GameStats gameType="deathroll" />
      </div>
    </div>
  );
}
