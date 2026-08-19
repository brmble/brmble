import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EQUIPMENT_CATALOG } from './constants';
import {
  getBailCost,
  getCaptainRemainingThreshold,
  getDealerCapacityCost,
  getEquipmentCost,
  getProductDefinition,
  getCaptainZoneBulkRemainingMs,
  isCaptainLevelUpAvailable,
  canCaptainZoneBulkSell,
} from './economy';
import { getCaptainBonuses, getCaptainMainSaleRate, getCaptainMarginMultiplier } from './dealers';
import { DealerRating } from './DealerRating';
import type { Captain, Dealer, DealerSlotTarget, EquipmentDefinition, EquipmentId, GameState, ProductId, TalentPathId, ZoneCityId } from './types';
import { Icon } from '../Icon/Icon';
import { Select } from '../Select';
import styles from './NeonD.module.css';
import { usePersistedCardPreferences } from './hooks/usePersistedCardPreferences';
import { TalentLedger } from './TalentLedger';
import { DealerHiringModal } from './DealerHiringModal';
import { DealerTransferModal } from './DealerTransferModal';
import { ZoneUnlockModal } from './ZoneUnlockModal';
import { isCaptain, isDealer } from './sellers';
import { getIncomingTransfers, getOutgoingTransfers } from './transfers';
import { getZoneLeadershipBonuses, hasProtectionCoverage, hasZoneBulkSaleTalent } from './talents';
import {
  getAvailableZoneDealerSlots,
  getActiveDealerEntries,
  getTotalDealerCapacity,
  getUnassignedCaptains,
  getZoneEarningsPerSecond,
} from './zones';

type DistributionPanelProps = {
  state: GameState;
  onHireSeller: (sellerId: string, slotIndex: number, sellerKind: 'dealer' | 'captain') => void;
  onHireDealer: (dealerId: string, target: DealerSlotTarget) => void;
  onRefreshDealers: () => void;
  onRecruitCaptain: () => void;
  onUnlockZone: (cityId: ZoneCityId, captainId: string) => void;
  openCaptainManagement?: boolean;
  onCaptainManagementClosed?: () => void;
  onRenameCaptain: (captainId: string, name: string) => void;
  fireDealer: (dealerId: string) => void;
  setSellerProduct: (sellerId: string, productId: ProductId, sellerKind: 'dealer' | 'captain') => void;
  buySellerEquipment: (sellerId: string, equipmentId: EquipmentId, sellerKind: 'dealer' | 'captain') => void;
  toggleDealerProtection: (dealerId: string) => void;
  payDealerBail: (dealerId: string) => void;
  buyDealerCapacity: (zoneId: ZoneCityId) => void;
  claimCaptainLevel: (captainId: string) => void;
  purchaseCaptainTalent: (captainId: string, path: TalentPathId, row: 0 | 1 | 2) => void;
  promoteCaptain: (captainId: string) => void;
  captainZoneBulkSell: (captainId: string) => void;
  transferDealer: (dealerId: string, destinationZoneId: ZoneCityId, destinationSlotId: string) => void;
};

const formatMoney = (value: number) => `$${Math.round(value).toLocaleString()}`;

const formatTransferRemaining = (remainingMs: number) => {
  const totalSeconds = Math.ceil(Math.max(0, remainingMs) / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

const formatDuration = (remainingMs: number) => {
  const totalSeconds = Math.ceil(Math.max(0, remainingMs) / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m${seconds > 0 ? ` ${seconds}s` : ''}` : `${seconds}s`;
};

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
  const [hiringTarget, setHiringTarget] = useState<DealerSlotTarget | null | undefined>(undefined);
  const [hiringInitialTab, setHiringInitialTab] = useState<'dealers' | 'captains'>('dealers');
  const [isZoneUnlockOpen, setZoneUnlockOpen] = useState(false);
  const [transferDealerId, setTransferDealerId] = useState<string | null>(null);
  const [transferDestination, setTransferDestination] = useState<{ zoneId: ZoneCityId; slotId: string } | null>(null);
  const [collapsedZoneIds, setCollapsedZoneIds] = useState<Set<ZoneCityId>>(() => new Set());
  const [editingCaptainId, setEditingCaptainId] = useState<string | null>(null);
  const [captainDraftName, setCaptainDraftName] = useState('');
  const talentButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const distributionHeadingRef = useRef<HTMLHeadingElement>(null);
  const captainRenameInputRef = useRef<HTMLInputElement>(null);
  const knownSellerIds = useMemo(
    () => [
      ...props.state.activeDealers
        .filter((seller): seller is Dealer | Captain => seller !== null)
        .map((seller) => seller.id),
      ...props.state.zones.flatMap((zone) =>
        zone.dealerSlots.flatMap((slot) => slot.dealer ? [slot.dealer.id] : []),
      ),
      ...props.state.captains.map((captain) => captain.id),
    ],
    [props.state.activeDealers, props.state.captains, props.state.zones],
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

  useEffect(() => {
    if (editingCaptainId) {
      captainRenameInputRef.current?.focus();
      captainRenameInputRef.current?.select();
    }
  }, [editingCaptainId]);

  useEffect(() => {
    if (!props.openCaptainManagement) return;
    setHiringTarget(null);
    setHiringInitialTab('captains');
  }, [props.openCaptainManagement]);

  const startCaptainRename = (captain: Captain) => {
    setCaptainDraftName(captain.name);
    setEditingCaptainId(captain.id);
  };

  const cancelCaptainRename = () => {
    setEditingCaptainId(null);
    setCaptainDraftName('');
  };

  const commitCaptainRename = (captainId: string) => {
    const trimmedName = captainDraftName.trim();
    if (trimmedName) props.onRenameCaptain(captainId, trimmedName);
    cancelCaptainRename();
  };

  const renderCaptainCard = (captain: Captain, slotIndex?: number) => {
    const remainingThreshold = getCaptainRemainingThreshold(
      captain.level,
      captain.personalEarnings,
      captain.lastLevelUpEarnings,
    );
    const bonuses = getCaptainBonuses(captain);
    const zoneLeadership = getZoneLeadershipBonuses(captain);
    const bulkSaleTalentUnlocked = hasZoneBulkSaleTalent(captain);
    const remainingMs = getCaptainZoneBulkRemainingMs(captain, props.state.lastTickAt);
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
    const isEditing = editingCaptainId === captain.id;
    const renameEditorId = `captain-rename-${captain.id}`;
    const title = slotIndex === undefined
      ? `♛ ${captain.name} (${getProductDefinition(captain.selling).name})`
      : `♛ ${captain.name} · Captain · Slot ${slotIndex + 1}`;

    return (
      <>
        <div className={`${styles.dealerHeader} ${styles.collapsibleDealerHeader}`}>
          <span className={styles.dealerHeaderTitle}>{title}</span>
          <div className={styles.cardHeaderActions}>
            <button
              type="button"
              className={styles.captainRenameButton}
              aria-label={`Rename ${captain.name}`}
              aria-expanded={isEditing}
              aria-controls={renameEditorId}
              onClick={() => startCaptainRename(captain)}
            >
              <Icon name="pencil" size={14} />
            </button>
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
        </div>
        {isEditing ? (
          <div id={renameEditorId} className={styles.captainRenameEditor}>
            <label htmlFor={`${renameEditorId}-input`}>Name for {captain.name}</label>
            <input
              ref={captainRenameInputRef}
              id={`${renameEditorId}-input`}
              className="brmble-input"
              value={captainDraftName}
              onChange={(event) => setCaptainDraftName(event.target.value)}
              onBlur={() => commitCaptainRename(captain.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitCaptainRename(captain.id);
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelCaptainRename();
                }
              }}
            />
          </div>
        ) : null}
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
            <div className={styles.zoneLeadershipSummary}>
              <h5 className={styles.subheading}>Zone leadership</h5>
              <div className={styles.metricRow}><span>Street influence</span><strong>+{Math.round(zoneLeadership.marginBonus * 100)}%</strong></div>
              <div className={styles.metricRow}><span>Delivery network</span><strong>+{Math.round(zoneLeadership.volumeBonus * 100)}%</strong></div>
              <div className={styles.metricRow}><span>Side hustle network</span><strong>+{Math.round(zoneLeadership.secondarySalesBonus * 100)}%</strong></div>
              <div className={styles.metricRow}><span>Protection coverage</span><strong>{hasProtectionCoverage(captain) ? 'Active' : 'Locked'}</strong></div>
              {bulkSaleTalentUnlocked ? (
                <div className={styles.metricRow}>
                  <span>Zone bulk cooldown</span>
                  <strong>{remainingMs > 0 ? formatDuration(remainingMs) : 'Ready'}</strong>
                </div>
              ) : null}
            </div>
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
              {bulkSaleTalentUnlocked ? (
                <button
                  type="button"
                  className={styles.buyButton}
                  disabled={!canCaptainZoneBulkSell(props.state, captain.id, props.state.lastTickAt)}
                  onClick={() => props.captainZoneBulkSell(captain.id)}
                >
                  Sell {getProductDefinition(captain.selling).name} bulk
                </button>
              ) : null}
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
      </>
    );
  };

  const toggleZoneCollapse = (zoneId: ZoneCityId) => {
    setCollapsedZoneIds((current) => {
      const next = new Set(current);
      if (next.has(zoneId)) next.delete(zoneId);
      else next.add(zoneId);
      return next;
    });
  };

  const renderZoneDealerCard = (dealer: Dealer, slotIndex: number, sourceZoneId: ZoneCityId) => {
    const isCollapsed = collapsedSellerIds.has(dealer.id);
    const bodyId = `distribution-body-${dealer.id}`;
    const availableDestinationSlots = getAvailableZoneDealerSlots(props.state)
      .filter((slot) => slot.zoneId !== sourceZoneId);

    return (
      <div className={styles.distributionCard} aria-label={`${dealer.name} distribution`}>
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
              <strong>{dealer.isArrested ? '$0/s' : `${formatMoney(props.state.lastEarningsPerSeller[dealer.id] ?? 0)}/s`}</strong>
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
                <button className={styles.buyButton} onClick={() => props.payDealerBail(dealer.id)} disabled={props.state.cash < getBailCost(dealer.earningsPerSecondAtArrest)}>
                  Pay Bail ({formatMoney(getBailCost(dealer.earningsPerSecondAtArrest))})
                </button>
                <button className={styles.dangerButton} onClick={() => props.fireDealer(dealer.id)}>Fire Dealer</button>
              </div>
            ) : (
              <>
                <button type="button" className={styles.toggleButtonText} aria-pressed={dealer.isProtected} onClick={() => props.toggleDealerProtection(dealer.id)}>
                  {dealer.isProtected ? 'Disable protection' : 'Enable protection (-10% income)'}
                </button>
                <button type="button" className={styles.equipmentToggle} aria-expanded={expandedEquipmentIds.has(dealer.id)} aria-label={`${expandedEquipmentIds.has(dealer.id) ? 'Collapse' : 'Expand'} equipment for ${dealer.name}`} onClick={() => toggleEquipment(dealer.id)}>
                  <span>Fixed equipment</span>
                  <span aria-hidden="true">{expandedEquipmentIds.has(dealer.id) ? '▴' : '▾'}</span>
                </button>
                {expandedEquipmentIds.has(dealer.id) ? (
                  <EquipmentList seller={dealer} sellerKind="dealer" state={props.state} onBuy={(equipmentId) => props.buySellerEquipment(dealer.id, equipmentId, 'dealer')} />
                ) : null}
                <button className={styles.dangerButton} onClick={() => props.fireDealer(dealer.id)}>Fire Dealer</button>
              </>
            )}
            <button
              type="button"
              className={styles.unlockButton}
              disabled={availableDestinationSlots.length === 0 || dealer.isArrested}
              onClick={() => setTransferDealerId(dealer.id)}
            >
              Transfer dealer
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderZoneDistribution = () => {
    const hasZoneVacancy = props.state.zones.some((zone) =>
      zone.dealerSlots.some((slot) => slot.dealer === null && slot.reservedTransferId === null),
    );
    const hasUnassignedCaptains = getUnassignedCaptains(props.state).length > 0;

    return (
      <>
        {hasZoneVacancy ? (
          <button
            type="button"
            className={styles.buyButton}
            onClick={() => { setHiringTarget(null); setHiringInitialTab('dealers'); }}
          >
            {hiringSummary}
          </button>
        ) : hasUnassignedCaptains ? (
          <button
            type="button"
            className={styles.unlockButton}
            onClick={() => { setHiringTarget(null); setHiringInitialTab('captains'); }}
          >
            View unassigned Captains
          </button>
        ) : <div className={styles.label}>{hiringSummary}</div>}
        <div className={styles.zoneCardStack}>
          {props.state.zones.map((zone) => {
            const isCollapsed = collapsedZoneIds.has(zone.id);
            const captain = zone.captainId
              ? props.state.captains.find((candidate) => candidate.id === zone.captainId) ?? null
              : null;
            const zoneActiveDealerCount = zone.dealerSlots.filter((slot) => slot.dealer).length;
            const outgoingTransfers = getOutgoingTransfers(props.state, zone.id);
            const incomingTransfers = getIncomingTransfers(props.state, zone.id);
            const outgoingCount = outgoingTransfers.length;
            const incomingCount = incomingTransfers.length;
            const bodyId = `zone-distribution-body-${zone.id}`;

            return (
              <article key={zone.id} className={styles.zoneGroup} aria-label={`${zone.displayName} distribution`}>
                <div className={styles.zoneHeader}>
                  <strong className={styles.zoneHeaderSummary}>
                    {zone.displayName.toUpperCase()} · {zone.captainId ? 1 : 0} Captain · {' '}
                    {zoneActiveDealerCount} / {zone.dealerSlots.length} Dealers
                    {outgoingCount > 0 ? ` · ${outgoingCount} travelling` : ''}
                    {incomingCount > 0 ? ` · ${incomingCount} incoming` : ''}
                  </strong>
                  <button
                    type="button"
                    className={styles.cardCollapseButton}
                    aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${zone.displayName} distribution`}
                    aria-expanded={!isCollapsed}
                    aria-controls={bodyId}
                    onClick={() => toggleZoneCollapse(zone.id)}
                  >
                    <Icon name={isCollapsed ? 'chevron-down' : 'chevron-up'} size={16} />
                  </button>
                </div>
                <div className={styles.zoneEarningsRow}>
                  <span>Zone earnings</span>
                  <strong>{formatMoney(getZoneEarningsPerSecond(props.state, zone.id))}/s</strong>
                </div>
                {!isCollapsed ? (
                  <div id={bodyId}>
                    {outgoingTransfers.map((transfer) => {
                      const destination = props.state.zones.find((candidate) => candidate.id === transfer.destinationZoneId);
                      return destination ? (
                        <div key={transfer.id} className={styles.transferRow}>
                          <span>{transfer.dealer.name} travelling to {destination.displayName}</span>
                          <strong>{formatTransferRemaining(transfer.completesAt - props.state.lastTickAt)}</strong>
                        </div>
                      ) : null;
                    })}
                    {incomingTransfers.map((transfer) => (
                      <div key={transfer.id} className={styles.transferRow}>
                        <span>Incoming: {transfer.dealer.name}</span>
                        <strong>{formatTransferRemaining(transfer.completesAt - props.state.lastTickAt)}</strong>
                      </div>
                    ))}
                    {captain ? <div className={styles.distributionCard}>{renderCaptainCard(captain)}</div> : null}
                    {zone.dealerSlots.map((slot, slotIndex) => {
                      if (slot.dealer) return <div key={slot.id}>{renderZoneDealerCard(slot.dealer, slotIndex, zone.id)}</div>;
                      if (slot.reservedTransferId) {
                        return <div key={slot.id} className={styles.zoneSlotRow}>Transfer reserved</div>;
                      }
                      return (
                        <div key={slot.id} className={styles.zoneSlotRow}>
                          <span>Dealer spot available</span>
                          <button type="button" className={styles.buyButton} onClick={() => { setHiringTarget({ kind: 'zone', zoneId: zone.id, slotId: slot.id }); setHiringInitialTab('dealers'); }}>
                            Hire dealer
                          </button>
                          <button type="button" className={styles.unlockButton} onClick={() => setTransferDestination({ zoneId: zone.id, slotId: slot.id })}>
                            Transfer dealer
                          </button>
                        </div>
                      );
                    })}
                    <div className={styles.zoneCapacityAction}>
                      <button
                        type="button"
                        className={styles.unlockButton}
                        disabled={props.state.respect < getDealerCapacityCost(props.state.territoryLevel)}
                        onClick={() => props.buyDealerCapacity(zone.id)}
                      >
                        Add dealer capacity · {Math.round(getDealerCapacityCost(props.state.territoryLevel)).toLocaleString()} Respect
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </>
    );
  };

  const isZoneMode = props.state.zones.length > 0;
  const zoneVacancies = getAvailableZoneDealerSlots(props.state);
  const activeDealerCount = isZoneMode
    ? getActiveDealerEntries(props.state).length
    : props.state.activeDealers.filter(Boolean).length;
  const reservedSlotCount = isZoneMode
    ? props.state.zones.reduce(
      (sum, zone) => sum + zone.dealerSlots.filter((slot) => slot.reservedTransferId !== null).length,
      0,
    )
    : 0;
  const totalSlotCount = isZoneMode ? getTotalDealerCapacity(props.state) : props.state.activeDealers.length;
  const firstEmptySlotIndex = props.state.activeDealers.findIndex((seller) => seller === null);
  const hasUnassignedCaptains = (isZoneMode
    ? getUnassignedCaptains(props.state)
    : props.state.captains.filter((captain) => !props.state.activeDealers.some((seller) => seller?.id === captain.id))).length > 0;
  const hasDealerVacancy = isZoneMode ? zoneVacancies.length > 0 : firstEmptySlotIndex !== -1;
  const hiringSummary = `Hire dealers ${activeDealerCount}/${totalSlotCount}${reservedSlotCount > 0 ? ` · ${reservedSlotCount} reserved` : ''}`;
  const transferEntry = transferDealerId === null
    ? null
    : getActiveDealerEntries(props.state).find((entry) => entry.dealer.id === transferDealerId) ?? null;

  return (
    <section className={styles.panel} aria-labelledby="neond-distribution-heading">
      <h3 ref={distributionHeadingRef} id="neond-distribution-heading" className={styles.distributionColumnHeader} tabIndex={-1}>Distribution</h3>
      {isZoneMode ? renderZoneDistribution() : (
      <>
      {!hasDealerVacancy ? (
        hasUnassignedCaptains ? (
          <button
            type="button"
            className={styles.unlockButton}
            onClick={() => { setHiringTarget(null); setHiringInitialTab('captains'); }}
          >
            View unassigned Captains
          </button>
        ) : <div className={styles.label}>{hiringSummary}</div>
      ) : (
        <button
          type="button"
          className={styles.buyButton}
          onClick={() => {
            setHiringTarget(isZoneMode ? null : { kind: 'legacy', slotIndex: firstEmptySlotIndex });
            setHiringInitialTab('dealers');
          }}
        >
          {hiringSummary}
        </button>
      )}

      <div className={styles.cardStack}>
        {props.state.activeDealers.map((seller, slotIndex) => {
          const dealer = isDealer(seller) ? seller : null;
          const assignedCaptain = isCaptain(seller)
            ? props.state.captains.find((captain) => captain.id === seller.id) ?? seller
            : null;
          const isCollapsed = dealer ? collapsedSellerIds.has(dealer.id) : false;
          const bodyId = dealer ? `distribution-body-${dealer.id}` : undefined;

          return (
          <article
            key={dealer?.id ?? `empty-${slotIndex}`}
            className={styles.distributionCard}
            aria-label={dealer || assignedCaptain ? `${(dealer || assignedCaptain)!.name} distribution` : undefined}
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
            ) : assignedCaptain ? (
              renderCaptainCard(assignedCaptain, slotIndex)
            ) : (
              <div className={styles.dealerBody}>
                <h4 className={styles.productTitle}>Slot {slotIndex + 1} - Empty</h4>
              </div>
            )}
          </article>
          );
        })}
      </div>
      </>
      )}
      {hiringTarget !== undefined ? (
        <DealerHiringModal
          state={props.state}
          slotIndex={hiringTarget?.kind === 'legacy' ? hiringTarget.slotIndex : 0}
          target={hiringTarget}
          initialTab={hiringInitialTab}
          onHireSeller={props.onHireSeller}
          onHireDealer={props.onHireDealer}
          onRefreshDealers={props.onRefreshDealers}
          onRecruitCaptain={props.onRecruitCaptain}
          onUnlockZone={() => { setHiringTarget(undefined); setZoneUnlockOpen(true); }}
          onRenameCaptain={props.onRenameCaptain}
          onClose={() => {
            setHiringTarget(undefined);
            props.onCaptainManagementClosed?.();
          }}
        />
      ) : null}
      {isZoneUnlockOpen ? (
        <ZoneUnlockModal
          state={props.state}
          onConfirm={(cityId, captainId) => {
            props.onUnlockZone(cityId, captainId);
            setZoneUnlockOpen(false);
          }}
          onClose={() => setZoneUnlockOpen(false)}
        />
      ) : null}
      {transferEntry?.zoneId && transferEntry.slotId ? (
        <DealerTransferModal
          state={props.state}
          dealer={transferEntry.dealer}
          sourceZoneId={transferEntry.zoneId}
          onConfirm={(dealerId, destinationZoneId, destinationSlotId) => {
            props.transferDealer(dealerId, destinationZoneId, destinationSlotId);
            setTransferDealerId(null);
          }}
          onClose={() => setTransferDealerId(null)}
        />
      ) : null}
      {transferDestination ? (
        <DealerTransferModal
          state={props.state}
          destination={transferDestination}
          onConfirm={(dealerId, destinationZoneId, destinationSlotId) => {
            props.transferDealer(dealerId, destinationZoneId, destinationSlotId);
            setTransferDestination(null);
          }}
          onClose={() => setTransferDestination(null)}
        />
      ) : null}
    </section>
  );
}
