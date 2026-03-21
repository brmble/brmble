import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { useProfileFingerprint } from '../../contexts/ProfileContext';
import './Brmblegotchi.css';

const STATE_KEY = 'brmblegotchi-state';
const SETTINGS_KEY = 'brmble-settings';
const POSITION_KEY = 'brmblegotchi-position';

interface PetState {
  hunger: number;
  happiness: number;
  cleanliness: number;
  lastUpdate: number;
  lastActionTime: number;
}

type Mood = 'happy' | 'content' | 'sad';

function getMood(hunger: number, happiness: number, cleanliness: number): Mood {
  const avg = (hunger + happiness + cleanliness) / 3;
  if (avg >= 70) return 'happy';
  if (avg >= 40) return 'content';
  return 'sad';
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

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
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
  const fingerprint = useProfileFingerprint();
  const stateKey = fingerprint ? `${STATE_KEY}_${fingerprint}` : STATE_KEY;
  const positionKey = fingerprint ? `${POSITION_KEY}_${fingerprint}` : POSITION_KEY;

  const [isEnabled, setIsEnabled] = useState(true);
  const [isVisible, setIsVisible] = useState(true);
  const [showActions, setShowActions] = useState(false);
  const [position, setPosition] = useState(() => {
    try {
      const stored = localStorage.getItem(positionKey);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch { /* empty */ }
    return { bottom: 150, right: 24 };
  });
  const [isDragging, setIsDragging] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [petState, setPetState] = useState<PetState>(() => {
    try {
      const stored = localStorage.getItem(stateKey);
      if (stored) {
        const saved = JSON.parse(stored) as PetState;
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
    return { hunger: 80, happiness: 75, cleanliness: 85, lastUpdate: Date.now(), lastActionTime: 0 };
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
    const interval = setInterval(() => {
      const now = Date.now();
      setPetState(prev => {
        const elapsedSinceUpdateSeconds = Math.max(0, (now - prev.lastUpdate) / 1000);

        const hungerDecayPerSecond = 0.0069;
        const happinessDecayPerSecond = 0.0139;
        const cleanlinessDecayPerSecond = 0.0278;

        const newState = {
          hunger: Math.max(0, prev.hunger - hungerDecayPerSecond * elapsedSinceUpdateSeconds),
          happiness: Math.max(0, prev.happiness - happinessDecayPerSecond * elapsedSinceUpdateSeconds),
          cleanliness: Math.max(0, prev.cleanliness - cleanlinessDecayPerSecond * elapsedSinceUpdateSeconds),
          lastUpdate: now,
          lastActionTime: prev.lastActionTime,
        };

        const elapsedSinceActionSeconds = Math.max(0, (now - prev.lastActionTime) / 1000);
        const remaining = Math.max(0, 600 - elapsedSinceActionSeconds);
        setCooldownRemaining(remaining);

        localStorage.setItem(stateKey, JSON.stringify(newState));
        return newState;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [stateKey]);

  const handleDismiss = useCallback(() => {
    setIsVisible(false);
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      const settings = stored ? JSON.parse(stored) : {};
      settings.brmblegotchi = { ...settings.brmblegotchi, enabled: false };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch { /* empty */ }
  }, []);

  const handlePetClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowActions(prev => !prev);
  }, []);

  const handleAction = useCallback((action: 'feed' | 'play' | 'clean') => {
    const now = Date.now();
    const elapsed = (now - petState.lastActionTime) / 1000;
    if (elapsed < 600) return;

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
      localStorage.setItem(stateKey, JSON.stringify(newState));
      setCooldownRemaining(600);
      return newState;
    });
    setShowActions(false);
  }, [petState.lastActionTime, stateKey]);

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
    localStorage.setItem(positionKey, JSON.stringify(position));
  }, [position, positionKey]);

  // Reload state when profile fingerprint changes
  const fingerprintRef = useRef(fingerprint);
  useLayoutEffect(() => {
    if (fingerprint && fingerprint !== fingerprintRef.current) {
      fingerprintRef.current = fingerprint;
      // Reload pet state
      try {
        const stored = localStorage.getItem(`${STATE_KEY}_${fingerprint}`);
        if (stored) {
          const saved = JSON.parse(stored) as PetState;
          const elapsed = (Date.now() - saved.lastUpdate) / 1000;
          setPetState({
            hunger: Math.max(0, saved.hunger - elapsed * 0.0069),
            happiness: Math.max(0, saved.happiness - elapsed * 0.0139),
            cleanliness: Math.max(0, saved.cleanliness - elapsed * 0.0278),
            lastUpdate: Date.now(),
            lastActionTime: saved.lastActionTime ?? 0,
          });
        } else {
          setPetState({ hunger: 80, happiness: 75, cleanliness: 85, lastUpdate: Date.now(), lastActionTime: 0 });
        }
      } catch {
        setPetState({ hunger: 80, happiness: 75, cleanliness: 85, lastUpdate: Date.now(), lastActionTime: 0 });
      }
      // Reload position
      try {
        const stored = localStorage.getItem(`${POSITION_KEY}_${fingerprint}`);
        if (stored) {
          setPosition(JSON.parse(stored));
        } else {
          setPosition({ bottom: 150, right: 24 });
        }
      } catch {
        setPosition({ bottom: 150, right: 24 });
      }
    }
  }, [fingerprint]);

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

  return (
    <div
      ref={widgetRef}
      className={`brmblegotchi-widget ${mood}`}
      style={{
        bottom: `${position.bottom}px`,
        right: `${position.right}px`,
      }}
    >
      <button className="brmblegotchi-dismiss" onClick={handleDismiss} aria-label="Dismiss pet">
        <CloseIcon />
      </button>
      
      <div className="brmblegotchi-drag-handle" onMouseDown={handleMouseDown}>
        <span /><span /><span />
      </div>

      <div className="brmblegotchi-pet" onClick={handlePetClick}>
        <div className="brmblegotchi-ring brmblegotchi-ring-outer" />
        <div className="brmblegotchi-ring brmblegotchi-ring-middle" />
        <div className="brmblegotchi-ring brmblegotchi-ring-inner" />
        <div className="brmblegotchi-ring brmblegotchi-ring-center" />
        <div className="brmblegotchi-face">
          <div className="brmblegotchi-eyes">
            <div className={`brmblegotchi-eye ${mood === 'happy' ? 'happy' : mood === 'sad' ? 'sad' : ''}`} />
            <div className={`brmblegotchi-eye ${mood === 'happy' ? 'happy' : mood === 'sad' ? 'sad' : ''}`} />
          </div>
          <div className={`brmblegotchi-mouth ${mood === 'content' ? 'neutral' : mood}`} />
        </div>

        {showActions && (
          <div className="brmblegotchi-actions">
            <button
              className={`brmblegotchi-action-btn ${cooldownRemaining > 0 ? 'disabled' : ''}`}
              onClick={(e) => { e.stopPropagation(); handleAction('feed'); }}
              aria-label="Feed"
              disabled={cooldownRemaining > 0}
            >
              {cooldownRemaining > 0 ? (
                <span className="brmblegotchi-cooldown">{Math.ceil(cooldownRemaining / 60)}m</span>
              ) : (
                <FoodIcon />
              )}
            </button>
            <button
              className={`brmblegotchi-action-btn ${cooldownRemaining > 0 ? 'disabled' : ''}`}
              onClick={(e) => { e.stopPropagation(); handleAction('play'); }}
              aria-label="Play"
              disabled={cooldownRemaining > 0}
            >
              {cooldownRemaining > 0 ? (
                <span className="brmblegotchi-cooldown">{Math.ceil(cooldownRemaining / 60)}m</span>
              ) : (
                <PlayIcon />
              )}
            </button>
            <button
              className={`brmblegotchi-action-btn ${cooldownRemaining > 0 ? 'disabled' : ''}`}
              onClick={(e) => { e.stopPropagation(); handleAction('clean'); }}
              aria-label="Clean"
              disabled={cooldownRemaining > 0}
            >
              {cooldownRemaining > 0 ? (
                <span className="brmblegotchi-cooldown">{Math.ceil(cooldownRemaining / 60)}m</span>
              ) : (
                <CleanIcon />
              )}
            </button>
          </div>
        )}
      </div>

      <div className="brmblegotchi-stats">
        <div className="brmblegotchi-stat">
          <div className="brmblegotchi-stat-icon" style={{ color: 'var(--accent-primary)' }}>
            <HungerIcon />
          </div>
          <div className="brmblegotchi-stat-bar">
            <div className="brmblegotchi-stat-fill hunger" style={{ width: `${petState.hunger}%` }} />
          </div>
        </div>
        <div className="brmblegotchi-stat">
          <div className="brmblegotchi-stat-icon" style={{ color: 'var(--accent-secondary)' }}>
            <HappinessIcon />
          </div>
          <div className="brmblegotchi-stat-bar">
            <div className="brmblegotchi-stat-fill happiness" style={{ width: `${petState.happiness}%` }} />
          </div>
        </div>
        <div className="brmblegotchi-stat">
          <div className="brmblegotchi-stat-icon" style={{ color: 'var(--accent-decorative)' }}>
            <CleanlinessIcon />
          </div>
          <div className="brmblegotchi-stat-bar">
            <div className="brmblegotchi-stat-fill cleanliness" style={{ width: `${petState.cleanliness}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export { BrmblegotchiWidget as Brmblegotchi }
