import {
  CAPTAIN_BASE_MARGIN_MULTIPLIER,
  CAPTAIN_BASE_VOLUME_MULTIPLIER,
  CAPTAIN_LEVEL_THRESHOLDS,
  EQUIPMENT_CATALOG,
} from './constants';
import {
  getBailCost,
  getCaptainLevel,
  getEquipmentCost,
  getProductDefinition,
  getRecruitmentRefreshRemainingMs,
} from './economy';
import { getNormalDealerMainSaleRate } from './dealers';
import type { Captain, Dealer, EquipmentDefinition, EquipmentId, GameState, ProductId } from './types';
import styles from './NeonD.module.css';

type DistributionPanelProps = {
  state: GameState;
  hireDealer: (dealerId: string, slotIndex: number) => void;
  fireDealer: (dealerId: string) => void;
  setSellerProduct: (sellerId: string, productId: ProductId, sellerKind: 'dealer' | 'captain') => void;
  buySellerEquipment: (sellerId: string, equipmentId: EquipmentId, sellerKind: 'dealer' | 'captain') => void;
  toggleDealerProtection: (dealerId: string) => void;
  payDealerBail: (dealerId: string) => void;
  promoteCaptain: (captainId: string) => void;
};

const formatMoney = (value: number) => `$${Math.round(value).toLocaleString()}`;

const formatEquipmentEffect = (equipmentId: EquipmentId) => {
  const effect = EQUIPMENT_CATALOG.find((item) => item.id === equipmentId)
    ?.effect as EquipmentDefinition['effect'] | undefined;
  if (!effect) return 'No effect';
  const parts = [
    effect.marginBonus ? `+${Math.round(effect.marginBonus * 100)}% margin` : null,
    effect.volumeBonus ? `+${Math.round(effect.volumeBonus * 100)}% volume` : null,
    effect.secondarySalesBonus ? `+${Math.round(effect.secondarySalesBonus * 100)}% secondary sales` : null,
  ].filter(Boolean);
  return parts.join(', ');
};

const ProductSelect = ({
  value,
  onChange,
  label,
  state,
}: {
  value: ProductId;
  onChange: (productId: ProductId) => void;
  label: string;
  state: GameState;
}) => (
  <label className={styles.metricRow}>
    <span>Product</span>
    <select
      className={styles.select}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as ProductId)}
    >
      {state.unlockedProducts.map((productId) => (
        <option key={productId} value={productId}>
          {getProductDefinition(productId).name}
        </option>
      ))}
    </select>
  </label>
);

const EquipmentList = ({
  seller,
  sellerKind,
  state,
  onBuy,
}: {
  seller: Dealer | Captain;
  sellerKind: 'dealer' | 'captain';
  state: GameState;
  onBuy: (equipmentId: EquipmentId) => void;
}) => (
  <div className={styles.equipmentList}>
    <h5 className={styles.subheading}>Fixed equipment</h5>
    {EQUIPMENT_CATALOG.map((item) => {
      const owned = seller.equipmentIds.includes(item.id);
      const cost = getEquipmentCost(item.id, sellerKind, state.discountLevel);
      return (
        <button
          key={item.id}
          className={`${styles.unlockButton} ${owned ? styles.equipmentOwned : ''}`}
          disabled={owned || state.cash < cost}
          onClick={() => onBuy(item.id)}
        >
          {item.name} - {owned ? 'Owned' : formatMoney(cost)} ({formatEquipmentEffect(item.id)})
        </button>
      );
    })}
  </div>
);

const CandidateCard = ({
  candidate,
  slotIndex,
  onHire,
}: {
  candidate: Dealer;
  slotIndex: number;
  onHire: (dealerId: string, slotIndex: number) => void;
}) => (
  <article className={styles.dealerCard}>
    <h5 className={styles.dealerName}>{candidate.name}</h5>
    <div className={styles.metricRow}><span>Volume</span><strong>{candidate.volumeMultiplier.toFixed(2)}x</strong></div>
    <div className={styles.metricRow}><span>Margin</span><strong>{candidate.marginMultiplier.toFixed(2)}x</strong></div>
    <div className={styles.metricRow}><span>Main sales</span><strong>{getNormalDealerMainSaleRate(candidate).toFixed(2)} units/s</strong></div>
    <button className={styles.buyButton} onClick={() => onHire(candidate.id, slotIndex)}>
      Hire to Slot {slotIndex + 1}
    </button>
  </article>
);

export function DistributionPanel(props: DistributionPanelProps) {
  const refreshRemainingMs = getRecruitmentRefreshRemainingMs(
    props.state,
    props.state.lastTickAt,
  );

  return (
    <section className={styles.panel} aria-labelledby="neond-distribution-heading">
      <h3 id="neond-distribution-heading" className={styles.distributionColumnHeader}>Distribution</h3>
      <div className={styles.label}>Next candidates in {Math.ceil(refreshRemainingMs / 1000)}s</div>

      <div className={styles.cardStack}>
        {props.state.activeDealers.map((dealer, slotIndex) => (
          <article key={dealer?.id ?? `empty-${slotIndex}`} className={styles.distributionCard}>
            {dealer ? (
              <>
                <div className={styles.dealerHeader}>
                  {dealer.name} ({getProductDefinition(dealer.selling).name})
                </div>
                <div className={styles.dealerBody}>
                  <div className={styles.metricRow}><span>Slot</span><strong>{slotIndex + 1}</strong></div>
                  <ProductSelect
                    value={dealer.selling}
                    label={`Product for ${dealer.name}`}
                    state={props.state}
                    onChange={(productId) => props.setSellerProduct(dealer.id, productId, 'dealer')}
                  />
                  <div className={styles.metricRow}><span>Volume</span><strong>{dealer.volumeMultiplier.toFixed(2)}x</strong></div>
                  <div className={styles.metricRow}><span>Margin</span><strong>{dealer.marginMultiplier.toFixed(2)}x</strong></div>
                  <div className={styles.metricRow}><span>Main sales</span><strong>{dealer.isArrested ? '0.00' : getNormalDealerMainSaleRate(dealer).toFixed(2)} units/s</strong></div>
                  <div className={styles.metricRow}><span>Earnings</span><strong>{dealer.isArrested ? '$0/s' : `${formatMoney(props.state.lastEarningsPerSeller[dealer.id] ?? 0)}/s`}</strong></div>
                  <div className={styles.metricRow}>
                    <span>Status</span>
                    <strong>{dealer.isArrested ? 'Arrested' : dealer.isProtected ? 'Protected -10% income' : 'Unprotected'}</strong>
                  </div>
                  {dealer.isArrested ? (
                    <div className={styles.actionStack}>
                      <button
                        className={styles.buyButton}
                        onClick={() => props.payDealerBail(dealer.id)}
                        disabled={props.state.cash < getBailCost(dealer.earningsPerSecondAtArrest)}
                      >
                        Pay Bail ({formatMoney(getBailCost(dealer.earningsPerSecondAtArrest))})
                      </button>
                      <button className={styles.dangerButton} onClick={() => props.fireDealer(dealer.id)}>
                        Fire Dealer
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={styles.toggleButtonText}
                        aria-pressed={dealer.isProtected}
                        onClick={() => props.toggleDealerProtection(dealer.id)}
                      >
                        {dealer.isProtected ? 'Disable protection' : 'Enable protection (-10% income)'}
                      </button>
                      <EquipmentList
                        seller={dealer}
                        sellerKind="dealer"
                        state={props.state}
                        onBuy={(equipmentId) => props.buySellerEquipment(dealer.id, equipmentId, 'dealer')}
                      />
                      <button className={styles.dangerButton} onClick={() => props.fireDealer(dealer.id)}>
                        Fire Dealer
                      </button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className={styles.dealerBody}>
                <h4 className={styles.productTitle}>Slot {slotIndex + 1} - Empty</h4>
                {props.state.availableDealers.map((candidate) => (
                  <CandidateCard
                    key={candidate.id}
                    candidate={candidate}
                    slotIndex={slotIndex}
                    onHire={props.hireDealer}
                  />
                ))}
              </div>
            )}
          </article>
        ))}

        {props.state.captains.map((captain) => {
          const level = getCaptainLevel(captain.personalEarnings);
          const nextThreshold = CAPTAIN_LEVEL_THRESHOLDS[level];
          return (
            <article key={captain.id} className={`${styles.distributionCard} ${styles.captainCard}`}>
              <div className={styles.dealerHeader}>{captain.name}</div>
              <div className={styles.dealerBody}>
                <ProductSelect
                  value={captain.selling}
                  label={`Product for ${captain.name}`}
                  state={props.state}
                  onChange={(productId) => props.setSellerProduct(captain.id, productId, 'captain')}
                />
                <div className={styles.metricRow}><span>Volume</span><strong>{CAPTAIN_BASE_VOLUME_MULTIPLIER.toFixed(2)}x base</strong></div>
                <div className={styles.metricRow}><span>Margin</span><strong>{CAPTAIN_BASE_MARGIN_MULTIPLIER.toFixed(2)}x base</strong></div>
                <div className={styles.metricRow}><span>Level</span><strong>Level {level}</strong></div>
                <div className={styles.metricRow}><span>Personal earnings</span><strong>{formatMoney(captain.personalEarnings)}</strong></div>
                {nextThreshold ? (
                  <div className={styles.metricRow}><span>Next threshold</span><strong>{formatMoney(nextThreshold)}</strong></div>
                ) : (
                  <div className={styles.kingpinBadge}>Ready for Kingpin promotion</div>
                )}
                <div className={styles.metricRow}><span>Respect bonus</span><strong>+{Math.round((1 + level * 0.5) * 100)}%</strong></div>
                <EquipmentList
                  seller={captain}
                  sellerKind="captain"
                  state={props.state}
                  onBuy={(equipmentId) => props.buySellerEquipment(captain.id, equipmentId, 'captain')}
                />
                {level >= 10 && (
                  <button className={styles.buyButton} onClick={() => props.promoteCaptain(captain.id)}>
                    Promote to Kingpin
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
