import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createBaseGameState } from '../constants';
import { DistributionPanel } from '../DistributionPanel';
import { makeReferenceCaptain, makeReferenceDealer } from './testFixtures';
import type { GameState } from '../types';

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
  buyDealerCapacity: vi.fn(),
  claimCaptainLevel: vi.fn(),
  purchaseCaptainTalent: vi.fn(),
  promoteCaptain: vi.fn(),
};

describe('DistributionPanel hiring entry point', () => {
  it('shows plain capacity text without the refresh countdown when all slots are occupied', () => {
    render(
      <DistributionPanel
        {...panelProps}
        state={{
          ...state,
          activeDealers: [makeReferenceDealer({ id: 'hired-dealer', name: 'Hired Dealer' })],
        }}
      />,
    );

    expect(screen.getByText('Hire dealers 1/1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hire dealers 1/1' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Next refresh in/i)).not.toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: 'View unassigned Captains' }));

    const management = screen.getByRole('dialog', { name: /Distribution hiring/ });
    await user.click(within(management).getByRole('tab', { name: 'Captains' }));
    expect(within(management).getByText('Captain Five')).toBeInTheDocument();
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

    expect(within(amsterdam).getByText('AMSTERDAM · 1 Captain · 1 / 3 Dealers')).toBeInTheDocument();
    expect(within(paris).getByText('PARIS · 0 Captain · 0 / 1 Dealers')).toBeInTheDocument();
    expect(within(amsterdam).getByText('Zone earnings')).toBeInTheDocument();
    expect(within(amsterdam).getByText('$150/s')).toBeInTheDocument();
    expect(screen.getByText('Hire dealers 1/4 · 1 reserved')).toBeInTheDocument();

    const content = amsterdam.textContent ?? '';
    expect(content.indexOf('AMSTERDAM · 1 Captain · 1 / 3 Dealers')).toBeLessThan(content.indexOf('Zone earnings'));
    expect(content.indexOf('Zone earnings')).toBeLessThan(content.indexOf('Amsterdam Captain'));
    expect(content.indexOf('Amsterdam Captain')).toBeLessThan(content.indexOf('Amsterdam Dealer'));
    expect(content.indexOf('Amsterdam Dealer')).toBeLessThan(content.indexOf('Transfer reserved'));
    expect(content.indexOf('Transfer reserved')).toBeLessThan(content.indexOf('Dealer spot available'));
    expect(content.indexOf('Dealer spot available')).toBeLessThan(content.indexOf('Add dealer capacity'));
  });

  it('keeps the zone header and earnings visible when a zone is collapsed', async () => {
    const user = userEvent.setup();
    renderZonePanel();

    const amsterdam = screen.getByRole('article', { name: 'Amsterdam distribution' });
    await user.click(within(amsterdam).getByRole('button', { name: 'Collapse Amsterdam distribution' }));

    expect(within(amsterdam).getByRole('button', { name: 'Expand Amsterdam distribution' })).toHaveAttribute('aria-expanded', 'false');
    expect(within(amsterdam).getByText('AMSTERDAM · 1 Captain · 1 / 3 Dealers')).toBeInTheDocument();
    expect(within(amsterdam).getByText('Zone earnings')).toBeInTheDocument();
    expect(within(amsterdam).getByText('$150/s')).toBeInTheDocument();
    expect(within(amsterdam).queryByText('Amsterdam Captain (Weed)')).not.toBeInTheDocument();
    expect(within(amsterdam).queryByText('Amsterdam Dealer (Weed)')).not.toBeInTheDocument();
    expect(within(amsterdam).queryByText('Transfer reserved')).not.toBeInTheDocument();
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
});
