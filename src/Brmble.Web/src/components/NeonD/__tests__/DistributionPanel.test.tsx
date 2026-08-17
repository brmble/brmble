import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createBaseGameState } from '../constants';
import { DistributionPanel } from '../DistributionPanel';
import { makeReferenceCaptain, makeReferenceDealer } from './testFixtures';

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
  onRefreshDealers: vi.fn(),
  onRenameCaptain: vi.fn(),
  fireDealer: vi.fn(),
  setSellerProduct: vi.fn(),
  buySellerEquipment: vi.fn(),
  toggleDealerProtection: vi.fn(),
  payDealerBail: vi.fn(),
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

  it('shows a rename button for assigned and unassigned Captain cards', () => {
    renderCaptainPanel();

    expect(screen.getByRole('button', { name: 'Rename Captain Rename' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename Assigned Captain' })).toBeInTheDocument();
  });

  it('opens the current name, commits a trimmed name, and closes the editor', async () => {
    const user = userEvent.setup();
    const onRenameCaptain = renderCaptainPanel();

    await user.click(screen.getByRole('button', { name: 'Rename Captain Rename' }));
    const input = screen.getByRole('textbox', { name: 'Name for Captain Rename' });
    expect(input).toHaveValue('Captain Rename');

    await user.clear(input);
    await user.type(input, '  Nightshade  ');
    await user.keyboard('{Enter}');

    expect(onRenameCaptain).toHaveBeenCalledWith('captain-rename', 'Nightshade');
    expect(screen.queryByRole('textbox', { name: 'Name for Captain Rename' })).not.toBeInTheDocument();
  });

  it('cancels with Escape without renaming', async () => {
    const user = userEvent.setup();
    const onRenameCaptain = renderCaptainPanel();

    await user.click(screen.getByRole('button', { name: 'Rename Captain Rename' }));
    const input = screen.getByRole('textbox', { name: 'Name for Captain Rename' });
    await user.clear(input);
    await user.type(input, 'Temporary');
    await user.keyboard('{Escape}');

    expect(onRenameCaptain).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Name for Captain Rename' })).not.toBeInTheDocument();
  });

  it('rejects a whitespace-only name when the editor loses focus', async () => {
    const user = userEvent.setup();
    const onRenameCaptain = renderCaptainPanel();

    await user.click(screen.getByRole('button', { name: 'Rename Captain Rename' }));
    const input = screen.getByRole('textbox', { name: 'Name for Captain Rename' });
    await user.clear(input);
    await user.type(input, '   ');
    await user.tab();

    expect(onRenameCaptain).not.toHaveBeenCalled();
  });
});
