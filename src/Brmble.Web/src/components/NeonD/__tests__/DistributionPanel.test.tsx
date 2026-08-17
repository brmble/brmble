import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createBaseGameState } from '../constants';
import { DistributionPanel } from '../DistributionPanel';
import { makeReferenceDealer } from './testFixtures';

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
