import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBaseGameState } from '../constants';
import type { Dealer, GameState, Zone } from '../types';
import * as transfers from '../transfers';
import { makeReferenceCaptain, makeReferenceDealer } from './testFixtures';
import { createAmsterdamZone } from '../zones';

const createParisZone = (
  captainId: string | null,
  dealerSlots: Zone['dealerSlots'] = [{ id: 'paris-slot-0', dealer: null, reservedTransferId: null }],
): Zone => ({
  id: 'paris',
  displayName: 'Paris',
  captainId,
  dealerSlots,
  perkIds: [],
});

const makeTransferState = (
  overrides: {
    dealer?: Dealer;
    amsterdamSlots?: Zone['dealerSlots'];
    parisSlots?: Zone['dealerSlots'];
  } = {},
): GameState => {
  const amsterdamCaptain = makeReferenceCaptain({ id: 'captain-amsterdam' });
  const parisCaptain = makeReferenceCaptain({ id: 'captain-paris' });
  const dealer = overrides.dealer ?? makeReferenceDealer({ id: 'dealer-amsterdam' });
  const state = createBaseGameState(0);

  return {
    ...state,
    territoryLevel: 1,
    activeDealers: [],
    captains: [amsterdamCaptain, parisCaptain],
    zones: [
      {
        ...createAmsterdamZone(amsterdamCaptain.id, 1),
        dealerSlots: overrides.amsterdamSlots ?? [
          { id: 'amsterdam-slot-0', dealer, reservedTransferId: null },
        ],
      },
      createParisZone(
        parisCaptain.id,
        overrides.parisSlots,
      ),
    ],
    lastEarningsPerSeller: {
      [dealer.id]: 18,
    },
  };
};

describe('dealer transfers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts a transfer by reserving both slots, clearing the source slot, and zeroing displayed earnings', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000001');
    const dealer = makeReferenceDealer({ id: 'traveller' });
    const state = makeTransferState({ dealer });

    const next = transfers.startDealerTransfer(
      state,
      dealer.id,
      'paris',
      'paris-slot-0',
      1_000,
    );

    expect(next.lastEarningsPerSeller[dealer.id]).toBe(0);
    expect(next.zones[0].dealerSlots[0]).toEqual({
      id: 'amsterdam-slot-0',
      dealer: null,
      reservedTransferId: '00000000-0000-0000-0000-000000000001',
    });
    expect(next.zones[1].dealerSlots[0]).toEqual({
      id: 'paris-slot-0',
      dealer: null,
      reservedTransferId: '00000000-0000-0000-0000-000000000001',
    });
    expect(next.dealerTransfers).toEqual([{
      id: '00000000-0000-0000-0000-000000000001',
      dealer,
      sourceZoneId: 'amsterdam',
      sourceSlotId: 'amsterdam-slot-0',
      destinationZoneId: 'paris',
      destinationSlotId: 'paris-slot-0',
      completesAt: 121_000,
      riskResolved: false,
    }]);
    expect(transfers.getOutgoingTransfers(next, 'amsterdam').map((transfer) => transfer.id))
      .toEqual(['00000000-0000-0000-0000-000000000001']);
    expect(transfers.getIncomingTransfers(next, 'paris').map((transfer) => transfer.id))
      .toEqual(['00000000-0000-0000-0000-000000000001']);
    expect(transfers.getTransferRemainingMs(next.dealerTransfers[0], 61_000)).toBe(60_000);
  });

  it('requires another unlocked destination zone and rejects the same zone or locked zones', () => {
    const state = makeTransferState();

    expect(
      transfers.startDealerTransfer(state, 'dealer-amsterdam', 'amsterdam', 'amsterdam-slot-0', 1_000),
    ).toBe(state);
    expect(
      transfers.startDealerTransfer(state, 'dealer-amsterdam', 'berlin', 'berlin-slot-0', 1_000),
    ).toBe(state);
  });

  it('rejects occupied or already reserved destination slots', () => {
    const occupiedState = makeTransferState({
      parisSlots: [{
        id: 'paris-slot-0',
        dealer: makeReferenceDealer({ id: 'dealer-occupied' }),
        reservedTransferId: null,
      }],
    });
    const reservedState = makeTransferState({
      parisSlots: [{
        id: 'paris-slot-0',
        dealer: null,
        reservedTransferId: 'transfer-occupied',
      }],
    });

    expect(
      transfers.startDealerTransfer(
        occupiedState,
        'dealer-amsterdam',
        'paris',
        'paris-slot-0',
        1_000,
      ),
    ).toBe(occupiedState);
    expect(
      transfers.startDealerTransfer(
        reservedState,
        'dealer-amsterdam',
        'paris',
        'paris-slot-0',
        1_000,
      ),
    ).toBe(reservedState);
  });

  it('rejects arrested dealers and dealers that are already travelling', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000001');
    const arrestedState = makeTransferState({
      dealer: makeReferenceDealer({ id: 'dealer-arrested', isArrested: true }),
    });
    const state = makeTransferState({
      dealer: makeReferenceDealer({ id: 'dealer-travelling' }),
    });
    const started = transfers.startDealerTransfer(
      state,
      'dealer-travelling',
      'paris',
      'paris-slot-0',
      1_000,
    );

    expect(
      transfers.startDealerTransfer(
        arrestedState,
        'dealer-arrested',
        'paris',
        'paris-slot-0',
        1_000,
      ),
    ).toBe(arrestedState);
    expect(
      transfers.startDealerTransfer(
        started,
        'dealer-travelling',
        'paris',
        'paris-slot-0',
        1_500,
      ),
    ).toBe(started);
  });

  it('has no cancel mutation and keeps in-flight transfers unchanged before completion', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000001');
    const state = makeTransferState({
      dealer: makeReferenceDealer({ id: 'dealer-flight' }),
    });
    const started = transfers.startDealerTransfer(
      state,
      'dealer-flight',
      'paris',
      'paris-slot-0',
      1_000,
    );

    expect('cancelDealerTransfer' in transfers).toBe(false);
    expect(transfers.resolveDueDealerTransfers(started, 120_999)).toBe(started);
  });

  it('completes a due transfer by placing the dealer into the destination and clearing both reservations', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000001');
    const dealer = makeReferenceDealer({ id: 'dealer-arrival' });
    const state = makeTransferState({ dealer });
    const started = transfers.startDealerTransfer(
      state,
      dealer.id,
      'paris',
      'paris-slot-0',
      1_000,
    );

    const arrived = transfers.resolveDueDealerTransfers(started, 121_000, () => 1);

    expect(arrived.zones[0].dealerSlots[0]).toEqual({
      id: 'amsterdam-slot-0',
      dealer: null,
      reservedTransferId: null,
    });
    expect(arrived.zones[1].dealerSlots[0]).toEqual({
      id: 'paris-slot-0',
      dealer,
      reservedTransferId: null,
    });
    expect(arrived.dealerTransfers).toEqual([]);
  });

  it('returns the same state when due reservations do not match the persisted transfer graph', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000001');
    const started = transfers.startDealerTransfer(
      makeTransferState({ dealer: makeReferenceDealer({ id: 'dealer-corrupt' }) }),
      'dealer-corrupt',
      'paris',
      'paris-slot-0',
      1_000,
    );
    const corrupted: GameState = {
      ...started,
      zones: started.zones.map((zone) =>
        zone.id !== 'paris'
          ? zone
          : {
            ...zone,
            dealerSlots: zone.dealerSlots.map((slot) =>
              slot.id === 'paris-slot-0'
                ? { ...slot, reservedTransferId: null }
                : slot,
            ),
          },
      ),
    };

    expect(transfers.resolveDueDealerTransfers(corrupted, 121_000, () => {
      throw new Error('corrupt reservations must not roll risk');
    })).toBe(corrupted);
  });

  it('rolls every equipment item exactly once at arrival', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000001');
    const state = makeTransferState({
      dealer: makeReferenceDealer({
        id: 'traveller',
        selling: 'mushrooms',
        volumeMultiplier: 1.25,
        marginMultiplier: 0.75,
        equipmentIds: ['baseballBat', 'bicycle', 'iphone6Plus'],
      }),
    });

    const started = transfers.startDealerTransfer(state, 'traveller', 'paris', 'paris-slot-0', 1_000);
    const rolls = [0.25, 0.75, 0.49];
    const arrived = transfers.resolveDueDealerTransfers(
      started,
      121_000,
      () => rolls.shift() ?? 1,
    );

    const dealer = arrived.zones[1].dealerSlots[0].dealer!;
    expect(dealer.equipmentIds).toEqual(['bicycle']);
    expect(dealer.selling).toBe('mushrooms');
    expect(dealer.volumeMultiplier).toBe(1.25);
    expect(dealer.marginMultiplier).toBe(0.75);
    expect(arrived.dealerTransfers).toEqual([]);

    const rerun = transfers.resolveDueDealerTransfers(arrived, 122_000, () => {
      throw new Error('risk must not roll twice');
    });
    expect(rerun).toBe(arrived);
  });
});
