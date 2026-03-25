import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { useProfileFingerprint } from '../../contexts/ProfileContext';
import './Brmblegotchi.css';

import dinoEggSprite from '../../assets/Sprites/Egg/Dino_egg.png';
import dinoChildIdle1 from '../../assets/Sprites/Dino Child/dino_idle -1.png';
import dinoChildIdle2 from '../../assets/Sprites/Dino Child/dino_idle -2.png';
import dinoChildIdle3 from '../../assets/Sprites/Dino Child/dino_idle -3.png';
import dinoChildFood1 from '../../assets/Sprites/Dino Child/Dino_food -1 .png';
import dinoChildFood2 from '../../assets/Sprites/Dino Child/Dino_food -2 .png';
import dinoChildPlay from '../../assets/Sprites/Dino Child/Dino_play.png';
import dinoChildSleep from '../../assets/Sprites/Dino Child/Dino_Sleep.png';
import dinoChildClean from '../../assets/Sprites/Dino Child/Dino_clean.png';
import dinoTeenIdle from '../../assets/Sprites/Dino Teen/Dino_teen_Idle-1.png';
import dinoTeenFood from '../../assets/Sprites/Dino Teen/Dino_teen_food-1.png';
import dinoTeenPlay from '../../assets/Sprites/Dino Teen/Dino_teen_play-1.png';
import dinoTeenSleep from '../../assets/Sprites/Dino Teen/Dino_teen_sleep-1.png';
import dinoTeenClean from '../../assets/Sprites/Dino Teen/Dino_teen_clean-1.png';

import catIdleSprite from '../../assets/Sprites/Cat/cat_idle.png';
import catHappySprite from '../../assets/Sprites/Cat/cat_happey.png';
import catPlaySprite from '../../assets/Sprites/Cat/cat_play.png';
import catFoodSprite from '../../assets/Sprites/Cat/cat_food.png';
import catCleanSprite from '../../assets/Sprites/Cat/cat_clean.png';
import catSleepSprite from '../../assets/Sprites/Cat/cat_sleep.png';
import catSmileSprite from '../../assets/Sprites/Cat/cat_smile.png';

const STATE_KEY = 'brmblegotchi-state';
const SETTINGS_KEY = 'brmble-settings';
const POSITION_KEY = 'brmblegotchi-position';

type PetTheme = 'original' | 'dino' | 'cat';
type GrowthStage = 'egg' | 'baby' | 'child' | 'teen' | 'adult' | 'ghost';

interface GrowthState {
  stage: GrowthStage;
  stageStartTime: number;
  birthTime: number;
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

const DINO_STAGE_DURATIONS: Record<'egg' | 'child' | 'teen', number> = {
  egg: 10 * 1000,
  child: 15 * 60 * 1000,
  teen: 1 * 60 * 1000,
};

const EGG_CLICKS_TO_HATCH = 10;

const DEFAULT_GROWTH_STATE: GrowthState = {
  stage: 'egg',
  stageStartTime: Date.now(),
  birthTime: Date.now(),
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

function DinoSprite({ stage, action }: { stage: GrowthStage; action: 'idle' | 'feed' | 'play' | 'clean' | 'sleep'; }) {
  const [frame, setFrame] = useState(0);
  const [feedFrame, setFeedFrame] = useState(0);

  useEffect(() => {
    if (stage === 'egg') return;
    if (action !== 'idle') {
      setFrame(0);
      return;
    }
    const interval = setInterval(() => {
      setFrame(f => (f + 1) % 3);
    }, 5000);
    return () => clearInterval(interval);
  }, [stage, action]);

  useEffect(() => {
    if (action !== 'feed') {
      setFeedFrame(0);
      return;
    }
    const interval = setInterval(() => {
      setFeedFrame(f => (f + 1) % 2);
    }, 1000);
    return () => clearInterval(interval);
  }, [action]);

  if (stage === 'egg') {
    return <img src={dinoEggSprite} alt="Dino Egg" className="pet-sprite" />;
  }

  if (stage === 'child') {
    switch (action) {
      case 'feed':
        return <img src={feedFrame === 0 ? dinoChildFood1 : dinoChildFood2} alt="Dino eating" className="pet-sprite" />;
      case 'play':
        return <img src={dinoChildPlay} alt="Dino playing" className="pet-sprite" />;
      case 'sleep':
        return <img src={dinoChildSleep} alt="Dino sleeping" className="pet-sprite" />;
      case 'clean':
        return <img src={dinoChildClean} alt="Dino cleaning" className="pet-sprite" />;
      default:
        const idleSprites = [dinoChildIdle1, dinoChildIdle2, dinoChildIdle3];
        return <img src={idleSprites[frame]} alt="Dino" className="pet-sprite" />;
    }
  }

  if (stage === 'teen') {
    switch (action) {
      case 'feed':
        return <img src={dinoTeenFood} alt="Dino eating" className="pet-sprite" />;
      case 'play':
        return <img src={dinoTeenPlay} alt="Dino playing" className="pet-sprite" />;
      case 'sleep':
        return <img src={dinoTeenSleep} alt="Dino sleeping" className="pet-sprite" />;
      case 'clean':
        return <img src={dinoTeenClean} alt="Dino cleaning" className="pet-sprite" />;
      default:
        return <img src={dinoTeenIdle} alt="Dino" className="pet-sprite" />;
    }
  }

  return <img src={dinoTeenIdle} alt="Dino" className="pet-sprite" />;
}

function CatSprite({ action }: { action: 'idle' | 'feed' | 'play' | 'clean' | 'sleep' | 'happy' }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (action !== 'idle') {
      setFrame(0);
      return;
    }
    const interval = setInterval(() => {
      setFrame(f => (f + 1) % 3);
    }, 800);
    return () => clearInterval(interval);
  }, [action]);

  switch (action) {
    case 'feed':
      return <img src={catFoodSprite} alt="Cat eating" className="pet-sprite" />;
    case 'play':
      return <img src={catPlaySprite} alt="Cat playing" className="pet-sprite" />;
    case 'clean':
      return <img src={catCleanSprite} alt="Cat cleaning" className="pet-sprite" />;
    case 'sleep':
      return <img src={catSleepSprite} alt="Cat sleeping" className="pet-sprite" />;
    case 'happy':
      return <img src={catHappySprite} alt="Cat happy" className="pet-sprite" />;
    default:
      const idleSprites = [catIdleSprite, catSmileSprite, catHappySprite];
      return <img src={idleSprites[frame]} alt="Cat" className="pet-sprite" />;
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

interface BrmblegotchiWidgetProps {
  onOpenSettings?: () => void;
}

export function BrmblegotchiWidget({ onOpenSettings }: BrmblegotchiWidgetProps) {
  const fingerprint = useProfileFingerprint();
  const stateKey = fingerprint ? `${STATE_KEY}_${fingerprint}` : STATE_KEY;
  const positionKey = fingerprint ? `${POSITION_KEY}_${fingerprint}` : POSITION_KEY;

  const [isEnabled, setIsEnabled] = useState(true);
  const [isVisible, setIsVisible] = useState(true);
  const [petTheme, setPetTheme] = useState<PetTheme>('original');
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
  const [isAnimating, setIsAnimating] = useState(false);
  const [eggClickAnim, setEggClickAnim] = useState(false);
  const [totalAge, setTotalAge] = useState(0);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [currentAction, setCurrentAction] = useState<'idle' | 'feed' | 'play' | 'clean' | 'sleep'>('idle');
  const [dinoEggTimeLeft, setDinoEggTimeLeft] = useState(10);

  const formatAge = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    if (mins >= 60) {
      const hours = Math.floor(mins / 60);
      const remainingMins = mins % 60;
      return `${hours}h ${remainingMins}m`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  const [petState, setPetState] = useState<PetState>(() => {
    try {
      const stored = localStorage.getItem(stateKey);
      if (stored) {
        const saved = JSON.parse(stored) as PetState & Partial<GrowthState>;
        const stage = saved.stage ?? 'adult';
        const elapsed = (Date.now() - saved.lastUpdate) / 1000;
        const baseDecay = 0.0069;
        const hungerDecay = baseDecay * getDecayMultiplier('hunger', stage);
        const happinessDecay = baseDecay * 2 * getDecayMultiplier('happiness', stage);
        const cleanlinessDecay = baseDecay * 4 * getDecayMultiplier('cleanliness', stage);
        return {
          hunger: Math.max(0, saved.hunger - hungerDecay * elapsed),
          happiness: Math.max(0, saved.happiness - happinessDecay * elapsed),
          cleanliness: Math.max(0, saved.cleanliness - cleanlinessDecay * elapsed),
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
            birthTime: saved.birthTime ?? Date.now(),
            eggClicks: saved.eggClicks ?? 0,
            hasDied: saved.hasDied ?? false,
          };
        }
        return { ...DEFAULT_GROWTH_STATE, stage: 'adult', stageStartTime: Date.now() };
      }
    } catch { /* empty */ }
    return { ...DEFAULT_GROWTH_STATE };
  });

  useEffect(() => {
    if (petTheme === 'cat' && growthState.stage === 'egg') {
      setGrowthState(prev => ({ ...prev, stage: 'adult', stageStartTime: Date.now() }));
    }
  }, [petTheme]);

  const dragStart = useRef({ mouseX: 0, mouseY: 0, right: 0, bottom: 0 });
  const widgetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkSettings = () => {
      try {
        const stored = localStorage.getItem(SETTINGS_KEY);
        if (stored) {
          const settings = JSON.parse(stored);
          const enabled = settings.brmblegotchi?.enabled ?? true;
          const theme = settings.brmblegotchi?.theme ?? 'original';
          setIsEnabled(prev => prev !== enabled ? enabled : prev);
          setIsVisible(prev => prev !== enabled ? enabled : prev);
          setPetTheme(prev => prev !== theme ? theme : prev);
        }
      } catch { /* empty */ }
    };
    const handleHide = () => {
      try {
        const stored = localStorage.getItem(SETTINGS_KEY);
        const settings = stored ? JSON.parse(stored) : {};
        settings.brmblegotchi = { ...settings.brmblegotchi, enabled: false };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch { /* empty */ }
    };
    checkSettings();
    const interval = setInterval(checkSettings, 500);
    window.addEventListener('brmblegotchi-hide', handleHide);
    return () => {
      clearInterval(interval);
      window.removeEventListener('brmblegotchi-hide', handleHide);
    };
  }, []);

  useEffect(() => {
    if (growthState.stage === 'egg' || growthState.stage === 'ghost' || growthState.stage === 'adult') return;

    const stageInterval = setInterval(() => {
      const duration = petTheme === 'dino' 
        ? DINO_STAGE_DURATIONS[growthState.stage as keyof typeof DINO_STAGE_DURATIONS]
        : STAGE_DURATIONS[growthState.stage as keyof typeof STAGE_DURATIONS];
      if (!duration) return;

      const elapsed = Date.now() - growthState.stageStartTime;
      
      if (elapsed >= duration) {
        const nextStage: Record<string, GrowthStage> = {
          baby: 'child',
          child: 'teen',
          teen: 'adult',
        };
        const next = nextStage[growthState.stage];
        if (!next) return;
        if (petTheme === 'dino' && next === 'adult') return;
        setGrowthState(prev => ({
          ...prev,
          stage: next,
          stageStartTime: Date.now(),
        }));
      }
    }, 1000);

    return () => clearInterval(stageInterval);
  }, [growthState.stage, growthState.stageStartTime, petTheme]);

  useEffect(() => {
    if (growthState.stage !== 'egg') return;
    if (petTheme !== 'original') return;

    const eggInterval = setInterval(() => {
      const duration = STAGE_DURATIONS.egg;
      const elapsed = Date.now() - growthState.stageStartTime;
      
      if (elapsed >= duration && growthState.eggClicks < EGG_CLICKS_TO_HATCH) {
        hatchToBaby();
      }
    }, 1000);

    return () => clearInterval(eggInterval);
  }, [growthState.stage, growthState.stageStartTime, growthState.eggClicks, petTheme]);

  useEffect(() => {
    if (growthState.stage !== 'egg') return;
    if (petTheme !== 'dino') return;

    const hatchInterval = setInterval(() => {
      const elapsed = Date.now() - growthState.stageStartTime;
      if (elapsed >= DINO_STAGE_DURATIONS.egg) {
        setGrowthState(prev => ({
          ...prev,
          stage: 'child',
          stageStartTime: Date.now(),
          birthTime: prev.birthTime || Date.now(),
        }));
      }
    }, 1000);

    return () => clearInterval(hatchInterval);
  }, [growthState.stage, growthState.stageStartTime, petTheme]);

  const hatchToBaby = useCallback(() => {
    setGrowthState(prev => ({
      ...prev,
      stage: 'baby',
      stageStartTime: Date.now(),
      birthTime: prev.birthTime || Date.now(),
      eggClicks: 0,
    }));
  }, []);

  const handleEggClick = useCallback(() => {
    setEggClickAnim(true);
    setTimeout(() => setEggClickAnim(false), 300);

    setGrowthState(prev => {
      if (prev.stage !== 'egg') {
        return prev;
      }

      const newClicks = prev.eggClicks + 1;

      if (newClicks >= EGG_CLICKS_TO_HATCH) {
        return {
          ...prev,
          stage: 'baby',
          stageStartTime: Date.now(),
          birthTime: prev.birthTime || Date.now(),
          eggClicks: 0,
        };
      }

      return {
        ...prev,
        eggClicks: newClicks,
      };
    });
  }, [setGrowthState, setEggClickAnim]);

  const handleRestart = useCallback(() => {
    const newPetState: PetState = {
      ...DEFAULT_PET_STATE,
      lastUpdate: Date.now(),
    };
    const newGrowthState: GrowthState = {
      ...DEFAULT_GROWTH_STATE,
      stageStartTime: Date.now(),
      birthTime: Date.now(),
    };
    setPetState(newPetState);
    setGrowthState(newGrowthState);
    setTotalAge(0);
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

        localStorage.setItem(stateKey, JSON.stringify({ ...newState, ...growthState }));
        return newState;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [stateKey, growthState.stage]);

  const handleAction = useCallback((action: 'feed' | 'play' | 'clean') => {
    const now = Date.now();
    const elapsed = (now - petState.lastActionTime) / 1000;
    if (elapsed < 5) return;

    setIsAnimating(true);
    setCurrentAction(action);
    const actionDuration = 4000;
    setTimeout(() => {
      setIsAnimating(false);
      setCurrentAction('idle');
    }, actionDuration);

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
      localStorage.setItem(stateKey, JSON.stringify({ ...newState, ...growthState }));
      setCooldownRemaining(5);
      return newState;
    });
    setShowActions(false);
  }, [petState.lastActionTime, stateKey, growthState]);

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

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (widgetRef.current && !widgetRef.current.contains(e.target as Node)) {
        setShowContextMenu(false);
      }
    };
    if (showContextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showContextMenu]);

  useEffect(() => {
    if (growthState.birthTime) {
      const elapsedSeconds = Math.floor((Date.now() - growthState.birthTime) / 1000);
      setTotalAge(Math.max(0, elapsedSeconds));
    }
    const ageInterval = setInterval(() => {
      setTotalAge(prev => prev + 1);
    }, 1000);
    return () => clearInterval(ageInterval);
  }, [growthState.birthTime]);

  useEffect(() => {
    if (growthState.stage !== 'egg' || petTheme !== 'dino') return;
    setDinoEggTimeLeft(Math.max(0, Math.ceil((DINO_STAGE_DURATIONS.egg - (Date.now() - growthState.stageStartTime)) / 1000)));
    const timerInterval = setInterval(() => {
      setDinoEggTimeLeft(Math.max(0, Math.ceil((DINO_STAGE_DURATIONS.egg - (Date.now() - growthState.stageStartTime)) / 1000)));
    }, 1000);
    return () => clearInterval(timerInterval);
  }, [growthState.stage, growthState.stageStartTime, petTheme]);

  if (!isEnabled || !isVisible) return null;

  const mood = getMood(petState.hunger, petState.happiness, petState.cleanliness);
  const showCleanliness = growthState.stage !== 'egg' && petTheme !== 'cat';
  const showHunger = growthState.stage !== 'egg' && growthState.stage !== 'baby' && petTheme !== 'cat';
  const showHappiness = growthState.stage !== 'egg' && growthState.stage !== 'baby' && growthState.stage !== 'child' && petTheme !== 'cat';
  const showStats = petTheme !== 'cat';
  const ringCount = getRingCount(growthState.stage);

  const nextStageDurations: Record<string, number> = {
    egg: STAGE_DURATIONS.egg,
    baby: STAGE_DURATIONS.baby,
    child: STAGE_DURATIONS.child,
    teen: STAGE_DURATIONS.teen,
  };
  const currentStageDuration = nextStageDurations[growthState.stage] ?? 0;
  const stageProgress = currentStageDuration > 0 
    ? Math.min(100, ((Date.now() - growthState.stageStartTime) / currentStageDuration) * 100) 
    : 0;

  const handlePetClickWithStage = (e: React.MouseEvent) => {
    if (growthState.stage === 'egg' && petTheme === 'original') {
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
    e.stopPropagation();
    setShowContextMenu(prev => !prev);
  }, []);

  const handleSettingsClick = useCallback(() => {
    setShowContextMenu(false);
    onOpenSettings?.();
  }, [onOpenSettings]);



  return (
    <div
      ref={widgetRef}
      className={`brmblegotchi-widget stage-${growthState.stage} theme-${petTheme} ${mood} ${isAnimating ? 'action-animating' : ''} ${eggClickAnim ? 'egg-click-animating' : ''}`}
      style={{
        bottom: `${position.bottom}px`,
        right: `${position.right}px`,
      }}
      onContextMenu={handleContextMenu}
    >
      {showActions && growthState.stage !== 'egg' && growthState.stage !== 'ghost' && (petTheme === 'cat' || petTheme === 'dino') && (
        <div className="brmblegotchi-actions">
          {petTheme === 'cat' ? (
            <>
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
            </>
          ) : (
            <>
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
              {(growthState.stage === 'child' || growthState.stage === 'teen' || growthState.stage === 'adult' || petTheme === 'dino') && (
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
              {(growthState.stage === 'teen' || growthState.stage === 'adult' || petTheme === 'dino') && (
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
            </>
          )}
        </div>
      )}

      <div className="brmblegotchi-pet-wrapper">
        <div className="brmblegotchi-pet" onClick={handlePetClickWithStage}>
          {(petTheme === 'dino' || petTheme === 'cat') ? (
            petTheme === 'dino' ? (
              <DinoSprite stage={growthState.stage} action={currentAction} />
            ) : (
              <CatSprite action={currentAction as 'idle' | 'feed' | 'play' | 'clean' | 'sleep' | 'happy'} />
            )
          ) : (
            <>
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
            </>
          )}

          {growthState.stage === 'ghost' && (
            <div className="brmblegotchi-restart-hint">Click to Restart</div>
          )}

          {growthState.stage === 'egg' && petTheme === 'original' && (
            <div className="brmblegotchi-egg-hint">
              {EGG_CLICKS_TO_HATCH - growthState.eggClicks} clicks left
            </div>
          )}
          {growthState.stage === 'egg' && petTheme === 'dino' && (
            <div className="brmblegotchi-egg-hint">
              Hatching in {dinoEggTimeLeft}s
            </div>
          )}
        </div>
      </div>

      <div className="brmblegotchi-stats">
        {showStats && (
          <>
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
          </>
        )}
      </div>

      {showContextMenu && (
        <div className="brmblegotchi-context-menu">
          <div className="brmblegotchi-context-header">Status</div>
          <div className="brmblegotchi-context-item">
            <span>Stage</span>
            <span>{growthState.stage === 'egg' ? 'Egg' : growthState.stage.charAt(0).toUpperCase() + growthState.stage.slice(1)}</span>
          </div>
          <div className="brmblegotchi-context-item">
            <span>Age</span>
            <span>{formatAge(totalAge)}</span>
          </div>
          {growthState.stage !== 'egg' && growthState.stage !== 'adult' && growthState.stage !== 'ghost' && !(petTheme === 'dino' && growthState.stage === 'teen') && (
            <div className="brmblegotchi-context-item">
              <span>Next stage</span>
              <span>{Math.ceil((100 - stageProgress) / 100 * 60)}s</span>
            </div>
          )}
          <button className="brmblegotchi-context-settings" onClick={handleSettingsClick}>
            Settings
          </button>
        </div>
      )}

      <div className="brmblegotchi-drag-handle" onMouseDown={handleMouseDown}>
        <span /><span /><span />
      </div>
    </div>
  );
}

export { BrmblegotchiWidget as Brmblegotchi }
