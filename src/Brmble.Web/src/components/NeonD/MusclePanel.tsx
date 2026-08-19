import { useState } from 'react';
import { MUSCLE_CATALOG } from './constants';
import {
  getDiscountCost,
  getDiscountMultiplier,
  getMuscleWorkerCost,
  getRespectPerSecond,
} from './economy';
import { getCollapsedMuscleWorkers } from './muscleVisibility';
import type { GameState, MuscleWorkerId } from './types';
import styles from './NeonD.module.css';

type MusclePanelProps = {
  state: GameState;
  buyMuscleWorker: (workerId: MuscleWorkerId) => void;
  buyDiscount: () => void;
};

const formatMoney = (value: number) => `$${Math.round(value).toLocaleString()}`;

export function MusclePanel(props: MusclePanelProps) {
  const [showAllWorkers, setShowAllWorkers] = useState(false);
  const respectPerSecond = getRespectPerSecond(props.state);
  const collapsedWorkers = getCollapsedMuscleWorkers(props.state.muscleOwned);
  const visibleWorkers = showAllWorkers ? MUSCLE_CATALOG : collapsedWorkers;
  const hiddenWorkerCount = MUSCLE_CATALOG.length - collapsedWorkers.length;

  return (
    <section className={styles.panel} aria-labelledby="neond-muscle-heading">
      <h3 id="neond-muscle-heading" className={styles.columnHeader}>Muscle / Respect</h3>
      <div className={styles.prestigeSummary}>
        <span>Respect: {Math.floor(props.state.respect).toLocaleString()}</span>
        <strong>Respect/sec: {respectPerSecond.toFixed(2)}</strong>
      </div>
      <div className={styles.muscleActionGrid}>
        <button
          className={styles.unlockButton}
          onClick={props.buyDiscount}
          disabled={props.state.respect < getDiscountCost(props.state.discountLevel)}
        >
          Discount {props.state.discountLevel} · {(getDiscountMultiplier(props.state.discountLevel) * 100).toFixed(1)}% cash prices - {Math.round(getDiscountCost(props.state.discountLevel)).toLocaleString()} Respect
        </button>
      </div>

      <div
        id="neond-muscle-workers"
        className={styles.muscleWorkerList}
        role="list"
        aria-label="Muscle workers"
      >
        {visibleWorkers.map((worker) => {
          const owned = props.state.muscleOwned[worker.id];
          const cost = getMuscleWorkerCost(worker.id, owned, props.state.discountLevel);
          const headingId = `neond-muscle-worker-${worker.id}`;
          return (
            <article
              key={worker.id}
              className={styles.muscleWorkerRow}
              role="listitem"
              aria-labelledby={headingId}
            >
              <div className={styles.muscleWorkerDetails}>
                <div className={styles.muscleWorkerHeading}>
                  <h4 id={headingId} className={styles.productTitle}>{worker.name}</h4>
                  <span>Owned {owned.toLocaleString()}</span>
                </div>
                <div className={styles.muscleWorkerMetrics}>
                  <span>{worker.respectPerSecond.toLocaleString()} Respect/sec each</span>
                  <strong>{(owned * worker.respectPerSecond).toLocaleString()} Respect/sec total</strong>
                </div>
              </div>
              <button
                className={`${styles.buyButton} ${styles.muscleBuyButton}`}
                onClick={() => props.buyMuscleWorker(worker.id)}
                disabled={props.state.cash < cost}
                aria-label={`Buy one ${worker.name} for ${formatMoney(cost)}`}
              >
                Buy - {formatMoney(cost)}
              </button>
            </article>
          );
        })}
      </div>

      {hiddenWorkerCount > 0 ? (
        <button
          type="button"
          className={styles.muscleRevealButton}
          aria-expanded={showAllWorkers}
          aria-controls="neond-muscle-workers"
          onClick={() => setShowAllWorkers((current) => !current)}
        >
          {showAllWorkers ? 'Hide later tiers' : `Show all ${hiddenWorkerCount} later tiers`}
        </button>
      ) : null}
    </section>
  );
}
