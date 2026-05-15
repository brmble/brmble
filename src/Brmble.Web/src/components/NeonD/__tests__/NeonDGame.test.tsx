import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { NeonDGame } from '../NeonDGame';

vi.mock('../hooks/useGameEngine', () => ({
  useGameEngine: () => ({
    state: {
      money: 10_000,
      totalEarned: 0,
      researchSpeed: 1,
      production: {
        weed: { id: 'weed', name: 'Weed', stock: 100, rate: 1, yieldPerLevel: 0.2, costMultiplier: 1.12, level: 1, upgradeCost: 16 },
      },
      unlockedProduction: ['weed'],
      activeDealers: [{
        id: 'dealer-ui',
        name: 'Test Dealer',
        selling: 'weed',
        volume: 1,
        margin: 10,
        volumeBonus: 0,
        marginBonus: 0,
        sideVolume: 0,
        equipmentCount: 0,
        baseVolumeGps: 1,
        baseMarginMult: 10,
        volumeStars: 3,
        marginStars: 3,
        isProtected: true,
        isArrested: false,
        nextArrestCheckAt: Date.now() + 60_000,
      }],
      availableDealers: [],
      unlockedSlots: 1,
      lastRefreshTime: 0,
      lastEarningsPerDealer: { 'dealer-ui': 8.5 },
    },
    upgrade: vi.fn(),
    unlockProduction: vi.fn(),
    hireDealer: vi.fn(),
    fireDealer: vi.fn(),
    refreshPool: vi.fn(),
    resetGame: vi.fn(),
    unlockSlot: vi.fn(),
    setDealerSelling: vi.fn(),
    buyEquipment: vi.fn(),
    toggleDealerProtection: vi.fn(),
    payDealerBail: vi.fn(),
    forceArrestDealer: vi.fn(),
  }),
}));

it('shows protection state and risk label on an active dealer card', () => {
  render(<NeonDGame />);
  expect(screen.getByText(/protected/i)).toBeInTheDocument();
  expect(screen.getByText(/low risk/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /pay off cops/i })).toBeInTheDocument();
});

it('shows bail and fire actions for arrested dealers', async () => {
  vi.resetModules();
  vi.doMock('../hooks/useGameEngine', () => ({
    useGameEngine: () => ({
      state: {
        money: 10_000,
        totalEarned: 0,
        researchSpeed: 1,
        production: {
          weed: { id: 'weed', name: 'Weed', stock: 100, rate: 1, yieldPerLevel: 0.2, costMultiplier: 1.12, level: 1, upgradeCost: 16 },
        },
        unlockedProduction: ['weed'],
        activeDealers: [{
          id: 'dealer-arrested',
          name: 'Arrested Dealer',
          selling: 'weed',
          volume: 1,
          margin: 10,
          volumeBonus: 0,
          marginBonus: 0,
          sideVolume: 0,
          equipmentCount: 1,
          baseVolumeGps: 1,
          baseMarginMult: 10,
          volumeStars: 3,
          marginStars: 3,
          isProtected: false,
          isArrested: true,
          nextArrestCheckAt: Date.now() + 60_000,
        }],
        availableDealers: [],
        unlockedSlots: 1,
        lastRefreshTime: 0,
        lastEarningsPerDealer: { 'dealer-arrested': 0 },
      },
      upgrade: vi.fn(),
      unlockProduction: vi.fn(),
      hireDealer: vi.fn(),
      fireDealer: vi.fn(),
      refreshPool: vi.fn(),
      resetGame: vi.fn(),
      unlockSlot: vi.fn(),
      setDealerSelling: vi.fn(),
      buyEquipment: vi.fn(),
      toggleDealerProtection: vi.fn(),
      payDealerBail: vi.fn(),
      forceArrestDealer: vi.fn(),
    }),
  }));

  const { NeonDGame: ArrestedNeonDGame } = await import('../NeonDGame');
  render(<ArrestedNeonDGame />);

  expect(screen.getAllByText(/arrested/i).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: /pay bail/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /fire dealer/i })).toBeInTheDocument();
  vi.resetModules();
  vi.doUnmock('../hooks/useGameEngine');
});
