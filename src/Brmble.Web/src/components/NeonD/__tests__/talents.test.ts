import { describe, expect, it } from 'vitest';
import { TALENT_RANK_SPLITS } from '../constants';
import type { Captain, TalentPathId, TalentRanks } from '../types';
import {
  canPurchaseTalent,
  getSpentTalentPoints,
  getTalentBonus,
  getTalentDefinition,
  getZoneLeadershipBonuses,
  hasProtectionCoverage,
  hasZoneBulkSaleTalent,
  isTalentStateValid,
} from '../talents';
import { makeReferenceCaptain } from './testFixtures';

const emptyRanks = (): TalentRanks => ({
  red: [0, 0, 0],
  yellow: [0, 0, 0],
  blue: [0, 0, 0],
});

const makeCaptain = (overrides: Partial<Captain> = {}): Captain => ({
  id: 'captain-1',
  name: 'Captain One',
  selling: 'weed',
  equipmentIds: [],
  personalEarnings: 0,
  level: 1,
  talentPoints: 0,
  talentRanks: emptyRanks(),
  ledgerUnlocked: true,
  kingpinAvailable: false,
  zoneBulkSellAvailableAt: 0,
  ...overrides,
  lastLevelUpEarnings: overrides.lastLevelUpEarnings ?? 0,
});

describe('Captain talent rules', () => {
  it('uses the reduced Volume split for every row size', () => {
    expect(TALENT_RANK_SPLITS.volume).toEqual({
      2: [0.50, 0.50],
      3: [0.33, 0.33, 0.33],
      4: [0.25, 0.25, 0.25, 0.25],
    });
  });

  it('defines the three lanes in their exact stat order and rank sizes', () => {
    const rows = [0, 1, 2] as const;
    expect(rows.map((row) => getTalentDefinition('red', row).stat)).toEqual([
      'margin', 'volume', 'secondarySales',
    ]);
    expect(rows.map((row) => getTalentDefinition('yellow', row).stat)).toEqual([
      'secondarySales', 'margin', 'volume',
    ]);
    expect(rows.map((row) => getTalentDefinition('blue', row).stat)).toEqual([
      'volume', 'secondarySales', 'margin',
    ]);
    expect(rows.map((row) => getTalentDefinition('red', row).maxRanks)).toEqual([2, 3, 4]);
  });

  it('splits each completed lane into the exact balance totals', () => {
    const ranks = emptyRanks();
    (['red', 'yellow', 'blue'] as TalentPathId[]).forEach((path) => {
      ranks[path] = [2, 3, 4];
    });

    expect(getTalentBonus(ranks)).toEqual({
      marginBonus: 2.4,
      volumeBonus: 2.99,
      secondarySalesBonus: 0.9,
    });
    expect(getSpentTalentPoints(ranks)).toBe(27);
  });

  it('allows one point in a lane and gates later rows behind only that lane', () => {
    const captain = makeCaptain({ talentPoints: 1 });

    expect(canPurchaseTalent(captain, 'red', 0)).toBe(true);
    expect(canPurchaseTalent(captain, 'red', 1)).toBe(false);
    expect(canPurchaseTalent(captain, 'yellow', 1)).toBe(false);
    expect(canPurchaseTalent(captain, 'blue', 2)).toBe(false);

    const completedFirstRedRow = makeCaptain({
      level: 3,
      talentPoints: 1,
      talentRanks: { ...emptyRanks(), red: [2, 0, 0] },
    });
    expect(canPurchaseTalent(completedFirstRedRow, 'red', 1)).toBe(true);
    expect(canPurchaseTalent(completedFirstRedRow, 'yellow', 1)).toBe(false);
  });

  it('rejects invalid, fractional, unknown, oversized, and diagonal talent states', () => {
    expect(isTalentStateValid(makeCaptain({ talentPoints: -1 }))).toBe(false);
    expect(isTalentStateValid(makeCaptain({ talentPoints: 1.5 }))).toBe(false);
    expect(isTalentStateValid(makeCaptain({ talentRanks: { ...emptyRanks(), red: [-1, 0, 0] } }))).toBe(false);
    expect(isTalentStateValid(makeCaptain({ talentRanks: { ...emptyRanks(), red: [3, 0, 0] } }))).toBe(false);
    expect(isTalentStateValid(makeCaptain({
      talentRanks: { ...emptyRanks(), red: [2, 1, 0] },
      talentPoints: 3,
    }))).toBe(false);
    expect(isTalentStateValid(makeCaptain({
      talentRanks: { ...emptyRanks(), red: [2, 3, 0], yellow: [0, 1, 0] },
      talentPoints: 6,
    }))).toBe(false);
    expect(isTalentStateValid(makeCaptain({
      talentRanks: { ...emptyRanks(), rogue: [0, 0, 0] } as unknown as TalentRanks,
    }))).toBe(false);
  });

  it('mirrors purchased talent ranks into small capped zone leadership bonuses', () => {
    const captain = makeReferenceCaptain({
      level: 10,
      talentPoints: 0,
      talentRanks: {
        red: [2, 3, 4],
        yellow: [1, 0, 0],
        blue: [0, 0, 0],
      },
      ledgerUnlocked: true,
      kingpinAvailable: true,
    });

    const bonuses = getZoneLeadershipBonuses(captain);

    expect(bonuses).toEqual({
      marginBonus: 0.04,
      volumeBonus: 0.06,
      secondarySalesBonus: 0.05,
    });
    expect(bonuses.marginBonus).toBeLessThanOrEqual(0.08);
    expect(bonuses.volumeBonus).toBeLessThanOrEqual(0.08);
    expect(bonuses.secondarySalesBonus).toBeLessThanOrEqual(0.05);

    const cappedCaptain = makeReferenceCaptain({
      level: 27,
      talentPoints: 0,
      talentRanks: {
        red: [2, 3, 4],
        yellow: [2, 3, 4],
        blue: [2, 3, 4],
      },
      ledgerUnlocked: true,
      kingpinAvailable: true,
    });
    expect(getZoneLeadershipBonuses(cappedCaptain)).toEqual({
      marginBonus: 0.08,
      volumeBonus: 0.08,
      secondarySalesBonus: 0.05,
    });
  });

  it('unlocks protection coverage at the final deep red rank', () => {
    expect(hasProtectionCoverage(makeReferenceCaptain({
      talentRanks: { red: [2, 3, 4], yellow: [0, 0, 0], blue: [0, 0, 0] },
    }))).toBe(true);
    expect(hasProtectionCoverage(makeReferenceCaptain({
      talentRanks: { red: [2, 3, 3], yellow: [0, 0, 0], blue: [0, 0, 0] },
    }))).toBe(false);
  });

  it('unlocks Zone bulk sale at the final deep yellow rank', () => {
    expect(hasZoneBulkSaleTalent(makeReferenceCaptain({
      talentRanks: { red: [0, 0, 0], yellow: [2, 3, 4], blue: [0, 0, 0] },
    }))).toBe(true);
    expect(hasZoneBulkSaleTalent(makeReferenceCaptain({
      talentRanks: { red: [0, 0, 0], yellow: [2, 3, 3], blue: [0, 0, 0] },
    }))).toBe(false);
  });
});
