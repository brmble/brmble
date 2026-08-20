import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createBaseGameState } from '../constants';
import { DistributionPanel } from '../DistributionPanel';
import { makeReferenceCaptain, makeReferenceDealer } from './testFixtures';
import type { GameState } from '../types';
import { createAmsterdamZone } from '../zones';

const formatRespect = (value: number) => Math.round(value).toLocaleString();

const state = {
  ...createBaseGameState(0),
  activeDealers: [makeReferenceDealer({ id: 'occupied-dealer', name: 'Occupied Dealer' }), null],
  availableDealers: [
    makeReferenceDealer({ id: 'candidate-1' }),
    makeReferenceDealer({ id: 'candidate-2' }),
    makeReferenceDealer({ id: 'candidate-3' }),
  ],
};

const panelProps = {
  onHireSeller: vi.fn(),
  onHireDealer: vi.fn(),
  onRefreshDealers: vi.fn(),
  onRecruitCaptain: vi.fn(),
  onUnlockZone: vi.fn(),
  onRenameCaptain: vi.fn(),
  fireDealer: vi.fn(),
  setSellerProduct: vi.fn(),
  buySellerEquipment: vi.fn(),
  toggleDealerProtection: vi.fn(),
  payDealerBail: vi.fn(),
  buyTerritory: vi.fn(),
  buyDealerCapacity: vi.fn(),
  claimCaptainLevel: vi.fn(),
  purchaseCaptainTalent: vi.fn(),
  promoteCaptain: vi.fn(),
  captainZoneBulkSell: vi.fn(),
  transferDealer: vi.fn(),
};

describe('DistributionPanel hiring entry point', () => {
  it('keeps a filled legacy roster clickable so the hiring menu can manage capacity', async () => {
    const user = userEvent.setup();
    render(
      <DistributionPanel
        {...panelProps}
        state={{
          ...state,
          activeDealers: [makeReferenceDealer({ id: 'hired-dealer', name: 'Hired Dealer' })],
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Hire dealers 1/1' }));

    expect(screen.getByRole('dialog', { name: 'Hire seller for Slot 1' })).toBeInTheDocument();
  });

  it('shows and purchases legacy capacity in the filled-roster hiring dialog', async () => {
    const user = userEvent.setup();
    const buyTerritory = vi.fn();
    render(
      <DistributionPanel
        {...panelProps}
        buyTerritory={buyTerritory}
        state={{
          ...state,
          respect: 500,
          activeDealers: [makeReferenceDealer({ id: 'hired-dealer', name: 'Hired Dealer' })],
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Hire dealers 1/1' }));

    await user.click(screen.getByRole('button', { name: 'Territory 0 · Capacity 1 - 500 Respect' }));

    expect(buyTerritory).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Next refresh in/i)).not.toBeInTheDocument();
  });

  it('uses the newly purchased legacy slot without reopening hiring', async () => {
    const user = userEvent.setup();
    const onHireDealer = vi.fn();
    const initialState: GameState = {
      ...state,
      respect: 500,
      activeDealers: [makeReferenceDealer({ id: 'hired-dealer', name: 'Hired Dealer' })],
    };

    function LegacyCapacityHarness() {
      const [gameState, setGameState] = useState(initialState);
      return (
        <DistributionPanel
          {...panelProps}
          state={gameState}
          onHireDealer={onHireDealer}
          buyTerritory={() => setGameState((current) => ({
            ...current,
            respect: current.respect - 500,
            territoryLevel: current.territoryLevel + 1,
            activeDealers: [...current.activeDealers, null],
          }))}
        />
      );
    }

    render(<LegacyCapacityHarness />);

    await user.click(screen.getByRole('button', { name: 'Hire dealers 1/1' }));
    expect(screen.getAllByRole('button', { name: 'Hire Test Dealer' })[0]).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Territory 0 · Capacity 1 - 500 Respect' }));
    await user.click(screen.getAllByRole('button', { name: 'Hire Test Dealer to Slot 2' })[0]);

    expect(onHireDealer).toHaveBeenCalledWith('candidate-1', { kind: 'legacy', slotIndex: 1 });
  });

  it('keeps an unassigned Captain roster entry point when all slots are occupied', async () => {
    const user = userEvent.setup();
    const unassignedCaptain = makeReferenceCaptain({
      id: 'unassigned-captain',
      name: 'Captain Five',
    });

    render(
      <DistributionPanel
        {...panelProps}
        state={{
          ...state,
          activeDealers: [makeReferenceDealer({ id: 'hired-dealer', name: 'Hired Dealer' })],
          captains: [unassignedCaptain],
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Hire dealers 1/1' }));

    const management = screen.getByRole('dialog', { name: /Distribution hiring/ });
    await user.click(within(management).getByRole('tab', { name: 'Captains' }));
    expect(within(management).getByText('Captain Five')).toBeInTheDocument();
    expect(within(management).getByRole('button', { name: 'Recruit Captain' })).toBeInTheDocument();
  });

  it('keeps Captain recruitment reachable when all zone dealer slots and Captains are assigned', async () => {
    const user = userEvent.setup();
    const captain = makeReferenceCaptain({ id: 'assigned-captain', name: 'Assigned Captain' });

    render(
      <DistributionPanel
        {...panelProps}
        state={{
          ...state,
          captains: [captain],
          zones: [{
            id: 'amsterdam',
            displayName: 'Amsterdam',
            captainId: captain.id,
            dealerSlots: [{
              id: 'amsterdam-slot-1',
              dealer: makeReferenceDealer({ id: 'zone-dealer', name: 'Zone Dealer' }),
              reservedTransferId: null,
            }],
            perkIds: [],
          }],
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Hire dealers 1/1' }));

    const management = screen.getByRole('dialog', { name: /Distribution hiring/ });
    await user.click(within(management).getByRole('tab', { name: 'Captains' }));
    expect(within(management).getByRole('button', { name: 'Recruit Captain' })).toBeInTheDocument();
  });

  it('uses the capacity summary button to open the first empty slot', async () => {
    const user = userEvent.setup();
    render(
      <DistributionPanel
        {...panelProps}
        state={state}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Hire dealers 1/2' }));

    expect(screen.getByRole('dialog', { name: 'Hire seller for Slot 2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hire seller for Slot 2' })).not.toBeInTheDocument();
  });

  it('keeps the empty slot visible without rendering unassigned Captain cards', () => {
    const unassignedCaptain = makeReferenceCaptain({
      id: 'unassigned-captain',
      name: 'Captain Five',
    });

    render(
      <DistributionPanel
        {...panelProps}
        state={{
          ...state,
          activeDealers: [null],
          captains: [unassignedCaptain],
        }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Hire dealers 0/1' })).toBeInTheDocument();
    expect(screen.getByText('Slot 1 - Empty')).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Captain Five distribution' })).not.toBeInTheDocument();
  });
});

describe('Captain card rename control', () => {
  const captain = makeReferenceCaptain({ id: 'captain-rename', name: 'Captain Rename' });

  const renderCaptainPanel = (
    overrides: Partial<typeof state> = {},
    onRenameCaptain = vi.fn(),
  ) => {
    render(
      <DistributionPanel
        {...panelProps}
        onRenameCaptain={onRenameCaptain}
        state={{
          ...state,
          activeDealers: [null, { ...captain, id: 'captain-assigned', name: 'Assigned Captain' }],
          captains: [captain, { ...captain, id: 'captain-assigned', name: 'Assigned Captain' }],
          ...overrides,
        }}
      />,
    );
    return onRenameCaptain;
  };

  it('shows a rename button for assigned Captain cards only', () => {
    renderCaptainPanel();

    expect(screen.getByRole('button', { name: 'Rename Assigned Captain' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rename Captain Rename' })).not.toBeInTheDocument();
  });

  it('opens the current name, commits a trimmed name, and closes the editor', async () => {
    const user = userEvent.setup();
    const onRenameCaptain = renderCaptainPanel();

    await user.click(screen.getByRole('button', { name: 'Rename Assigned Captain' }));
    const input = screen.getByRole('textbox', { name: 'Name for Assigned Captain' });
    expect(input).toHaveValue('Assigned Captain');

    await user.clear(input);
    await user.type(input, '  Nightshade  ');
    await user.keyboard('{Enter}');

    expect(onRenameCaptain).toHaveBeenCalledWith('captain-assigned', 'Nightshade');
    expect(screen.queryByRole('textbox', { name: 'Name for Assigned Captain' })).not.toBeInTheDocument();
  });

  it('cancels with Escape without renaming', async () => {
    const user = userEvent.setup();
    const onRenameCaptain = renderCaptainPanel();

    await user.click(screen.getByRole('button', { name: 'Rename Assigned Captain' }));
    const input = screen.getByRole('textbox', { name: 'Name for Assigned Captain' });
    await user.clear(input);
    await user.type(input, 'Temporary');
    await user.keyboard('{Escape}');

    expect(onRenameCaptain).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Name for Assigned Captain' })).not.toBeInTheDocument();
  });

  it('rejects a whitespace-only name when the editor loses focus', async () => {
    const user = userEvent.setup();
    const onRenameCaptain = renderCaptainPanel();

    await user.click(screen.getByRole('button', { name: 'Rename Assigned Captain' }));
    const input = screen.getByRole('textbox', { name: 'Name for Assigned Captain' });
    await user.clear(input);
    await user.type(input, '   ');
    await user.tab();

    expect(onRenameCaptain).not.toHaveBeenCalled();
  });
});

describe('DistributionPanel zone groups', () => {
  const amsterdamCaptain = makeReferenceCaptain({
    id: 'amsterdam-captain',
    name: 'Amsterdam Captain',
  });
  const amsterdamDealer = makeReferenceDealer({
    id: 'amsterdam-dealer',
    name: 'Amsterdam Dealer',
  });

  const createZoneState = (): GameState => ({
    ...createBaseGameState(0),
    respect: 10_000,
    activeDealers: [],
    captains: [amsterdamCaptain],
    availableDealers: [makeReferenceDealer({ id: 'zone-candidate', name: 'Zone Candidate' })],
    zones: [
      {
        id: 'amsterdam',
        displayName: 'Amsterdam',
        captainId: amsterdamCaptain.id,
        dealerSlots: [
          { id: 'amsterdam-slot-1', dealer: amsterdamDealer, reservedTransferId: null },
          { id: 'amsterdam-slot-2', dealer: null, reservedTransferId: 'transfer-amsterdam' },
          { id: 'amsterdam-slot-3', dealer: null, reservedTransferId: null },
        ],
        perkIds: [],
      },
      {
        id: 'paris',
        displayName: 'Paris',
        captainId: null,
        dealerSlots: [{ id: 'paris-slot-1', dealer: null, reservedTransferId: null }],
        perkIds: [],
      },
    ],
    lastEarningsPerSeller: {
      [amsterdamCaptain.id]: 100,
      [amsterdamDealer.id]: 50,
    },
  });

  const renderZonePanel = (buyDealerCapacity = vi.fn()) => {
    render(
      <DistributionPanel
        {...panelProps}
        buyDealerCapacity={buyDealerCapacity}
        state={createZoneState()}
      />,
    );
    return buyDealerCapacity;
  };

  it('renders Amsterdam and Paris as ordered zone groups with exact earnings and capacity summary', () => {
    renderZonePanel();

    const amsterdam = screen.getByRole('article', { name: 'Amsterdam distribution' });
    const paris = screen.getByRole('article', { name: 'Paris distribution' });

    expect(within(amsterdam).getByRole('heading', { name: 'AMSTERDAM' })).toBeInTheDocument();
    expect(within(amsterdam).getByText('1 Captain · 1 / 3 Dealers')).toBeInTheDocument();
    expect(within(paris).getByRole('heading', { name: 'PARIS' })).toBeInTheDocument();
    expect(within(paris).getByText('0 Captain · 0 / 1 Dealers')).toBeInTheDocument();
    expect(within(amsterdam).getByText('Zone earnings')).toBeInTheDocument();
    expect(within(amsterdam).getByText('$150/s')).toBeInTheDocument();
    expect(within(amsterdam).getByText('Amsterdam Captain (Weed)')).toBeInTheDocument();
    expect(screen.getByText('Hire dealers 1/4 · 1 reserved')).toBeInTheDocument();

    const content = amsterdam.textContent ?? '';
    expect(content.indexOf('AMSTERDAM')).toBeLessThan(content.indexOf('1 Captain · 1 / 3 Dealers'));
    expect(content.indexOf('1 Captain · 1 / 3 Dealers')).toBeLessThan(content.indexOf('Zone earnings'));
    expect(content.indexOf('Zone earnings')).toBeLessThan(content.indexOf('Amsterdam Captain'));
    expect(content.indexOf('Amsterdam Captain')).toBeLessThan(content.indexOf('Amsterdam Dealer'));
    expect(content.indexOf('Amsterdam Dealer')).toBeLessThan(content.indexOf('Transfer reserved'));
    expect(content.indexOf('Transfer reserved')).toBeLessThan(content.indexOf('Dealer spot available'));
    expect(content.indexOf('Dealer spot available')).toBeLessThan(content.indexOf('Add dealer capacity'));
  });

  it('renders filled dealer slots before free slots within a zone', () => {
    const orderingCaptain = makeReferenceCaptain({ id: 'ordering-captain', name: 'Ordering Captain' });
    const orderingDealer = makeReferenceDealer({ id: 'ordering-dealer', name: 'Ordering Dealer' });
    const orderingState = createZoneState();
    orderingState.captains = [orderingCaptain];
    orderingState.zones = [{
      id: 'amsterdam',
      displayName: 'Amsterdam',
      captainId: orderingCaptain.id,
      dealerSlots: [
        { id: 'amsterdam-slot-0', dealer: null, reservedTransferId: null },
        { id: 'amsterdam-slot-1', dealer: orderingDealer, reservedTransferId: null },
      ],
      perkIds: [],
    }];

    render(<DistributionPanel {...panelProps} state={orderingState} />);

    const amsterdam = screen.getByRole('article', { name: 'Amsterdam distribution' });
    const dealerCard = within(amsterdam).getByLabelText('Ordering Dealer distribution');
    const freeSlot = within(amsterdam).getByText('Dealer spot available');

    expect(dealerCard.compareDocumentPosition(freeSlot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(amsterdam).getByRole('button', { name: 'Hire dealer' })).toBeInTheDocument();
    expect(within(amsterdam).getAllByRole('button', { name: 'Transfer dealer' })).toHaveLength(1);
  });

  it('keeps the zone header and earnings visible when a zone is collapsed', async () => {
    const user = userEvent.setup();
    renderZonePanel();

    const amsterdam = screen.getByRole('article', { name: 'Amsterdam distribution' });
    await user.click(within(amsterdam).getByRole('button', { name: 'Collapse Amsterdam distribution' }));

    expect(within(amsterdam).getByRole('button', { name: 'Expand Amsterdam distribution' })).toHaveAttribute('aria-expanded', 'false');
    expect(within(amsterdam).getByRole('heading', { name: 'AMSTERDAM' })).toBeInTheDocument();
    expect(within(amsterdam).getByText('1 Captain · 1 / 3 Dealers')).toBeInTheDocument();
    expect(within(amsterdam).getByText('Zone earnings')).toBeInTheDocument();
    expect(within(amsterdam).getByText('$150/s')).toBeInTheDocument();
    expect(within(amsterdam).queryByText('Amsterdam Captain (Weed)')).not.toBeInTheDocument();
    expect(within(amsterdam).queryByText('Amsterdam Dealer (Weed)')).not.toBeInTheDocument();
    expect(within(amsterdam).queryByText('Transfer reserved')).not.toBeInTheDocument();
  });

  it('collapses and expands a normal dealer card inside a zone', async () => {
    const user = userEvent.setup();
    renderZonePanel();

    const dealerCard = screen.getByLabelText('Amsterdam Dealer distribution');
    const collapseButton = within(dealerCard).getByRole('button', {
      name: 'Collapse Amsterdam Dealer distribution',
    });

    await user.click(collapseButton);

    expect(within(dealerCard).getByRole('button', {
      name: 'Expand Amsterdam Dealer distribution',
    })).toHaveAttribute('aria-expanded', 'false');
    expect(within(dealerCard).queryByText('Volume')).not.toBeInTheDocument();
    expect(within(dealerCard).getByText('Earnings')).toBeInTheDocument();

    await user.click(within(dealerCard).getByRole('button', {
      name: 'Expand Amsterdam Dealer distribution',
    }));

    expect(within(dealerCard).getByText('Volume')).toBeInTheDocument();
  });

  it('opens hiring for the exact local zone slot and purchases local capacity', async () => {
    const user = userEvent.setup();
    const buyDealerCapacity = renderZonePanel();
    const amsterdam = screen.getByRole('article', { name: 'Amsterdam distribution' });

    await user.click(within(amsterdam).getByRole('button', { name: 'Hire dealer' }));
    await user.click(screen.getByRole('button', { name: 'Hire Zone Candidate' }));

    expect(panelProps.onHireDealer).toHaveBeenCalledWith('zone-candidate', {
      kind: 'zone',
      zoneId: 'amsterdam',
      slotId: 'amsterdam-slot-3',
    });

    await user.click(within(amsterdam).getByRole('button', { name: /Add dealer capacity/ }));
    expect(buyDealerCapacity).toHaveBeenCalledWith('amsterdam');
  });

  it('keeps one-Captain Amsterdam on normal capacity pricing past three slots', () => {
    const oneCaptainState = createZoneState();
    oneCaptainState.territoryLevel = 2;
    oneCaptainState.captains = [amsterdamCaptain];
    oneCaptainState.zones = [
      createAmsterdamZone(amsterdamCaptain.id, 3),
    ];

    render(
      <DistributionPanel
        {...panelProps}
        state={oneCaptainState}
      />,
    );

    const amsterdam = screen.getByRole('article', {
      name: 'Amsterdam distribution',
    });

    expect(
      within(amsterdam).getByRole('button', {
        name: `Add dealer capacity · ${formatRespect(13_520)} Respect`,
      }),
    ).toBeInTheDocument();
    expect(
      within(amsterdam).queryByText(/concentration cost/i),
    ).not.toBeInTheDocument();
  });

  it('shows the exact local surcharge while another zone remains normal', () => {
    const parisCaptain = makeReferenceCaptain({
      id: 'paris-captain',
      name: 'Paris Captain',
    });
    const multiCaptainState = createZoneState();
    multiCaptainState.territoryLevel = 2;
    multiCaptainState.captains = [amsterdamCaptain, parisCaptain];
    multiCaptainState.zones = [
      createAmsterdamZone(amsterdamCaptain.id, 3),
      {
        id: 'paris',
        displayName: 'Paris',
        captainId: parisCaptain.id,
        dealerSlots: [],
        perkIds: [],
      },
    ];

    render(
      <DistributionPanel
        {...panelProps}
        state={multiCaptainState}
      />,
    );

    const amsterdam = screen.getByRole('article', {
      name: 'Amsterdam distribution',
    });
    const paris = screen.getByRole('article', {
      name: 'Paris distribution',
    });

    expect(
      within(amsterdam).getByRole('button', {
        name: `Add dealer capacity · ${formatRespect(33_800)} Respect`,
      }),
    ).toBeInTheDocument();
    expect(
      within(amsterdam).getByText(
        'Amsterdam is over its 3-dealer operating limit · 2.5× concentration cost',
      ),
    ).toBeInTheDocument();

    expect(
      within(paris).getByRole('button', {
        name: `Add dealer capacity · ${formatRespect(13_520)} Respect`,
      }),
    ).toBeInTheDocument();
    expect(
      within(paris).getByText(
        '3 dealer slots available at normal operating cost',
      ),
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        'Captains do not consume dealer slots. Existing dealers stay in place.',
      ),
    ).toBeInTheDocument();
    expect(
      within(amsterdam).getByText(
        'Paris can expand at normal operating cost.',
      ),
    ).toBeInTheDocument();
  });

  it('renders an existing over-capacity dealer roster unchanged after a second Captain exists', () => {
    const secondCaptain = makeReferenceCaptain({
      id: 'second-captain',
      name: 'Second Captain',
    });
    const dealers = [
      makeReferenceDealer({ id: 'dealer-1', name: 'Dealer One' }),
      makeReferenceDealer({ id: 'dealer-2', name: 'Dealer Two' }),
      makeReferenceDealer({ id: 'dealer-3', name: 'Dealer Three' }),
      makeReferenceDealer({ id: 'dealer-4', name: 'Dealer Four' }),
    ];
    const preservedState = createZoneState();
    preservedState.captains = [amsterdamCaptain, secondCaptain];
    preservedState.zones = [
      createAmsterdamZone(amsterdamCaptain.id, 4, dealers),
    ];

    render(
      <DistributionPanel
        {...panelProps}
        state={preservedState}
      />,
    );

    const amsterdam = screen.getByRole('article', {
      name: 'Amsterdam distribution',
    });
    expect(
      within(amsterdam).getByText(
        '1 Captain · 4 / 4 Dealers',
      ),
    ).toBeInTheDocument();
    expect(within(amsterdam).getByRole('heading', { name: 'AMSTERDAM' })).toBeInTheDocument();

    for (const dealer of dealers) {
      expect(
        within(amsterdam).getByText(`${dealer.name} (Weed)`),
      ).toBeInTheDocument();
    }

    expect(
      screen.queryByRole('dialog', { name: /transfer/i }),
    ).not.toBeInTheDocument();
  });

  it('offers the existing zone unlock flow when opening and initially expanding it costs less', async () => {
    const user = userEvent.setup();
    const secondCaptain = makeReferenceCaptain({
      id: 'unassigned-captain',
      name: 'Second Captain',
    });
    const multiCaptainState = createZoneState();
    multiCaptainState.territoryLevel = 2;
    multiCaptainState.captains = [amsterdamCaptain, secondCaptain];
    multiCaptainState.zones = [
      createAmsterdamZone(amsterdamCaptain.id, 3),
    ];

    render(
      <DistributionPanel
        {...panelProps}
        state={multiCaptainState}
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: `Open another zone · ${formatRespect(15_020)} Respect total`,
      }),
    );

    expect(
      screen.getByRole('dialog', { name: 'Open new zone' }),
    ).toBeInTheDocument();
  });

  it('does not present a new zone as cheaper when its unlock and first slot cost more', () => {
    const parisCaptain = makeReferenceCaptain({ id: 'paris-captain' });
    const berlinCaptain = makeReferenceCaptain({ id: 'berlin-captain' });
    const unassignedCaptain = makeReferenceCaptain({ id: 'unassigned-captain' });
    const state = createZoneState();
    state.territoryLevel = 2;
    state.captains = [
      amsterdamCaptain,
      parisCaptain,
      berlinCaptain,
      unassignedCaptain,
    ];
    state.zones = [
      createAmsterdamZone(amsterdamCaptain.id, 3),
      {
        id: 'paris',
        displayName: 'Paris',
        captainId: parisCaptain.id,
        dealerSlots: [
          { id: 'paris-slot-0', dealer: null, reservedTransferId: null },
          { id: 'paris-slot-1', dealer: null, reservedTransferId: null },
          { id: 'paris-slot-2', dealer: null, reservedTransferId: null },
        ],
        perkIds: [],
      },
      {
        id: 'berlin',
        displayName: 'Berlin',
        captainId: berlinCaptain.id,
        dealerSlots: [
          { id: 'berlin-slot-0', dealer: null, reservedTransferId: null },
          { id: 'berlin-slot-1', dealer: null, reservedTransferId: null },
          { id: 'berlin-slot-2', dealer: null, reservedTransferId: null },
        ],
        perkIds: [],
      },
    ];

    render(<DistributionPanel {...panelProps} state={state} />);

    expect(
      screen.queryByRole('button', {
        name: /Open another zone/i,
      }),
    ).not.toBeInTheDocument();
  });

  it('does not offer a transfer action from an active dealer card', () => {
    renderZonePanel();

    const dealerCard = screen.getByLabelText('Amsterdam Dealer distribution');
    expect(within(dealerCard).queryByRole('button', { name: 'Transfer dealer' })).not.toBeInTheDocument();
  });

  it('starts a transfer into the exact vacant Rome slot while keeping hiring available', async () => {
    const user = userEvent.setup();
    const transferDealer = vi.fn();
    const zoneState = createZoneState();
    zoneState.zones = [
      {
        id: 'amsterdam',
        displayName: 'Amsterdam',
        captainId: amsterdamCaptain.id,
        dealerSlots: [{ id: 'amsterdam-slot-1', dealer: amsterdamDealer, reservedTransferId: null }],
        perkIds: [],
      },
      {
        id: 'rome',
        displayName: 'Rome',
        captainId: null,
        dealerSlots: [{ id: 'rome-slot-1', dealer: null, reservedTransferId: null }],
        perkIds: [],
      },
    ];

    render(<DistributionPanel {...panelProps} transferDealer={transferDealer} state={zoneState} />);

    const rome = screen.getByRole('article', { name: 'Rome distribution' });
    expect(within(rome).getByRole('button', { name: 'Hire dealer' })).toBeInTheDocument();

    await user.click(within(rome).getByRole('button', { name: 'Transfer dealer' }));

    await user.click(screen.getByRole('combobox', { name: 'Dealer to transfer' }));
    await user.click(screen.getByRole('option', { name: 'Amsterdam Dealer · Amsterdam' }));
    await user.click(screen.getByRole('button', { name: 'Confirm transfer' }));

    expect(transferDealer).toHaveBeenCalledWith('amsterdam-dealer', 'rome', 'rome-slot-1');
  });

  it('does not offer a transfer action for an arrested zone dealer', () => {
    const arrestedDealer = makeReferenceDealer({
      id: 'arrested-zone-dealer',
      isArrested: true,
      earningsPerSecondAtArrest: 10,
    });
    render(
      <DistributionPanel
        {...panelProps}
        state={{
          ...createZoneState(),
          zones: [
            {
              id: 'amsterdam',
              displayName: 'Amsterdam',
              captainId: null,
              dealerSlots: [{ id: 'amsterdam-slot-1', dealer: arrestedDealer, reservedTransferId: null }],
              perkIds: [],
            },
            {
              id: 'paris',
              displayName: 'Paris',
              captainId: null,
              dealerSlots: [{ id: 'paris-slot-1', dealer: null, reservedTransferId: null }],
              perkIds: [],
            },
          ],
        }}
      />,
    );

    const dealerCard = screen.getByLabelText('Test Dealer distribution');
    expect(within(dealerCard).queryByRole('button', { name: 'Transfer dealer' })).not.toBeInTheDocument();
  });

  it('shows pending transfers in both expanded zones while keeping reserved slots unavailable', async () => {
    const user = userEvent.setup();
    const travellingDealer = makeReferenceDealer({ id: 'travelling-dealer', name: 'Travelling Dealer' });
    const transferState: GameState = {
      ...createZoneState(),
      lastTickAt: 30_000,
      dealerTransfers: [{
        id: 'amsterdam-paris',
        dealer: travellingDealer,
        sourceZoneId: 'amsterdam',
        sourceSlotId: 'amsterdam-slot-1',
        destinationZoneId: 'paris',
        destinationSlotId: 'paris-slot-1',
        completesAt: 120_000,
        riskResolved: false,
      }],
      zones: [
        {
          id: 'amsterdam',
          displayName: 'Amsterdam',
          captainId: amsterdamCaptain.id,
          dealerSlots: [{ id: 'amsterdam-slot-1', dealer: null, reservedTransferId: 'amsterdam-paris' }],
          perkIds: [],
        },
        {
          id: 'paris',
          displayName: 'Paris',
          captainId: null,
          dealerSlots: [{ id: 'paris-slot-1', dealer: null, reservedTransferId: 'amsterdam-paris' }],
          perkIds: [],
        },
      ],
      lastEarningsPerSeller: { [amsterdamCaptain.id]: 100, [travellingDealer.id]: 0 },
    };

    render(<DistributionPanel {...panelProps} state={transferState} />);

    const amsterdam = screen.getByRole('article', { name: 'Amsterdam distribution' });
    const paris = screen.getByRole('article', { name: 'Paris distribution' });
    expect(within(amsterdam).getByRole('heading', { name: 'AMSTERDAM' })).toBeInTheDocument();
    expect(within(amsterdam).getByText(/1 Captain · 0 \/ 1 Dealers · 1 travelling/)).toBeInTheDocument();
    expect(within(paris).getByRole('heading', { name: 'PARIS' })).toBeInTheDocument();
    expect(within(paris).getByText(/0 Captain · 0 \/ 1 Dealers · 1 incoming/)).toBeInTheDocument();
    expect(within(amsterdam).getByText('Travelling Dealer travelling to Paris')).toBeInTheDocument();
    expect(within(paris).getByText('Incoming: Travelling Dealer')).toBeInTheDocument();
    expect(screen.getAllByText('1m 30s')).toHaveLength(2);
    expect(screen.getByText('Hire dealers 0/2 · 2 reserved')).toBeInTheDocument();
    expect(screen.queryByText('Travelling Dealer (Weed)')).not.toBeInTheDocument();
    expect(within(amsterdam).getByText('$100/s')).toBeInTheDocument();
    expect(within(amsterdam).queryByRole('button', { name: 'Hire dealer' })).not.toBeInTheDocument();
    expect(within(paris).queryByRole('button', { name: 'Hire dealer' })).not.toBeInTheDocument();

    await user.click(within(amsterdam).getByRole('button', { name: 'Collapse Amsterdam distribution' }));

    expect(within(amsterdam).queryByText('Travelling Dealer travelling to Paris')).not.toBeInTheDocument();
    expect(within(amsterdam).getByText(/1 travelling/)).toBeInTheDocument();
  });
});

describe('DistributionPanel Captain zone leadership', () => {
  const makeBulkSaleState = (
    captainOverrides: Parameters<typeof makeReferenceCaptain>[0] = {},
    options: {
      lastTickAt?: number;
      secondCaptain?: Parameters<typeof makeReferenceCaptain>[0];
      weedStock?: number;
    } = {},
  ): GameState => {
    const captain = makeReferenceCaptain({
      id: 'bulk-captain',
      name: 'Bulk Captain',
      level: 10,
      talentPoints: 0,
      talentRanks: { red: [2, 3, 4], yellow: [2, 3, 4], blue: [0, 0, 0] },
      ledgerUnlocked: true,
      kingpinAvailable: true,
      ...captainOverrides,
    });
    const secondCaptain = options.secondCaptain
      ? makeReferenceCaptain({
        id: 'second-bulk-captain',
        name: 'Second Bulk Captain',
        level: 10,
        talentPoints: 0,
        talentRanks: { red: [0, 0, 0], yellow: [2, 3, 4], blue: [0, 0, 0] },
        ledgerUnlocked: true,
        kingpinAvailable: true,
        ...options.secondCaptain,
      })
      : null;
    const baseState = createBaseGameState(0);

    return {
      ...baseState,
      lastTickAt: options.lastTickAt ?? 0,
      activeDealers: [],
      captains: secondCaptain ? [captain, secondCaptain] : [captain],
      zones: [
        {
          id: 'amsterdam',
          displayName: 'Amsterdam',
          captainId: captain.id,
          dealerSlots: [],
          perkIds: [],
        },
        ...(secondCaptain ? [{
          id: 'paris' as const,
          displayName: 'Paris',
          captainId: secondCaptain.id,
          dealerSlots: [],
          perkIds: [],
        }] : []),
      ],
      production: {
        ...baseState.production,
        weed: { ...baseState.production.weed, stock: options.weedStock ?? 1_500 },
      },
    };
  };

  it('shows zone leadership effects and leaves bulk selling hidden until the final yellow rank', () => {
    const captain = makeReferenceCaptain({
      talentRanks: { red: [2, 3, 4], yellow: [2, 3, 3], blue: [0, 0, 0] },
    });
    render(<DistributionPanel {...panelProps} captainZoneBulkSell={vi.fn()} state={makeBulkSaleState(captain)} />);

    expect(screen.getByText('Street influence')).toBeInTheDocument();
    expect(screen.getByText('Delivery network')).toBeInTheDocument();
    expect(screen.getByText('Side hustle network')).toBeInTheDocument();
    expect(screen.getByText('Protection coverage')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sell Weed bulk' })).not.toBeInTheDocument();
  });

  it('enables the Captain bulk action only when there is surplus stock and uses the current product name', async () => {
    const user = userEvent.setup();
    const captainZoneBulkSell = vi.fn();
    const { rerender } = render(
      <DistributionPanel {...panelProps} captainZoneBulkSell={captainZoneBulkSell} state={makeBulkSaleState()} />,
    );

    const bulkButton = screen.getByRole('button', { name: 'Sell Weed bulk' });
    expect(bulkButton).toBeEnabled();
    await user.click(bulkButton);
    expect(captainZoneBulkSell).toHaveBeenCalledWith('bulk-captain');

    rerender(
      <DistributionPanel {...panelProps} captainZoneBulkSell={vi.fn()} state={makeBulkSaleState({}, { weedStock: 500 })} />,
    );
    expect(screen.getByRole('button', { name: 'Sell Weed bulk' })).toBeDisabled();
    expect(screen.getByText('Ready')).toBeInTheDocument();

    const cocaineState = makeBulkSaleState({ selling: 'cocaine' });
    cocaineState.unlockedProducts = [...cocaineState.unlockedProducts, 'cocaine'];
    rerender(<DistributionPanel {...panelProps} captainZoneBulkSell={vi.fn()} state={cocaineState} />);
    expect(screen.getByRole('button', { name: 'Sell Cocaine bulk' })).toBeInTheDocument();
  });

  it('shows each Captain\'s own bulk cooldown after a sale', () => {
    render(
      <DistributionPanel
        {...panelProps}
        captainZoneBulkSell={vi.fn()}
        state={makeBulkSaleState(
          { zoneBulkSellAvailableAt: 90_000 },
          { lastTickAt: 30_000, secondCaptain: { zoneBulkSellAvailableAt: 45_000 } },
        )}
      />,
    );

    const amsterdam = screen.getByRole('article', { name: 'Amsterdam distribution' });
    const paris = screen.getByRole('article', { name: 'Paris distribution' });
    expect(within(amsterdam).getByText('1m')).toBeInTheDocument();
    expect(within(paris).getByText('15s')).toBeInTheDocument();
    expect(within(amsterdam).getByRole('button', { name: 'Sell Weed bulk' })).toBeDisabled();
    expect(within(paris).getByRole('button', { name: 'Sell Weed bulk' })).toBeDisabled();
  });
});
