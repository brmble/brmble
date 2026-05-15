import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, vi } from 'vitest';
import { NeonDGame } from '../NeonDGame';

const mockNeonD = vi.hoisted(() => {
  const buyEquipmentMock = vi.fn();
  const startDealerUpgradeMock = vi.fn();
  const dealerUpgradeOptions = [
    { type: 'VOLUME', label: 'Armed Gang', description: 'Volume +15%', value: 0.15 },
    { type: 'MARGIN', label: 'Ferrari', description: 'Margin +15%', value: 0.15 },
    { type: 'SIDE_HUSTLE', label: 'JACKPOT: Side Hustle', description: 'Add 10% side volume bleed', value: 0.1, sideVolumeValue: 0.1 },
  ] as const;

  const createDealer = (overrides: Record<string, unknown> = {}) => ({
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
    hasPendingUpgrade: true,
    pendingUpgradeOptions: dealerUpgradeOptions,
    ...overrides,
  });

  const createState = (overrides: Record<string, unknown> = {}) => ({
    money: 10_000,
    totalEarned: 0,
    researchSpeed: 1,
    production: {
      weed: { id: 'weed', name: 'Weed', stock: 100, rate: 1, yieldPerLevel: 0.2, costMultiplier: 1.12, level: 1, upgradeCost: 16 },
    },
    unlockedProduction: ['weed'],
    activeDealers: [createDealer()],
    availableDealers: [],
    unlockedSlots: 1,
    lastRefreshTime: 0,
    lastEarningsPerDealer: { 'dealer-ui': 8.5 },
    ...overrides,
  });

  let state = createState();

  return {
    buyEquipmentMock,
    startDealerUpgradeMock,
    dealerUpgradeOptions,
    createDealer,
    createState,
    getState: () => state,
    setState: (nextState: ReturnType<typeof createState>) => {
      state = nextState;
    },
    reset: () => {
      state = createState();
      buyEquipmentMock.mockReset();
      startDealerUpgradeMock.mockReset();
    },
    useGameEngine: () => ({
      state,
      upgrade: vi.fn(),
      unlockProduction: vi.fn(),
      hireDealer: vi.fn(),
      fireDealer: vi.fn(),
      refreshPool: vi.fn(),
      resetGame: vi.fn(),
      unlockSlot: vi.fn(),
      setDealerSelling: vi.fn(),
      startDealerUpgrade: startDealerUpgradeMock,
      buyEquipment: buyEquipmentMock,
      toggleDealerProtection: vi.fn(),
      payDealerBail: vi.fn(),
      forceArrestDealer: vi.fn(),
    }),
  };
});

vi.mock('../hooks/useGameEngine', () => ({
  useGameEngine: () => mockNeonD.useGameEngine(),
}));

beforeEach(() => {
  mockNeonD.reset();
});

it('shows protection state and risk label on an active dealer card', () => {
  render(<NeonDGame />);

  expect(screen.getByText(/protected/i)).toBeInTheDocument();
  expect(screen.queryByText(/low risk/i)).not.toBeInTheDocument();
  expect(screen.getByText(/-15% income/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /pay off cops/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/production and dealer sales are balanced/i)).toBeInTheDocument();
});

it('reopens stored dealer upgrade options without rerolling and uses the engine flow', async () => {
  const user = userEvent.setup();
  const { rerender } = render(<NeonDGame />);

  await user.click(screen.getByRole('button', { name: /upgrade/i }));

  expect(mockNeonD.startDealerUpgradeMock).toHaveBeenCalledWith('dealer-ui');
  expect(screen.getByText(/select equipment/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /armed gang/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /ferrari/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /jackpot: side hustle/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();

  mockNeonD.setState(
    mockNeonD.createState({
      activeDealers: [mockNeonD.createDealer({ hasPendingUpgrade: false, pendingUpgradeOptions: [] })],
    }),
  );
  rerender(<NeonDGame />);
  expect(screen.queryByText(/select equipment/i)).not.toBeInTheDocument();

  mockNeonD.setState(
    mockNeonD.createState({
      activeDealers: [mockNeonD.createDealer()],
    }),
  );
  rerender(<NeonDGame />);

  await user.click(screen.getByRole('button', { name: /upgrade/i }));

  expect(screen.getByRole('button', { name: /armed gang/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /ferrari/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /jackpot: side hustle/i })).toBeInTheDocument();
});

it('allows reopening stored dealer upgrade options even when current money is below the normal upgrade cost', async () => {
  const user = userEvent.setup();

  mockNeonD.setState(
    mockNeonD.createState({
      money: 100,
      activeDealers: [
        mockNeonD.createDealer({
          hasPendingUpgrade: true,
          pendingUpgradeOptions: mockNeonD.dealerUpgradeOptions,
        }),
      ],
    }),
  );

  render(<NeonDGame />);

  await user.click(screen.getByRole('button', { name: /upgrade/i }));

  expect(mockNeonD.startDealerUpgradeMock).toHaveBeenCalledWith('dealer-ui');
  expect(screen.getByText(/select equipment/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /armed gang/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /ferrari/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /jackpot: side hustle/i })).toBeInTheDocument();
});

it('closes the modal when pending state is consumed', async () => {
  const user = userEvent.setup();
  const { rerender } = render(<NeonDGame />);

  await user.click(screen.getByRole('button', { name: /upgrade/i }));
  expect(screen.getByText(/select equipment/i)).toBeInTheDocument();

  mockNeonD.setState(
    mockNeonD.createState({
      activeDealers: [mockNeonD.createDealer({ hasPendingUpgrade: false, pendingUpgradeOptions: [] })],
    }),
  );
  rerender(<NeonDGame />);

  expect(screen.queryByText(/select equipment/i)).not.toBeInTheDocument();
});

it('closes the modal when the dealer disappears', async () => {
  const user = userEvent.setup();
  const { rerender } = render(<NeonDGame />);

  await user.click(screen.getByRole('button', { name: /upgrade/i }));
  expect(screen.getByText(/select equipment/i)).toBeInTheDocument();

  mockNeonD.setState(
    mockNeonD.createState({
      activeDealers: [null],
    }),
  );
  rerender(<NeonDGame />);

  expect(screen.queryByText(/select equipment/i)).not.toBeInTheDocument();
});

it('shows bail and fire actions for arrested dealers', () => {
  mockNeonD.setState(
    mockNeonD.createState({
      lastEarningsPerDealer: { 'dealer-arrested': 20 },
      activeDealers: [
        mockNeonD.createDealer({
          id: 'dealer-arrested',
          name: 'Arrested Dealer',
          isProtected: false,
          isArrested: true,
          hasPendingUpgrade: false,
          pendingUpgradeOptions: [],
        }),
      ],
    }),
  );

  render(<NeonDGame />);

  expect(screen.getAllByText(/arrested/i).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: /pay bail \(\$900\)/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /fire dealer/i })).toBeInTheDocument();
});
