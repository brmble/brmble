import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
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

it('constrains the Distribution panel for local vertical scrolling', () => {
  const cssPath = resolve(process.cwd(), 'src/components/NeonD/NeonD.module.css');
  const css = readFileSync(cssPath, 'utf8');

  expect(css).toMatch(/\.leftWorkspace\s*>\s*\.panel,\s*\.gameplayGrid\s*>\s*\.panel\s*\{[\s\S]*height:\s*100%/);
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

it('keeps captain headers centered while hired dealer headers support collapse controls', () => {
  const cssPath = resolve(process.cwd(), 'src/components/NeonD/NeonD.module.css');
  const css = readFileSync(cssPath, 'utf8');

  expect(css).toMatch(/\.dealerHeader\s*\{[^}]*text-align:\s*center/);
  expect(css).toMatch(/\.collapsibleDealerHeader\s*\{[^}]*display:\s*flex/);
});

it('shows all three auto-refreshed candidates without a manual refresh button', () => {
  mockState({
    activeDealers: [null],
  });

  render(<NeonDGame />);

  expect(screen.getByText(/candidate one/i)).toBeInTheDocument();
  expect(screen.getByText(/candidate two/i)).toBeInTheDocument();
  expect(screen.getByText(/candidate three/i)).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Volume: 1.23x' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Margin: 0.87x' })).toBeInTheDocument();
  expect(screen.getByText(/next candidates in/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /refresh/i })).not.toBeInTheDocument();
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

it('renders global bulk controls once and labels each producer purchase as one producer', () => {
  mockState({
    cash: 10_000_000,
    runEarnings: 7_500_000,
    bulkUnlocked: true,
    unlockedProducts: ['weed', 'mushrooms'],
  });

  render(<NeonDGame />);

  expect(screen.getAllByRole('button', { name: /buy one cannabis plant/i })).toHaveLength(1);
  expect(screen.getByRole('button', { name: /auto bulk off/i })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /auto bulk off/i })).toHaveLength(1);
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
