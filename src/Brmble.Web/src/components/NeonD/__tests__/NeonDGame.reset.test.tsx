import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NeonDGame } from '../NeonDGame';
import type { Dealer } from '../types';

const makeDealer = (overrides: Partial<Dealer> = {}): Dealer => ({
  id: 'dealer-reset-ui',
  name: 'Reset Dealer',
  selling: 'weed',
  volume: 1,
  margin: 1,
  volumeBonus: 0,
  marginBonus: 0,
  sideVolume: 0,
  equipmentCount: 0,
  maxEquipmentSlots: 3,
  riskBonus: 0,
  bulkStreetValue: 0,
  baseVolumeGps: 1,
  baseMarginMult: 1,
  volumeStars: 3,
  marginStars: 3,
  isProtected: false,
  isArrested: false,
  nextArrestCheckAt: Date.now() + 60_000,
  hasPendingUpgrade: false,
  pendingUpgradeOptions: [],
  ...overrides,
});

describe('NeonDGame reset integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it('returns dealer slot unlock UI to one unlocked slot after reset', async () => {
    localStorage.setItem('brmble_neon_d_save', JSON.stringify({
      unlockedSlots: 3,
      activeDealers: [makeDealer(), null, null],
    }));

    render(<NeonDGame />);

    expect(screen.getByText(/slot 2 - empty/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /reset/i }));

    expect(screen.getByText(/slot 2/i)).toBeInTheDocument();
    expect(screen.getAllByText(/locked/i).length).toBeGreaterThanOrEqual(2);
  });
});
