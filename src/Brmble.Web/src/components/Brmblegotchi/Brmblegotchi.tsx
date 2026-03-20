import { useState, useRef, useCallback, useEffect } from 'react';
import './Brmblegotchi.css';

interface BrmblegotchiWidgetProps {
  hunger: number;
  happiness: number;
  cleanliness: number;
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

const STORAGE_KEY = 'brmblegotchi-dismissed';

export function BrmblegotchiWidget({ hunger, happiness, cleanliness }: BrmblegotchiWidgetProps) {
  const [isVisible, setIsVisible] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored !== 'true';
  });
  const [showActions, setShowActions] = useState(false);
  const [position, setPosition] = useState({ bottom: 24, right: 24 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const widgetRef = useRef<HTMLDivElement>(null);

  const handleDismiss = useCallback(() => {
    setIsVisible(false);
    localStorage.setItem(STORAGE_KEY, 'true');
  }, []);

  const handlePetClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowActions(prev => !prev);
  }, []);

  const handleAction = useCallback((action: string) => {
    console.log(`Brmblegotchi action: ${action}`);
    setShowActions(false);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.brmblegotchi-actions') || 
        (e.target as HTMLElement).closest('.brmblegotchi-dismiss') ||
        (e.target as HTMLElement).closest('.brmblegotchi-pet')) {
      return;
    }
    setIsDragging(true);
    dragOffset.current = {
      x: e.clientX - position.right,
      y: window.innerHeight - e.clientY - position.bottom,
    };
  }, [position]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    const newRight = Math.max(0, window.innerWidth - e.clientX - dragOffset.current.x);
    const newBottom = Math.max(0, e.clientY - dragOffset.current.y);
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

  if (!isVisible) return null;

  const mood = getMood(hunger, happiness, cleanliness);

  return (
    <div
      ref={widgetRef}
      className={`brmblegotchi-widget ${mood}`}
      style={{
        bottom: `${position.bottom}px`,
        right: `${position.right}px`,
      }}
      onMouseDown={handleMouseDown}
    >
      <button className="brmblegotchi-dismiss" onClick={handleDismiss} aria-label="Dismiss pet">
        <CloseIcon />
      </button>

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
          <div className={`brmblegotchi-mouth ${mood}`} />
        </div>

        {showActions && (
          <div className="brmblegotchi-actions">
            <button
              className="brmblegotchi-action-btn"
              onClick={(e) => { e.stopPropagation(); handleAction('feed'); }}
              aria-label="Feed"
            >
              <FoodIcon />
            </button>
            <button
              className="brmblegotchi-action-btn"
              onClick={(e) => { e.stopPropagation(); handleAction('play'); }}
              aria-label="Play"
            >
              <PlayIcon />
            </button>
            <button
              className="brmblegotchi-action-btn"
              onClick={(e) => { e.stopPropagation(); handleAction('clean'); }}
              aria-label="Clean"
            >
              <CleanIcon />
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
            <div className="brmblegotchi-stat-fill hunger" style={{ width: `${hunger}%` }} />
          </div>
        </div>
        <div className="brmblegotchi-stat">
          <div className="brmblegotchi-stat-icon" style={{ color: 'var(--accent-secondary)' }}>
            <HappinessIcon />
          </div>
          <div className="brmblegotchi-stat-bar">
            <div className="brmblegotchi-stat-fill happiness" style={{ width: `${happiness}%` }} />
          </div>
        </div>
        <div className="brmblegotchi-stat">
          <div className="brmblegotchi-stat-icon" style={{ color: 'var(--accent-decorative)' }}>
            <CleanlinessIcon />
          </div>
          <div className="brmblegotchi-stat-bar">
            <div className="brmblegotchi-stat-fill cleanliness" style={{ width: `${cleanliness}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function BrmblegotchiDemo() {
  const [hunger, setHunger] = useState(75);
  const [happiness, setHappiness] = useState(60);
  const [cleanliness, setCleanliness] = useState(85);

  useEffect(() => {
    const interval = setInterval(() => {
      setHunger(prev => Math.max(0, prev - Math.random() * 2));
      setHappiness(prev => Math.max(0, prev - Math.random() * 1.5));
      setCleanliness(prev => Math.max(0, prev - Math.random() * 1));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <BrmblegotchiWidget
      hunger={hunger}
      happiness={happiness}
      cleanliness={cleanliness}
    />
  );
}
