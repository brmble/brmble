import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, vi } from 'vitest';
import { NeonDGame } from '../NeonDGame';

const mockNeonD = vi.hoisted(() => {
  const buyEquipmentMock = vi.fn();
  const startDealerUpgradeMock = vi.fn();
  const dealerUpgradeOptions = [
    { type: 'VOLUME', rarity: 'COMMON', tone: 'POSITIVE', label: 'Armed Gang', description: 'Volume +15%', value: 0.15, effects: [{ stat: 'volumeBonus', value: 0.15, label: '+15% volume' }] },
    { type: 'MARGIN', rarity: 'COMMON', tone: 'POSITIVE', label: 'Ferrari', description: 'Margin +15%', value: 0.15, effects: [{ stat: 'marginBonus', value: 0.15, label: '+15% margin' }] },
    { type: 'SIDE_HUSTLE', rarity: 'JACKPOT', tone: 'POSITIVE', label: 'JACKPOT: Side Hustle', description: 'Add 10% side volume bleed', value: 0.1, sideVolumeValue: 0.1, effects: [{ stat: 'sideVolume', value: 0.1, label: '+10% side volume' }] },
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
    maxEquipmentSlots: 3,
    riskBonus: 0,
    bulkStreetValue: 0,
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
    operationUpgrades: {
      betterVolumeTraining: 0,
      betterMarginTraining: 0,
      saferOperations: 0,
      bulkNetwork: 0,
    },
    productUpgrades: {
      weed: {
        PURITY: { category: 'PURITY', level: 0, maxLevel: 3 },
        AUTOMATION: { category: 'AUTOMATION', level: 0, maxLevel: 3 },
        CONCEALMENT: { category: 'CONCEALMENT', level: 0, maxLevel: 3 },
        DISTRIBUTION: { category: 'DISTRIBUTION', level: 0, maxLevel: 2 },
      },
    },
    bulkMarket: {
      cooldownUntil: 0,
      lastSaleAt: 0,
    },
    lastRefreshTime: 0,
    lastEarningsPerDealer: { 'dealer-ui': 8.5 },
    lastTickAt: Date.now(),
    offlineEarningsSummary: null,
    ...overrides,
  });

  let state = createState();
  const defaultUseGameEngine = () => ({
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
    dismissOfflineEarningsSummary: vi.fn(),
    buyOperationUpgrade: vi.fn(),
    buyProductUpgrade: vi.fn(),
    unlockDealerEquipmentSlot: vi.fn(),
    sellBulk: vi.fn(),
  });

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
    defaultUseGameEngine,
    useGameEngine: defaultUseGameEngine,
  };
});

vi.mock('../hooks/useGameEngine', () => ({
  useGameEngine: () => mockNeonD.useGameEngine(),
}));

beforeEach(() => {
  mockNeonD.reset();
  mockNeonD.useGameEngine = mockNeonD.defaultUseGameEngine;
});

it('shows protection state and risk label on an active dealer card', () => {
  render(<NeonDGame />);

  expect(screen.getByText(/protected/i)).toBeInTheDocument();
  expect(screen.queryByText(/low risk/i)).not.toBeInTheDocument();
  expect(screen.getByText(/-15% income/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /pay off cops/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/production and dealer sales are balanced/i)).toBeInTheDocument();
});

it('renders dealer volume and margin as star ratings instead of fractions', () => {
  render(<NeonDGame />);

  expect(screen.queryByText('3/5')).not.toBeInTheDocument();
  expect(screen.getAllByText('★★★☆☆').length).toBeGreaterThan(0);
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

it('shows an offline earnings popup after a long enough break and dismisses it on accept', async () => {
  const user = userEvent.setup();
  const dismissOfflineEarningsSummary = vi.fn();

  mockNeonD.useGameEngine = () => ({
    state: mockNeonD.createState({
      offlineEarningsSummary: {
        awayMs: 65 * 60 * 1000,
        earned: 12345,
      },
    }),
    upgrade: vi.fn(),
    unlockProduction: vi.fn(),
    hireDealer: vi.fn(),
    fireDealer: vi.fn(),
    refreshPool: vi.fn(),
    resetGame: vi.fn(),
    unlockSlot: vi.fn(),
    setDealerSelling: vi.fn(),
    startDealerUpgrade: mockNeonD.startDealerUpgradeMock,
    buyEquipment: mockNeonD.buyEquipmentMock,
    toggleDealerProtection: vi.fn(),
    payDealerBail: vi.fn(),
    forceArrestDealer: vi.fn(),
    dismissOfflineEarningsSummary,
    buyOperationUpgrade: vi.fn(),
    buyProductUpgrade: vi.fn(),
    unlockDealerEquipmentSlot: vi.fn(),
    sellBulk: vi.fn(),
  });

  render(<NeonDGame />);

  expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
  expect(screen.getByText(/you've been away for 1h 5m/i)).toBeInTheDocument();
  expect(screen.getByText(/you've earned \$12[.,]345/i)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /accept/i }));
  expect(dismissOfflineEarningsSummary).toHaveBeenCalled();
});

it('renders operations tab with meta-upgrades, product upgrades, and bulk market', async () => {
  const user = userEvent.setup();
  render(<NeonDGame />);

  await user.click(screen.getByRole('tab', { name: /operations/i }));

  expect(screen.getByText(/better volume training/i)).toBeInTheDocument();
  expect(screen.getByText(/product specialization/i)).toBeInTheDocument();
  expect(screen.getByText(/bulk market/i)).toBeInTheDocument();
});

it('shows positive and negative upgrade effects in the equipment modal', async () => {
  const user = userEvent.setup();
  mockNeonD.setState(
    mockNeonD.createState({
      activeDealers: [
        mockNeonD.createDealer({
          pendingUpgradeOptions: [
            {
              type: 'VOLUME',
              rarity: 'RARE',
              tone: 'MIXED',
              label: 'Reckless Crew',
              description: 'Volume +25%, arrest risk +5%',
              value: 0.25,
              riskPenalty: 0.05,
              effects: [
                { stat: 'volumeBonus', value: 0.25, label: '+25% volume' },
                { stat: 'riskBonus', value: 0.05, label: '+5% arrest risk', isNegative: true },
              ],
            },
            {
              type: 'RISK_REDUCTION',
              rarity: 'UNCOMMON',
              tone: 'POSITIVE',
              label: 'Clean Route',
              description: 'Arrest risk -6%',
              value: 0.06,
              riskReduction: 0.06,
              effects: [{ stat: 'riskBonus', value: -0.06, label: '-6% arrest risk' }],
            },
            {
              type: 'ALL_AROUNDER',
              rarity: 'COMMON',
              tone: 'POSITIVE',
              label: 'All-Arounder',
              description: 'Volume +5%, margin +5%',
              value: 0.05,
              effects: [
                { stat: 'volumeBonus', value: 0.05, label: '+5% volume' },
                { stat: 'marginBonus', value: 0.05, label: '+5% margin' },
              ],
            },
          ],
        }),
      ],
    }),
  );

  render(<NeonDGame />);
  await user.click(screen.getByRole('button', { name: /upgrade/i }));

  expect(screen.getByText(/high risk/i)).toBeInTheDocument();
  expect(screen.getByText(/\+5% arrest risk/i)).toBeInTheDocument();
  expect(screen.getByText(/-6% arrest risk/i)).toBeInTheDocument();
});

it('shows hover explanations for Operations V2 controls', () => {
  vi.useFakeTimers();
  render(<NeonDGame />);

  fireEvent.click(screen.getByRole('tab', { name: /operations/i }));
  fireEvent.mouseEnter(screen.getAllByRole('button', { name: /upgrade/i })[0]);
  act(() => { vi.advanceTimersByTime(400); });

  expect(screen.getByRole('tooltip')).toHaveTextContent(/improves future dealer volume rolls/i);

  fireEvent.mouseLeave(screen.getAllByRole('button', { name: /upgrade/i })[0]);
  fireEvent.mouseEnter(screen.getByRole('button', { name: /PURITY/i }));
  act(() => { vi.advanceTimersByTime(400); });

  expect(screen.getByRole('tooltip')).toHaveTextContent(/raises this product's sell price/i);

  vi.useRealTimers();
});
