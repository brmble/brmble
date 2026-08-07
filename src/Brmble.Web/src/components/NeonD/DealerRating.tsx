import styles from './DealerRating.module.css';
import { getDealerStarRating } from './DealerRating.utils';

export const DealerRating = ({
  label,
  multiplier,
}: {
  label: 'Volume' | 'Margin';
  multiplier: number;
}) => {
  const rating = getDealerStarRating(multiplier);
  const exactValue = `${label}: ${multiplier.toFixed(2)}x`;

  return (
    <div className={styles.row}>
      <span>{label}</span>
      <span
        className={styles.rating}
        role="img"
        tabIndex={0}
        aria-label={exactValue}
        title={exactValue}
      >
        {Array.from({ length: 5 }, (_, index) => {
          const starValue = index + 1;
          const state = rating >= starValue ? 'full' : rating === starValue - 0.5 ? 'half' : 'empty';
          return (
            <span key={starValue} className={styles.star} data-star-state={state} aria-hidden="true">
              ★
            </span>
          );
        })}
      </span>
    </div>
  );
};
