import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, vi } from 'vitest';
import { NeonDGame } from '../NeonDGame';
import {
  CAPTAIN_COSTS,
  CAPTAIN_VISIBLE_EARNINGS,
  MARKET_DURATION_MAX_MS,
  createBaseGameState,
} from '../constants';
import { serializeNeonDSave } from '../saveFormat';
import { NEON_D_CARD_PREFERENCES_KEY } from '../hooks/usePersistedCardPreferences';
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
  const hireSellerMock = vi.fn();
  const refreshDealersMock = vi.fn();
  const renameCaptainMock = vi.fn();
  const fireDealerMock = vi.fn();
  const setSellerProductMock = vi.fn();
  const buySellerEquipmentMock = vi.fn();
  const toggleDealerProtectionMock = vi.fn();
  const payDealerBailMock = vi.fn();
  const unlockBulkSellingMock = vi.fn();
  const bulkSellProductMock = vi.fn();
  const dismissOfflineEarningsSummaryMock = vi.fn();
  const buyCaptainMock = vi.fn();
  const claimCaptainLevelMock = vi.fn();
  const purchaseCaptainTalentMock = vi.fn();
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
    hireSellerMock,
    refreshDealersMock,
    renameCaptainMock,
    fireDealerMock,
    setSellerProductMock,
    buySellerEquipmentMock,
    toggleDealerProtectionMock,
    payDealerBailMock,
    unlockBulkSellingMock,
    bulkSellProductMock,
    dismissOfflineEarningsSummaryMock,
    buyCaptainMock,
    claimCaptainLevelMock,
    purchaseCaptainTalentMock,
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
        hireSellerMock,
        refreshDealersMock,
        renameCaptainMock,
        fireDealerMock,
        setSellerProductMock,
        buySellerEquipmentMock,
        toggleDealerProtectionMock,
        payDealerBailMock,
        unlockBulkSellingMock,
        bulkSellProductMock,
        dismissOfflineEarningsSummaryMock,
        buyCaptainMock,
        claimCaptainLevelMock,
        purchaseCaptainTalentMock,
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
      hireSeller: hireSellerMock,
      refreshDealers: refreshDealersMock,
      renameCaptain: renameCaptainMock,
      fireDealer: fireDealerMock,
      setSellerProduct: setSellerProductMock,
      buySellerEquipment: buySellerEquipmentMock,
      toggleDealerProtection: toggleDealerProtectionMock,
      payDealerBail: payDealerBailMock,
      unlockBulkSelling: unlockBulkSellingMock,
      bulkSellProduct: bulkSellProductMock,
      dismissOfflineEarningsSummary: dismissOfflineEarningsSummaryMock,
      buyCaptain: buyCaptainMock,
      claimCaptainLevel: claimCaptainLevelMock,
      purchaseCaptainTalent: purchaseCaptainTalentMock,
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

const formatExpectedMoney = (value: number) =>
  `$${Math.round(value).toLocaleString()}`;

beforeEach(() => {
  localStorage.clear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
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

it('asks for confirmation before firing a regular dealer', async () => {
  const user = userEvent.setup();
  confirmMock.mockResolvedValue(true);
  mockState({
    activeDealers: [makeReferenceDealer({ id: 'dealer-fire', name: 'Dealer Fire' })],
  });

  render(<NeonDGame />);
  await user.click(screen.getByRole('button', { name: 'Fire Dealer' }));

  expect(confirmMock).toHaveBeenCalledWith({
    title: 'Fire dealer?',
    message: 'Are you sure you want to fire Dealer Fire?',
    confirmLabel: 'Fire Dealer',
    cancelLabel: 'Cancel',
    destructive: true,
  });
  expect(mockNeonD.fireDealerMock).toHaveBeenCalledWith('dealer-fire');
});

it('does not fire a dealer when the confirmation is canceled', async () => {
  const user = userEvent.setup();
  confirmMock.mockResolvedValue(false);
  mockState({
    activeDealers: [makeReferenceDealer({ id: 'dealer-cancel', name: 'Dealer Cancel' })],
  });

  render(<NeonDGame />);
  await user.click(screen.getByRole('button', { name: 'Fire Dealer' }));

  expect(confirmMock).toHaveBeenCalledOnce();
  expect(mockNeonD.fireDealerMock).not.toHaveBeenCalled();
});

it('uses the same confirmation before firing an arrested dealer', async () => {
  const user = userEvent.setup();
  confirmMock.mockResolvedValue(true);
  mockState({
    activeDealers: [
      makeReferenceDealer({
        id: 'dealer-arrested-fire',
        name: 'Arrested Fire',
        isArrested: true,
        isProtected: false,
        earningsPerSecondAtArrest: 20,
      }),
    ],
  });

  render(<NeonDGame />);
  await user.click(screen.getByRole('button', { name: 'Fire Dealer' }));

  expect(confirmMock).toHaveBeenCalledWith({
    title: 'Fire dealer?',
    message: 'Are you sure you want to fire Arrested Fire?',
    confirmLabel: 'Fire Dealer',
    cancelLabel: 'Cancel',
    destructive: true,
  });
  expect(mockNeonD.fireDealerMock).toHaveBeenCalledWith('dealer-arrested-fire');
});

it('presents an active market event as a single live market card', () => {
  const now = Date.now();
  mockState({
    lastTickAt: now,
    activeMarketEvent: {
      productId: 'weed',
      multiplier: 4.2,
      endsAt: now + 30_000,
    },
  });

  render(<NeonDGame />);

  expect(screen.getByRole('heading', { name: 'Weed market spike' })).toBeInTheDocument();
  expect(screen.getByText('LIVE MARKET')).toBeInTheDocument();
  expect(screen.getByText('4.20x')).toBeInTheDocument();
  expect(screen.getByText('30s remaining')).toBeInTheDocument();
  expect(screen.getAllByText(/market spike/i)).toHaveLength(1);

  const progress = screen.getByRole('heading', { name: 'Weed market spike' })
    .closest('section')
    ?.querySelector('span[style]');
  expect(progress).toBeTruthy();
  expect(progress).toHaveStyle({ width: `${(30_000 / MARKET_DURATION_MAX_MS) * 100}%` });
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

it('prioritizes income, then Respect per second, cash, and prestige counters', () => {
  const baseState = createBaseGameState(0);
  mockState({
    cash: 31_253.15,
    respect: 2_345,
    lastEarningsPerSeller: { first: 10, second: 6.65 },
    muscleOwned: {
      ...baseState.muscleOwned,
      hoodRat: 1,
    },
    captains: [makeReferenceCaptain({ id: 'captain-priority', personalEarnings: 0 })],
    kingpins: 2,
  });

  render(<NeonDGame />);

  const statistics = screen.getByRole('region', { name: 'Empire statistics' });
  const primary = statistics.querySelector('[data-stat-priority="primary"]');
  const secondary = statistics.querySelector('[data-stat-priority="secondary"]');
  const tertiary = statistics.querySelector('[data-stat-priority="tertiary"]');
  const prestige = statistics.querySelector('[data-stat-priority="prestige"]');

  expect(primary).toHaveTextContent(/seller income\/sec/i);
  expect(primary).toHaveTextContent(/16[.,]65/);
  const respectLabel = within(secondary as HTMLElement).getByText('Respect/sec');
  const respectValue = within(secondary as HTMLElement).getByText('4.00');
  expect(respectLabel).not.toBe(respectValue);
  expect(respectLabel.tagName).toBe('SPAN');
  expect(respectValue.tagName).toBe('STRONG');
  expect(tertiary).toHaveTextContent(/cash/i);
  expect(tertiary).toHaveTextContent(/31[.,]253[.,]15/);
  expect(prestige).toHaveTextContent(/captains\s*1/i);
  expect(prestige).toHaveTextContent(/kingpins\s*2/i);
  expect(primary).not.toHaveClass('undefined');
  expect(secondary).not.toHaveClass('undefined');
  expect(tertiary).not.toHaveClass('undefined');
});

it('does not reference undefined priority metric CSS modifiers', () => {
  const componentPath = resolve(process.cwd(), 'src/components/NeonD/NeonDGame.tsx');
  const source = readFileSync(componentPath, 'utf8');

  expect(source).not.toMatch(/styles\.(?:primaryMetric|secondaryMetric|cashMetric)\b/);
});

it('hides the Captain recruitment panel before the first Captain threshold', () => {
  mockState({ runEarnings: 3_750_000, captains: [] });

  render(<NeonDGame />);

  const workspace = screen.getByTestId('distribution-workspace');
  const distribution = within(workspace).getByRole('region', {
    name: 'Distribution',
  });

  expect(within(workspace).queryByRole('progressbar')).not.toBeInTheDocument();
  expect(distribution.previousElementSibling).toBeNull();
  expect(screen.getByRole('region', { name: 'Empire statistics' }))
    .not.toHaveTextContent(/captain progress/i);
});

it('shows current cash against the first Captain price', () => {
  mockState({
    cash: 1_000_000,
    runEarnings: CAPTAIN_VISIBLE_EARNINGS,
    captains: [],
  });

  render(<NeonDGame />);

  const workspace = screen.getByTestId('distribution-workspace');
  const progress = within(workspace).getByRole('progressbar', {
    name: 'Captain recruitment fund',
  });
  const milestone = progress.closest('section') as HTMLElement;

  expect(progress).toHaveAttribute('aria-valuemax', String(CAPTAIN_COSTS[0]));
  expect(progress).toHaveAttribute('aria-valuenow', '1000000');
  expect(progress).toHaveAttribute(
    'aria-valuetext',
    `${formatExpectedMoney(1_000_000)} of ${formatExpectedMoney(CAPTAIN_COSTS[0])}`,
  );
  expect(within(milestone).getByText(
    `${formatExpectedMoney(1_000_000)} / ${formatExpectedMoney(CAPTAIN_COSTS[0])}`,
  )).toBeInTheDocument();
  expect(within(workspace).queryByRole('button', { name: /deposit|withdraw/i })).not.toBeInTheDocument();
  expect(within(workspace).queryByRole('spinbutton')).not.toBeInTheDocument();
});

it('opens Captain naming before invoking recruitment', async () => {
  const user = userEvent.setup();
  mockState({ cash: CAPTAIN_COSTS[0], runEarnings: 7_500_000, captains: [] });

  render(<NeonDGame />);

  const workspace = screen.getByTestId('distribution-workspace');
  expect(within(workspace).queryByRole('button', { name: /deposit|withdraw/i })).not.toBeInTheDocument();
  expect(within(workspace).queryByRole('spinbutton')).not.toBeInTheDocument();
  const hireButton = within(workspace).getByRole('button', { name: /hire captain/i });
  expect(hireButton.closest('section')?.nextElementSibling)
    .toBe(within(workspace).getByRole('region', { name: 'Distribution' }));

  await user.click(hireButton);

  const dialog = screen.getByRole('dialog', { name: 'Name your Captain' });
  expect(dialog).toBeInTheDocument();
  const input = within(dialog).getByRole('textbox', { name: 'Captain name' });
  expect(input).toHaveValue('Captain 1');
  expect(mockNeonD.buyCaptainMock).not.toHaveBeenCalled();

  await user.clear(input);
  await user.type(input, 'Nightshade');
  await user.click(within(dialog).getByRole('button', { name: 'Confirm Captain name' }));

  expect(mockNeonD.buyCaptainMock).toHaveBeenCalledWith('Nightshade');
  expect(screen.queryByRole('dialog', { name: 'Name your Captain' })).not.toBeInTheDocument();
});

it('cancels Captain naming without invoking recruitment', async () => {
  const user = userEvent.setup();
  mockState({ cash: CAPTAIN_COSTS[0], runEarnings: 7_500_000, captains: [] });

  render(<NeonDGame />);
  await user.click(screen.getByRole('button', { name: /hire captain/i }));
  await user.click(screen.getByRole('button', { name: 'Cancel Captain naming' }));

  expect(mockNeonD.buyCaptainMock).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog', { name: 'Name your Captain' })).not.toBeInTheDocument();
});

it('keeps the recruitment panel visible for the next Captain after the first hire', () => {
  mockState({
    cash: 0,
    runEarnings: 0,
    captains: [makeReferenceCaptain({ id: 'captain-owned' })],
  });

  render(<NeonDGame />);

  const workspace = screen.getByTestId('distribution-workspace');
  expect(within(workspace).getByText(
    `${formatExpectedMoney(0)} / ${formatExpectedMoney(CAPTAIN_COSTS[1])}`,
  )).toBeInTheDocument();
  expect(within(workspace).queryByRole('button', { name: /deposit|withdraw/i })).not.toBeInTheDocument();
});

it('shows the exact Captain price and disables hiring when unlocked but unaffordable', () => {
  mockState({
    cash: CAPTAIN_COSTS[0] - 1,
    runEarnings: CAPTAIN_VISIBLE_EARNINGS,
    captains: [],
    kingpins: 0,
    discountLevel: 0,
  });

  render(<NeonDGame />);

  const workspace = screen.getByTestId('distribution-workspace');
  expect(within(workspace).getByText(
    `${formatExpectedMoney(CAPTAIN_COSTS[0] - 1)} / ${formatExpectedMoney(CAPTAIN_COSTS[0])}`,
  )).toBeInTheDocument();
  expect(within(workspace).queryByRole('button', { name: /deposit|withdraw/i })).not.toBeInTheDocument();
});

it('renders Production as the default left tab and keeps Distribution visible', () => {
  render(<NeonDGame />);

  const productionTab = screen.getByRole('tab', { name: 'Production' });
  const muscleTab = screen.getByRole('tab', { name: 'Muscle' });

  expect(productionTab).toHaveAttribute('aria-selected', 'true');
  expect(muscleTab).toHaveAttribute('aria-selected', 'false');
  expect(screen.getByRole('heading', { name: /production/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /distribution/i })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /muscle \/ respect/i })).not.toBeInTheDocument();
});

it('switches the left panel between Production and Muscle while retaining Distribution', async () => {
  const user = userEvent.setup();
  render(<NeonDGame />);

  await user.click(screen.getByRole('tab', { name: 'Muscle' }));

  expect(screen.getByRole('tab', { name: 'Muscle' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('heading', { name: /muscle \/ respect/i })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /production/i })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /distribution/i })).toBeInTheDocument();
  const hoodRatRow = screen.getByRole('listitem', { name: 'Hood Rat' });
  expect(hoodRatRow.className).toContain('muscleWorkerRow');
  expect(hoodRatRow).toHaveTextContent('Owned 0');

  await user.click(screen.getByRole('tab', { name: 'Production' }));

  expect(screen.getByRole('tab', { name: 'Production' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('heading', { name: /production/i })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /muscle \/ respect/i })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /distribution/i })).toBeInTheDocument();
});

it('keeps Muscle compact and reveals every later tier on request', async () => {
  const user = userEvent.setup();
  mockState({ cash: 100 });
  render(<NeonDGame />);

  await user.click(screen.getByRole('tab', { name: 'Muscle' }));

  const muscleList = screen.getByRole('list', { name: 'Muscle workers' });
  expect(within(muscleList).getByRole('listitem', { name: 'Hood Rat' })).toBeInTheDocument();
  expect(within(muscleList).getByRole('listitem', { name: 'Young Thug' })).toBeInTheDocument();
  expect(within(muscleList).queryByRole('listitem', { name: 'Hired Goon' })).not.toBeInTheDocument();

  const hoodRatRow = within(muscleList).getByRole('listitem', { name: 'Hood Rat' });
  const youngThugRow = within(muscleList).getByRole('listitem', { name: 'Young Thug' });
  await user.click(within(hoodRatRow).getByRole('button', { name: 'Buy one Hood Rat for $80' }));

  expect(mockNeonD.buyMuscleWorkerMock).toHaveBeenCalledWith('hoodRat');
  expect(
    within(youngThugRow).getByRole('button', { name: /Buy one Young Thug for \$1[.,]000/ }),
  ).toBeDisabled();

  const revealButton = screen.getByRole('button', { name: 'Show all 8 later tiers' });
  expect(revealButton).toHaveAttribute('aria-expanded', 'false');
  expect(revealButton).toHaveAttribute('aria-controls', 'neond-muscle-workers');

  await user.click(revealButton);

  expect(screen.getByRole('button', { name: 'Hide later tiers' })).toHaveAttribute('aria-expanded', 'true');
  expect(within(muscleList).getByRole('listitem', { name: 'Orbital Ion Cannon' })).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Hide later tiers' }));

  expect(within(muscleList).queryByRole('listitem', { name: 'Orbital Ion Cannon' })).not.toBeInTheDocument();
});

it('uses compact Muscle rows and a two-column progression action grid', () => {
  const cssPath = resolve(process.cwd(), 'src/components/NeonD/NeonD.module.css');
  const css = readFileSync(cssPath, 'utf8');

  expect(css).toMatch(
    /\.muscleActionGrid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  );
  expect(css).toMatch(
    /\.muscleWorkerRow\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/,
  );
  expect(css).toMatch(/\.muscleBuyButton\s*\{[\s\S]*width:\s*auto/);
});

it('allocates the left workspace panel row for local vertical scrolling', () => {
  const cssPath = resolve(process.cwd(), 'src/components/NeonD/NeonD.module.css');
  const css = readFileSync(cssPath, 'utf8');

  expect(css).toMatch(/\.leftWorkspace\s*\{[\s\S]*height:\s*100%/);
  expect(css).toMatch(/\.leftWorkspace\s*\{[\s\S]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)/);
  expect(css).toMatch(/\.panel\s*\{[\s\S]*overflow-y:\s*auto/);
  expect(css).toMatch(/\.panel\s*\{[\s\S]*max-height:\s*none/);
});

it('constrains the Distribution panel in its right workspace for local vertical scrolling', () => {
  const cssPath = resolve(process.cwd(), 'src/components/NeonD/NeonD.module.css');
  const css = readFileSync(cssPath, 'utf8');

  expect(css).toMatch(/\.leftWorkspace\s*>\s*\.panel,\s*\.rightWorkspace\s*>\s*\.panel\s*\{[\s\S]*height:\s*100%/);
});

it('uses complete glass-border tokens for the redesigned dividers and progress track', () => {
  const cssPath = resolve(process.cwd(), 'src/components/NeonD/NeonD.module.css');
  const css = readFileSync(cssPath, 'utf8');

  expect(css).toMatch(/\.headerActions\s*\{[^}]*border-left:\s*var\(--glass-border\);/);
  expect(css).toMatch(/\.captainProgressTrack\s*\{[^}]*border:\s*var\(--glass-border\);/);
  expect(css).toMatch(/border-top:\s*var\(--glass-border\);/);
});

it('reflows redesigned controls before they can overflow at narrow widths', () => {
  const cssPath = resolve(process.cwd(), 'src/components/NeonD/NeonD.module.css');
  const css = readFileSync(cssPath, 'utf8');

  expect(css).toMatch(
    /\.primaryMetricValue,\s*\.secondaryMetricValue,\s*\.cashMetricValue\s*\{[^}]*overflow-wrap:\s*anywhere;/,
  );
  expect(css).toMatch(/\.headerActions\s*\{[^}]*flex-wrap:\s*wrap;/);
  expect(css).toMatch(
    /@media \(max-width:\s*1200px\)\s*\{[\s\S]*?\.statsBar\s*\{[^}]*flex-wrap:\s*wrap;[\s\S]*?\.headerActions\s*\{[^}]*width:\s*100%;/,
  );
  expect(css).toMatch(
    /@media \(max-width:\s*900px\)\s*\{[\s\S]*?\.captainMilestone:has\(>\s*\.captainMilestoneCopy\)\s*\{[^}]*grid-template-columns:\s*1fr;/,
  );
  expect(css).toMatch(/\.captainMilestone\s*>\s*button\s*\{[^}]*white-space:\s*normal;/);
});

it('does not render Research Speed', () => {
  render(<NeonDGame />);

  expect(screen.queryByText(/research speed/i)).not.toBeInTheDocument();
});

it('shows producer, stock, production rate, sales rate, and bottleneck delta for Weed', () => {
  render(<NeonDGame />);

  const weedCard = screen.getByRole('article', { name: 'Weed' });
  const productionHeader = weedCard.querySelector('[class*="productionHeader"]');
  expect(productionHeader).toHaveTextContent('Weed');
  expect(productionHeader).toHaveTextContent('$');
  expect(screen.getAllByText(/cannabis plant/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/stock/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/production/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/sales/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/delta/i).length).toBeGreaterThan(0);
  expect(weedCard.querySelector('[class*="productionMetrics"]')).toHaveTextContent('Stock');
  expect(weedCard.querySelector('[class*="productionFlow"]')).toHaveTextContent('Production');
  expect(weedCard.querySelector('[class*="productionFlow"]')).toHaveTextContent('Sales');
  expect(weedCard.querySelector('[class*="productionDelta"]')).toHaveTextContent('Delta');
  expect(weedCard.querySelector('[class*="productionUpIndicator"]')).toHaveAttribute(
    'aria-label',
    'Production increasing',
  );
  expect(weedCard.querySelector('[class*="productionDownIndicator"]')).toHaveAttribute(
    'aria-label',
    'Sales decreasing',
  );
  expect(weedCard.querySelectorAll('[class*="productionSide"]').length).toBe(2);
  expect(within(weedCard).getByRole('button', { name: /buy one cannabis plant/i })).toBeInTheDocument();
});

it('starts Production cards expanded and collapses them independently', async () => {
  const user = userEvent.setup();
  const currentState = mockNeonD.getState();
  mockState({
    production: {
      ...currentState.production,
      mushrooms: {
        ...currentState.production.mushrooms,
        producersOwned: 2,
      },
    },
    unlockedProducts: ['weed', 'mushrooms'],
  });

  render(<NeonDGame />);

  const weedCard = screen.getByRole('article', { name: 'Weed' });
  const mushroomCard = screen.getByRole('article', { name: 'Magic Mushrooms' });
  const collapseWeed = within(weedCard).getByRole('button', { name: 'Collapse Weed production' });

  expect(collapseWeed).toHaveAttribute('aria-expanded', 'true');
  expect(within(weedCard).getByText('Stock')).toBeInTheDocument();
  expect(within(mushroomCard).getByText('Stock')).toBeInTheDocument();

  await user.click(collapseWeed);

  expect(within(weedCard).getByRole('button', { name: 'Expand Weed production' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  const expandWeed = within(weedCard).getByRole('button', { name: 'Expand Weed production' });
  expect(document.getElementById(expandWeed.getAttribute('aria-controls') ?? '')).toBeInTheDocument();
  expect(within(weedCard).getByText('Weed')).toBeInTheDocument();
  expect(within(weedCard).queryByText('Stock')).not.toBeInTheDocument();
  expect(within(weedCard).queryByRole('button', { name: /buy one cannabis plant/i })).not.toBeInTheDocument();
  expect(within(mushroomCard).getByRole('button', { name: 'Collapse Magic Mushrooms production' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(within(mushroomCard).getByText('Stock')).toBeInTheDocument();

  await user.click(within(weedCard).getByRole('button', { name: 'Expand Weed production' }));

  expect(within(weedCard).getByText('Stock')).toBeInTheDocument();
  expect(within(weedCard).getByRole('button', { name: /buy one cannabis plant/i })).toBeInTheDocument();
});

it('keeps a locked Production product name visible while hiding its Research action', async () => {
  const user = userEvent.setup();
  render(<NeonDGame />);

  const mushroomCard = screen.getByRole('article', { name: 'Magic Mushrooms' });
  expect(within(mushroomCard).getByRole('button', { name: /research/i })).toBeInTheDocument();

  await user.click(
    within(mushroomCard).getByRole('button', { name: 'Collapse Magic Mushrooms production' }),
  );

  expect(within(mushroomCard).getByText('Magic Mushrooms')).toBeInTheDocument();
  expect(within(mushroomCard).queryByRole('button', { name: /research/i })).not.toBeInTheDocument();
});

it('keeps production on the left and sales on the right in the card flow', () => {
  const cssPath = resolve(process.cwd(), 'src/components/NeonD/NeonD.module.css');
  const css = readFileSync(cssPath, 'utf8');

  expect(css).toMatch(
    /\.productionFlow\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/,
  );
  expect(css).toMatch(/\.productionSide\s*\{[\s\S]*display:\s*flex/);
  expect(css).toMatch(/\.productionSideSales\s*\{[\s\S]*justify-content:\s*flex-end/);
});

it('shows dealer Volume and Margin ratings, protection loss, and fixed equipment choices', async () => {
  const user = userEvent.setup();
  render(<NeonDGame />);

  expect(screen.getByRole('img', { name: 'Volume: 1.00x' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Margin: 1.00x' })).toBeInTheDocument();
  expect(screen.getByText(/-10% income/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /expand equipment for test dealer/i }));
  expect(screen.getAllByRole('button', { name: /baseball bat/i }).length).toBeGreaterThan(0);
});

it('hides main sales from hired and candidate dealer cards', () => {
  render(<NeonDGame />);

  expect(screen.queryByText('Main sales')).not.toBeInTheDocument();
});

it('starts hired Distribution cards expanded and collapses them independently', async () => {
  const user = userEvent.setup();
  mockState({
    unlockedProducts: ['weed', 'mushrooms'],
    activeDealers: [
      makeReferenceDealer({ id: 'dealer-ui', name: 'Test Dealer', isProtected: true }),
      makeReferenceDealer({ id: 'dealer-two', name: 'Second Dealer', isProtected: false }),
    ],
    lastEarningsPerSeller: {
      'dealer-ui': 8.5,
      'dealer-two': 4.25,
    },
  });

  render(<NeonDGame />);

  const firstCard = screen.getByRole('article', { name: 'Test Dealer distribution' });
  const secondCard = screen.getByRole('article', { name: 'Second Dealer distribution' });
  const collapseFirst = within(firstCard).getByRole('button', {
    name: 'Collapse Test Dealer distribution',
  });

  expect(collapseFirst).toHaveAttribute('aria-expanded', 'true');
  expect(within(firstCard).getByRole('combobox', { name: 'Product for Test Dealer' })).toBeInTheDocument();
  expect(within(secondCard).getByRole('combobox', { name: 'Product for Second Dealer' })).toBeInTheDocument();

  await user.click(collapseFirst);

  expect(within(firstCard).getByText('Test Dealer (Weed)')).toBeInTheDocument();
  expect(within(firstCard).getByText('Earnings')).toBeInTheDocument();
  expect(within(firstCard).getByText('$9/s')).toBeInTheDocument();
  const expandFirst = within(firstCard).getByRole('button', { name: 'Expand Test Dealer distribution' });
  expect(document.getElementById(expandFirst.getAttribute('aria-controls') ?? '')).toBeInTheDocument();
  const compactProductSelect = within(firstCard).getByRole('combobox', { name: 'Product for Test Dealer' });
  await user.click(compactProductSelect);
  await user.click(screen.getByRole('option', { name: 'Magic Mushrooms' }));
  expect(mockNeonD.setSellerProductMock).toHaveBeenCalledWith('dealer-ui', 'mushrooms', 'dealer');
  expect(within(firstCard).queryByRole('img', { name: /volume/i })).not.toBeInTheDocument();
  expect(within(firstCard).queryByRole('button', { name: /protection/i })).not.toBeInTheDocument();
  expect(within(firstCard).queryByRole('button', { name: /equipment/i })).not.toBeInTheDocument();
  expect(within(firstCard).queryByRole('button', { name: /fire dealer/i })).not.toBeInTheDocument();
  expect(within(secondCard).getByRole('button', { name: 'Collapse Second Dealer distribution' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(within(secondCard).getByRole('combobox', { name: 'Product for Second Dealer' })).toBeInTheDocument();

  await user.click(
    within(firstCard).getByRole('button', { name: 'Expand Test Dealer distribution' }),
  );

  expect(within(firstCard).getByRole('combobox', { name: 'Product for Test Dealer' })).toBeInTheDocument();
  expect(within(firstCard).getByRole('button', { name: /fire dealer/i })).toBeInTheDocument();
});

it('restores a collapsed distribution card after the panel remounts', async () => {
  const user = userEvent.setup();
  mockState({
    activeDealers: [makeReferenceDealer({ id: 'dealer-ui', name: 'Test Dealer' })],
  });

  const firstRender = render(<NeonDGame />);
  const firstCard = screen.getByRole('article', { name: 'Test Dealer distribution' });
  await user.click(within(firstCard).getByRole('button', { name: 'Collapse Test Dealer distribution' }));
  expect(localStorage.getItem(NEON_D_CARD_PREFERENCES_KEY)).toContain('dealer-ui');

  firstRender.unmount();
  render(<NeonDGame />);

  const remountedCard = screen.getByRole('article', { name: 'Test Dealer distribution' });
  expect(within(remountedCard).getByRole('button', { name: 'Expand Test Dealer distribution' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

it('keeps captain headers centered while hired dealer headers support collapse controls', () => {
  const cssPath = resolve(process.cwd(), 'src/components/NeonD/NeonD.module.css');
  const css = readFileSync(cssPath, 'utf8');

  expect(css).toMatch(/\.dealerHeader\s*\{[^}]*text-align:\s*center/);
  expect(css).toMatch(/\.collapsibleDealerHeader\s*\{[^}]*display:\s*flex/);
});

it('shows all three candidates in the hiring modal with a manual refresh button', async () => {
  mockState({
    activeDealers: [null],
  });

  const user = userEvent.setup();
  render(<NeonDGame />);

  await user.click(screen.getByRole('button', { name: 'Hire dealers 0/1' }));
  expect(screen.getAllByText(/candidate one/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/candidate two/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/candidate three/i).length).toBeGreaterThan(0);
  expect(screen.getByRole('img', { name: 'Volume: 1.23x' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Margin: 0.87x' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /refresh available/i })).toBeDisabled();
});

it('keeps hired dealer favorite stars while candidate hiring stays in the modal', async () => {
  const user = userEvent.setup();
  mockState({
    activeDealers: [makeReferenceDealer({ id: 'dealer-favorite', name: 'Favorite Dealer' }), null],
    availableDealers: [makeReferenceDealer({ id: 'candidate-favorite', name: 'Candidate Dealer' })],
  });

  render(<NeonDGame />);

  const hiredCard = screen.getByRole('article', { name: 'Favorite Dealer distribution' });
  const hiredStar = within(hiredCard).getByRole('button', { name: 'Favorite Favorite Dealer' });

  expect(hiredStar).toHaveAttribute('aria-pressed', 'false');

  await user.click(hiredStar);

  expect(within(hiredCard).getByRole('button', { name: 'Unfavorite Favorite Dealer' }))
    .toHaveAttribute('aria-pressed', 'true');
  expect(mockNeonD.hireSellerMock).not.toHaveBeenCalled();

  await user.click(within(hiredCard).getByRole('button', { name: 'Unfavorite Favorite Dealer' }));

  expect(within(hiredCard).getByRole('button', { name: 'Favorite Favorite Dealer' }))
    .toHaveAttribute('aria-pressed', 'false');
});

it('keeps owned dealer equipment compact while leaving dealer details visible', async () => {
  const user = userEvent.setup();
  mockState({
    activeDealers: [makeReferenceDealer({ id: 'dealer-ui', isProtected: false })],
  });

  render(<NeonDGame />);

  const dealerCard = screen.getByText(/test dealer/i).closest('article');
  expect(dealerCard).not.toBeNull();
  const dealer = within(dealerCard as HTMLElement);
  expect(dealer.getByText(/test dealer/i)).toBeInTheDocument();
  expect(dealer.getByText(/volume/i)).toBeInTheDocument();
  expect(dealer.getByText(/unprotected/i)).toBeInTheDocument();
  expect(dealer.getByRole('button', { name: /expand equipment for test dealer/i })).toBeInTheDocument();
  expect(dealer.queryByRole('button', { name: /baseball bat/i })).not.toBeInTheDocument();

  await user.click(dealer.getByRole('button', { name: /expand equipment for test dealer/i }));

  expect(dealer.getByRole('button', { name: /baseball bat/i })).toBeInTheDocument();
  expect(dealer.getByRole('button', { name: /collapse equipment for test dealer/i })).toBeInTheDocument();

  await user.click(dealer.getByRole('button', { name: /collapse equipment for test dealer/i }));

  expect(dealer.queryByRole('button', { name: /baseball bat/i })).not.toBeInTheDocument();
});

it('shows talent-derived Captain ratings and hides compatibility equipment controls', () => {
  mockState({
    cash: 10_000_000,
    captains: [makeReferenceCaptain({
      id: 'captain-ui',
      name: 'Captain UI',
      equipmentIds: ['bicycle'],
      level: 0,
    })],
  });

  render(<NeonDGame />);

  const captainCard = screen.getByRole('article', { name: 'Captain UI distribution' });
  expect(within(captainCard).getByRole('img', { name: 'Volume: 1.75x' })).toBeInTheDocument();
  expect(within(captainCard).getByRole('img', { name: 'Margin: 1.75x' })).toBeInTheDocument();
  expect(within(captainCard).queryByRole('button', { name: /equipment/i })).not.toBeInTheDocument();
});

it('collapses Captain cards independently while retaining product and earnings controls', async () => {
  const user = userEvent.setup();
  mockState({
    unlockedProducts: ['weed', 'mushrooms'],
    captains: [
      makeReferenceCaptain({ id: 'captain-one', name: 'Captain One' }),
      makeReferenceCaptain({ id: 'captain-two', name: 'Captain Two' }),
    ],
    lastEarningsPerSeller: { 'captain-one': 12.5, 'captain-two': 7.25 },
  });

  render(<NeonDGame />);

  const firstCard = screen.getByRole('article', { name: 'Captain One distribution' });
  const secondCard = screen.getByRole('article', { name: 'Captain Two distribution' });
  const collapseFirst = within(firstCard).getByRole('button', { name: 'Collapse Captain One distribution' });
  expect(collapseFirst).toHaveAttribute('aria-expanded', 'true');
  expect(document.getElementById(collapseFirst.getAttribute('aria-controls') ?? '')).toBeInTheDocument();
  expect(within(firstCard).getByRole('img', { name: /Volume:/ })).toBeInTheDocument();

  await user.click(collapseFirst);

  expect(within(firstCard).getByRole('button', { name: 'Expand Captain One distribution' })).toHaveAttribute('aria-expanded', 'false');
  expect(within(firstCard).getByText('Captain One (Weed)')).toBeInTheDocument();
  expect(within(firstCard).getByText('$13/s')).toBeInTheDocument();
  expect(within(firstCard).getByRole('combobox', { name: 'Product for Captain One' })).toBeInTheDocument();
  expect(within(firstCard).queryByRole('img', { name: /Volume:/ })).not.toBeInTheDocument();
  expect(within(secondCard).getByRole('button', { name: 'Collapse Captain Two distribution' })).toHaveAttribute('aria-expanded', 'true');

  await user.click(within(firstCard).getByRole('combobox', { name: 'Product for Captain One' }));
  await user.click(screen.getByRole('option', { name: 'Magic Mushrooms' }));
  expect(mockNeonD.setSellerProductMock).toHaveBeenCalledWith('captain-one', 'mushrooms', 'captain');

  await user.click(within(firstCard).getByRole('button', { name: 'Expand Captain One distribution' }));
  expect(within(firstCard).getByRole('img', { name: /Volume:/ })).toBeInTheDocument();
});

it('shows stats and product controls for an assigned Captain card', async () => {
  const user = userEvent.setup();
  const assignedCaptain = makeReferenceCaptain({
    id: 'captain-assigned',
    name: 'Assigned Captain',
    personalEarnings: 250_000,
  });
  mockState({
    activeDealers: [{ ...assignedCaptain, personalEarnings: 0 }],
    captains: [assignedCaptain],
    unlockedProducts: ['weed', 'mushrooms'],
  });

  render(<NeonDGame />);

  const captainCard = screen.getByRole('article', { name: 'Assigned Captain distribution' });
  expect(within(captainCard).getByRole('button', { name: 'Collapse Assigned Captain distribution' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(within(captainCard).getByRole('img', { name: /Volume:/ })).toBeInTheDocument();
  expect(within(captainCard).getByText('Personal earnings').parentElement?.textContent?.replace(/\D/g, ''))
    .toBe('250000');

  await user.click(within(captainCard).getByRole('combobox', { name: 'Product for Assigned Captain' }));
  await user.click(screen.getByRole('option', { name: 'Magic Mushrooms' }));
  expect(mockNeonD.setSellerProductMock).toHaveBeenCalledWith('captain-assigned', 'mushrooms', 'captain');
});

it('shows the Captain prestige controls and invokes buyCaptain', async () => {
  const user = userEvent.setup();
  mockState({
    cash: CAPTAIN_COSTS[1],
    runEarnings: CAPTAIN_VISIBLE_EARNINGS,
  });

  render(<NeonDGame />);
  await user.click(screen.getByRole('button', { name: /hire captain/i }));

  expect(mockNeonD.buyCaptainMock).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Captain name' })).toHaveValue('Captain 2');
  await user.click(screen.getByRole('button', { name: 'Confirm Captain name' }));

  expect(screen.getByText(/captain ui/i)).toBeInTheDocument();
  expect(screen.getByText(/level 0/i)).toBeInTheDocument();
  expect(mockNeonD.buyCaptainMock).toHaveBeenCalledWith('Captain 2');
});

it('shows manual Captain level claims and opens the Talent Ledger in place', async () => {
  const user = userEvent.setup();
  mockState({
    captains: [makeReferenceCaptain({
      id: 'captain-ledger',
      name: 'Captain Ledger',
      personalEarnings: 950_000,
      level: 1,
      talentPoints: 1,
      ledgerUnlocked: true,
    })],
  });

  render(<NeonDGame />);

  const card = screen.getByRole('article', { name: 'Captain Ledger distribution' });
  await user.click(within(card).getByRole('button', { name: 'Level Up' }));
  expect(mockNeonD.claimCaptainLevelMock).toHaveBeenCalledWith('captain-ledger');

  await user.click(within(card).getByRole('button', { name: 'Open talents for Captain Ledger' }));
  expect(screen.getByRole('dialog', { name: /Captain Ledger/ })).toBeInTheDocument();
  expect(screen.getByRole('article', { name: 'Captain Ledger distribution' })).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /Margin.*0\/2.*available/i }));
  expect(mockNeonD.purchaseCaptainTalentMock).toHaveBeenCalledWith('captain-ledger', 'red', 0);
});

it('shows the remaining Captain earnings needed for the next level', () => {
  mockState({
    captains: [makeReferenceCaptain({
      id: 'captain-countdown',
      name: 'Captain Countdown',
      personalEarnings: 125_000,
      level: 0,
    })],
  });

  render(<NeonDGame />);

  const card = screen.getByRole('article', { name: 'Captain Countdown distribution' });
  const threshold = within(card).getByText(/to level/);
  expect(threshold.textContent?.replace(/\D/g, '')).toBe('375000');
  const personalEarnings = within(card).getByText('Personal earnings').parentElement;
  expect(personalEarnings?.textContent?.replace(/\D/g, '')).toBe('125000');
  expect(within(card).queryByRole('button', { name: 'Level Up' })).not.toBeInTheDocument();
});

it('shows zero remaining Captain earnings while keeping Level Up manual', () => {
  mockState({
    captains: [makeReferenceCaptain({
      id: 'captain-ready',
      name: 'Captain Ready',
      personalEarnings: 500_000,
      level: 0,
    })],
  });

  render(<NeonDGame />);

  const card = screen.getByRole('article', { name: 'Captain Ready distribution' });
  expect(within(card).getByText('$0 to level')).toBeInTheDocument();
  expect(within(card).getByRole('button', { name: 'Level Up' })).toBeInTheDocument();
});

it('does not start the next Captain level until the current claim is pressed', () => {
  mockState({
    captains: [makeReferenceCaptain({
      id: 'captain-boundary',
      name: 'Captain Boundary',
      personalEarnings: 750_000,
      level: 0,
      lastLevelUpEarnings: 0,
    })],
  });

  const { rerender } = render(<NeonDGame />);
  let card = screen.getByRole('article', { name: 'Captain Boundary distribution' });
  expect(within(card).getByRole('button', { name: 'Level Up' })).toBeInTheDocument();
  expect(within(card).getByText('$0 to level')).toBeInTheDocument();

  mockState({
    captains: [makeReferenceCaptain({
      id: 'captain-boundary',
      name: 'Captain Boundary',
      personalEarnings: 750_000,
      level: 1,
      lastLevelUpEarnings: 750_000,
      talentPoints: 1,
      ledgerUnlocked: true,
    })],
  });
  rerender(<NeonDGame />);
  card = screen.getByRole('article', { name: 'Captain Boundary distribution' });
  expect(within(card).queryByRole('button', { name: 'Level Up' })).not.toBeInTheDocument();
  const threshold = within(card).getByText(/to level/);
  expect(threshold.textContent?.replace(/\D/g, '')).toBe('450000');
});

it('keeps the Talent Ledger locked before the first claimed level', () => {
  mockState({ captains: [makeReferenceCaptain({ id: 'captain-locked', name: 'Captain Locked' })] });
  render(<NeonDGame />);

  expect(screen.getByRole('button', { name: 'Talents locked for Captain Locked' })).toBeDisabled();
});

it('does not show a global Bulk control while still showing Captain progression', () => {
  mockState({
    cash: CAPTAIN_COSTS[1],
    runEarnings: 7_500_000,
  });

  render(<NeonDGame />);

  expect(screen.queryByRole('button', { name: /bulk.*141[.,]592/i })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /hire captain/i })).toBeInTheDocument();
});

it('shows the per-product Bulk purchase only after all product upgrades are owned', () => {
  mockState({
    cash: 10_000_000,
    production: {
      ...createBaseGameState(Date.now()).production,
      weed: { stock: 100, producersOwned: 5, purchasedUpgradeIds: ['fertilizer', 'hydroponics'] },
    },
  });

  render(<NeonDGame />);

  expect(screen.getByRole('button', { name: /unlock bulk selling.*141[.,]592/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /bulk sell overflow/i })).not.toBeInTheDocument();
});

it('renders manual bulk controls once and labels each producer purchase as one producer', () => {
  mockState({
    cash: 10_000_000,
    runEarnings: 7_500_000,
    bulkUnlockedProductIds: ['weed'],
    unlockedProducts: ['weed', 'mushrooms'],
  });

  render(<NeonDGame />);

  expect(screen.getAllByRole('button', { name: /buy one cannabis plant/i })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: /auto bulk/i })).not.toBeInTheDocument();
});

it('disables manual bulk selling and shows the remaining cooldown', () => {
  const now = Date.now();
  mockState({
    bulkUnlockedProductIds: ['weed'],
    lastTickAt: now,
    lastBulkSellAt: now - 1_000,
    production: {
      ...createBaseGameState(now).production,
      weed: { stock: 1_500, producersOwned: 0, purchasedUpgradeIds: [] },
    },
  });

  render(<NeonDGame />);

  const bulkButton = screen.getByRole('button', { name: /bulk sell overflow/i });
  expect(bulkButton).toBeDisabled();
  expect(bulkButton).toHaveTextContent('Bulk sell overflow — 20m cooldown');
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

it('formats sub-minute simulated durations with seconds and exposes the summary as a dialog', () => {
  mockState({
    offlineEarningsSummary: {
      actualAwayMs: 45_000,
      simulatedMs: 45_000,
      cashEarned: 12,
      respectEarned: 3,
    },
  });

  render(<NeonDGame />);

  expect(screen.getByRole('dialog', { name: 'Welcome back' })).toBeInTheDocument();
  expect(screen.getByText('45s simulated')).toBeInTheDocument();
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

it('shows bail and fire actions for arrested dealers and keeps their compact summary', async () => {
  const user = userEvent.setup();
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

  const arrestedCard = screen.getByRole('article', { name: 'Arrested Dealer distribution' });
  await user.click(
    within(arrestedCard).getByRole('button', { name: 'Collapse Arrested Dealer distribution' }),
  );

  expect(within(arrestedCard).getByText('Arrested Dealer (Weed)')).toBeInTheDocument();
  expect(within(arrestedCard).getByText('Earnings')).toBeInTheDocument();
  expect(within(arrestedCard).getByText('$0/s')).toBeInTheDocument();
  expect(within(arrestedCard).getByRole('combobox', { name: 'Product for Arrested Dealer' })).toBeInTheDocument();
  expect(within(arrestedCard).queryByText('Status')).not.toBeInTheDocument();
  expect(within(arrestedCard).queryByRole('button', { name: /pay bail/i })).not.toBeInTheDocument();
  expect(within(arrestedCard).queryByRole('button', { name: /fire dealer/i })).not.toBeInTheDocument();
});
