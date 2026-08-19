import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createBaseGameState } from '../constants';
import { DealerHiringModal } from '../DealerHiringModal';
import { makeReferenceCaptain, makeReferenceDealer } from './testFixtures';

const state = {
  ...createBaseGameState(0),
  availableDealers: [
    makeReferenceDealer({ id: 'dealer-1', name: 'Dealer One' }),
    makeReferenceDealer({ id: 'dealer-2', name: 'Dealer Two' }),
    makeReferenceDealer({ id: 'dealer-3', name: 'Dealer Three' }),
  ],
  captains: [makeReferenceCaptain({ id: 'captain-1', name: 'Captain One', level: 2, ledgerUnlocked: true })],
};

describe('DealerHiringModal', () => {
  it('keeps the legacy presentation dealer-only until Captain management is available', () => {
    render(
      <DealerHiringModal
        state={{ ...state, captains: [], runEarnings: 0 }}
        slotIndex={0}
        onHireSeller={vi.fn()}
        onRefreshDealers={vi.fn()}
        onRenameCaptain={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole('tablist', { name: 'Distribution hiring' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('shows dealer and Captain management tabs once Captain progression is available', async () => {
    const user = userEvent.setup();
    const onRecruitCaptain = vi.fn();
    const onUnlockZone = vi.fn();
    const captain = makeReferenceCaptain({ id: 'captain-2', name: 'Captain Two' });
    const zonedState = {
      ...state,
      cash: 10_000_000,
      captains: [captain],
      zones: [{
        id: 'amsterdam' as const,
        displayName: 'Amsterdam',
        captainId: null,
        dealerSlots: [{ id: 'amsterdam-slot-0', dealer: null, reservedTransferId: null }],
        perkIds: [],
      }],
    };

    render(
      <DealerHiringModal
        state={zonedState}
        slotIndex={0}
        onHireSeller={vi.fn()}
        onRefreshDealers={vi.fn()}
        onRenameCaptain={vi.fn()}
        onClose={vi.fn()}
        onRecruitCaptain={onRecruitCaptain}
        onUnlockZone={onUnlockZone}
      />,
    );

    const tablist = screen.getByRole('tablist', { name: 'Distribution hiring' });
    expect(within(tablist).getByRole('tab', { name: 'Dealers' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Refresh dealers' })).toBeInTheDocument();

    await user.click(within(tablist).getByRole('tab', { name: 'Captains' }));

    expect(screen.getByRole('button', { name: 'Recruit Captain' })).toBeEnabled();
    expect(screen.getByText('Captain Two')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Recruit Captain' }));
    await user.click(screen.getByRole('button', { name: 'Open new zone' }));
    expect(onRecruitCaptain).toHaveBeenCalledOnce();
    expect(onUnlockZone).toHaveBeenCalledOnce();
  });

  it('requires a destination for a zone-mode dealer hire opened from the summary', async () => {
    const user = userEvent.setup();
    const onHireDealer = vi.fn();
    const zonedState = {
      ...state,
      captains: [],
      zones: [{
        id: 'amsterdam' as const,
        displayName: 'Amsterdam',
        captainId: null,
        dealerSlots: [{ id: 'amsterdam-slot-0', dealer: null, reservedTransferId: null }],
        perkIds: [],
      }],
    };

    render(
      <DealerHiringModal
        state={zonedState}
        slotIndex={0}
        onHireSeller={vi.fn()}
        onRefreshDealers={vi.fn()}
        onRenameCaptain={vi.fn()}
        onClose={vi.fn()}
        onHireDealer={onHireDealer}
        target={null}
      />,
    );

    const hire = screen.getByRole('button', { name: 'Hire Dealer One' });
    expect(hire).toBeDisabled();
    await user.click(screen.getByRole('combobox', { name: 'Dealer destination' }));
    await user.click(screen.getByRole('option', { name: 'Amsterdam · Slot 1' }));
    expect(hire).toBeEnabled();
    await user.click(hire);
    expect(onHireDealer).toHaveBeenCalledWith('dealer-1', {
      kind: 'zone', zoneId: 'amsterdam', slotId: 'amsterdam-slot-0',
    });
  });

  it('uses the exact zone slot target when opened from that slot', async () => {
    const user = userEvent.setup();
    const onHireDealer = vi.fn();
    const zonedState = {
      ...state,
      captains: [],
      zones: [{
        id: 'paris' as const,
        displayName: 'Paris',
        captainId: null,
        dealerSlots: [{ id: 'paris-slot-1', dealer: null, reservedTransferId: null }],
        perkIds: [],
      }],
    };

    render(
      <DealerHiringModal
        state={zonedState}
        slotIndex={0}
        target={{ kind: 'zone', zoneId: 'paris', slotId: 'paris-slot-1' }}
        onHireSeller={vi.fn()}
        onHireDealer={onHireDealer}
        onRefreshDealers={vi.fn()}
        onRenameCaptain={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Hire Dealer One' }));
    expect(onHireDealer).toHaveBeenCalledWith('dealer-1', {
      kind: 'zone', zoneId: 'paris', slotId: 'paris-slot-1',
    });
  });

  it('shows three dealers and unassigned Captain candidates with Captain details', async () => {
    const user = userEvent.setup();
    const onHireSeller = vi.fn();
    const onClose = vi.fn();

    render(
      <DealerHiringModal
        state={state}
        slotIndex={0}
        onHireSeller={onHireSeller}
        onRefreshDealers={vi.fn()}
        onRenameCaptain={vi.fn()}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Distribution hiring' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(3);
    await user.click(screen.getByRole('tab', { name: 'Captains' }));
    expect(screen.getByText('Captain One')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Volume: 1.75x' }).querySelectorAll('[data-star-state="full"]')).toHaveLength(6);
    expect(screen.getByText('Level 2')).toBeInTheDocument();

    expect(onHireSeller).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('refreshes dealer candidates and closes on Escape', async () => {
    const user = userEvent.setup();
    const onRefreshDealers = vi.fn();
    const onClose = vi.fn();

    render(
      <DealerHiringModal
        state={{ ...state, lastDealerRefreshAt: Date.now() - 60_000 }}
        slotIndex={1}
        onHireSeller={vi.fn()}
        onRefreshDealers={onRefreshDealers}
        onRenameCaptain={vi.fn()}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Refresh dealers' }));
    expect(onRefreshDealers).toHaveBeenCalledOnce();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows the refresh countdown inside the modal', () => {
    render(
      <DealerHiringModal
        state={{ ...state, lastDealerRefreshAt: Date.now() }}
        slotIndex={0}
        onHireSeller={vi.fn()}
        onRefreshDealers={vi.fn()}
        onRenameCaptain={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /refresh available in/i })).toBeDisabled();
  });

  it('shows the talent preview button instead of the talent bonus summary', async () => {
    const user = userEvent.setup();
    render(
      <DealerHiringModal
        state={{
          ...state,
          captains: [makeReferenceCaptain({
            id: 'captain-1',
            name: 'Captain One',
            level: 2,
            ledgerUnlocked: true,
            talentRanks: { red: [2, 3, 4], yellow: [0, 0, 0], blue: [0, 0, 0] },
          })],
        }}
        slotIndex={0}
        onHireSeller={vi.fn()}
        onRefreshDealers={vi.fn()}
        onRenameCaptain={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('tab', { name: 'Captains' }));
    expect(screen.getByRole('button', { name: 'View talents for Captain One' })).toBeInTheDocument();
    expect(screen.queryByText('+80% margin')).not.toBeInTheDocument();
  });

  it('opens the selected unassigned Captain talent tree as a read-only preview', async () => {
    const user = userEvent.setup();
    const onHireSeller = vi.fn();
    const onClose = vi.fn();

    render(
      <DealerHiringModal
        state={state}
        slotIndex={0}
        onHireSeller={onHireSeller}
        onRefreshDealers={vi.fn()}
        onRenameCaptain={vi.fn()}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('tab', { name: 'Captains' }));
    await user.click(screen.getByRole('button', { name: 'View talents for Captain One' }));

    expect(screen.getByRole('heading', { name: /Captain’s Talent Ledger — Captain One/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Level Up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Promote to Kingpin' })).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('heading', { name: /Captain’s Talent Ledger — Captain One/ })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'View talents for Captain One' }));
    await user.click(screen.getByRole('button', { name: 'Close Captain One talent ledger' }));
    expect(screen.queryByRole('heading', { name: /Captain’s Talent Ledger — Captain One/ })).not.toBeInTheDocument();
    expect(onHireSeller).not.toHaveBeenCalled();
  });

  it('keeps Captain naming focused when the parent rerenders', async () => {
    const user = userEvent.setup();
    const firstOnClose = vi.fn();
    const { rerender } = render(
      <DealerHiringModal
        state={state}
        slotIndex={0}
        initialTab="captains"
        onHireSeller={vi.fn()}
        onRefreshDealers={vi.fn()}
        onRenameCaptain={vi.fn()}
        onClose={firstOnClose}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Name for Captain One' });
    await user.clear(input);
    await user.type(input, 'Night');

    rerender(
      <DealerHiringModal
        state={state}
        slotIndex={0}
        initialTab="captains"
        onHireSeller={vi.fn()}
        onRefreshDealers={vi.fn()}
        onRenameCaptain={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.keyboard('shade');

    expect(input).toHaveValue('Nightshade');
    expect(document.activeElement).toBe(input);
  });

  it('commits a Captain rename once when Enter blurs the input', async () => {
    const user = userEvent.setup();
    const onRenameCaptain = vi.fn();

    render(
      <DealerHiringModal
        state={state}
        slotIndex={0}
        initialTab="captains"
        onHireSeller={vi.fn()}
        onRefreshDealers={vi.fn()}
        onRenameCaptain={onRenameCaptain}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Name for Captain One' });
    await user.clear(input);
    await user.type(input, 'Nightshade');
    await user.keyboard('{Enter}');

    expect(onRenameCaptain).toHaveBeenCalledOnce();
    expect(onRenameCaptain).toHaveBeenCalledWith('captain-1', 'Nightshade');
  });

  it('cancels a Captain rename on Escape without committing the draft', async () => {
    const user = userEvent.setup();
    const onRenameCaptain = vi.fn();

    render(
      <DealerHiringModal
        state={state}
        slotIndex={0}
        initialTab="captains"
        onHireSeller={vi.fn()}
        onRefreshDealers={vi.fn()}
        onRenameCaptain={onRenameCaptain}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Name for Captain One' });
    await user.clear(input);
    await user.type(input, 'Temporary');
    await user.keyboard('{Escape}');

    expect(onRenameCaptain).not.toHaveBeenCalled();
    expect(input).toHaveValue('Captain One');
  });

  it('uses the shared modal shell and does not close when its panel is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <DealerHiringModal
        state={state}
        slotIndex={0}
        onHireSeller={vi.fn()}
        onRefreshDealers={vi.fn()}
        onRenameCaptain={vi.fn()}
        onClose={onClose}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Distribution hiring' });
    expect(dialog).toHaveClass('glass-panel', 'animate-slide-up');
    expect(dialog.parentElement).toHaveClass('modal-overlay');

    await user.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('announces purchasable nodes as unavailable in a read-only preview', async () => {
    const user = userEvent.setup();

    render(
      <DealerHiringModal
        state={{
          ...state,
          captains: [makeReferenceCaptain({
            id: 'captain-1',
            name: 'Captain One',
            level: 1,
            talentPoints: 1,
            ledgerUnlocked: true,
          })],
        }}
        slotIndex={0}
        initialTab="captains"
        onHireSeller={vi.fn()}
        onRefreshDealers={vi.fn()}
        onRenameCaptain={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'View talents for Captain One' }));

    expect(screen.queryByRole('button', { name: /Margin, 0\/2, available/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Margin, 0\/2, locked/ })).toBeDisabled();
  });
});
