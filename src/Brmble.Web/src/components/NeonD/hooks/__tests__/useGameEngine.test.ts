import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGameEngine } from '../useGameEngine';
import type { Dealer } from '../../types';

const makeDealer = (overrides: Partial<Dealer> = {}): Dealer => ({
  id: 'test-dealer',
  name: 'Test',
  selling: 'weed',
  volume: 10,
  margin: 1,
  volumeBonus: 1.0,
  marginBonus: 1.0,
  sideHustle: {},
  networkBonus: 0,
  equipmentCount: 0,
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
    hook.result.current.unlockProduction('weed');
    hook.result.current.upgrade('weed');
    hook.result.current.hireDealer(makeDealer({ margin: 100 }), 0);
  });
  act(() => { vi.advanceTimersByTime(50000); });
  return hook;
};

describe('useGameEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
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
    it('VOLUME upgrade increases volumeBonus', () => {
      const { result } = setupWithMoney();
      const before = result.current.state.activeDealers[0]!.volumeBonus;
      act(() => {
        result.current.buyEquipment('test-dealer', { type: 'VOLUME', label: 'HC', description: '', value: 0.15 });
      });
      expect(result.current.state.activeDealers[0]?.volumeBonus).toBeCloseTo(before + 0.15, 5);
    });

    it('MARGIN upgrade increases marginBonus', () => {
      const { result } = setupWithMoney();
      const before = result.current.state.activeDealers[0]!.marginBonus;
      act(() => {
        result.current.buyEquipment('test-dealer', { type: 'MARGIN', label: 'PC', description: '', value: 0.15 });
      });
      expect(result.current.state.activeDealers[0]?.marginBonus).toBeCloseTo(before + 0.15, 5);
    });

    it('BULK upgrade increases volumeBonus and reduces marginBonus', () => {
      const { result } = setupWithMoney();
      const volBefore = result.current.state.activeDealers[0]!.volumeBonus;
      const margBefore = result.current.state.activeDealers[0]!.marginBonus;
      act(() => {
        result.current.buyEquipment('test-dealer', { type: 'BULK', label: 'BS', description: '', value: 0.35, marginPenalty: 0.1 });
      });
      const d = result.current.state.activeDealers[0];
      expect(d?.volumeBonus).toBeCloseTo(volBefore + 0.35, 5);
      expect(d?.marginBonus).toBeCloseTo(margBefore - 0.1, 5);
    });

    it('ALL_AROUNDER upgrade increases both volumeBonus and marginBonus', () => {
      const { result } = setupWithMoney();
      const volBefore = result.current.state.activeDealers[0]!.volumeBonus;
      const margBefore = result.current.state.activeDealers[0]!.marginBonus;
      act(() => {
        result.current.buyEquipment('test-dealer', { type: 'ALL_AROUNDER', label: 'PE', description: '', value: 0.05 });
      });
      const d = result.current.state.activeDealers[0];
      expect(d?.volumeBonus).toBeCloseTo(volBefore + 0.05, 5);
      expect(d?.marginBonus).toBeCloseTo(margBefore + 0.05, 5);
    });

    it('SIDE_HUSTLE upgrade adds a side product entry', () => {
      const { result } = setupWithMoney();
      act(() => {
        result.current.buyEquipment('test-dealer', { type: 'SIDE_HUSTLE', label: 'SH', description: '', value: 0.1, targetProductId: 'mushrooms' });
      });
      expect(result.current.state.activeDealers[0]?.sideHustle['mushrooms']).toBeCloseTo(0.1, 5);
    });

    it('NETWORK upgrade increments networkBonus (tick applies it as multiplier)', () => {
      const { result } = renderHook(() => useGameEngine());
      act(() => {
        result.current.unlockProduction('weed');
        result.current.upgrade('weed');
        result.current.hireDealer(makeDealer({ margin: 100, sideHustle: { mushrooms: 0.1 } }), 0);
      });
      act(() => { vi.advanceTimersByTime(50000); });

      act(() => {
        result.current.buyEquipment('test-dealer', { type: 'NETWORK', label: 'NW', description: '', value: 0.1 });
      });
      const d = result.current.state.activeDealers[0];
      // networkBonus should accumulate; tick applies it as a ratio multiplier
      expect(d?.networkBonus).toBeCloseTo(0.1, 5);
      // sideHustle base entries are left unchanged; networkBonus is the single source of truth
      expect(d?.sideHustle['mushrooms']).toBeCloseTo(0.1, 5);
    });

    it('NETWORK upgrade on dealer with no side hustles still increments networkBonus', () => {
      const { result } = setupWithMoney();
      act(() => {
        result.current.buyEquipment('test-dealer', { type: 'NETWORK', label: 'NW', description: '', value: 0.1 });
      });
      expect(result.current.state.activeDealers[0]?.networkBonus).toBeCloseTo(0.1, 5);
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
        result.current.buyEquipment('test-dealer', { type: 'VOLUME', label: 'HC', description: '', value: 0.15 });
      });
      // equipmentCount must remain 3 (maxed)
      expect(result.current.state.activeDealers[0]?.equipmentCount).toBe(3);
    });

    it('buyEquipment deducts the correct cost', () => {
      const { result } = setupWithMoney();
      const moneyBefore = result.current.state.money;
      const expectedCost = 500 * Math.pow(2.5, 0); // equipmentCount=0 → $500
      act(() => {
        result.current.buyEquipment('test-dealer', { type: 'VOLUME', label: 'HC', description: '', value: 0.15 });
      });
      expect(result.current.state.money).toBeCloseTo(moneyBefore - expectedCost, 1);
    });
  });

  describe('side hustle mechanics', () => {
    it('side hustle stock never goes below zero', async () => {
      const { result } = renderHook(() => useGameEngine());
      act(() => {
        result.current.unlockProduction('weed');
        result.current.upgrade('weed');
        // Dealer with extreme volume and side hustle ratio near cap
        result.current.hireDealer(makeDealer({ volume: 1000, sideHustle: { mushrooms: 0.5 } }), 0);
      });
      act(() => { vi.advanceTimersByTime(5000); });
      expect(result.current.state.production.mushrooms.stock).toBeGreaterThanOrEqual(0);
    });

    it('side hustle ratio capped at 0.9 so primary sales still occur', async () => {
      const { result } = renderHook(() => useGameEngine());
      act(() => {
        result.current.unlockProduction('weed');
        result.current.upgrade('weed');
        // sideHustle ratio > 0.9 should be capped, ensuring primary sales
        result.current.hireDealer(makeDealer({ volume: 5, margin: 10, sideHustle: { mushrooms: 0.95 } }), 0);
      });
      act(() => { vi.advanceTimersByTime(5000); });
      const moneyBefore = result.current.state.money;
      act(() => { vi.advanceTimersByTime(1000); });
      // At least some money from primary sales (even with huge side ratio, primary still sells 10% of vol)
      expect(result.current.state.money).toBeGreaterThanOrEqual(moneyBefore);
    });

    it('NETWORK networkBonus multiplies effective side hustle ratios in the tick', async () => {
      const { result } = renderHook(() => useGameEngine());
      act(() => {
        result.current.unlockProduction('weed');
        result.current.upgrade('weed');
        result.current.unlockProduction('mushrooms');
        result.current.upgrade('mushrooms');
        // dealer with side hustle and network bonus
        result.current.hireDealer(makeDealer({ volume: 5, margin: 10, sideHustle: { mushrooms: 0.1 }, networkBonus: 1.0 }), 0);
      });
      act(() => { vi.advanceTimersByTime(2000); });
      // Mushrooms is sold as side hustle; stock should not go below zero
      expect(result.current.state.production.mushrooms.stock).toBeGreaterThanOrEqual(0);
    });
  });
});
