import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import type { GameState, GameActions, License } from './types';
import { INITIAL_STATE } from './types';
import { applyTheme } from '../../themes/theme-loader';
import { useProfileFingerprint } from '../../contexts/ProfileContext';

const STORAGE_KEY = 'idle-farm-save';
const THEME_KEY = 'idle-farm-theme';

function hasInfrastructure(state: unknown): state is GameState {
  if (typeof state !== 'object' || state === null) return false;
  return 'infrastructure' in state && Array.isArray((state as GameState).infrastructure);
}

function hasLicenses(state: unknown): state is GameState {
  if (typeof state !== 'object' || state === null) return false;
  if (!('licenses' in state) || !Array.isArray((state as GameState).licenses)) return false;
  const licenses = (state as GameState).licenses;
  if (licenses.length === 0) return false;
  const first = licenses[0];
  if (!first || typeof first !== 'object') return false;
  return 'baseCap' in first;
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
        if (!hasInfrastructure(parsed) || !hasLicenses(parsed)) {
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

  const uploadSpeed = useMemo(() => {
    return state.infrastructure.reduce((total, infra) => {
      const multiplier = 1 + (infra.upgrade1Level * 0.25);
      return total + (infra.bandwidthBytesPerSecond * infra.owned * multiplier);
    }, 0);
  }, [state.infrastructure]);

  useEffect(() => {
    setState(prev => ({ ...prev, uploadSpeed }));
  }, [uploadSpeed]);

  useEffect(() => {
    const interval = setInterval(() => {
      localStorage.setItem(storageKey, JSON.stringify({ ...stateRef.current, lastSaved: Date.now() }));
    }, 30000);
    return () => clearInterval(interval);
  }, [storageKey]);

  // Reload state when profile fingerprint changes
  const fingerprintRef = useRef(fingerprint);
  useLayoutEffect(() => {
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
      setState(prev => {
        const totalIncome = prev.licenses
          .filter(l => l.unlocked)
          .reduce((sum, l) => sum + (l.allocated * l.incomePerKB), 0);
        
        return {
          ...prev,
          money: prev.money + totalIncome,
          incomePerSecond: totalIncome,
        };
      });
    }, 1000);
    
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

  const upgradeInfrastructure = useCallback((infrastructureId: string) => {
    setState(prev => {
      const infra = prev.infrastructure.find(i => i.id === infrastructureId);
      if (!infra || infra.upgrade1Level >= 10 || prev.money < infra.upgrade1Cost) {
        return prev;
      }
      
      const cost = infra.upgrade1Cost;
      const newLevel = infra.upgrade1Level + 1;
      const newCost = Math.floor(infra.baseCost * Math.pow(1.5, newLevel));
      
      return {
        ...prev,
        money: prev.money - cost,
        infrastructure: prev.infrastructure.map(i =>
          i.id === infrastructureId
            ? { ...i, upgrade1Level: newLevel, upgrade1Cost: newCost }
            : i
        ),
      };
    });
  }, []);

  const MAX_SAFE_INTEGER = 9007199254740991;

  const calculateCap = (license: License, level: number): number => {
    const raw = license.baseCap + (level * license.capPerLevel);
    return Math.min(raw, MAX_SAFE_INTEGER);
  };

  const unlockLicense = useCallback((licenseId: string) => {
    setState(prev => {
      const license = prev.licenses.find(l => l.id === licenseId);
      if (!license || license.unlocked || prev.money < license.unlockCost) {
        return prev;
      }
      
      return {
        ...prev,
        money: prev.money - license.unlockCost,
        licenses: prev.licenses.map(l =>
          l.id === licenseId ? { ...l, unlocked: true } : l
        ),
      };
    });
  }, []);

  const upgradeLicense = useCallback((licenseId: string) => {
    setState(prev => {
      const license = prev.licenses.find(l => l.id === licenseId);
      if (!license || !license.unlocked || license.level >= 10) {
        return prev;
      }
      
      const cost = Math.floor(license.baseUpgradeCost * Math.pow(1.15, license.level));
      if (prev.money < cost) {
        return prev;
      }
      
      const newLevel = license.level + 1;
      const newCost = Math.floor(license.baseUpgradeCost * Math.pow(1.15, newLevel));
      const newCap = calculateCap(license, newLevel);
      const newAllocated = Math.min(license.allocated, newCap);
      
      return {
        ...prev,
        money: prev.money - cost,
        licenses: prev.licenses.map(l =>
          l.id === licenseId
            ? { ...l, level: newLevel, upgradeCost: newCost, allocated: newAllocated }
            : l
        ),
      };
    });
  }, []);

  const allocateBandwidth = useCallback((licenseId: string, amount: number) => {
    setState(prev => {
      const license = prev.licenses.find(l => l.id === licenseId);
      if (!license || !license.unlocked) {
        return prev;
      }
      
      const cap = license.baseCap + (license.level * license.capPerLevel);
      const clampedAmount = Math.max(0, Math.min(amount, cap, prev.uploadSpeed));
      
      const currentAllocated = prev.licenses
        .filter(l => l.id !== licenseId)
        .reduce((sum, l) => sum + l.allocated, 0);
      
      const maxAllowed = prev.uploadSpeed - currentAllocated;
      const finalAmount = Math.min(clampedAmount, maxAllowed);
      
      const newAllocatedTotal = currentAllocated + finalAmount;
      
      return {
        ...prev,
        bandwidthAllocated: newAllocatedTotal,
        licenses: prev.licenses.map(l =>
          l.id === licenseId ? { ...l, allocated: finalAmount } : l
        ),
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
        if (!hasInfrastructure(parsed) || !hasLicenses(parsed)) {
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
      if (!hasInfrastructure(parsed) || !hasLicenses(parsed)) {
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
    upgradeInfrastructure,
    unlockLicense,
    upgradeLicense,
    allocateBandwidth,
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
