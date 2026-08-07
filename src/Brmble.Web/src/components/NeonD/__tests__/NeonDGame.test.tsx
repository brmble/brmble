import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, vi } from 'vitest';
import { NeonDGame } from '../NeonDGame';
import { createBaseGameState } from '../constants';
import { serializeNeonDSave } from '../saveFormat';
import { makeReferenceCaptain, makeReferenceDealer } from './testFixtures';
import type { GameState } from '../types';

const mockNeonD = vi.hoisted(() => {
  const buyProducerMock = vi.fn();
  const researchProductMock = vi.fn();
  const buyProductUpgradeMock = vi.fn();
  const buyMuscleWorkerMock = vi.fn();
  const buyTerritoryMock = vi.fn();
  const buyDiscountMock = vi.fn();
  const hireDealerMock = vi.fn();
  const fireDealerMock = vi.fn();
  const setSellerProductMock = vi.fn();
  const buySellerEquipmentMock = vi.fn();
  const toggleDealerProtectionMock = vi.fn();
  const payDealerBailMock = vi.fn();
  const unlockBulkSellingMock = vi.fn();
  const bulkSellProductMock = vi.fn();
  const setAutoBulkEnabledMock = vi.fn();
  const dismissOfflineEarningsSummaryMock = vi.fn();
  const buyCaptainMock = vi.fn();
  const promoteCaptainMock = vi.fn();
  const resetGameMock = vi.fn();
  const importGameMock = vi.fn();
  let state: GameState;

  return {
    buyProducerMock,
    researchProductMock,
    buyProductUpgradeMock,
    buyMuscleWorkerMock,
    buyTerritoryMock,
    buyDiscountMock,
    hireDealerMock,
    fireDealerMock,
    setSellerProductMock,
    buySellerEquipmentMock,
    toggleDealerProtectionMock,
    payDealerBailMock,
    unlockBulkSellingMock,
    bulkSellProductMock,
    setAutoBulkEnabledMock,
    dismissOfflineEarningsSummaryMock,
    buyCaptainMock,
    promoteCaptainMock,
    resetGameMock,
    importGameMock,
    getState: () => state,
    setState: (nextState: GameState) => {
      state = nextState;
    },
    resetMocks: () => {
      [
        buyProducerMock,
        researchProductMock,
        buyProductUpgradeMock,
        buyMuscleWorkerMock,
        buyTerritoryMock,
        buyDiscountMock,
        hireDealerMock,
        fireDealerMock,
        setSellerProductMock,
        buySellerEquipmentMock,
        toggleDealerProtectionMock,
        payDealerBailMock,
        unlockBulkSellingMock,
        bulkSellProductMock,
        setAutoBulkEnabledMock,
        dismissOfflineEarningsSummaryMock,
        buyCaptainMock,
        promoteCaptainMock,
        resetGameMock,
        importGameMock,
      ].forEach((mock) => mock.mockReset());
    },
    useGameEngine: () => ({
      state,
      buyProducer: buyProducerMock,
      researchProduct: researchProductMock,
      buyProductUpgrade: buyProductUpgradeMock,
      buyMuscleWorker: buyMuscleWorkerMock,
      buyTerritory: buyTerritoryMock,
      buyDiscount: buyDiscountMock,
      hireDealer: hireDealerMock,
      fireDealer: fireDealerMock,
      setSellerProduct: setSellerProductMock,
      buySellerEquipment: buySellerEquipmentMock,
      toggleDealerProtection: toggleDealerProtectionMock,
      payDealerBail: payDealerBailMock,
      unlockBulkSelling: unlockBulkSellingMock,
      bulkSellProduct: bulkSellProductMock,
      setAutoBulkEnabled: setAutoBulkEnabledMock,
      dismissOfflineEarningsSummary: dismissOfflineEarningsSummaryMock,
      buyCaptain: buyCaptainMock,
      promoteCaptain: promoteCaptainMock,
      resetGame: resetGameMock,
      importGame: importGameMock,
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

const createState = (overrides: Partial<GameState> = {}): GameState => {
  const base = createBaseGameState(Date.now());
  return {
    ...base,
    cash: 10_000,
    respect: 2_000,
    runEarnings: 8_000_000,
    production: {
      ...base.production,
      weed: {
        stock: 100,
        producersOwned: 5,
        purchasedUpgradeIds: ['fertilizer'],
      },
    },
    activeDealers: [makeReferenceDealer({ id: 'dealer-ui', isProtected: true })],
    availableDealers: [
      makeReferenceDealer({ id: 'candidate-1', name: 'Candidate One', volumeMultiplier: 1.23, marginMultiplier: 0.87 }),
      makeReferenceDealer({ id: 'candidate-2', name: 'Candidate Two', volumeMultiplier: 0.75, marginMultiplier: 1.25 }),
      makeReferenceDealer({ id: 'candidate-3', name: 'Candidate Three', volumeMultiplier: 1.5, marginMultiplier: 1 }),
    ],
    lastEarningsPerSeller: { 'dealer-ui': 8.5 },
    captains: [
      makeReferenceCaptain({ id: 'captain-ui', name: 'Captain UI', personalEarnings: 500_000 }),
    ],
    ...overrides,
  };
};

const mockState = (overrides: Partial<GameState>) => {
  mockNeonD.setState(createState(overrides));
};

beforeEach(() => {
  mockNeonD.setState(createState());
  mockNeonD.resetMocks();
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

it('exports the current Neon-D v2 state as a JSON download', async () => {
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:neon-d');
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

  render(<NeonDGame />);
  const exportButton = screen.getByRole('button', { name: 'Export' });
  const importButton = screen.getByRole('button', { name: 'Import' });
  const resetButton = screen.getByRole('button', { name: 'Reset' });
  expect(exportButton.parentElement).toBe(importButton.parentElement);
  expect(exportButton.parentElement).toBe(resetButton.parentElement);

  await userEvent.setup().click(exportButton);

  expect(createObjectURL).toHaveBeenCalledOnce();
  const blob = createObjectURL.mock.calls[0][0] as Blob;
  expect(await blob.text()).toBe(serializeNeonDSave(mockNeonD.getState()));
  expect(click).toHaveBeenCalledOnce();
  expect(document.querySelector('a[download="brmble-neon-d-save.json"]')).toBeNull();
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:neon-d');
});

it('does not import a valid v2 save when replacement confirmation is canceled', async () => {
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

it('renders Production, Distribution, and Muscle / Respect as primary areas', () => {
  render(<NeonDGame />);

  expect(screen.getByRole('heading', { name: /production/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /distribution/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /muscle/i })).toBeInTheDocument();
  expect(screen.getAllByText(/respect/i).length).toBeGreaterThan(0);
});

it('does not render Research Speed or dealer star ratings', () => {
  render(<NeonDGame />);

  expect(screen.queryByText(/research speed/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/★/)).not.toBeInTheDocument();
});

it('shows producer, stock, production rate, sales rate, and bottleneck delta for Weed', () => {
  render(<NeonDGame />);

  expect(screen.getAllByText(/cannabis plant/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/stock/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/production/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/sales/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/delta/i).length).toBeGreaterThan(0);
});

it('shows numeric dealer Volume, Margin, protection loss, and fixed equipment choices', () => {
  render(<NeonDGame />);

  expect(screen.getAllByText(/volume/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/margin/i).length).toBeGreaterThan(0);
  expect(screen.getByText(/-10% income/i)).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /baseball bat/i }).length).toBeGreaterThan(0);
});

it('shows all three auto-refreshed candidates without a manual refresh button', () => {
  mockState({
    activeDealers: [null],
  });

  render(<NeonDGame />);

  expect(screen.getByText(/candidate one/i)).toBeInTheDocument();
  expect(screen.getByText(/candidate two/i)).toBeInTheDocument();
  expect(screen.getByText(/candidate three/i)).toBeInTheDocument();
  expect(screen.getByText(/next candidates in/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /refresh/i })).not.toBeInTheDocument();
});

it('shows the Captain prestige controls and invokes buyCaptain', async () => {
  const user = userEvent.setup();
  mockState({ cash: 10_000_000 });

  render(<NeonDGame />);
  await user.click(screen.getByRole('button', { name: /hire captain/i }));

  expect(screen.getByText(/captain ui/i)).toBeInTheDocument();
  expect(screen.getByText(/level 1/i)).toBeInTheDocument();
  expect(mockNeonD.buyCaptainMock).toHaveBeenCalledOnce();
});

it('shows Bulk and Captain progression controls at their visible thresholds', () => {
  mockState({
    cash: 10_000_000,
    runEarnings: 7_500_000,
    bulkUnlocked: false,
  });

  render(<NeonDGame />);

  expect(screen.getByRole('button', { name: /bulk.*141[.,]592/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /captain/i })).toBeInTheDocument();
});

it('shows the offline summary with cash, Respect, and simulated duration', () => {
  mockState({
    offlineEarningsSummary: {
      actualAwayMs: 48 * 60 * 60 * 1000,
      simulatedMs: 24 * 60 * 60 * 1000,
      cashEarned: 12_345,
      respectEarned: 678,
    },
  });

  render(<NeonDGame />);

  expect(screen.getByText(/24h simulated/i)).toBeInTheDocument();
  expect(screen.getByText(/12[.,]345/)).toBeInTheDocument();
  expect(screen.getByText(/678.*respect/i)).toBeInTheDocument();
});

it('dismisses the offline summary on accept', async () => {
  const user = userEvent.setup();
  mockState({
    offlineEarningsSummary: {
      actualAwayMs: 65 * 60 * 1000,
      simulatedMs: 65 * 60 * 1000,
      cashEarned: 12_345,
      respectEarned: 67,
    },
  });

  render(<NeonDGame />);
  await user.click(screen.getByRole('button', { name: /accept/i }));

  expect(mockNeonD.dismissOfflineEarningsSummaryMock).toHaveBeenCalledOnce();
});

it('shows bail and fire actions for arrested dealers', () => {
  mockState({
    activeDealers: [
      makeReferenceDealer({
        id: 'dealer-arrested',
        name: 'Arrested Dealer',
        isProtected: false,
        isArrested: true,
        earningsPerSecondAtArrest: 20,
      }),
    ],
  });

  render(<NeonDGame />);

  expect(screen.getAllByText(/arrested/i).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: /pay bail \(\$1[.,]900\)/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /fire dealer/i })).toBeInTheDocument();
});
