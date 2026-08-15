const MIN_MULTIPLIER = 0.5;
const MAX_MULTIPLIER = 1.75;
const MIN_STAR_COUNT = 1;
const MAX_STAR_COUNT = 6;

export const getDealerStarRating = (multiplier: number) => {
  const clamped = Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, multiplier));
  const normalized = (clamped - MIN_MULTIPLIER) / (MAX_MULTIPLIER - MIN_MULTIPLIER);
  return Math.round(MIN_STAR_COUNT + normalized * (MAX_STAR_COUNT - MIN_STAR_COUNT));
};
