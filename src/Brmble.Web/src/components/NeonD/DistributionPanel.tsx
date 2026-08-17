import { useCallback, useMemo, useRef, useState } from 'react';
import { EQUIPMENT_CATALOG } from './constants';
import {
  getBailCost,
  getCaptainRemainingThreshold,
  getEquipmentCost,
  getProductDefinition,
  getRecruitmentRefreshRemainingMs,
  isCaptainLevelUpAvailable,
} from './economy';
import { getCaptainBonuses, getCaptainMainSaleRate, getCaptainMarginMultiplier } from './dealers';
import { DealerRating } from './DealerRating';
import type { Captain, Dealer, EquipmentDefinition, EquipmentId, GameState, ProductId, TalentPathId } from './types';
import { Icon } from '../Icon/Icon';
import { Select } from '../Select';
import styles from './NeonD.module.css';
import { usePersistedCardPreferences } from './hooks/usePersistedCardPreferences';
import { TalentLedger } from './TalentLedger';

type DistributionPanelProps = {
  state: GameState;
  hireDealer: (dealerId: string, slotIndex: number) => void;
  fireDealer: (dealerId: string) => void;
  setSellerProduct: (sellerId: string, productId: ProductId, sellerKind: 'dealer' | 'captain') => void;
  buySellerEquipment: (sellerId: string, equipmentId: EquipmentId, sellerKind: 'dealer' | 'captain') => void;
  toggleDealerProtection: (dealerId: string) => void;
  payDealerBail: (dealerId: string) => void;
  claimCaptainLevel: (captainId: string) => void;
  purchaseCaptainTalent: (captainId: string, path: TalentPathId, row: 0 | 1 | 2) => void;
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
    <Select
      className={styles.select}
      ariaLabel={label}
      value={value}
      onChange={(productId) => onChange(productId as ProductId)}
      options={state.unlockedProducts.map((productId) => ({
        value: productId,
        label: getProductDefinition(productId).name,
      }))}
    />
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
  isFavorite,
  onToggleFavorite,
}: {
  candidate: Dealer;
  slotIndex: number;
  onHire: (dealerId: string, slotIndex: number) => void;
  isFavorite: boolean;
  onToggleFavorite: (dealerId: string) => void;
}) => (
  <article className={styles.dealerCard}>
    <h5 className={styles.dealerName}>
      <DealerFavoriteButton
        dealer={candidate}
        isFavorite={isFavorite}
        onToggle={onToggleFavorite}
      />
      <span>{candidate.name}</span>
    </h5>
    <DealerRating label="Volume" multiplier={candidate.volumeMultiplier} maxStars={5} />
    <DealerRating label="Margin" multiplier={candidate.marginMultiplier} maxStars={5} />
    <button className={styles.buyButton} onClick={() => onHire(candidate.id, slotIndex)}>
      Hire to Slot {slotIndex + 1}
    </button>
  </article>
);

const DealerFavoriteButton = ({
  dealer,
  isFavorite,
  onToggle,
}: {
  dealer: Dealer;
  isFavorite: boolean;
  onToggle: (dealerId: string) => void;
}) => (
  <button
    type="button"
    className={`${styles.dealerFavoriteButton} ${isFavorite ? styles.dealerFavoriteButtonActive : ''}`}
    aria-label={`${isFavorite ? 'Unfavorite' : 'Favorite'} ${dealer.name}`}
    aria-pressed={isFavorite}
    onClick={() => onToggle(dealer.id)}
  >
    <Icon name="star" size={14} />
  </button>
);

export function DistributionPanel(props: DistributionPanelProps) {
  const [expandedEquipmentIds, setExpandedEquipmentIds] = useState<Set<string>>(() => new Set());
  const [favoriteDealerIds, setFavoriteDealerIds] = useState<Set<string>>(() => new Set());
  const [ledgerCaptainId, setLedgerCaptainId] = useState<string | null>(null);
  const talentButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const distributionHeadingRef = useRef<HTMLHeadingElement>(null);
  const knownSellerIds = useMemo(
    () => [
      ...props.state.activeDealers
        .filter((dealer): dealer is Dealer => dealer !== null)
        .map((dealer) => dealer.id),
      ...props.state.captains.map((captain) => captain.id),
    ],
    [props.state.activeDealers, props.state.captains],
  );
  const [collapsedSellerIds, toggleSellerCard] = usePersistedCardPreferences(knownSellerIds);

  const toggleDealerFavorite = useCallback((dealerId: string) => {
    setFavoriteDealerIds((current) => {
      const next = new Set(current);
      if (next.has(dealerId)) next.delete(dealerId);
      else next.add(dealerId);
      return next;
    });
  }, []);

  const toggleEquipment = (sellerId: string) => {
    setExpandedEquipmentIds((current) => {
      const next = new Set(current);
      if (next.has(sellerId)) next.delete(sellerId);
      else next.add(sellerId);
      return next;
    });
  };

  const closeLedger = () => {
    const opener = ledgerCaptainId ? talentButtonRefs.current[ledgerCaptainId] : null;
    setLedgerCaptainId(null);
    requestAnimationFrame(() => opener?.focus());
  };

  const promoteFromLedger = () => {
    if (!ledgerCaptainId) return;
    props.promoteCaptain(ledgerCaptainId);
    setLedgerCaptainId(null);
    requestAnimationFrame(() => distributionHeadingRef.current?.focus());
  };

  const refreshRemainingMs = getRecruitmentRefreshRemainingMs(
    props.state,
    props.state.lastTickAt,
  );

  return (
    <section className={styles.panel} aria-labelledby="neond-distribution-heading">
      <h3 ref={distributionHeadingRef} id="neond-distribution-heading" className={styles.distributionColumnHeader} tabIndex={-1}>Distribution</h3>
      <div className={styles.label}>Next candidates in {Math.ceil(refreshRemainingMs / 1000)}s</div>

      <div className={styles.cardStack}>
        {props.state.activeDealers.map((dealer, slotIndex) => {
          const isCollapsed = dealer ? collapsedSellerIds.has(dealer.id) : false;
          const bodyId = dealer ? `distribution-body-${dealer.id}` : undefined;

          return (
          <article
            key={dealer?.id ?? `empty-${slotIndex}`}
            className={styles.distributionCard}
            aria-label={dealer ? `${dealer.name} distribution` : undefined}
          >
            {dealer ? (
              <>
                <div className={`${styles.dealerHeader} ${styles.collapsibleDealerHeader}`}>
                  <span className={`${styles.dealerHeaderTitle} ${styles.dealerHeaderTitleWithFavorite}`}>
                    <DealerFavoriteButton
                      dealer={dealer}
                      isFavorite={favoriteDealerIds.has(dealer.id)}
                      onToggle={toggleDealerFavorite}
                    />
                    <span>{dealer.name} ({getProductDefinition(dealer.selling).name})</span>
                  </span>
                  <button
                    type="button"
                    className={styles.cardCollapseButton}
                    aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${dealer.name} distribution`}
                    aria-expanded={!isCollapsed}
                    aria-controls={bodyId}
                    onClick={() => toggleSellerCard(dealer.id)}
                  >
                    <Icon name={isCollapsed ? 'chevron-down' : 'chevron-up'} size={16} />
                  </button>
                </div>
                {isCollapsed ? (
                  <div id={bodyId} className={styles.collapsedDealerBody}>
                    <ProductSelect
                      value={dealer.selling}
                      label={`Product for ${dealer.name}`}
                      state={props.state}
                      onChange={(productId) => props.setSellerProduct(dealer.id, productId, 'dealer')}
                    />
                    <div className={styles.collapsedDealerSummary}>
                      <span>Earnings</span>
                      <strong>
                        {dealer.isArrested
                          ? '$0/s'
                          : `${formatMoney(props.state.lastEarningsPerSeller[dealer.id] ?? 0)}/s`}
                      </strong>
                    </div>
                  </div>
                ) : (
                <div id={bodyId} className={styles.dealerBody}>
                  <div className={styles.metricRow}><span>Slot</span><strong>{slotIndex + 1}</strong></div>
                  <ProductSelect
                    value={dealer.selling}
                    label={`Product for ${dealer.name}`}
                    state={props.state}
                    onChange={(productId) => props.setSellerProduct(dealer.id, productId, 'dealer')}
                  />
                  <DealerRating label="Volume" multiplier={dealer.volumeMultiplier} maxStars={5} />
                  <DealerRating label="Margin" multiplier={dealer.marginMultiplier} maxStars={5} />
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
                      <button
                        type="button"
                        className={styles.equipmentToggle}
                        aria-expanded={expandedEquipmentIds.has(dealer.id)}
                        aria-label={`${expandedEquipmentIds.has(dealer.id) ? 'Collapse' : 'Expand'} equipment for ${dealer.name}`}
                        onClick={() => toggleEquipment(dealer.id)}
                      >
                        <span>Fixed equipment</span>
                        <span aria-hidden="true">{expandedEquipmentIds.has(dealer.id) ? '▴' : '▾'}</span>
                      </button>
                      {expandedEquipmentIds.has(dealer.id) ? (
                        <EquipmentList
                          seller={dealer}
                          sellerKind="dealer"
                          state={props.state}
                          onBuy={(equipmentId) => props.buySellerEquipment(dealer.id, equipmentId, 'dealer')}
                        />
                      ) : null}
                      <button className={styles.dangerButton} onClick={() => props.fireDealer(dealer.id)}>
                        Fire Dealer
                      </button>
                    </>
                  )}
                </div>
                )}
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
                    isFavorite={favoriteDealerIds.has(candidate.id)}
                    onToggleFavorite={toggleDealerFavorite}
                  />
                ))}
              </div>
            )}
          </article>
          );
        })}

        {props.state.captains.map((captain) => {
          const remainingThreshold = getCaptainRemainingThreshold(
            captain.level,
            captain.personalEarnings,
            captain.lastLevelUpEarnings,
          );
          const bonuses = getCaptainBonuses(captain);
          const volumeMultiplier = getCaptainMainSaleRate(captain) / 3;
          const marginMultiplier = getCaptainMarginMultiplier(captain);
          const isCollapsed = collapsedSellerIds.has(captain.id);
          const bodyId = `distribution-body-${captain.id}`;
          const levelUpAvailable = isCaptainLevelUpAvailable(
            captain.level,
            captain.personalEarnings,
            captain.lastLevelUpEarnings,
          );
          const isLedgerOpen = ledgerCaptainId === captain.id;
          return (
            <article
              key={captain.id}
              className={`${styles.distributionCard} ${styles.captainCard}`}
              aria-label={`${captain.name} distribution`}
            >
              <div className={`${styles.dealerHeader} ${styles.collapsibleDealerHeader}`}>
                <span className={styles.dealerHeaderTitle}>
                  {captain.name} ({getProductDefinition(captain.selling).name})
                </span>
                <button
                  type="button"
                  className={styles.cardCollapseButton}
                  aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${captain.name} distribution`}
                  aria-expanded={!isCollapsed}
                  aria-controls={bodyId}
                  onClick={() => toggleSellerCard(captain.id)}
                >
                  <Icon name={isCollapsed ? 'chevron-down' : 'chevron-up'} size={16} />
                </button>
              </div>
              {isCollapsed ? (
                <div id={bodyId} className={styles.collapsedDealerBody}>
                  <ProductSelect
                    value={captain.selling}
                    label={`Product for ${captain.name}`}
                    state={props.state}
                    onChange={(productId) => props.setSellerProduct(captain.id, productId, 'captain')}
                  />
                  <div className={styles.collapsedDealerSummary}>
                    <span>Earnings</span>
                    <strong>{formatMoney(props.state.lastEarningsPerSeller[captain.id] ?? 0)}/s</strong>
                  </div>
                </div>
              ) : (
                <div id={bodyId} className={styles.dealerBody}>
                  <ProductSelect
                    value={captain.selling}
                    label={`Product for ${captain.name}`}
                    state={props.state}
                    onChange={(productId) => props.setSellerProduct(captain.id, productId, 'captain')}
                  />
                  <DealerRating label="Volume" multiplier={volumeMultiplier} maxStars={6} />
                  <DealerRating label="Margin" multiplier={marginMultiplier} maxStars={6} />
                  <div className={styles.metricRow}><span>Secondary sales</span><strong>+{Math.round(bonuses.secondarySalesBonus * 100)}%</strong></div>
                  <div className={styles.metricRow}><span>Level</span><strong>Level {captain.level}</strong></div>
                  <div className={styles.metricRow}><span>Personal earnings</span><strong>{formatMoney(captain.personalEarnings)}</strong></div>
                  {remainingThreshold !== null ? (
                    <div className={styles.metricRow}><span>Next threshold</span><strong>{formatMoney(remainingThreshold)} to level</strong></div>
                  ) : (
                    <div className={styles.kingpinBadge}>All Captain levels claimed</div>
                  )}
                  <div className={styles.metricRow}><span>Respect bonus</span><strong>+{Math.round((1 + captain.level * 0.5) * 100)}%</strong></div>
                  <div className={styles.actionStack}>
                    {levelUpAvailable ? (
                      <button type="button" className={styles.buyButton} onClick={() => props.claimCaptainLevel(captain.id)}>
                        Level Up
                      </button>
                    ) : null}
                    <button
                      ref={(element) => { talentButtonRefs.current[captain.id] = element; }}
                      type="button"
                      className={styles.unlockButton}
                      disabled={!captain.ledgerUnlocked}
                      aria-label={captain.ledgerUnlocked ? `Open talents for ${captain.name}` : `Talents locked for ${captain.name}`}
                      onClick={() => setLedgerCaptainId(captain.id)}
                    >
                      Talents{captain.talentPoints > 0 ? ` (${captain.talentPoints} point${captain.talentPoints === 1 ? '' : 's'})` : ''}
                    </button>
                  </div>
                </div>
              )}
              {isLedgerOpen ? (
                <TalentLedger
                  captain={captain}
                  onClose={closeLedger}
                  onClaimLevel={() => props.claimCaptainLevel(captain.id)}
                  onPurchaseTalent={(path, row) => props.purchaseCaptainTalent(captain.id, path, row)}
                  onPromote={promoteFromLedger}
                />
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
