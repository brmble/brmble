const MIN_STAR_COUNT = 0;
const MAX_STAR_COUNT = 5;

export const getDealerStarRating = (multiplier: number) => {
  return Math.min(MAX_STAR_COUNT, Math.max(MIN_STAR_COUNT, Math.round(multiplier)));
};
