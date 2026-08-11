import { MUSCLE_CATALOG } from './constants';
import type { GameState, MuscleWorkerDefinition } from './types';

export const COLLAPSED_FUTURE_MUSCLE_TIER_COUNT = 2;

export const getCollapsedMuscleWorkers = (
  owned: GameState['muscleOwned'],
): readonly MuscleWorkerDefinition[] => {
  const highestOwnedIndex = MUSCLE_CATALOG.reduce(
    (highest, worker, index) => owned[worker.id] > 0 ? index : highest,
    -1,
  );
  const lastFutureIndex = highestOwnedIndex + COLLAPSED_FUTURE_MUSCLE_TIER_COUNT;

  return MUSCLE_CATALOG.filter((worker, index) =>
    owned[worker.id] > 0
      || (index > highestOwnedIndex && index <= lastFutureIndex),
  );
};
