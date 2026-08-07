import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, vi } from 'vitest';
import { NeonDGame } from '../NeonDGame';
import { serializeNeonDSave } from '../saveFormat';
import type { Dealer, DealerUpgrade, GameState } from '../types';

const mockNeonD = vi.hoisted(() => {
  const buyEquipmentMock = vi.fn();
  const startDealerUpgradeMock = vi.fn();
  const resetGameMock = vi.fn();
  const importGameMock = vi.fn();
  const dealerUpgradeOptions: DealerUpgrade[] = [
    { type: 'VOLUME', label: 'Armed Gang', description: 'Volume +15%', value: 0.15 },
    { type: 'MARGIN', label: 'Ferrari', description: 'Margin +15%', value: 0.15 },
    { type: 'SIDE_HUSTLE', label: 'JACKPOT: Side Hustle', description: 'Add 10% side volume bleed', value: 0.1, sideVolumeValue: 0.1 },
  ];

  const createDealer = (overrides: Partial<Dealer> = {}): Dealer => ({
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

  const createState = (overrides: Partial<GameState> = {}): GameState => ({
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
    lastTickAt: Date.now(),
    offlineEarningsSummary: null,
    ...overrides,
  });

  let state = createState();

  return {
    buyEquipmentMock,
    startDealerUpgradeMock,
    resetGameMock,
    importGameMock,
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
      resetGameMock.mockReset();
      importGameMock.mockReset();
    },
    useGameEngine: () => ({
      state,
      upgrade: vi.fn(),
      unlockProduction: vi.fn(),
      hireDealer: vi.fn(),
      fireDealer: vi.fn(),
      refreshPool: vi.fn(),
      resetGame: resetGameMock,
      importGame: importGameMock,
      unlockSlot: vi.fn(),
      setDealerSelling: vi.fn(),
      startDealerUpgrade: startDealerUpgradeMock,
      buyEquipment: buyEquipmentMock,
      toggleDealerProtection: vi.fn(),
      payDealerBail: vi.fn(),
      forceArrestDealer: vi.fn(),
      dismissOfflineEarningsSummary: vi.fn(),
    }),
  };
});

vi.mock('../hooks/useGameEngine', () => ({
  useGameEngine: () => mockNeonD.useGameEngine(),
}));

const confirmMock = vi.hoisted(() => vi.fn());

vi.mock('../../../hooks/usePrompt', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../hooks/usePrompt')>()),
  confirm: confirmMock,
}));

beforeEach(() => {
  mockNeonD.reset();
  confirmMock.mockReset();
});

it('asks for confirmation before resetting the Neon-D empire', async () => {
  const user = userEvent.setup();
  confirmMock.mockResolvedValue(true);

  render(<NeonDGame />);
  await user.click(screen.getByRole('button', { name: 'Reset' }));

  expect(confirmMock).toHaveBeenCalledWith({
    title: 'Reset Neon-D empire?',
    message: 'Are you sure you want to reset your Neon-D empire? All progress will be lost.',
    confirmLabel: 'Reset',
    cancelLabel: 'Cancel',
    destructive: true,
  });
  expect(mockNeonD.resetGameMock).toHaveBeenCalledTimes(1);
});

it('does not reset the Neon-D empire when confirmation is canceled', async () => {
  const user = userEvent.setup();
  confirmMock.mockResolvedValue(false);

  render(<NeonDGame />);
  await user.click(screen.getByRole('button', { name: 'Reset' }));

  expect(confirmMock).toHaveBeenCalledTimes(1);
  expect(mockNeonD.resetGameMock).not.toHaveBeenCalled();
});

it('exports the current Neon-D state as a JSON download', async () => {
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:neon-d');
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

  render(<NeonDGame />);
  const exportButton = screen.getByRole('button', { name: 'Export' });
  const importButton = screen.getByRole('button', { name: 'Import' });
  const resetButton = screen.getByRole('button', { name: 'Reset' });
  expect(exportButton.parentElement).toBe(importButton.parentElement);
  expect(exportButton.parentElement).toBe(resetButton.parentElement);
  expect(exportButton).toHaveClass('btn', 'btn-primary');
  expect(importButton).toHaveClass('btn', 'btn-secondary');
  expect(resetButton).toHaveClass('btn', 'btn-danger');
  await userEvent.setup().click(exportButton);

  expect(createObjectURL).toHaveBeenCalledOnce();
  const blob = createObjectURL.mock.calls[0][0] as Blob;
  expect(await blob.text()).toBe(serializeNeonDSave(mockNeonD.getState()));
  expect(click).toHaveBeenCalledOnce();
  expect(document.querySelector('a[download="brmble-neon-d-save.json"]')).toBeNull();
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:neon-d');
});

it('does not import a valid save when replacement confirmation is canceled', async () => {
  const user = userEvent.setup();
  confirmMock.mockResolvedValue(false);
  render(<NeonDGame />);

  await user.upload(
    screen.getByLabelText('Neon-D save file'),
    new File([serializeNeonDSave(mockNeonD.getState())], 'save.json', { type: 'application/json' }),
  );

  expect(confirmMock).toHaveBeenCalledWith({
    title: 'Import Neon-D save?',
    message: 'Import this Neon-D save? Your current empire will be replaced.',
    confirmLabel: 'Import',
    cancelLabel: 'Cancel',
    destructive: true,
  });
  expect(mockNeonD.importGameMock).not.toHaveBeenCalled();
});

it('shows an error and keeps the current empire when an imported file is invalid', async () => {
  const user = userEvent.setup();
  render(<NeonDGame />);

  await user.upload(
    screen.getByLabelText('Neon-D save file'),
    new File(['not json'], 'save.json', { type: 'application/json' }),
  );

  expect(await screen.findByRole('alert')).toHaveTextContent('not valid JSON');
  expect(mockNeonD.importGameMock).not.toHaveBeenCalled();
});

it('processes a second file selection after the first import fails', async () => {
  const user = userEvent.setup();
  confirmMock.mockResolvedValue(true);
  render(<NeonDGame />);
  const input = screen.getByLabelText('Neon-D save file');

  await user.upload(input, new File(['not json'], 'save.json', { type: 'application/json' }));
  await screen.findByRole('alert');
  await user.upload(
    input,
    new File([serializeNeonDSave(mockNeonD.getState())], 'save.json', { type: 'application/json' }),
  );

  expect(mockNeonD.importGameMock).toHaveBeenCalledOnce();
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
    importGame: vi.fn(),
    unlockSlot: vi.fn(),
    setDealerSelling: vi.fn(),
    startDealerUpgrade: mockNeonD.startDealerUpgradeMock,
    buyEquipment: mockNeonD.buyEquipmentMock,
    toggleDealerProtection: vi.fn(),
    payDealerBail: vi.fn(),
    forceArrestDealer: vi.fn(),
    dismissOfflineEarningsSummary,
  });

  render(<NeonDGame />);

  expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
  expect(screen.getByText(/you've been away for 1h 5m/i)).toBeInTheDocument();
  expect(screen.getByText(/you've earned \$12[.,]345/i)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /accept/i }));
  expect(dismissOfflineEarningsSummary).toHaveBeenCalled();
});
