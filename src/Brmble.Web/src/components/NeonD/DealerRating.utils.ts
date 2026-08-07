const MIN_MULTIPLIER = 0.5;
const MAX_MULTIPLIER = 1.5;

export const getDealerStarRating = (multiplier: number) => {
  const clamped = Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, multiplier));
  const normalized = (clamped - MIN_MULTIPLIER) / (MAX_MULTIPLIER - MIN_MULTIPLIER);
  return Math.round((1 + normalized * 4) * 2) / 2;
};
