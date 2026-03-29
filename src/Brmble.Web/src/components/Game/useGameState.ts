import { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import type { GameState, GameActions, License, Advertisement, AdType, ActiveInvestment, InvestmentStatus } from './types';
import { INITIAL_STATE } from './types';
import { applyTheme } from '../../themes/theme-loader';
import { useProfileFingerprint } from '../../contexts/ProfileContext';

const STAR_WEIGHTS = [
  { stars: 1, weight: 0.25 },
  { stars: 2, weight: 0.25 },
  { stars: 3, weight: 0.28 },
  { stars: 4, weight: 0.15 },
  { stars: 5, weight: 0.07 },
];

function getWeightedStarRating(): number {
  const rand = Math.random();
  let cumulative = 0;
  for (const { stars, weight } of STAR_WEIGHTS) {
    cumulative += weight;
    if (rand < cumulative) return stars;
  }
  return 3;
}

const PASSIVE_INCOME_BY_STARS: Record<number, number> = {
  1: 0.10,
  2: 0.25,
  3: 0.50,
  4: 1.50,
  5: 4.00,
};

const MARGIN_MULTIPLIER_BY_STARS: Record<number, number> = {
  1: 100,
  2: 200,
  3: 400,
  4: 800,
  5: 1600,
};

const VOLUME_KB_BY_STARS: Record<number, number> = {
  1: 512,
  2: 1024,
  3: 2048,
  4: 4096,
  5: 8192,
};

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

const getEffectiveCap = (license: License): number => {
  const baseAdCap = 0.6;
  return baseAdCap + license.bonus.capacityBonus;
};

const STORAGE_KEY = 'idle-farm-save';
const THEME_KEY = 'idle-farm-theme';

export const VOLUME_TO_CAPACITY = {
  1: 0.1,
  2: 0.2,
  3: 0.3,
  4: 0.4,
  5: 0.5,
};

const TIER_MAX_VOLUME = {
  1: 2,
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
  if (!('advertisements' in state) || !Array.isArray((state as GameState).advertisements)) return false;
  if (!('adSlots' in state) || typeof (state as GameState).adSlots !== 'number') return false;
  if (!('activeInvestments' in state) || !Array.isArray((state as GameState).activeInvestments)) return false;
  const licenses = (state as GameState).licenses;
  if (licenses.length === 0) return true;
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

  const getAdVolumeKB = (ad: Advertisement, license: License): number => {
    const cap = calculateCap(license, license.level);
    const effectiveCap = getEffectiveCap(license);
    const maxAdKB = cap * effectiveCap;
    const volumePercent = ad.volume / 5;
    return maxAdKB * volumePercent;
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setState(prev => {
        const regularIncome = prev.licenses
          .filter(l => l.unlocked)
          .reduce((sum, l) => sum + l.allocated * l.incomePerKB, 0);

        const passiveIncome = prev.activeInvestments
          .filter(i => i.status === 'running')
          .reduce((sum, i) => sum + i.passiveIncomePerSec, 0);

        const totalIncome = regularIncome + passiveIncome;

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

  const unlockInfrastructure = useCallback((infraId: string) => {
    setState(prev => {
      const infra = prev.infrastructure.find(i => i.id === infraId);
      if (!infra || infra.unlocked || !infra.unlockCost || prev.money < infra.unlockCost) {
        return prev;
      }
      
      return {
        ...prev,
        money: prev.money - infra.unlockCost,
        infrastructure: prev.infrastructure.map(i =>
          i.id === infraId ? { ...i, unlocked: true } : i
        ),
      };
    });
  }, []);

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
      const newCap = calculateCap(license, newLevel);
      const newAllocated = Math.min(license.allocated, newCap);
      
      return {
        ...prev,
        money: prev.money - cost,
        licenses: prev.licenses.map(l =>
          l.id === licenseId
            ? { ...l, level: newLevel, allocated: newAllocated }
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

  const generateAdOptions = useCallback((): Advertisement[] => {
    const options: Advertisement[] = [];
    
    const highestTier = Math.max(...state.licenses
      .filter(l => l.unlocked)
      .map(l => l.tier));
    
    const tierMultiplier = Math.pow(2, highestTier - 1);
    
    const totalUploadSpeedKBps = state.uploadSpeed / 1024;
    
    const TIME_RANGES: Record<number, { minFactor: number; maxFactor: number }> = {
      1: { minFactor: 6.0, maxFactor: 30.0 },
      2: { minFactor: 30.0, maxFactor: 90.0 },
      3: { minFactor: 90.0, maxFactor: 180.0 },
      4: { minFactor: 180.0, maxFactor: 360.0 },
      5: { minFactor: 360.0, maxFactor: 1080.0 },
    };
    
    for (let i = 0; i < 3; i++) {
      const type = AD_TYPES[Math.floor(Math.random() * AD_TYPES.length)];
      const volume = getWeightedStarRating();
      const margin = getWeightedStarRating();
      const passiveIncome = getWeightedStarRating();
      
      const volumeKB = VOLUME_KB_BY_STARS[volume] * tierMultiplier;
      
      const baseTimeSec = volumeKB / totalUploadSpeedKBps;
      const { minFactor, maxFactor } = TIME_RANGES[volume];
      const timeFactor = minFactor + Math.random() * (maxFactor - minFactor);
      const timeLimitMs = Math.floor(baseTimeSec * timeFactor * 1000);
      
      const passivePerSec = PASSIVE_INCOME_BY_STARS[passiveIncome];
      const marginMult = MARGIN_MULTIPLIER_BY_STARS[margin];
      
      const estimatedDurationSec = timeLimitMs / 1000;
      const expectedPassive = passivePerSec * estimatedDurationSec;
      const expectedMargin = volumeKB * 0.001 * marginMult;
      const expectedTotal = expectedPassive + expectedMargin;
      
      const buyPrice = expectedTotal * (0.20 + Math.random() * 0.10);
      
      options.push({
        id: crypto.randomUUID(),
        name: generateAdName(type),
        type,
        volume,
        margin,
        passiveIncome,
        volumeKB,
        timeLimitMs,
        licenseId: '',
        buyPrice: Math.round(buyPrice * 100) / 100,
      });
    }
    return options;
  }, [state.licenses, state.uploadSpeed]);

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
      
      const maxVolume = (TIER_MAX_VOLUME as Record<number, number>)[license.tier] ?? 2;
      if (ad.volume > maxVolume) return prev;
      
      const hasRunningForAd = prev.activeInvestments.some(
        i => i.adId === adId && i.status === 'running'
      );
      if (hasRunningForAd) return prev;
      
      const hasRunningForLicense = prev.activeInvestments.some(
        i => i.licenseId === licenseId && i.status === 'running'
      );
      if (hasRunningForLicense) return prev;
      
      const passivePerSec = PASSIVE_INCOME_BY_STARS[ad.passiveIncome];
      const marginMult = MARGIN_MULTIPLIER_BY_STARS[ad.margin];
      const marginPerKB = license.incomePerKB * marginMult;
      
      const expectedDurationSec = ad.volumeKB / Math.max(license.allocated, 1);
      const expectedPassive = passivePerSec * expectedDurationSec;
      const expectedMargin = ad.volumeKB * marginPerKB;
      const expectedTotal = expectedPassive + expectedMargin;
      
      const breachFee = ad.buyPrice + (expectedTotal * 0.20);
      
      if (prev.money < ad.buyPrice) return prev;
      
      const newInvestment: ActiveInvestment = {
        adId,
        licenseId,
        startTime: Date.now(),
        volumeKB: ad.volumeKB,
        passiveIncomePerSec: passivePerSec,
        marginPerKB,
        buyPrice: ad.buyPrice,
        breachFee: Math.round(breachFee * 100) / 100,
        expectedTotalPayout: Math.round(expectedTotal * 100) / 100,
        status: 'running',
      };
      
      return {
        ...prev,
        money: prev.money - ad.buyPrice,
        activeInvestments: [...prev.activeInvestments, newInvestment],
        advertisements: prev.advertisements.map(a =>
          a.id === adId ? { ...a, licenseId } : a
        ),
      };
    });
  }, []);

  const collectInvestment = useCallback((adId: string) => {
    setState(prev => {
      const investment = prev.activeInvestments.find(i => i.adId === adId);
      if (!investment || investment.status !== 'ready') return prev;
      
      const elapsedSec = (Date.now() - investment.startTime) / 1000;
      const passiveEarned = elapsedSec * investment.passiveIncomePerSec;
      
      const marginEarned = investment.volumeKB * investment.marginPerKB;
      
      const totalPayout = passiveEarned + marginEarned;
      
      return {
        ...prev,
        money: prev.money + totalPayout,
        activeInvestments: prev.activeInvestments.filter(i => i.adId !== adId),
        advertisements: prev.advertisements.filter(ad => ad.id !== adId),
      };
    });
  }, []);

  const cancelInvestment = useCallback((adId: string) => {
    setState(prev => {
      const investment = prev.activeInvestments.find(i => i.adId === adId);
      if (!investment) return prev;
      
      if (investment.status === 'running') {
        const elapsedSec = (Date.now() - investment.startTime) / 1000;
        const passiveEarned = elapsedSec * investment.passiveIncomePerSec;
        const newMoney = prev.money - investment.breachFee + passiveEarned;
        
        return {
          ...prev,
          money: Math.max(0, newMoney),
          activeInvestments: prev.activeInvestments.filter(i => i.adId !== adId),
          advertisements: prev.advertisements.filter(a => a.id !== adId),
        };
      }
      
      if (investment.status === 'failed') {
        return {
          ...prev,
          activeInvestments: prev.activeInvestments.filter(i => i.adId !== adId),
          advertisements: prev.advertisements.filter(a => a.id !== adId),
        };
      }
      
      return prev;
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
          
          const ad = prev.advertisements.find(a => a.id === inv.adId);
          if (!ad) return inv;
          
          const license = prev.licenses.find(l => l.id === inv.licenseId);
          if (!license) return inv;
          
          const elapsedSec = (now - inv.startTime) / 1000;
          const allocatedKBps = license.allocated / 1000;
          const kbProcessed = allocatedKBps * elapsedSec;
          
          if (kbProcessed >= ad.volumeKB) {
            hasChanges = true;
            return { ...inv, status: 'ready' as InvestmentStatus };
          }
          
          if (elapsedSec * 1000 >= ad.timeLimitMs) {
            hasChanges = true;
            return { ...inv, status: 'failed' as InvestmentStatus };
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
    unlockInfrastructure,
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
    cancelInvestment,
  };

  return {
    state,
    actions,
  };
}
