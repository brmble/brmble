import { MUSCLE_CATALOG } from './constants';
import {
  getDiscountCost,
  getDiscountMultiplier,
  getMuscleWorkerCost,
  getRespectPerSecond,
  getTerritoryCost,
} from './economy';
import type { GameState, MuscleWorkerId } from './types';
import styles from './NeonD.module.css';

type MusclePanelProps = {
  state: GameState;
  buyMuscleWorker: (workerId: MuscleWorkerId) => void;
  buyTerritory: () => void;
  buyDiscount: () => void;
};

const formatMoney = (value: number) => `$${Math.round(value).toLocaleString()}`;

export function MusclePanel(props: MusclePanelProps) {
  const respectPerSecond = getRespectPerSecond(props.state);

  return (
    <section className={styles.panel} aria-labelledby="neond-muscle-heading">
      <h3 id="neond-muscle-heading" className={styles.columnHeader}>Muscle / Respect</h3>
      <div className={styles.prestigeSummary}>
        <span>Respect: {Math.floor(props.state.respect).toLocaleString()}</span>
        <strong>Respect/sec: {respectPerSecond.toFixed(2)}</strong>
      </div>
      <div className={styles.actionStack}>
        <button
          className={styles.unlockButton}
          onClick={props.buyTerritory}
          disabled={props.state.respect < getTerritoryCost(props.state.territoryLevel)}
        >
          Territory {props.state.territoryLevel} · Capacity {props.state.activeDealers.length} - {Math.round(getTerritoryCost(props.state.territoryLevel)).toLocaleString()} Respect
        </button>
        <button
          className={styles.unlockButton}
          onClick={props.buyDiscount}
          disabled={props.state.respect < getDiscountCost(props.state.discountLevel)}
        >
          Discount {props.state.discountLevel} · {(getDiscountMultiplier(props.state.discountLevel) * 100).toFixed(1)}% cash prices - {Math.round(getDiscountCost(props.state.discountLevel)).toLocaleString()} Respect
        </button>
      </div>

      <div className={styles.cardStack}>
        {MUSCLE_CATALOG.map((worker) => {
          const owned = props.state.muscleOwned[worker.id];
          const cost = getMuscleWorkerCost(worker.id, owned, props.state.discountLevel);
          return (
            <article key={worker.id} className={styles.muscleWorkerRow}>
              <div className={styles.panelHeader}>
                <h4 className={styles.productTitle}>{worker.name}</h4>
                <span>Owned: {owned.toLocaleString()}</span>
              </div>
              <div className={styles.metricRow}>
                <span>Base Respect/sec</span>
                <strong>{worker.respectPerSecond.toLocaleString()} each</strong>
              </div>
              <div className={styles.metricRow}>
                <span>Total contribution</span>
                <strong>{(owned * worker.respectPerSecond).toLocaleString()} Respect/sec</strong>
              </div>
              <button
                className={styles.buyButton}
                onClick={() => props.buyMuscleWorker(worker.id)}
                disabled={props.state.cash < cost}
              >
                Buy - {formatMoney(cost)}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
