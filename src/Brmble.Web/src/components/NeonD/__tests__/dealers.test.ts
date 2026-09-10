import { describe, expect, it } from 'vitest';
import {
  buildSecondaryDemands,
  createCaptain,
  getDealerMarginMultiplier,
  getCaptainDefaultName,
  getCaptainBonuses,
  getCaptainMainSaleRate,
  getCaptainMarginMultiplier,
  generateCandidatePool,
  getNormalDealerMainSaleRate,
  getSellerEquipmentBonuses,
} from '../dealers';
import { makeReferenceCaptain, makeReferenceDealer } from './testFixtures';

describe('reference dealer behavior', () => {
  it('uses a supplied Captain name while retaining the generated default', () => {
    expect(createCaptain(2, '  Nightshade  ')).toMatchObject({ name: '  Nightshade  ' });
    expect(getCaptainDefaultName(2)).toBe('Captain 2');
    expect(createCaptain(2)).toMatchObject({ name: 'Captain 2' });
  });

  it('creates a Captain with a Weed assignment and empty personal state', () => {
    expect(createCaptain(2)).toMatchObject({
      name: 'Captain 2',
      selling: 'weed',
      equipmentIds: [],
      personalEarnings: 0,
      level: 0,
      talentPoints: 0,
      talentRanks: { red: [0, 0, 0], yellow: [0, 0, 0], blue: [0, 0, 0] },
      ledgerUnlocked: false,
      kingpinAvailable: false,
    });
  });

  it('creates a Level 0 Captain with an empty talent ledger', () => {
    expect(createCaptain(2)).toMatchObject({
      level: 0,
      talentPoints: 0,
      talentRanks: { red: [0, 0, 0], yellow: [0, 0, 0], blue: [0, 0, 0] },
      ledgerUnlocked: false,
      kingpinAvailable: false,
    });
  });

  it('uses purchased Captain talents and ignores compatibility equipment', () => {
    const captain = makeReferenceCaptain({
      equipmentIds: ['personalArmy'],
      level: 1,
      talentPoints: 0,
      talentRanks: { red: [1, 0, 0], yellow: [0, 0, 0], blue: [0, 0, 0] },
      ledgerUnlocked: true,
    });

    expect(getCaptainBonuses(captain)).toEqual({
      marginBonus: 0.4,
      volumeBonus: 0,
      secondarySalesBonus: 0,
    });
    expect(getCaptainMainSaleRate(captain)).toBeCloseTo(1.75 * 3);
    expect(getCaptainMarginMultiplier(captain)).toBeCloseTo(1.75 * 1.4);
  });

  it('generates exactly three candidates with independent 0.5-1.5 multipliers', () => {
    const rolls = [0, 0, 0, 0.5, 0.5, 0.5, 1, 1, 1, 0.25, 0.75, 0.5];
    const rng = () => rolls.shift() ?? 0.5;
    const pool = generateCandidatePool(['weed'], rng);

    expect(pool).toHaveLength(3);
    pool.forEach((dealer) => {
      expect(dealer.volumeMultiplier).toBeGreaterThanOrEqual(0.5);
      expect(dealer.volumeMultiplier).toBeLessThanOrEqual(1.5);
      expect(dealer.marginMultiplier).toBeGreaterThanOrEqual(0.5);
      expect(dealer.marginMultiplier).toBeLessThanOrEqual(1.5);
    });
  });

  it('uses Volume x 3 as the main sale rate', () => {
    expect(getNormalDealerMainSaleRate({
      id: 'd',
      name: 'Dealer',
      selling: 'weed',
      volumeMultiplier: 1.2,
      marginMultiplier: 1,
      equipmentIds: [],
      isProtected: false,
      isArrested: false,
      earningsPerSecondAtArrest: 0,
    })).toBeCloseTo(3.6);
  });

  it('adds local leadership to normal dealer volume and margin', () => {
    const dealer = makeReferenceDealer({
      volumeMultiplier: 1.2,
      marginMultiplier: 1.1,
    });
    const leadership = {
      marginBonus: 0.08,
      volumeBonus: 0.06,
      secondarySalesBonus: 0.05,
    };

    expect(getNormalDealerMainSaleRate(dealer, leadership))
      .toBeCloseTo(1.2 * 1.06 * 3);
    expect(getDealerMarginMultiplier(dealer, leadership))
      .toBeCloseTo(1.1 * 1.08);
  });

  it('aggregates fixed equipment effects', () => {
    expect(getSellerEquipmentBonuses(['baseballBat', 'bicycle', 'iphone6Plus'])).toEqual({
      volumeBonus: 0.10,
      marginBonus: 0.10,
      secondarySalesBonus: 0.10,
    });
  });

  it('splits total secondary sale volume across other unlocked products', () => {
    const demands = buildSecondaryDemands(
      3,
      0.20,
      'weed',
      ['weed', 'mushrooms', 'meth'],
    );
    expect(demands.get('mushrooms')).toBeCloseTo(0.3);
    expect(demands.get('meth')).toBeCloseTo(0.3);
  });
});
