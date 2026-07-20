import { useEffect, useState } from 'react';
import { GameStats } from '../Profile/GameStats';
import { getGameSettings, setGameSettings } from '../../api/games';

export function GamesSettingsTab() {
  const [challengesBlocked, setChallengesBlocked] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getGameSettings()
      .then(s => { if (!cancelled) { setChallengesBlocked(s.challengesBlocked); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const toggle = (next: boolean) => {
    setChallengesBlocked(next); // optimistic
    setGameSettings({ challengesBlocked: next }).catch(() => setChallengesBlocked(!next));
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
      </div>

      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Deathroll Stats</h3>
        <GameStats gameType="deathroll" />
      </div>
    </div>
  );
}
