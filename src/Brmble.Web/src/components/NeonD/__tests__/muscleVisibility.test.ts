import { describe, expect, it } from 'vitest';
import { createBaseGameState, MUSCLE_CATALOG } from '../constants';
import { getCollapsedMuscleWorkers } from '../muscleVisibility';

const workerNames = (workers: ReturnType<typeof getCollapsedMuscleWorkers>) =>
  workers.map((worker) => worker.name);

describe('getCollapsedMuscleWorkers', () => {
  it('shows the first two tiers when no workers are owned', () => {
    const owned = createBaseGameState(0).muscleOwned;

    expect(workerNames(getCollapsedMuscleWorkers(owned))).toEqual([
      'Hood Rat',
      'Young Thug',
    ]);
  });

  it('keeps every owned tier and adds two tiers after the highest owned tier', () => {
    const owned = {
      ...createBaseGameState(0).muscleOwned,
      hoodRat: 2,
      hiredGoon: 1,
    };

    expect(workerNames(getCollapsedMuscleWorkers(owned))).toEqual([
      'Hood Rat',
      'Hired Goon',
      'Crooked Cop',
      'Bought Judge',
    ]);
  });

  it('returns the complete catalog when every tier is owned', () => {
    const owned = Object.fromEntries(
      MUSCLE_CATALOG.map((worker) => [worker.id, 1]),
    ) as ReturnType<typeof createBaseGameState>['muscleOwned'];

    expect(getCollapsedMuscleWorkers(owned)).toEqual(MUSCLE_CATALOG);
  });
});
