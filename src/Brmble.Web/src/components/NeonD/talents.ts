import {
  CAPTAIN_LEVEL_THRESHOLDS,
  TALENT_RANK_SPLITS,
  ZONE_LEADERSHIP_CAPS,
  ZONE_LEADERSHIP_PER_RANK,
} from './constants';
import type { Captain, SellerBonuses, TalentNodeDefinition, TalentPathId, TalentRanks, TalentStat } from './types';

const PATH_STATS: Record<TalentPathId, readonly TalentStat[]> = {
  red: ['margin', 'volume', 'secondarySales'],
  yellow: ['secondarySales', 'margin', 'volume'],
  blue: ['volume', 'secondarySales', 'margin'],
};

const ROW_RANKS = [2, 3, 4] as const;
const PATHS = ['red', 'yellow', 'blue'] as const;
const STAT_LABELS: Record<TalentStat, string> = {
  margin: 'Margin',
  volume: 'Volume',
  secondarySales: 'Secondary sales',
};

export function getTalentDefinition(path: TalentPathId, row: 0 | 1 | 2): TalentNodeDefinition {
  const stat = PATH_STATS[path][row];
  const maxRanks = ROW_RANKS[row];
  return {
    path,
    row,
    stat,
    maxRanks,
    rankBonuses: TALENT_RANK_SPLITS[stat][maxRanks],
    label: STAT_LABELS[stat],
  };
}

export function getSpentTalentPoints(talentRanks: TalentRanks): number {
  return PATHS.reduce((spent, path) => spent + talentRanks[path].reduce((sum, ranks) => sum + ranks, 0), 0);
}

export function getTalentBonus(talentRanks: TalentRanks): SellerBonuses {
  const bonuses: SellerBonuses = { marginBonus: 0, volumeBonus: 0, secondarySalesBonus: 0 };

  PATHS.forEach((path) => {
    ([0, 1, 2] as const).forEach((row) => {
      const definition = getTalentDefinition(path, row);
      const rankCount = talentRanks[path][row];
      const total = definition.rankBonuses.slice(0, rankCount).reduce((sum, bonus) => sum + bonus, 0);
      if (definition.stat === 'margin') bonuses.marginBonus += total;
      if (definition.stat === 'volume') bonuses.volumeBonus += total;
      if (definition.stat === 'secondarySales') bonuses.secondarySalesBonus += total;
    });
  });

  return {
    marginBonus: Number(bonuses.marginBonus.toFixed(10)),
    volumeBonus: Number(bonuses.volumeBonus.toFixed(10)),
    secondarySalesBonus: Number(bonuses.secondarySalesBonus.toFixed(10)),
  };
}

export const getZoneLeadershipBonuses = (captain: Captain): SellerBonuses => {
  const totals: SellerBonuses = {
    marginBonus: 0,
    volumeBonus: 0,
    secondarySalesBonus: 0,
  };

  for (const path of PATHS) {
    for (const row of [0, 1, 2] as const) {
      const definition = getTalentDefinition(path, row);
      const ranks = captain.talentRanks[path][row];

      if (definition.stat === 'margin') {
        totals.marginBonus += ranks * ZONE_LEADERSHIP_PER_RANK.marginBonus;
      }
      if (definition.stat === 'volume') {
        totals.volumeBonus += ranks * ZONE_LEADERSHIP_PER_RANK.volumeBonus;
      }
      if (definition.stat === 'secondarySales') {
        totals.secondarySalesBonus += ranks * ZONE_LEADERSHIP_PER_RANK.secondarySalesBonus;
      }
    }
  }

  return {
    marginBonus: Math.min(totals.marginBonus, ZONE_LEADERSHIP_CAPS.marginBonus),
    volumeBonus: Math.min(totals.volumeBonus, ZONE_LEADERSHIP_CAPS.volumeBonus),
    secondarySalesBonus: Math.min(
      totals.secondarySalesBonus,
      ZONE_LEADERSHIP_CAPS.secondarySalesBonus,
    ),
  };
};

export const hasProtectionCoverage = (captain: Captain) =>
  captain.talentRanks.red[2] === 4;

export const hasZoneBulkSaleTalent = (captain: Captain) =>
  captain.talentRanks.yellow[2] === 4;

export function canPurchaseTalent(captain: Captain, path: TalentPathId, row: 0 | 1 | 2): boolean {
  if (!captain.ledgerUnlocked || !isTalentStateValid(captain)) return false;
  if (captain.talentPoints <= 0) return false;

  const currentRanks = captain.talentRanks[path][row];
  if (currentRanks >= ROW_RANKS[row]) return false;
  if (row > 0 && captain.talentRanks[path][row - 1] < ROW_RANKS[row - 1]) return false;
  return true;
}

export function isTalentStateValid(captain: Captain): boolean {
  if (!Number.isInteger(captain.level) || captain.level < 0 || captain.level > CAPTAIN_LEVEL_THRESHOLDS.length) return false;
  if (!Number.isInteger(captain.talentPoints) || captain.talentPoints < 0) return false;
  if (captain.ledgerUnlocked !== (captain.level > 0)) return false;
  if (!captain.talentRanks || typeof captain.talentRanks !== 'object') return false;

  const rankKeys = Object.keys(captain.talentRanks).sort();
  if (rankKeys.join(',') !== [...PATHS].sort().join(',')) return false;

  for (const path of PATHS) {
    const ranks = captain.talentRanks[path];
    if (!Array.isArray(ranks) || ranks.length !== 3) return false;
    for (const row of [0, 1, 2] as const) {
      if (!Number.isInteger(ranks[row]) || ranks[row] < 0 || ranks[row] > ROW_RANKS[row]) return false;
      if (row > 0 && ranks[row] > 0 && ranks[row - 1] < ROW_RANKS[row - 1]) return false;
    }
  }

  const spent = getSpentTalentPoints(captain.talentRanks);
  if (spent > captain.level || spent + captain.talentPoints !== captain.level) return false;
  const laneComplete = PATHS.some((path) => captain.talentRanks[path][2] === ROW_RANKS[2]);
  return captain.kingpinAvailable === (captain.level >= 10 && laneComplete);
}
