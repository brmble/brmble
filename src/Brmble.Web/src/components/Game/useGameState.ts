import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import type { GameState, GameActions, License, Advertisement, AdType, AdDuration, ActiveInvestment, InvestmentStatus } from './types';
import { INITIAL_STATE } from './types';
import { applyTheme } from '../../themes/theme-loader';
import { useProfileFingerprint } from '../../contexts/ProfileContext';

const AD_TYPES = ['video', 'banner', 'popup', 'sponsored'] as const;

const AD_TYPE_NAMES = {
  video: ['StreamHub', 'VidMax', 'TubePro', 'ClipStream', 'MovieBox'],
  banner: ['AdPlace', 'BannerHub', 'WebAd', 'DisplayNet', 'AdSpot'],
  popup: ['PopGen', 'AdPop', 'SpotPop', 'QuickAd', 'AlertBox'],
  sponsored: ['BrandSync', 'SponsorHub', 'PartnerPro', 'ContentPlus', 'BrandDeal'],
};

const AD_ADJECTIVES = {
  video: ['Pro', 'Plus', 'Max', 'Ultra', 'Elite'],
  banner: ['Basic', 'Standard', 'Prime', 'Premium', 'Plus'],
  popup: ['Quick', 'Fast', 'Swift', 'Rapid', 'Instant'],
  sponsored: ['Premium', 'Exclusive', 'Partner', 'Brand', 'VIP'],
};

const generateAdName = (type: AdType): string => {
  const names = AD_TYPE_NAMES[type];
  const adj = AD_ADJECTIVES[type];
  const name = names[Math.floor(Math.random() * names.length)];
  const a = adj[Math.floor(Math.random() * adj.length)];
  return `${a} ${name}`;
};

const getAdSlotCost = (currentSlots: number): number => {
  return Math.floor(10000 * Math.pow(2, currentSlots - 1));
};

const getEfficiency = (adCountOnLicense: number, efficiencyBonus: number = 0): number => {
  const baseEfficiency = adCountOnLicense === 1 ? 1.0 : adCountOnLicense === 2 ? 0.8 : adCountOnLicense === 3 ? 0.6 : 0.4;
  return Math.min(1.0, baseEfficiency + efficiencyBonus);
};

const getEffectiveCap = (license: License): number => {
  const baseAdCap = 0.6;
  return baseAdCap + license.bonus.capacityBonus;
};

const isLowVolume = (volume: number): boolean => volume <= 2;

const STORAGE_KEY = 'idle-farm-save';
const THEME_KEY = 'idle-farm-theme';

const DURATION_VALUES = {
  short: { minMs: 5 * 60 * 1000, maxMs: 20 * 60 * 1000, bonus: 1.1 },
  medium: { minMs: 60 * 60 * 1000, maxMs: 4 * 60 * 60 * 1000, bonus: 1.25 },
  long: { minMs: 6 * 60 * 60 * 1000, maxMs: 12 * 60 * 60 * 1000, bonus: 1.5 },
};

const VOLUME_TO_CAPACITY = {
  1: 0.1,
  2: 0.2,
  3: 0.3,
  4: 0.4,
  5: 0.5,
};

const VOLUME_BONUS = {
  1: 0.9,
  2: 1.0,
  3: 1.1,
  4: 1.2,
  5: 1.3,
};

const MARGIN_MULTIPLIER = {
  1: 1.2,
  2: 1.4,
  3: 1.6,
  4: 1.8,
  5: 2.0,
};

const MAX_VOLUME_BY_TIER: Record<number, number> = {
  1: 3,
  2: 4,
  3: 5,
};

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
          if (hasInfrastructure(parsed) && hasLicenses(parsed)) {
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
        const getAdVolumeKB = (ad: Advertisement, license: License): number => {
          const cap = calculateCap(license, license.level);
          const effectiveCap = getEffectiveCap(license);
          const maxAdKB = cap * effectiveCap;
          const volumePercent = ad.volume * 0.05; // 5% per star (1-5 stars = 5-25%)
          return maxAdKB * volumePercent;
        };

        let totalAdIncome = 0;
        let totalRegularIncome = 0;

        for (const license of prev.licenses) {
          if (!license.unlocked) continue;

          const cap = calculateCap(license, license.level);
          const adsOnLicense = prev.advertisements.filter(a => a.licenseId === license.id);

          for (let i = 0; i < adsOnLicense.length; i++) {
            const ad = adsOnLicense[i];
            const efficiency = getEfficiency(i + 1, license.bonus.efficiencyBonus);
            const volumeKB = getAdVolumeKB(ad, license);

            let marginRate = ad.margin * 0.00001;
            if (isLowVolume(ad.volume) && license.bonus.marginBonus > 0) {
              marginRate *= (1 + license.bonus.marginBonus);
            }

            const effectiveMargin = marginRate * efficiency;
            totalAdIncome += volumeKB * effectiveMargin;
          }

          const minContent = cap * 0.4;
          const adUsage = adsOnLicense.reduce((sum, ad) => sum + getAdVolumeKB(ad, license), 0);
          const regularKB = Math.max(0, cap - adUsage - minContent);
          totalRegularIncome += regularKB * license.incomePerKB;
        }

        const totalIncome = totalAdIncome + totalRegularIncome;

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

  const getDuration = (): AdDuration => {
    const rand = Math.random();
    if (rand < 0.33) return 'short';
    if (rand < 0.66) return 'medium';
    return 'long';
  };

  const getDurationMs = (duration: AdDuration): number => {
    const { minMs, maxMs } = DURATION_VALUES[duration];
    return Math.floor(Math.random() * (maxMs - minMs) + minMs);
  };

  const calculateInvestmentCost = (license: License, volumeStars: number): number => {
    const cap = calculateCap(license, license.level);
    const effectiveCap = getEffectiveCap(license);
    const volumeKB = cap * effectiveCap * (VOLUME_TO_CAPACITY as Record<number, number>)[volumeStars];
    return volumeKB * license.incomePerKB * 60;
  };

  const calculateInvestmentPayout = (
    cost: number,
    volume: number,
    margin: number,
    duration: AdDuration
  ): number => {
    const marginMult = (MARGIN_MULTIPLIER as Record<number, number>)[margin];
    const volumeBonus = (VOLUME_BONUS as Record<number, number>)[volume];
    const durationBonus = DURATION_VALUES[duration].bonus;
    return cost * marginMult * volumeBonus * durationBonus;
  };

  const getVolumeCapacityKB = (license: License, volumeStars: number): number => {
    const cap = calculateCap(license, license.level);
    const effectiveCap = getEffectiveCap(license);
    return cap * effectiveCap * (VOLUME_TO_CAPACITY as Record<number, number>)[volumeStars];
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
      if (!license || !license.unlocked) {
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
      
      const cap = calculateCap(license, license.level);
      const clampedByCap = Math.max(0, Math.min(amount, cap));
      
      const currentAllocated = prev.licenses
        .filter(l => l.id !== licenseId)
        .reduce((sum, l) => sum + l.allocated, 0);
      
      const maxAllowed = Math.max(0, prev.uploadSpeed - currentAllocated);
      const finalAmount = Math.min(clampedByCap, maxAllowed);
      
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

  const getAdVolumeKB = (ad: Advertisement, license: License): number => {
    const cap = calculateCap(license, license.level);
    const effectiveCap = getEffectiveCap(license);
    const maxAdKB = cap * effectiveCap;
    const volumePercent = ad.volume / 5;
    return maxAdKB * volumePercent;
  };

  const generateAdOptions = useCallback((): Advertisement[] => {
    const options: Advertisement[] = [];
    for (let i = 0; i < 3; i++) {
      const type = AD_TYPES[Math.floor(Math.random() * AD_TYPES.length)];
      const volume = Math.floor(Math.random() * 5) + 1;
      const margin = Math.floor(Math.random() * 5) + 1;
      const duration = getDuration();
      options.push({
        id: crypto.randomUUID(),
        name: generateAdName(type),
        type,
        volume,
        margin,
        licenseId: '',
        duration,
      });
    }
    return options;
  }, []);

  const assignAdToLicense = useCallback((adId: string, licenseId: string) => {
    setState(prev => {
      const ad = prev.advertisements.find(a => a.id === adId);
      if (!ad) return prev;

      if (!licenseId) {
        return {
          ...prev,
          advertisements: prev.advertisements.map(a =>
            a.id === adId ? { ...a, licenseId: '' } : a
          ),
        };
      }

      const license = prev.licenses.find(l => l.id === licenseId);
      if (!license || !license.unlocked) return prev;

      const otherAdsOnLicense = prev.advertisements
        .filter(a => a.id !== adId && a.licenseId === licenseId)
        .reduce((sum, a) => sum + getAdVolumeKB(a, license), 0);

      const cap = calculateCap(license, license.level);
      const effectiveCap = getEffectiveCap(license);
      const maxAdKB = cap * effectiveCap;
      const available = maxAdKB - otherAdsOnLicense;
      const adKB = getAdVolumeKB(ad, license);

      if (adKB > available) return prev;

      return {
        ...prev,
        advertisements: prev.advertisements.map(a =>
          a.id === adId ? { ...a, licenseId } : a
        ),
      };
    });
  }, []);

  const buyAdSlot = useCallback(() => {
    setState(prev => {
      const cost = getAdSlotCost(prev.adSlots);
      if (prev.money < cost) return prev;
      if (prev.advertisements.length >= prev.adSlots) return prev;

      return {
        ...prev,
        money: prev.money - cost,
        adSlots: prev.adSlots + 1,
      };
    });
  }, []);

  const startInvestment = useCallback((adId: string, licenseId: string) => {
    setState(prev => {
      const ad = prev.advertisements.find(a => a.id === adId);
      if (!ad) return prev;
      
      const license = prev.licenses.find(l => l.id === licenseId);
      if (!license || !license.unlocked) return prev;
      
      const hasRunningInvestment = prev.activeInvestments.some(
        i => i.licenseId === licenseId && i.status === 'running'
      );
      if (hasRunningInvestment) return prev;
      
      const maxVolume = MAX_VOLUME_BY_TIER[license.tier];
      if (maxVolume === undefined || ad.volume > maxVolume) return prev;
      
      const volumeKB = getVolumeCapacityKB(license, ad.volume);
      const cost = calculateInvestmentCost(license, ad.volume);
      
      if (prev.money < cost) return prev;
      
      const duration = getDuration();
      const durationMs = getDurationMs(duration);
      const payout = calculateInvestmentPayout(cost, ad.volume, ad.margin, duration);
      
      const newInvestment: ActiveInvestment = {
        adId,
        licenseId,
        startTime: Date.now(),
        durationMs,
        payout,
        status: 'running',
        volumeKB,
      };
      
      return {
        ...prev,
        money: prev.money - cost,
        activeInvestments: [...prev.activeInvestments, newInvestment],
      };
    });
  }, []);

  const collectInvestment = useCallback((adId: string) => {
    setState(prev => {
      const investment = prev.activeInvestments.find(i => i.adId === adId);
      if (!investment || investment.status !== 'ready') return prev;
      
      return {
        ...prev,
        money: prev.money + investment.payout,
        activeInvestments: prev.activeInvestments.filter(i => i.adId !== adId),
      };
    });
  }, []);

  const selectAd = useCallback((ad: Advertisement) => {
    setState(prev => {
      let newAds: Advertisement[];
      if (prev.advertisements.length < prev.adSlots) {
        newAds = [...prev.advertisements, ad];
      } else {
        newAds = [ad, ...prev.advertisements.slice(1)];
      }
      return {
        ...prev,
        advertisements: newAds,
        lastAdRefresh: Date.now(),
      };
    });
  }, []);

  const hasRunningInvestments = useMemo(
    () => state.activeInvestments.some(i => i.status === 'running'),
    [state.activeInvestments]
  );

  useEffect(() => {
    if (!hasRunningInvestments) return;
    
    const interval = setInterval(() => {
      setState(prev => {
        const now = Date.now();
        let hasChanges = false;
        
        const updatedInvestments = prev.activeInvestments.map(inv => {
          if (inv.status !== 'running') return inv;
          
          const elapsed = now - inv.startTime;
          if (elapsed >= inv.durationMs) {
            hasChanges = true;
            return { ...inv, status: 'ready' as InvestmentStatus };
          }
          return inv;
        });
        
        if (!hasChanges) return prev;
        return { ...prev, activeInvestments: updatedInvestments };
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [hasRunningInvestments]);

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
    generateAdOptions,
    selectAd,
    assignAdToLicense,
    buyAdSlot,
    startInvestment,
    collectInvestment,
  };

  return {
    state,
    actions,
  };
}
