import { useState, useRef, useCallback, useEffect } from 'react';
import './Brmblegotchi.css';

const STATE_KEY = 'brmblegotchi-state';
const SETTINGS_KEY = 'brmble-settings';
const POSITION_KEY = 'brmblegotchi-position';

type GrowthStage = 'egg' | 'baby' | 'child' | 'teen' | 'adult' | 'ghost';

interface GrowthState {
  stage: GrowthStage;
  stageStartTime: number;
  eggClicks: number;
  hasDied: boolean;
}

interface PetState {
  hunger: number;
  happiness: number;
  cleanliness: number;
  lastUpdate: number;
  lastActionTime: number;
}

type StageWithDuration = 'egg' | 'baby' | 'child' | 'teen';

const STAGE_DURATIONS: Record<StageWithDuration, number> = {
  egg: 1 * 60 * 1000,
  baby: 1 * 60 * 1000,
  child: 1 * 60 * 1000,
  teen: 1 * 60 * 1000,
};

const EGG_CLICKS_TO_HATCH = 10;

const DEFAULT_GROWTH_STATE: GrowthState = {
  stage: 'egg',
  stageStartTime: Date.now(),
  eggClicks: 0,
  hasDied: false,
};

const DEFAULT_PET_STATE: PetState = {
  hunger: 100,
  happiness: 100,
  cleanliness: 100,
  lastUpdate: Date.now(),
  lastActionTime: 0,
};

type Mood = 'happy' | 'content' | 'sad';

function getMood(hunger: number, happiness: number, cleanliness: number): Mood {
  const avg = (hunger + happiness + cleanliness) / 3;
  if (avg >= 70) return 'happy';
  if (avg >= 40) return 'content';
  return 'sad';
}

function getDecayMultiplier(stat: 'hunger' | 'happiness' | 'cleanliness', stage: GrowthStage): number {
  if (stage === 'egg' || stage === 'ghost') return 0;
  
  const multipliers: Record<string, Record<string, number>> = {
    baby: { hunger: 1.0, happiness: 0, cleanliness: 0 },
    child: { hunger: 1.0, happiness: 1.0, cleanliness: 0 },
    teen: { hunger: 1.0, happiness: 1.0, cleanliness: 1.5 },
    adult: { hunger: 1.0, happiness: 1.0, cleanliness: 1.0 },
  };
  
  return multipliers[stage]?.[stat] ?? 0;
}

function getRingCount(stage: GrowthStage): number {
  switch (stage) {
    case 'egg': return 0;
    case 'baby': return 2;
    case 'child': return 3;
    case 'teen': return 4;
    case 'adult': return 4;
    case 'ghost': return 4;
    default: return 4;
  }
}

function FoodIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
      <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
      <line x1="6" y1="1" x2="6" y2="4" />
      <line x1="10" y1="1" x2="10" y2="4" />
      <line x1="14" y1="1" x2="14" y2="4" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" />
    </svg>
  );
}

function CleanIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
    </svg>
  );
}

function HungerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
      <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
    </svg>
  );
}

function HappinessIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  );
}

function CleanlinessIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
    </svg>
  );
}

export function BrmblegotchiWidget() {
  const [isEnabled, setIsEnabled] = useState(true);
  const [isVisible, setIsVisible] = useState(true);
  const [showActions, setShowActions] = useState(false);
  const [position, setPosition] = useState(() => {
    try {
      const stored = localStorage.getItem(POSITION_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch { /* empty */ }
    return { bottom: 150, right: 24 };
  });
  const [isDragging, setIsDragging] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [eggClickAnim, setEggClickAnim] = useState(false);
  const [petState, setPetState] = useState<PetState>(() => {
    try {
      const stored = localStorage.getItem(STATE_KEY);
      if (stored) {
        const saved = JSON.parse(stored) as PetState & Partial<GrowthState>;
        const elapsed = (Date.now() - saved.lastUpdate) / 1000;
        return {
          hunger: Math.max(0, saved.hunger - elapsed * 0.0069),
          happiness: Math.max(0, saved.happiness - elapsed * 0.0139),
          cleanliness: Math.max(0, saved.cleanliness - elapsed * 0.0278),
          lastUpdate: Date.now(),
          lastActionTime: saved.lastActionTime ?? 0,
        };
      }
    } catch { /* empty */ }
    return { ...DEFAULT_PET_STATE };
  });
  const [growthState, setGrowthState] = useState<GrowthState>(() => {
    try {
      const stored = localStorage.getItem(STATE_KEY);
      if (stored) {
        const saved = JSON.parse(stored) as Partial<GrowthState>;
        if (saved && saved.stage) {
          return {
            stage: saved.stage,
            stageStartTime: saved.stageStartTime ?? Date.now(),
            eggClicks: saved.eggClicks ?? 0,
            hasDied: saved.hasDied ?? false,
          };
        }
        return { ...DEFAULT_GROWTH_STATE, stage: 'adult', stageStartTime: Date.now() };
      }
    } catch { /* empty */ }
    return { ...DEFAULT_GROWTH_STATE };
  });

  const dragStart = useRef({ mouseX: 0, mouseY: 0, right: 0, bottom: 0 });
  const widgetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkSettings = () => {
      try {
        const stored = localStorage.getItem(SETTINGS_KEY);
        if (stored) {
          const settings = JSON.parse(stored);
          const enabled = settings.brmblegotchi?.enabled ?? true;
          setIsEnabled(prev => prev !== enabled ? enabled : prev);
          setIsVisible(prev => prev !== enabled ? enabled : prev);
        }
      } catch { /* empty */ }
    };
    checkSettings();
    const interval = setInterval(checkSettings, 500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (growthState.stage === 'egg' || growthState.stage === 'ghost' || growthState.stage === 'adult') return;

    const stageInterval = setInterval(() => {
      const duration = STAGE_DURATIONS[growthState.stage as keyof typeof STAGE_DURATIONS];
      if (!duration) return;

      const elapsed = Date.now() - growthState.stageStartTime;
      
      if (elapsed >= duration) {
        const nextStage: Record<string, GrowthStage> = {
          baby: 'child',
          child: 'teen',
          teen: 'adult',
        };
        setGrowthState(prev => ({
          ...prev,
          stage: nextStage[prev.stage] ?? 'adult',
          stageStartTime: Date.now(),
        }));
      }
    }, 1000);

    return () => clearInterval(stageInterval);
  }, [growthState.stage, growthState.stageStartTime]);

  useEffect(() => {
    if (growthState.stage !== 'egg') return;

    const eggInterval = setInterval(() => {
      const duration = STAGE_DURATIONS.egg;
      const elapsed = Date.now() - growthState.stageStartTime;
      
      if (elapsed >= duration && growthState.eggClicks < EGG_CLICKS_TO_HATCH) {
        hatchToBaby();
      }
    }, 1000);

    return () => clearInterval(eggInterval);
  }, [growthState.stage, growthState.stageStartTime, growthState.eggClicks]);

  const hatchToBaby = useCallback(() => {
    setGrowthState(prev => ({
      ...prev,
      stage: 'baby',
      stageStartTime: Date.now(),
      eggClicks: 0,
    }));
  }, []);

  const handleEggClick = useCallback(() => {
    if (growthState.stage !== 'egg') return;
    
    setEggClickAnim(true);
    setTimeout(() => setEggClickAnim(false), 300);

    const newClicks = growthState.eggClicks + 1;
    
    if (newClicks >= EGG_CLICKS_TO_HATCH) {
      hatchToBaby();
    } else {
      setGrowthState(prev => ({ ...prev, eggClicks: newClicks }));
    }
  }, [growthState.stage, growthState.eggClicks, hatchToBaby]);

  const handleRestart = useCallback(() => {
    const newPetState: PetState = {
      ...DEFAULT_PET_STATE,
      lastUpdate: Date.now(),
    };
    const newGrowthState: GrowthState = {
      ...DEFAULT_GROWTH_STATE,
      stageStartTime: Date.now(),
    };
    setPetState(newPetState);
    setGrowthState(newGrowthState);
    localStorage.setItem(STATE_KEY, JSON.stringify({ ...newPetState, ...newGrowthState }));
  }, []);

  useEffect(() => {
    const handleReset = () => {
      handleRestart();
    };
    window.addEventListener('brmblegotchi-reset', handleReset);
    return () => window.removeEventListener('brmblegotchi-reset', handleReset);
  }, [handleRestart]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setPetState(prev => {
        const elapsedSinceUpdateSeconds = Math.max(0, (now - prev.lastUpdate) / 1000);

        const baseDecay = 0.0069;
        const hungerDecay = baseDecay * getDecayMultiplier('hunger', growthState.stage);
        const happinessDecay = baseDecay * 2 * getDecayMultiplier('happiness', growthState.stage);
        const cleanlinessDecay = baseDecay * 4 * getDecayMultiplier('cleanliness', growthState.stage);

        const newState = {
          hunger: Math.max(0, prev.hunger - hungerDecay * elapsedSinceUpdateSeconds),
          happiness: Math.max(0, prev.happiness - happinessDecay * elapsedSinceUpdateSeconds),
          cleanliness: Math.max(0, prev.cleanliness - cleanlinessDecay * elapsedSinceUpdateSeconds),
          lastUpdate: now,
          lastActionTime: prev.lastActionTime,
        };

        if (newState.hunger <= 0 && newState.happiness <= 0 && newState.cleanliness <= 0 && growthState.stage !== 'ghost') {
          setGrowthState(g => ({ ...g, stage: 'ghost', hasDied: true }));
        }

        const elapsedSinceActionSeconds = Math.max(0, (now - prev.lastActionTime) / 1000);
        const remaining = Math.max(0, 5 - elapsedSinceActionSeconds);
        setCooldownRemaining(remaining);

        localStorage.setItem(STATE_KEY, JSON.stringify({ ...newState, ...growthState }));
        return newState;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [growthState.stage]);

  const handleDismiss = useCallback(() => {
    setIsVisible(false);
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      const settings = stored ? JSON.parse(stored) : {};
      settings.brmblegotchi = { ...settings.brmblegotchi, enabled: false };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch { /* empty */ }
  }, []);

  const handleAction = useCallback((action: 'feed' | 'play' | 'clean') => {
    const now = Date.now();
    const elapsed = (now - petState.lastActionTime) / 1000;
    if (elapsed < 5) return;

    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 500);

    setPetState(prev => {
      let newState: PetState;
      switch (action) {
        case 'feed':
          newState = { ...prev, hunger: Math.min(100, prev.hunger + 25), lastUpdate: Date.now(), lastActionTime: now };
          break;
        case 'play':
          newState = { ...prev, happiness: Math.min(100, prev.happiness + 20), lastUpdate: Date.now(), lastActionTime: now };
          break;
        case 'clean':
          newState = { ...prev, cleanliness: Math.min(100, prev.cleanliness + 30), lastUpdate: Date.now(), lastActionTime: now };
          break;
      }
      localStorage.setItem(STATE_KEY, JSON.stringify(newState));
      setCooldownRemaining(5);
      return newState;
    });
    setShowActions(false);
  }, [petState.lastActionTime]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.brmblegotchi-actions') || 
        (e.target as HTMLElement).closest('.brmblegotchi-dismiss') ||
        (e.target as HTMLElement).closest('.brmblegotchi-pet')) {
      return;
    }
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      right: position.right,
      bottom: position.bottom,
    };
  }, [position]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    const deltaX = e.clientX - dragStart.current.mouseX;
    const deltaY = e.clientY - dragStart.current.mouseY;
    const newRight = Math.max(0, dragStart.current.right - deltaX);
    const newBottom = Math.max(0, dragStart.current.bottom - deltaY);
    setPosition({ right: newRight, bottom: newBottom });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  useEffect(() => {
    localStorage.setItem(POSITION_KEY, JSON.stringify(position));
  }, [position]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (widgetRef.current && !widgetRef.current.contains(e.target as Node)) {
        setShowActions(false);
      }
    };
    if (showActions) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showActions]);

  if (!isEnabled || !isVisible) return null;

  const mood = getMood(petState.hunger, petState.happiness, petState.cleanliness);
  const showCleanliness = growthState.stage !== 'egg';
  const showHunger = growthState.stage !== 'egg' && growthState.stage !== 'baby';
  const showHappiness = growthState.stage !== 'egg' && growthState.stage !== 'baby' && growthState.stage !== 'child';
  const ringCount = getRingCount(growthState.stage);

  const handlePetClickWithStage = (e: React.MouseEvent) => {
    if (growthState.stage === 'egg') {
      handleEggClick();
      return;
    }
    if (growthState.stage === 'ghost') {
      handleRestart();
      return;
    }
    e.stopPropagation();
    setShowActions(prev => !prev);
  };

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    handleDismiss();
  }, []);

  return (
    <div
      ref={widgetRef}
      className={`brmblegotchi-widget stage-${growthState.stage} ${mood} ${isAnimating ? 'action-animating' : ''} ${eggClickAnim ? 'egg-click-animating' : ''}`}
      style={{
        bottom: `${position.bottom}px`,
        right: `${position.right}px`,
      }}
      onContextMenu={handleContextMenu}
    >
      {showActions && growthState.stage !== 'egg' && growthState.stage !== 'ghost' && (
        <div className="brmblegotchi-actions">
          {(growthState.stage === 'child' || growthState.stage === 'teen' || growthState.stage === 'adult') && (
            <button
              className={`brmblegotchi-action-btn ${cooldownRemaining > 0 ? 'disabled' : ''}`}
              onClick={(e) => { e.stopPropagation(); handleAction('feed'); }}
              aria-label="Feed"
              disabled={cooldownRemaining > 0}
            >
              {cooldownRemaining > 0 ? (
                <span className="brmblegotchi-cooldown">{Math.ceil(cooldownRemaining)}s</span>
              ) : (
                <FoodIcon />
              )}
            </button>
          )}
          {(growthState.stage === 'teen' || growthState.stage === 'adult') && (
            <button
              className={`brmblegotchi-action-btn ${cooldownRemaining > 0 ? 'disabled' : ''}`}
              onClick={(e) => { e.stopPropagation(); handleAction('play'); }}
              aria-label="Play"
              disabled={cooldownRemaining > 0}
            >
              {cooldownRemaining > 0 ? (
                <span className="brmblegotchi-cooldown">{Math.ceil(cooldownRemaining)}s</span>
              ) : (
                <PlayIcon />
              )}
            </button>
          )}
          <button
            className={`brmblegotchi-action-btn ${cooldownRemaining > 0 ? 'disabled' : ''}`}
            onClick={(e) => { e.stopPropagation(); handleAction('clean'); }}
            aria-label="Clean"
            disabled={cooldownRemaining > 0}
          >
            {cooldownRemaining > 0 ? (
              <span className="brmblegotchi-cooldown">{Math.ceil(cooldownRemaining)}s</span>
            ) : (
              <CleanIcon />
            )}
          </button>
        </div>
      )}

      <div className="brmblegotchi-pet-wrapper">
        <div className="brmblegotchi-pet" onClick={handlePetClickWithStage}>
          {[...Array(ringCount)].map((_, i) => {
            const ringClass = growthState.stage === 'baby' 
              ? ['outer', 'center'][i]
              : growthState.stage === 'child'
              ? ['outer', 'middle', 'center'][i]
              : ['outer', 'middle', 'inner', 'center'][i];
            return <div key={i} className={`brmblegotchi-ring brmblegotchi-ring-${ringClass}`} />;
          })}
          <div className="brmblegotchi-face">
            <div className="brmblegotchi-eyes">
              <div className={`brmblegotchi-eye ${mood === 'happy' ? 'happy' : mood === 'sad' ? 'sad' : ''}`} />
              <div className={`brmblegotchi-eye ${mood === 'happy' ? 'happy' : mood === 'sad' ? 'sad' : ''}`} />
            </div>
            <div className={`brmblegotchi-mouth ${mood === 'content' ? 'neutral' : mood}`} />
          </div>

          {growthState.stage === 'ghost' && (
            <div className="brmblegotchi-restart-hint">Click to Restart</div>
          )}

          {growthState.stage === 'egg' && (
            <div className="brmblegotchi-egg-hint">
              {EGG_CLICKS_TO_HATCH - growthState.eggClicks} clicks left
            </div>
          )}
        </div>
      </div>

      <div className="brmblegotchi-stats">
        {showCleanliness && (
          <div className="brmblegotchi-stat">
            <div className="brmblegotchi-stat-icon" style={{ color: 'var(--accent-primary)' }}>
              <CleanlinessIcon />
            </div>
            <div className="brmblegotchi-stat-bar">
              <div className="brmblegotchi-stat-fill cleanliness" style={{ width: `${petState.cleanliness}%` }} />
            </div>
          </div>
        )}
        {showHunger && (
          <div className="brmblegotchi-stat">
            <div className="brmblegotchi-stat-icon" style={{ color: 'var(--accent-secondary)' }}>
              <HungerIcon />
            </div>
            <div className="brmblegotchi-stat-bar">
              <div className="brmblegotchi-stat-fill hunger" style={{ width: `${petState.hunger}%` }} />
            </div>
          </div>
        )}
        {showHappiness && (
          <div className="brmblegotchi-stat">
            <div className="brmblegotchi-stat-icon" style={{ color: 'var(--accent-decorative)' }}>
              <HappinessIcon />
            </div>
            <div className="brmblegotchi-stat-bar">
              <div className="brmblegotchi-stat-fill happiness" style={{ width: `${petState.happiness}%` }} />
            </div>
          </div>
        )}
      </div>

      <div className="brmblegotchi-drag-handle" onMouseDown={handleMouseDown}>
        <span /><span /><span />
      </div>
    </div>
  );
}

export { BrmblegotchiWidget as Brmblegotchi }
