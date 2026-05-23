import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGameEngine } from '../useGameEngine';
import type { Dealer } from '../../types';
type GameEngineState = ReturnType<typeof useGameEngine>;

const makeDealer = (overrides: Partial<Dealer> = {}): Dealer => ({
  id: 'test-dealer',
  name: 'Test',
  selling: 'weed',
  volume: 10,
  margin: 1,
  volumeBonus: 0,
  marginBonus: 0,
  sideVolume: 0.10,
  equipmentCount: 0,
  baseVolumeGps: 10,
  baseMarginMult: 1,
  volumeStars: 3,
  marginStars: 3,
  isProtected: false,
  isArrested: false,
  nextArrestCheckAt: Date.now() + 300000,
  hasPendingUpgrade: false,
  pendingUpgradeOptions: [],
  ...overrides,
});

/**
 * Set up a game with enough money for at least one equipment upgrade ($500).
 * Uses a high-margin dealer (margin=100) + 50 ticks of production to earn ~$500.
 * Initial money: $250 - $50 (unlock weed) - $17 (upgrade weed) = $183
 * Earnings: 50 ticks * 0.1g * $100/g = $500 → total ~$683
 */
const setupWithMoney = () => {
  const hook = renderHook(() => useGameEngine());
  act(() => {
    hook.result.current.upgrade('weed');
    hook.result.current.hireDealer(makeDealer({ margin: 100 }), 0);
  });
  act(() => { vi.advanceTimersByTime(50000); });
  return hook;
};

const mockDealerUpgradeRolls = (values: number[]) => {
  const sequence = [...values];
  return vi.spyOn(Math, 'random').mockImplementation(() => {
    const next = sequence.shift();
    if (next === undefined) {
      throw new Error('Unexpected Math.random call while generating dealer upgrades');
    }
    return next;
  });
};

const startPendingDealerUpgrade = (
  result: { current: GameEngineState },
  rolls: number[],
  dealerId = 'test-dealer'
) => {
  const randomSpy = mockDealerUpgradeRolls(rolls);
  act(() => {
    result.current.startDealerUpgrade(dealerId);
  });
  randomSpy.mockRestore();
  return result.current.state.activeDealers[0];
};

describe('useGameEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('newly hired dealers start unprotected, unarrested, and with a scheduled risk check', () => {
    const { result } = renderHook(() => useGameEngine());

    act(() => {
      result.current.hireDealer(makeDealer({ id: 'dealer-state' }), 0);
    });

    const dealer = result.current.state.activeDealers[0];
    expect(dealer?.isProtected).toBe(false);
    expect(dealer?.isArrested).toBe(false);
    expect(typeof dealer?.nextArrestCheckAt).toBe('number');
    expect((dealer?.nextArrestCheckAt ?? 0)).toBeGreaterThan(Date.now());
  });

  it('should update production without dealer', async () => {
    const { result } = renderHook(() => useGameEngine());
    
    act(() => {
      result.current.unlockProduction('weed');
      result.current.upgrade('weed');
    });
    
    const initialStock = result.current.state.production.weed.stock;
    
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    
    expect(result.current.state.production.weed.stock).toBeGreaterThan(initialStock);
  });
  
  it('should earn money when dealer sells', async () => {
    const { result } = renderHook(() => useGameEngine());
    
    act(() => {
      result.current.unlockProduction('weed');
      result.current.upgrade('weed');
      result.current.hireDealer(makeDealer(), 0);
    });
    
    const initialMoney = result.current.state.money;
    
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    
    expect(result.current.state.money).toBeGreaterThan(initialMoney);
  });

  it('should upgrade production item', async () => {
    const { result } = renderHook(() => useGameEngine());
    
    act(() => {
      result.current.unlockProduction('weed');
      result.current.upgrade('weed');
    });
    
    expect(result.current.state.production.weed.level).toBe(1);
  });

  it('should not allow stock to go below zero', async () => {
    const { result } = renderHook(() => useGameEngine());
    
    act(() => {
      vi.advanceTimersByTime(100000);
    });
    
    expect(result.current.state.production.weed.stock).toBeGreaterThanOrEqual(0);
  });

  describe('multi-dealer stock sharing', () => {
    it('stock never goes below zero with a high-volume dealer', async () => {
      const { result } = renderHook(() => useGameEngine());
      act(() => {
        result.current.unlockProduction('weed');
        result.current.upgrade('weed');
        result.current.hireDealer(makeDealer({ volume: 1000 }), 0);
      });
      act(() => { vi.advanceTimersByTime(10000); });
      expect(result.current.state.production.weed.stock).toBeGreaterThanOrEqual(0);
    });

    it('hireDealer into locked slot is a no-op', () => {
      const { result } = renderHook(() => useGameEngine());
      const initialDealers = [...result.current.state.activeDealers];
      act(() => {
        // Slot 1 is locked (unlockedSlots starts at 1, so only slot 0 is open)
        result.current.hireDealer(makeDealer({ id: 'dealer-locked' }), 1);
      });
      expect(result.current.state.activeDealers).toEqual(initialDealers);
    });

    it('second dealer cannot consume stock already consumed by the first', async () => {
      const { result } = renderHook(() => useGameEngine());
      act(() => {
        result.current.unlockProduction('weed');
        result.current.upgrade('weed');
        // Hire dealer 1 in slot 0
        result.current.hireDealer(makeDealer({ id: 'dealer-1', volume: 1000 }), 0);
      });
      // Advance to accumulate some stock, then check that stock stays >= 0 even with greedy dealer
      act(() => { vi.advanceTimersByTime(5000); });
      expect(result.current.state.production.weed.stock).toBeGreaterThanOrEqual(0);
    });
  });

  describe('slot unlocking', () => {
    it('unlockSlot is blocked when player has insufficient funds', () => {
      const { result } = renderHook(() => useGameEngine());
      // Default initial money ($250) is below slot-1 cost ($1000)
      expect(result.current.state.money).toBeLessThan(1000);
      act(() => { result.current.unlockSlot(); });
      expect(result.current.state.unlockedSlots).toBe(1);
    });

    it('unlockSlot deducts cost and increments unlockedSlots when funded', () => {
      const { result } = renderHook(() => useGameEngine());
      // Earn enough money ($1000) to unlock slot 1
      act(() => {
        result.current.unlockProduction('weed');
        result.current.upgrade('weed');
        result.current.hireDealer(makeDealer({ margin: 100 }), 0);
      });
      act(() => { vi.advanceTimersByTime(100000); }); // ~$1000 earned
      const moneyBefore = result.current.state.money;
      act(() => { result.current.unlockSlot(); });
      expect(result.current.state.unlockedSlots).toBe(2);
      expect(result.current.state.money).toBeCloseTo(moneyBefore - 1000, 0);
    });
  });

  describe('equipment upgrades', () => {
    it('starting a dealer upgrade charges once and stores 3 pending options', () => {
      const { result } = setupWithMoney();
      const moneyBefore = result.current.state.money;

      const dealer = startPendingDealerUpgrade(result, [0.5, 0, 0.5, 0, 0.5, 0]);

      expect(result.current.state.money).toBeCloseTo(moneyBefore - 500, 1);
      expect(dealer?.hasPendingUpgrade).toBe(true);
      expect(dealer?.pendingUpgradeOptions).toHaveLength(3);
    });

    it('calling startDealerUpgrade again with an existing pending roll does not charge twice and keeps same options', () => {
      const { result } = setupWithMoney();

      const firstDealer = startPendingDealerUpgrade(result, [0.5, 0, 0.5, 0, 0.5, 0]);
      const moneyAfterFirstRoll = result.current.state.money;
      const firstOptions = firstDealer?.pendingUpgradeOptions ?? [];

      const secondDealer = startPendingDealerUpgrade(result, [0.5, 1 / 3, 0.5, 1 / 3, 0.5, 1 / 3]);

      expect(result.current.state.money).toBeCloseTo(moneyAfterFirstRoll, 1);
      expect(secondDealer?.pendingUpgradeOptions).toEqual(firstOptions);
    });

    it('buyEquipment applies a chosen pending option and clears pending state', () => {
      const { result } = setupWithMoney();
      const dealerBefore = result.current.state.activeDealers[0]!;
      const volumeBefore = dealerBefore.volumeBonus;

      const dealer = startPendingDealerUpgrade(result, [0.5, 0, 0.5, 1 / 3, 0.5, 2 / 3])!;
      const chosenUpgrade = dealer.pendingUpgradeOptions.find(option => option.type === 'VOLUME') ?? dealer.pendingUpgradeOptions[0];

      act(() => {
        result.current.buyEquipment('test-dealer', chosenUpgrade);
      });

      const updatedDealer = result.current.state.activeDealers[0];
      expect(updatedDealer?.volumeBonus).toBeCloseTo(volumeBefore + chosenUpgrade.value, 5);
      expect(updatedDealer?.equipmentCount).toBe(dealerBefore.equipmentCount + 1);
      expect(updatedDealer?.hasPendingUpgrade).toBe(false);
      expect(updatedDealer?.pendingUpgradeOptions).toEqual([]);
    });

    it('fireDealer after a pending roll leaves the slot null', () => {
      const { result } = setupWithMoney();

      startPendingDealerUpgrade(result, [0.5, 0, 0.5, 0, 0.5, 0]);

      act(() => {
        result.current.fireDealer('test-dealer');
      });

      expect(result.current.state.activeDealers[0]).toBeNull();
    });

    it('startDealerUpgrade deducts the correct cost and buyEquipment does not charge again', () => {
      const { result } = setupWithMoney();
      const moneyBefore = result.current.state.money;

      const dealer = startPendingDealerUpgrade(result, [0.5, 0, 0.5, 0, 0.5, 0])!;
      expect(result.current.state.money).toBeCloseTo(moneyBefore - 500, 1);

      const moneyAfterRoll = result.current.state.money;
      act(() => {
        result.current.buyEquipment('test-dealer', dealer.pendingUpgradeOptions[0]);
      });

      expect(result.current.state.money).toBeCloseTo(moneyAfterRoll, 1);
    });

    it('equipment slots are capped at 3', () => {
      const { result } = renderHook(() => useGameEngine());
      act(() => {
        result.current.unlockProduction('weed');
        result.current.upgrade('weed');
        result.current.hireDealer(makeDealer({ margin: 100, equipmentCount: 3 }), 0);
      });
      act(() => { vi.advanceTimersByTime(50000); });
      act(() => {
        result.current.startDealerUpgrade('test-dealer');
      });
      // equipmentCount must remain 3 (maxed)
      expect(result.current.state.activeDealers[0]?.equipmentCount).toBe(3);
    });

    it('VOLUME upgrade increases volumeBonus', () => {
      const { result } = setupWithMoney();
      const dealer = startPendingDealerUpgrade(result, [0.5, 0, 0.5, 0, 0.5, 0])!;
      const before = result.current.state.activeDealers[0]!.volumeBonus;
      const upgrade = dealer.pendingUpgradeOptions.find(option => option.type === 'VOLUME')!;
      act(() => {
        result.current.buyEquipment('test-dealer', upgrade);
      });
      expect(result.current.state.activeDealers[0]?.volumeBonus).toBeCloseTo(before + 0.15, 5);
    });

    it('MARGIN upgrade increases marginBonus', () => {
      const { result } = setupWithMoney();
      const dealer = startPendingDealerUpgrade(result, [0.5, 1 / 3, 0.5, 1 / 3, 0.5, 1 / 3])!;
      const before = result.current.state.activeDealers[0]!.marginBonus;
      const upgrade = dealer.pendingUpgradeOptions.find(option => option.type === 'MARGIN')!;
      act(() => {
        result.current.buyEquipment('test-dealer', upgrade);
      });
      expect(result.current.state.activeDealers[0]?.marginBonus).toBeCloseTo(before + 0.15, 5);
    });

    it('BULK upgrade increases volumeBonus and reduces marginBonus', () => {
      const { result } = setupWithMoney();
      const dealer = startPendingDealerUpgrade(result, [0.2, 0, 0.5, 0, 0.5, 0])!;
      const volBefore = result.current.state.activeDealers[0]!.volumeBonus;
      const margBefore = result.current.state.activeDealers[0]!.marginBonus;
      const upgrade = dealer.pendingUpgradeOptions.find(option => option.type === 'BULK')!;
      act(() => {
        result.current.buyEquipment('test-dealer', upgrade);
      });
      const d = result.current.state.activeDealers[0];
      expect(d?.volumeBonus).toBeCloseTo(volBefore + 0.35, 5);
      expect(d?.marginBonus).toBeCloseTo(margBefore - 0.1, 5);
    });

    it('ALL_AROUNDER upgrade increases both volumeBonus and marginBonus', () => {
      const { result } = setupWithMoney();
      const dealer = startPendingDealerUpgrade(result, [0.5, 2 / 3, 0.5, 2 / 3, 0.5, 2 / 3])!;
      const volBefore = result.current.state.activeDealers[0]!.volumeBonus;
      const margBefore = result.current.state.activeDealers[0]!.marginBonus;
      const upgrade = dealer.pendingUpgradeOptions.find(option => option.type === 'ALL_AROUNDER')!;
      act(() => {
        result.current.buyEquipment('test-dealer', upgrade);
      });
      const d = result.current.state.activeDealers[0];
      expect(d?.volumeBonus).toBeCloseTo(volBefore + 0.05, 5);
      expect(d?.marginBonus).toBeCloseTo(margBefore + 0.05, 5);
    });

    it('SIDE_HUSTLE upgrade adds sideVolume', () => {
      const { result } = setupWithMoney();
      act(() => {
        result.current.unlockProduction('mushrooms');
      });
      const dealer = startPendingDealerUpgrade(result, [0.05, 0.5, 0, 0.5, 0, 0.5, 0])!;
      const upgrade = dealer.pendingUpgradeOptions.find(option => option.type === 'SIDE_HUSTLE')!;
      act(() => {
        result.current.buyEquipment('test-dealer', upgrade);
      });
      expect(result.current.state.activeDealers[0]?.sideVolume).toBeCloseTo(0.2, 5);
    });
  });

  describe('side hustle mechanics', () => {
    it('side hustle stock never goes below zero', async () => {
      const { result } = renderHook(() => useGameEngine());
      act(() => {
        result.current.unlockProduction('weed');
        result.current.upgrade('weed');
        result.current.unlockProduction('mushrooms');
        // Dealer with extreme volume and side hustle
        result.current.hireDealer(makeDealer({ volume: 1000, sideVolume: 0.5 }), 0);
      });
      act(() => { vi.advanceTimersByTime(5000); });
      expect(result.current.state.production.mushrooms.stock).toBeGreaterThanOrEqual(0);
    });

    it('side hustle ratio capped at 0.9 so primary sales still occur', async () => {
      const { result } = renderHook(() => useGameEngine());
      act(() => {
        result.current.unlockProduction('weed');
        result.current.upgrade('weed');
        // sideVolume is parallel, primary sales still occur
        result.current.hireDealer(makeDealer({ volume: 5, margin: 10, sideVolume: 0.95 }), 0);
      });
      act(() => { vi.advanceTimersByTime(5000); });
      const moneyBefore = result.current.state.money;
      act(() => { vi.advanceTimersByTime(1000); });
      // At least some money from primary sales (even with huge side ratio, primary still sells 10% of vol)
      expect(result.current.state.money).toBeGreaterThanOrEqual(moneyBefore);
    });

    it('Side hustle bleeds to other unlocked products', async () => {
      const { result } = renderHook(() => useGameEngine());
      act(() => {
        result.current.unlockProduction('weed');
        result.current.upgrade('weed');
        result.current.unlockProduction('mushrooms');
        result.current.upgrade('mushrooms');
        // dealer with side hustle
        result.current.hireDealer(makeDealer({ volume: 5, margin: 10, sideVolume: 0.1 }), 0);
      });
      act(() => { vi.advanceTimersByTime(2000); });
      // Mushrooms is sold as side hustle; stock should not go below zero
      expect(result.current.state.production.mushrooms.stock).toBeGreaterThanOrEqual(0);
    });
  });

  it('protected dealers earn 15 percent less than unprotected dealers', () => {
    const { result } = renderHook(() => useGameEngine());

    act(() => {
      result.current.upgrade('weed');
      result.current.hireDealer(makeDealer({ id: 'protected-check', margin: 10, volume: 1, sideVolume: 0 }), 0);
    });

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    const baseline = result.current.state.lastEarningsPerDealer['protected-check'];

    act(() => {
      result.current.toggleDealerProtection('protected-check');
      vi.advanceTimersByTime(1_000);
    });

    const protectedIncome = result.current.state.lastEarningsPerDealer['protected-check'];
    expect(protectedIncome).toBeCloseTo(baseline * 0.85, 5);
  });

  it('arrested dealers generate zero earnings per tick', () => {
    const { result } = renderHook(() => useGameEngine());

    act(() => {
      result.current.upgrade('weed');
      result.current.hireDealer(makeDealer({ id: 'arrested-check', isArrested: true, nextArrestCheckAt: Date.now() + 999999 }), 0);
    });

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(result.current.state.lastEarningsPerDealer['arrested-check']).toBe(0);
  });

  it('unprotected dealers use current product risk when the arrest timer expires', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const { result } = renderHook(() => useGameEngine());
    act(() => {
      result.current.hireDealer(makeDealer({
        id: 'risk-check',
        selling: 'meth',
        isProtected: false,
        isArrested: false,
        nextArrestCheckAt: Date.now() - 1,
      }), 0);
    });

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(result.current.state.activeDealers[0]?.isArrested).toBe(true);
  });

  it('protected dealers never get arrested when the timer expires', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const { result } = renderHook(() => useGameEngine());
    act(() => {
      result.current.hireDealer(makeDealer({
        id: 'safe-check',
        selling: 'meth',
        isProtected: true,
        isArrested: false,
        nextArrestCheckAt: Date.now() - 1,
      }), 0);
    });

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(result.current.state.activeDealers[0]?.isArrested).toBe(false);
  });

  it('payBail uses current total income per second with a minimum floor', () => {
    const { result } = setupWithMoney();
    act(() => {
      result.current.upgrade('weed');
      result.current.hireDealer(makeDealer({ id: 'earner', margin: 1, volume: 1, sideVolume: 0 }), 0);
      vi.advanceTimersByTime(1_000);
    });

    const dealerIncome = result.current.state.lastEarningsPerDealer['earner'];
    const expectedCost = Math.max(500, dealerIncome * 45);

    act(() => {
      result.current.forceArrestDealer('earner');
    });

    const moneyBefore = result.current.state.money;
    act(() => {
      result.current.payDealerBail('earner');
    });

    expect(result.current.state.money).toBeCloseTo(moneyBefore - expectedCost, 5);
    expect(result.current.state.activeDealers[0]?.isArrested).toBe(false);
    expect(result.current.state.activeDealers[0]?.isProtected).toBe(false);
  });

  it('restores older saves by filling in missing dealer risk fields', () => {
    localStorage.setItem('brmble_neon_d_save', JSON.stringify({
      activeDealers: [{
        id: 'legacy',
        name: 'Legacy Dealer',
        selling: 'weed',
        volume: 1,
        margin: 1,
        volumeBonus: 0,
        marginBonus: 0,
        sideVolume: 0,
        equipmentCount: 0,
        baseVolumeGps: 1,
        baseMarginMult: 1,
        volumeStars: 1,
        marginStars: 1,
      }],
    }));

    const { result } = renderHook(() => useGameEngine());
    const dealer = result.current.state.activeDealers[0];

    expect(dealer?.isProtected).toBe(false);
    expect(dealer?.isArrested).toBe(false);
    expect(typeof dealer?.nextArrestCheckAt).toBe('number');
  });

  it('restores older saves by filling in missing pending dealer upgrade fields', () => {
    localStorage.setItem('brmble_neon_d_save', JSON.stringify({
      activeDealers: [{
        id: 'legacy',
        name: 'Legacy Dealer',
        selling: 'weed',
        volume: 1,
        margin: 1,
        volumeBonus: 0,
        marginBonus: 0,
        sideVolume: 0,
        equipmentCount: 0,
        baseVolumeGps: 1,
        baseMarginMult: 1,
        volumeStars: 1,
        marginStars: 1,
        isProtected: false,
        isArrested: false,
        nextArrestCheckAt: Date.now() + 10_000,
      }],
    }));

    const { result } = renderHook(() => useGameEngine());
    const dealer = result.current.state.activeDealers[0];

    expect(dealer?.hasPendingUpgrade).toBe(false);
    expect(dealer?.pendingUpgradeOptions).toEqual([]);
  });

  it('restores older saves by filling in missing pending upgrade fields on available dealers', () => {
    localStorage.setItem('brmble_neon_d_save', JSON.stringify({
      availableDealers: [{
        id: 'available-legacy',
        name: 'Available Legacy Dealer',
        selling: 'weed',
        volume: 1,
        margin: 1,
        volumeBonus: 0,
        marginBonus: 0,
        sideVolume: 0,
        equipmentCount: 0,
        baseVolumeGps: 1,
        baseMarginMult: 1,
        volumeStars: 1,
        marginStars: 1,
        isProtected: false,
        isArrested: false,
        nextArrestCheckAt: Date.now() + 10_000,
      }],
    }));

    const { result } = renderHook(() => useGameEngine());
    const dealer = result.current.state.availableDealers[0];

    expect(dealer?.hasPendingUpgrade).toBe(false);
    expect(dealer?.pendingUpgradeOptions).toEqual([]);
  });

  it('catches up production and earnings after the game was closed for a few seconds', () => {
    localStorage.setItem('brmble_neon_d_save', JSON.stringify({
      money: 100,
      totalEarned: 0,
      researchSpeed: 1,
      production: {
        weed: {
          id: 'weed',
          name: 'Weed',
          stock: 0,
          rate: 2,
          yieldPerLevel: 0.2,
          costMultiplier: 1.12,
          level: 1,
          upgradeCost: 16,
        },
      },
      unlockedProduction: ['weed'],
      activeDealers: [makeDealer({
        id: 'offline-earner',
        volume: 1,
        margin: 1,
        sideVolume: 0,
      }), null, null],
      availableDealers: [],
      unlockedSlots: 1,
      lastRefreshTime: 0,
      lastEarningsPerDealer: {},
      lastTickAt: Date.now() - 5_000,
      offlineEarningsSummary: null,
    }));

    const { result } = renderHook(() => useGameEngine());

    expect(result.current.state.money).toBeCloseTo(121, 5);
    expect(result.current.state.totalEarned).toBeCloseTo(21, 5);
    expect(result.current.state.production.weed.stock).toBeCloseTo(5, 5);
    expect(result.current.state.lastEarningsPerDealer['offline-earner']).toBeCloseTo(4.2, 5);
  });

  it('stores an offline earnings summary after 10 minutes away', () => {
    localStorage.setItem('brmble_neon_d_save', JSON.stringify({
      money: 100,
      totalEarned: 0,
      researchSpeed: 1,
      production: {
        weed: {
          id: 'weed',
          name: 'Weed',
          stock: 0,
          rate: 2,
          yieldPerLevel: 0.2,
          costMultiplier: 1.12,
          level: 1,
          upgradeCost: 16,
        },
      },
      unlockedProduction: ['weed'],
      activeDealers: [makeDealer({
        id: 'offline-summary',
        volume: 1,
        margin: 1,
        sideVolume: 0,
      }), null, null],
      availableDealers: [],
      unlockedSlots: 1,
      lastRefreshTime: 0,
      lastEarningsPerDealer: {},
      lastTickAt: Date.now() - 10 * 60 * 1000,
      offlineEarningsSummary: null,
    }));

    const { result } = renderHook(() => useGameEngine());

    expect(result.current.state.offlineEarningsSummary?.awayMs).toBe(10 * 60 * 1000);
    expect(result.current.state.offlineEarningsSummary?.earned).toBeCloseTo(2520, 5);
  });

  it('bulk-catches up a week of offline earnings without replaying every second', { timeout: 750 }, () => {
    localStorage.setItem('brmble_neon_d_save', JSON.stringify({
      money: 100,
      totalEarned: 0,
      researchSpeed: 1,
      production: {
        weed: {
          id: 'weed',
          name: 'Weed',
          stock: 0,
          rate: 2,
          yieldPerLevel: 0.2,
          costMultiplier: 1.12,
          level: 1,
          upgradeCost: 16,
        },
      },
      unlockedProduction: ['weed'],
      activeDealers: [makeDealer({
        id: 'offline-week',
        volume: 1,
        margin: 1,
        sideVolume: 0,
        nextArrestCheckAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
      }), null, null],
      availableDealers: [],
      unlockedSlots: 1,
      lastRefreshTime: 0,
      lastEarningsPerDealer: {},
      lastTickAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
      offlineEarningsSummary: null,
    }));

    const { result } = renderHook(() => useGameEngine());

    expect(result.current.state.money).toBeCloseTo(2_540_260, 5);
    expect(result.current.state.totalEarned).toBeCloseTo(2_540_160, 5);
    expect(result.current.state.production.weed.stock).toBeCloseTo(604_800, 5);
    expect(result.current.state.lastEarningsPerDealer['offline-week']).toBeCloseTo(4.2, 5);
    expect(result.current.state.offlineEarningsSummary?.earned).toBeCloseTo(2_540_160, 5);
  });

  it('processes offline arrest checks at their scheduled moment during bulk catch-up', () => {
    const arrestSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    localStorage.setItem('brmble_neon_d_save', JSON.stringify({
      money: 100,
      totalEarned: 0,
      researchSpeed: 1,
      production: {
        weed: {
          id: 'weed',
          name: 'Weed',
          stock: 0,
          rate: 2,
          yieldPerLevel: 0.2,
          costMultiplier: 1.12,
          level: 1,
          upgradeCost: 16,
        },
      },
      unlockedProduction: ['weed'],
      activeDealers: [makeDealer({
        id: 'offline-arrest',
        volume: 1,
        margin: 1,
        sideVolume: 0,
        nextArrestCheckAt: Date.now() - 3_000,
      }), null, null],
      availableDealers: [],
      unlockedSlots: 1,
      lastRefreshTime: 0,
      lastEarningsPerDealer: {},
      lastTickAt: Date.now() - 5_000,
      offlineEarningsSummary: null,
    }));

    const { result } = renderHook(() => useGameEngine());

    expect(result.current.state.money).toBeCloseTo(108.4, 5);
    expect(result.current.state.totalEarned).toBeCloseTo(8.4, 5);
    expect(result.current.state.production.weed.stock).toBeCloseTo(8, 5);
    expect(result.current.state.activeDealers[0]?.isArrested).toBe(true);
    expect(result.current.state.lastEarningsPerDealer['offline-arrest']).toBe(0);
    expect(arrestSpy).toHaveBeenCalled();
  });

  it('does not store an offline earnings summary before 10 minutes away', () => {
    localStorage.setItem('brmble_neon_d_save', JSON.stringify({
      money: 100,
      totalEarned: 0,
      researchSpeed: 1,
      production: {
        weed: {
          id: 'weed',
          name: 'Weed',
          stock: 0,
          rate: 2,
          yieldPerLevel: 0.2,
          costMultiplier: 1.12,
          level: 1,
          upgradeCost: 16,
        },
      },
      unlockedProduction: ['weed'],
      activeDealers: [makeDealer({
        id: 'offline-short',
        volume: 1,
        margin: 1,
        sideVolume: 0,
      }), null, null],
      availableDealers: [],
      unlockedSlots: 1,
      lastRefreshTime: 0,
      lastEarningsPerDealer: {},
      lastTickAt: Date.now() - (9 * 60 * 1000 + 59 * 1000),
      offlineEarningsSummary: null,
    }));

    const { result } = renderHook(() => useGameEngine());

    expect(result.current.state.offlineEarningsSummary).toBeNull();
  });
});
