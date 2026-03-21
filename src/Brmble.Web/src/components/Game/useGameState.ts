import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { GameState, GameActions, Infrastructure, Service } from './types';
import { INITIAL_STATE } from './types';
import { applyTheme } from '../../themes/theme-loader';
import { useProfileFingerprint } from '../../contexts/ProfileContext';

const STORAGE_KEY = 'idle-farm-save';
const THEME_KEY = 'idle-farm-theme';

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
  const sortedServices = [...services].sort((a, b) => {
    const efficiencyA = a.baseIncomePerSecond / a.baseBandwidthRequired;
    const efficiencyB = b.baseIncomePerSecond / b.baseBandwidthRequired;
    return efficiencyB - efficiencyA;
  });
  
  let bandwidthUsed = 0;
  let income = 0;
  
  for (const service of sortedServices) {
    if (!service.unlocked || service.owned === 0) continue;
    
    const serviceBandwidth = service.baseBandwidthRequired;
    const maxCanFit = Math.floor((bandwidth - bandwidthUsed) / serviceBandwidth);
    const toActivate = Math.min(service.owned, maxCanFit);
    
    if (toActivate > 0) {
      bandwidthUsed += serviceBandwidth * toActivate;
      income += service.baseIncomePerSecond * toActivate;
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
  if (!('services' in state) || !Array.isArray((state as GameState).services)) return false;
  const services = (state as GameState).services;
  if (services.length === 0) return false;
  const first = services[0];
  if (!first || typeof first !== 'object') return false;
  return 'baseCost' in first;
}

export function useGameState() {
  const fingerprint = useProfileFingerprint();
  const storageKey = fingerprint ? `${STORAGE_KEY}_${fingerprint}` : STORAGE_KEY;
  const themeKey = fingerprint ? `${THEME_KEY}_${fingerprint}` : THEME_KEY;

  const [state, setState] = useState<GameState>(() => {
    const saved = localStorage.getItem(storageKey);
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
    const totalBandwidthDemanded = state.services
      .filter(s => s.unlocked && s.owned > 0)
      .reduce((total, s) => total + (s.baseBandwidthRequired * s.owned), 0);
    const isOverage = totalBandwidthDemanded > bandwidth;
    const incomeAfterPenalty = isOverage ? Math.floor(income * 0.85) : income;
    return { uploadSpeed: bandwidth, bandwidthSold: bandwidthUsed, bandwidthDemanded: totalBandwidthDemanded, incomePerSecond: incomeAfterPenalty };
  }, [state.infrastructure, state.services]);

  useEffect(() => {
    setState(prev => ({ ...prev, ...derivedValues }));
  }, [derivedValues]);

  useEffect(() => {
    const interval = setInterval(() => {
      localStorage.setItem(storageKey, JSON.stringify({ ...stateRef.current, lastSaved: Date.now() }));
    }, 30000);
    return () => clearInterval(interval);
  }, [storageKey]);

  // Reload state when profile fingerprint changes
  const fingerprintRef = useRef(fingerprint);
  useEffect(() => {
    if (fingerprint && fingerprint !== fingerprintRef.current) {
      fingerprintRef.current = fingerprint;
      const key = `${STORAGE_KEY}_${fingerprint}`;
      const saved = localStorage.getItem(key);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (hasInfrastructure(parsed) && hasServices(parsed)) {
            setState(parsed);
            return;
          }
        } catch { /* ignore */ }
      }
      setState(INITIAL_STATE);
    }
  }, [fingerprint]);

  useEffect(() => {
    const interval = setInterval(() => {
      const currentIncome = derivedValues.incomePerSecond;
      setState(prev => ({
        ...prev,
        money: prev.money + (currentIncome / 10),
      }));
    }, 100);
    return () => clearInterval(interval);
  }, [derivedValues.incomePerSecond]);

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

  const buyService = useCallback((serviceId: string) => {
    setState(prev => {
      const service = prev.services.find(s => s.id === serviceId);
      if (!service || !service.unlocked) return prev;
      
      const cost = Math.floor(service.baseCost * Math.pow(1.15, service.owned));
      if (prev.money < cost) return prev;
      
      return {
        ...prev,
        money: prev.money - cost,
        services: prev.services.map(s => s.id === serviceId ? { ...s, owned: s.owned + 1 } : s)
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
    localStorage.setItem(themeKey, theme);
  }, [themeKey]);

  const saveGame = useCallback(() => {
    localStorage.setItem(storageKey, JSON.stringify({ ...state, lastSaved: Date.now() }));
  }, [state, storageKey]);

  const loadGame = useCallback(() => {
    const saved = localStorage.getItem(storageKey);
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
  }, [storageKey]);

  const resetGame = useCallback(() => {
    localStorage.removeItem(storageKey);
    setState(INITIAL_STATE);
  }, [storageKey]);

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
    buyService,
    unlockService,
    setTheme,
    saveGame,
    loadGame,
    resetGame,
    exportSave,
    importSave,
  };

  return {
    state,
    actions,
  };
}
