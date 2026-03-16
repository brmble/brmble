import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { GameState, GameActions, Infrastructure, Service } from './types';
import { INITIAL_STATE } from './types';
import { applyTheme } from '../../themes/theme-loader';

const STORAGE_KEY = 'idle-farm-save';

function calculateBandwidth(infra: Infrastructure[]): number {
  return infra.reduce((total, item) => {
    if (!item.unlocked) return total;
    const owned = item.owned ?? 0;
    const upgrade1Multiplier = 1 + (item.upgrade1Level * 0.25);
    const upgrade2Multiplier = 1 + (item.upgrade2Level * 0.25);
    const upgrade3Multiplier = 1 + (item.upgrade3Level * 0.25);
    const totalMultiplier = upgrade1Multiplier * upgrade2Multiplier * upgrade3Multiplier;
    return total + Math.floor(item.bandwidthBytesPerSecond * owned * totalMultiplier);
  }, 0);
}

function calculateIncome(services: Service[], bandwidth: number): { income: number; bandwidthUsed: number } {
  let bandwidthUsed = 0;
  let income = 0;
  
  for (const service of services) {
    if (!service.unlocked || !service.active) continue;
    if (bandwidthUsed + service.bandwidthRequired <= bandwidth) {
      bandwidthUsed += service.bandwidthRequired;
      income += service.incomePerSecond;
    }
  }
  
  return { income, bandwidthUsed };
}

function hasInfrastructure(state: unknown): state is GameState {
  if (typeof state !== 'object' || state === null) return false;
  return 'infrastructure' in state && Array.isArray((state as GameState).infrastructure);
}

function hasServices(state: unknown): state is GameState {
  if (typeof state !== 'object' || state === null) return false;
  return 'services' in state && Array.isArray((state as GameState).services);
}

export function useGameState() {
  const [state, setState] = useState<GameState>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (!hasInfrastructure(parsed) || !hasServices(parsed)) {
          return INITIAL_STATE;
        }
        return parsed;
      } catch {
        return INITIAL_STATE;
      }
    }
    return INITIAL_STATE;
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const derivedValues = useMemo(() => {
    const bandwidth = calculateBandwidth(state.infrastructure);
    const { income, bandwidthUsed } = calculateIncome(state.services, bandwidth);
    return { uploadSpeed: bandwidth, bandwidthSold: bandwidthUsed, incomePerSecond: income };
  }, [state.infrastructure, state.services]);

  const incomeRef = useRef(derivedValues.incomePerSecond);

  useEffect(() => {
    incomeRef.current = derivedValues.incomePerSecond;
  }, [derivedValues.incomePerSecond]);

  useEffect(() => {
    const interval = setInterval(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stateRef.current, lastSaved: Date.now() }));
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setState(prev => ({
        ...prev,
        money: prev.money + (incomeRef.current / 10),
      }));
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const buyInfrastructure = useCallback((infraId: string) => {
    setState(prev => {
      const infra = prev.infrastructure.find(i => i.id === infraId);
      if (!infra || !infra.unlocked) return prev;
      const cost = Math.floor(infra.baseCost * Math.pow(1.15, infra.owned));
      if (prev.money < cost) return prev;
      const newInfra = prev.infrastructure.map(i => i.id === infraId ? { ...i, owned: i.owned + 1 } : i);
      return { ...prev, infrastructure: newInfra, money: prev.money - cost };
    });
  }, []);

  const upgrade1 = useCallback((infraId: string) => {
    setState(prev => {
      const infra = prev.infrastructure.find(i => i.id === infraId);
      if (!infra || !infra.unlocked || infra.upgrade1Level >= 10) return prev;
      if (prev.money < infra.upgrade1Cost) return prev;
      return {
        ...prev,
        infrastructure: prev.infrastructure.map(i => {
          if (i.id !== infraId) return i;
          return {
            ...i,
            upgrade1Level: i.upgrade1Level + 1,
            upgrade1Cost: Math.floor(i.upgrade1Cost * 1.5),
          };
        }),
        money: prev.money - infra.upgrade1Cost,
      };
    });
  }, []);

  const upgrade2 = useCallback((infraId: string) => {
    setState(prev => {
      const infra = prev.infrastructure.find(i => i.id === infraId);
      if (!infra || !infra.unlocked || infra.upgrade2Level >= 10) return prev;
      if (prev.money < infra.upgrade2Cost) return prev;
      return {
        ...prev,
        infrastructure: prev.infrastructure.map(i => {
          if (i.id !== infraId) return i;
          return {
            ...i,
            upgrade2Level: i.upgrade2Level + 1,
            upgrade2Cost: Math.floor(i.upgrade2Cost * 1.5),
          };
        }),
        money: prev.money - infra.upgrade2Cost,
      };
    });
  }, []);

  const upgrade3 = useCallback((infraId: string) => {
    setState(prev => {
      const infra = prev.infrastructure.find(i => i.id === infraId);
      if (!infra || !infra.unlocked || infra.upgrade3Level >= 5) return prev;
      if (prev.money < infra.upgrade3Cost) return prev;
      return {
        ...prev,
        infrastructure: prev.infrastructure.map(i => {
          if (i.id !== infraId) return i;
          return {
            ...i,
            upgrade3Level: i.upgrade3Level + 1,
            upgrade3Cost: Math.floor(i.upgrade3Cost * 1.5),
          };
        }),
        money: prev.money - infra.upgrade3Cost,
      };
    });
  }, []);

  const unlockInfrastructure = useCallback((infraId: string) => {
    setState(prev => {
      const infra = prev.infrastructure.find(i => i.id === infraId);
      if (!infra || infra.unlocked || !infra.unlockCost) return prev;
      if (prev.money < infra.unlockCost) return prev;
      return {
        ...prev,
        infrastructure: prev.infrastructure.map(i => 
          i.id === infraId ? { ...i, unlocked: true } : i
        ),
        money: prev.money - infra.unlockCost,
      };
    });
  }, []);

  const toggleService = useCallback((serviceId: string) => {
    setState(prev => {
      const service = prev.services.find(s => s.id === serviceId);
      if (!service || !service.unlocked) return prev;
      
      const currentUsed = prev.bandwidthSold;
      const wouldBeUsed = service.active 
        ? currentUsed - service.bandwidthRequired 
        : currentUsed + service.bandwidthRequired;
      
      if (!service.active && wouldBeUsed > prev.uploadSpeed) return prev;
      
      return {
        ...prev,
        services: prev.services.map(s => s.id === serviceId ? { ...s, active: !s.active } : s)
      };
    });
  }, []);

  const unlockService = useCallback((serviceId: string) => {
    setState(prev => {
      const service = prev.services.find(s => s.id === serviceId);
      if (!service || service.unlocked || prev.money < service.unlockRequirement) return prev;
      return {
        ...prev,
        services: prev.services.map(s => s.id === serviceId ? { ...s, unlocked: true } : s),
        money: prev.money - service.unlockRequirement
      };
    });
  }, []);

  const setTheme = useCallback((theme: string) => {
    applyTheme(theme);
    localStorage.setItem('idle-farm-theme', theme);
  }, []);

  const saveGame = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, lastSaved: Date.now() }));
  }, [state]);

  const loadGame = useCallback(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (!hasInfrastructure(parsed) || !hasServices(parsed)) {
          setState(INITIAL_STATE);
        } else {
          setState(parsed);
        }
      } catch {
        // Invalid save data
      }
    }
  }, []);

  const resetGame = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState(INITIAL_STATE);
  }, []);

  const exportSave = useCallback((): string => {
    return JSON.stringify(state);
  }, [state]);

  const importSave = useCallback((data: string): boolean => {
    try {
      const parsed = JSON.parse(data);
      if (!hasInfrastructure(parsed) || !hasServices(parsed)) {
        return false;
      }
      setState(parsed);
      return true;
    } catch {
      return false;
    }
  }, []);

  const actions: GameActions = {
    buyInfrastructure,
    upgrade1,
    upgrade2,
    upgrade3,
    unlockInfrastructure,
    toggleService,
    unlockService,
    setTheme,
    saveGame,
    loadGame,
    resetGame,
    exportSave,
    importSave,
  };

  return {
    state: { ...state, ...derivedValues },
    actions,
  };
}
