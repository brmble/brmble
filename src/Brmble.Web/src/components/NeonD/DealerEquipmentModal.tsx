import { EQUIPMENT_CATALOG } from './constants';
import { getEquipmentCost } from './economy';
import type { Dealer, EquipmentDefinition, EquipmentId, GameState } from './types';
import { Icon } from '../Icon/Icon';
import styles from './NeonD.module.css';

type DealerEquipmentModalProps = {
  dealer: Dealer;
  state: GameState;
  onBuy: (equipmentId: EquipmentId) => void;
  onClose: () => void;
};

const formatMoney = (value: number) => `$${Math.round(value).toLocaleString()}`;

const formatEquipmentEffect = (equipmentId: EquipmentId) => {
  const effect = EQUIPMENT_CATALOG.find((item) => item.id === equipmentId)
    ?.effect as EquipmentDefinition['effect'] | undefined;
  if (!effect) return 'No effect';
  return [
    effect.marginBonus ? `+${Math.round(effect.marginBonus * 100)}% margin` : null,
    effect.volumeBonus ? `+${Math.round(effect.volumeBonus * 100)}% volume` : null,
    effect.secondarySalesBonus ? `+${Math.round(effect.secondarySalesBonus * 100)}% secondary sales` : null,
  ].filter(Boolean).join(', ');
};

export function DealerEquipmentModal({ dealer, state, onBuy, onClose }: DealerEquipmentModalProps) {
  const titleId = `dealer-equipment-title-${dealer.id}`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`${styles.dealerEquipmentModal} glass-panel animate-slide-up`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId} className="heading-title modal-title">Equipment for {dealer.name}</h2>
            <p className="modal-subtitle">Buy fixed equipment for this dealer.</p>
          </div>
          <button type="button" className="modal-close" aria-label={`Close equipment for ${dealer.name}`} onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className={styles.dealerEquipmentList}>
          {EQUIPMENT_CATALOG.map((item) => {
            const owned = dealer.equipmentIds.includes(item.id);
            const cost = getEquipmentCost(item.id, 'dealer', state.discountLevel);
            return (
              <button
                key={item.id}
                type="button"
                className={`${styles.unlockButton} ${owned ? styles.equipmentOwned : ''}`}
                disabled={owned || state.cash < cost}
                onClick={() => onBuy(item.id)}
              >
                {item.name} - {owned ? 'Owned' : formatMoney(cost)} ({formatEquipmentEffect(item.id)})
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
