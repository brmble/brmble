import { useEffect, useState } from 'react';
import { useGameEngine } from './hooks/useGameEngine';
import { UNLOCK_COSTS, PRODUCT_TIERS, SLOT_UNLOCK_COSTS, PRODUCT_ARREST_RISK, OPERATION_UPGRADE_DEFINITIONS } from './constants';
import { getBailCost } from './economy';
import { formatBulkCooldown, getBestBulkStreetValue } from './bulkMarket';
import { getDealerEquipmentUpgradeCost, getDealerSlotUnlockCost } from './dealerUpgrades';
import { getProductUpgradeCost } from './productUpgrades';
import { confirm } from '../../hooks/usePrompt';
import { Tooltip } from '../Tooltip/Tooltip';
import { Icon } from '../Icon/Icon';
import { Select } from '../Select';
import styles from './NeonD.module.css';



function StarRating({ rating, label, tooltipText }: { rating: number; label?: string; tooltipText?: string }) {
  const clampedRating = Math.min(5, Math.max(0, Math.round(rating)));
  const stars = `${'★'.repeat(clampedRating)}${'☆'.repeat(5 - clampedRating)}`;
  const text = tooltipText || (label ? `${label}: ${clampedRating}/5` : `Rating: ${clampedRating}/5`);
  return (
    <Tooltip content={text}>
      <button 
        tabIndex={0}
        aria-label={`Rating: ${clampedRating} of 5 stars`} 
        className={styles.ratingButton}
      >
        <span className={styles.ratingValue} aria-hidden="true">{stars}</span>
      </button>
    </Tooltip>
  );
}

function getUpgradeName(id: string): string {
  const names: Record<string, string> = {
    weed: 'Grow Op',
    mushrooms: 'Mushroom Farm',
    blueLotus: 'Club Lab',
    frostBite: 'Lab',
    electricLace: 'Micro-Drip',
    meth: 'Meth Lab',
    pharmGrade: 'Factory',
    khole: 'Lab',
    lunarRegolith: 'Zero-G Lab',
    martianSpores: 'Mars Chamber',
    nebulaMist: 'Siphon',
    voidCrystals: 'Event Horizon',
    chronoSalt: 'Accelerator',
    stardustResin: 'Solar Extractor',
    darkMatterInk: 'Telepathy Lab',
    singularityShards: 'Void Rift',
    neutronFlakes: 'Particle Accel',
    galacticCore: 'Core Fusion',
  };
  return names[id] || 'Lab';
}

function getProductSalesRates(state: ReturnType<typeof useGameEngine>['state']) {
  const salesRates: Record<string, number> = {};

  Object.keys(state.production).forEach(productId => {
    salesRates[productId] = 0;
  });

  state.activeDealers.forEach(dealer => {
    if (!dealer || dealer.isArrested) return;

    const effectiveVolume = dealer.volume * (1 + dealer.volumeBonus);
    salesRates[dealer.selling] = (salesRates[dealer.selling] ?? 0) + effectiveVolume;

    if (dealer.sideVolume > 0) {
      const bleedAmount = effectiveVolume * dealer.sideVolume;
      state.unlockedProduction.forEach(productId => {
        if (productId === dealer.selling) return;
        salesRates[productId] = (salesRates[productId] ?? 0) + bleedAmount;
      });
    }
  });

  return salesRates;
}

function formatMoney(value: number) {
  return `$${Math.round(value).toLocaleString()}`;
}

function formatAwayDuration(awayMs: number) {
  const totalMinutes = Math.floor(awayMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

export function NeonDGame({ onClose }: { onClose?: () => void }) {
  const {
    state,
    upgrade,
    unlockProduction,
    hireDealer,
    fireDealer,
    refreshPool,
    resetGame,
    unlockSlot,
    setDealerSelling,
    startDealerUpgrade,
    buyEquipment,
    toggleDealerProtection,
    payDealerBail,
    dismissOfflineEarningsSummary,
    buyOperationUpgrade,
    buyProductUpgrade,
    unlockDealerEquipmentSlot,
    sellBulk,
  } = useGameEngine();
  const [upgradingDealerId, setUpgradingDealerId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'production' | 'operations'>('production');

  const upgradingDealer = upgradingDealerId
    ? state.activeDealers.find(dealer => dealer?.id === upgradingDealerId) ?? null
    : null;

  useEffect(() => {
    if (!upgradingDealerId) return;
    if (!upgradingDealer || !upgradingDealer.hasPendingUpgrade || upgradingDealer.pendingUpgradeOptions.length === 0) {
      setUpgradingDealerId(null);
    }
  }, [upgradingDealer, upgradingDealerId]);

  const getRefreshCooldown = () => {
    const now = Date.now();
    const cooldown = 10 * 60 * 1000;
    const elapsed = now - state.lastRefreshTime;
    if (elapsed >= cooldown) return null;
    const remaining = Math.ceil((cooldown - elapsed) / 1000);
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleDealerChange = (dealerId: string, selling: string) => {
    setDealerSelling(dealerId, selling);
  };





  const refreshCooldown = getRefreshCooldown();
  const allIds = Object.keys(state.production);
  const nextUnlockIndex = state.unlockedProduction.length;
  const productSalesRates = getProductSalesRates(state);
  const bailCost = getBailCost(state.lastEarningsPerDealer);
  const visibleProduction = Object.values(state.production).filter(prod => {
    const isUnlocked = state.unlockedProduction.includes(prod.id);
    const prodIndex = allIds.indexOf(prod.id);
    return isUnlocked || prodIndex === nextUnlockIndex;
  });

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <h2 className={`heading-title ${styles.title}`}>Brmble Empire</h2>
          {onClose && (
            <button 
              onClick={onClose}
              className={styles.closeButton}
              aria-label="Close Brmble Empire"
            >
              <Icon name="x" size={20} />
            </button>
          )}
        </div>
        <div className={`glass-panel ${styles.statsBar}`}>
          <div className={styles.label}>
            Research Speed: {state.researchSpeed.toFixed(1)}x
          </div>
          <div className={styles.money}>
            ${state.money.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className={styles.label}>
            {state.activeDealers.filter(d => d !== null).length > 0 ? `($${Object.values(state.lastEarningsPerDealer).reduce((a, b) => a + b, 0).toFixed(2)}/s)` : ''}
          </div>
          <button 
            onClick={resetGame}
            className={`${styles.upgradeButton} ${styles.resetButton}`}
          >
            Reset
          </button>
        </div>
      </header>

      <div className={styles.tabBar} role="tablist" aria-label="Neon-D sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'production'}
          className={`${styles.tabButton} ${activeTab === 'production' ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab('production')}
        >
          Production
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'operations'}
          className={`${styles.tabButton} ${activeTab === 'operations' ? styles.tabButtonActive : ''}`}
          onClick={() => setActiveTab('operations')}
        >
          Operations
        </button>
      </div>

      {activeTab === 'production' && (
      <div className={styles.gridLayout}>
        <section>
          <h3 className={`heading-section ${styles.productionColumnHeader}`}>Production</h3>
          
          {visibleProduction.map(prod => {
            const isUnlocked = state.unlockedProduction.includes(prod.id);
            const dealerSalesRate = productSalesRates[prod.id] ?? 0;
            const salesDelta = prod.rate - dealerSalesRate;
            const isProductionAhead = salesDelta > 0.001;
            const isSalesAhead = salesDelta < -0.001;

            return (
              <div key={prod.id} className={`glass-panel ${styles.productionCard}`}>
                <div className={styles.statRow}>
                  <h3 className={`heading-section ${styles.productTitle}`}>
                      {prod.name}
                  </h3>
                  {isUnlocked && <span className={styles.stockValue}>{prod.stock.toFixed(2)}g</span>}
                </div>
                
                {isUnlocked && (
                  <>
                    <div className={`${styles.statRow} ${styles.spacedRow}`}>
                      <span className={styles.productionRate}>
                        Yield: <strong>+{prod.rate.toFixed(2)}g/s</strong>
                      </span>
                      <span className={styles.label}>Level {prod.level}</span>
                    </div>

                    <div className={styles.statRow}>
                      <span className={styles.salesRate} aria-hidden="true" />
                      <span
                        className={`${styles.flowIndicator} ${isProductionAhead ? styles.flowUp : ''} ${isSalesAhead ? styles.flowDown : ''}`}
                        aria-label={
                          isProductionAhead
                            ? 'Production is ahead of dealer sales'
                            : isSalesAhead
                              ? 'Dealer sales are ahead of production'
                              : 'Production and dealer sales are balanced'
                        }
                      >
                        <span
                          className={`${styles.flowArrow} ${isProductionAhead ? styles.flowArrowUp : ''} ${isSalesAhead ? styles.flowArrowDown : ''}`}
                          aria-hidden="true"
                        />
                        <span>{Math.abs(salesDelta).toFixed(2)}g/s</span>
                      </span>
                    </div>

                    <div className={styles.buttonSpacing}>
                      <button 
                        className={styles.buyButton}
                        onClick={() => upgrade(prod.id)}
                        disabled={state.money < prod.upgradeCost}
                      >
                        Buy {getUpgradeName(prod.id)} (${Math.floor(prod.upgradeCost).toLocaleString()})
                      </button>
                    </div>
                  </>
                )}

                {!isUnlocked && (
                  <button 
                    className={styles.unlockButton}
                    onClick={() => unlockProduction(prod.id)}
                    disabled={state.money < UNLOCK_COSTS[prod.id]}
                  >
                    Unlock - ${UNLOCK_COSTS[prod.id].toLocaleString()}
                  </button>
                )}
              </div>
            );
          })}
        </section>

        <section>
          <div className={styles.sectionHeader}>
            <h3 className={`heading-section ${styles.distributionColumnHeader}`}>Distribution</h3>
            <button 
              onClick={refreshPool} 
              className={`${styles.label} ${styles.refreshButton}`}
              disabled={!!refreshCooldown}
            >
              <Icon name="refresh-cw" size={14} /> Refresh {refreshCooldown ? `(${refreshCooldown})` : ''}
            </button>
          </div>
          
          {state.activeDealers.map((slot, slotIndex) => {
            if (slotIndex >= state.unlockedSlots) {
              const cost = SLOT_UNLOCK_COSTS[slotIndex] || 0;
              return (
                <div key={`locked-${slotIndex}`} className={`glass-panel ${styles.slotCard} ${styles.slotCardLocked}`}>
                  <div className={styles.statRow}>
                    <span className={styles.label}>Slot {slotIndex + 1}</span>
                    <span className={styles.label}>Locked</span>
                  </div>
                  <button 
                    className={`${styles.unlockButton} ${styles.fullWidthButton}`}
                    onClick={unlockSlot}
                    disabled={state.money < cost}
                  >
                    Unlock - ${cost.toLocaleString()}
                  </button>
                </div>
              );
            }
            
            if (slot === null) {
              return (
                <div key={`empty-${slotIndex}`} className={`glass-panel ${styles.slotCardCompact}`}>
                  <p className={`${styles.label} ${styles.spacedRow}`}>Slot {slotIndex + 1} - Empty</p>
                  {state.availableDealers.length > 0 && (
                    <div>
                      {state.availableDealers.map((dealer) => (
                        <div key={dealer.id} className={`glass-panel ${styles.dealerCard}`}>
                          <h4 className={`heading-label ${styles.dealerName}`}>{dealer.name}</h4>
                          <div className={styles.statRow}>
                            <span className={styles.label}>Volume:</span>
                            <StarRating rating={dealer.volumeStars} label="Volume" tooltipText={`can sell up to ${Number((dealer.volume * (1 + dealer.volumeBonus)).toFixed(2))}g of ${state.production[dealer.selling]?.name || 'Weed'} per second.`} />
                          </div>
                          <div className={styles.statRow}>
                            <span className={styles.label}>Margin:</span>
                            <StarRating rating={dealer.marginStars} label="Margin" tooltipText={`sells 1g of ${state.production[dealer.selling]?.name || 'Weed'} for $${(dealer.margin * (1 + dealer.marginBonus) * (PRODUCT_TIERS[dealer.selling] || 1)).toFixed(2)}`} />
                          </div>
                          <button 
                            className={`${styles.buyButton} ${styles.primaryHireButton}`}
                            onClick={() => hireDealer(dealer, slotIndex)}
                          >
                            Hire to Slot {slotIndex + 1}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            
            if (slot.isArrested) {
              return (
                <div key={slot.id} className={`glass-panel ${styles.distributionCard} ${styles.distributionPanel}`}>
                  <div className={styles.dealerHeader}>
                    {slot.name} ({state.production[slot.selling]?.name})
                  </div>
                  <div className={styles.dealerBody}>
                    <div className={styles.statRow}>
                      <span className={styles.label}>Status:</span>
                      <span className={styles.dangerText}>Arrested</span>
                    </div>
                    <div className={styles.statRow}>
                      <span className={styles.label}>Earnings:</span>
                      <span>$0.00/s</span>
                    </div>
                    <div className={styles.actionStack}>
                      <button 
                        className={styles.buyButton} 
                        onClick={() => payDealerBail(slot.id)}
                        disabled={state.money < bailCost}
                      >
                        Pay Bail ({formatMoney(bailCost)})
                      </button>
                      <button className={styles.dangerButton} onClick={() => fireDealer(slot.id)}>
                        Fire Dealer
                      </button>
                    </div>
                  </div>
                </div>
              );
            }

            const dealer = slot;
                const upgradeCost = getDealerEquipmentUpgradeCost(dealer.equipmentCount);
                const isMaxed = dealer.equipmentCount >= dealer.maxEquipmentSlots;
                const hasStoredPendingUpgrade = dealer.hasPendingUpgrade && dealer.pendingUpgradeOptions.length > 0;
                const isInsufficientFunds = !hasStoredPendingUpgrade && state.money < upgradeCost;
                
                return (
                  <div key={slot.id} className={`glass-panel ${styles.distributionCard} ${styles.distributionPanel}`}>
                    <div className={styles.dealerHeader}>
                      {slot.name} ({state.production[slot.selling]?.name})
                    </div>
                    
                    <div className={styles.dealerBody}>
                      <div className={styles.statRow}>
                        <span className={styles.label}>Slot {slotIndex + 1}</span>
                      </div>
                      
                      <div className={styles.statRow}>
                        <span className={styles.label}>Selling now:</span>
                        <Select
                          value={slot.selling}
                          onChange={(value) => handleDealerChange(slot.id, value)}
                          className={styles.select}
                          options={visibleProduction
                            .filter(p => state.unlockedProduction.includes(p.id))
                            .map(p => ({ value: p.id, label: p.name }))}
                        />
                      </div>

                      <div className={styles.statRow}>
                        <span className={styles.label}>Volume:</span>
                        <StarRating rating={slot.volumeStars} label="Volume" tooltipText={`can sell up to ${Number((slot.volume * (1 + slot.volumeBonus)).toFixed(2))}g of ${state.production[slot.selling]?.name || 'Weed'} per second.`} />
                        <span className={styles.bonusText}>({(1 + slot.volumeBonus).toFixed(1)}x)</span>
                      </div>
                      <div className={styles.statRow}>
                        <span className={styles.label}>Margin:</span>
                        <StarRating rating={slot.marginStars} label="Margin" tooltipText={`sells 1g of ${state.production[slot.selling]?.name || 'Weed'} for $${(slot.margin * (1 + slot.marginBonus) * (PRODUCT_TIERS[slot.selling] || 1)).toFixed(2)}`} />
                        <span className={styles.bonusText}>({(1 + slot.marginBonus).toFixed(1)}x)</span>
                      </div>
                      {!slot.isProtected && (
                        <div className={styles.statRow}>
                          <span className={styles.label}>Risk:</span>
                          <span className={styles.dangerText}>
                            {PRODUCT_ARREST_RISK[slot.selling]?.label ?? 'LOW'} Risk
                          </span>
                        </div>
                      )}
                      {slot.isProtected && (
                        <div className={styles.statRow}>
                          <span className={styles.label}>Status:</span>
                          <span className={styles.successText}>Protected</span>
                        </div>
                      )}

                      {slot.sideVolume > 0 && (
                        <div className={styles.statRow}>
                          <span className={styles.label}>Side Volume:</span>
                          <span className={styles.sideVolumeValue}>{(slot.sideVolume * 100).toFixed(1)}%</span>
                        </div>
                      )}

                      <div className={styles.toggleRow}>
                        <div>
                          <div className={styles.toggleLabel}>Pay off cops</div>
                          <div className={styles.toggleHint}>-15% income</div>
                        </div>
                        <button
                          type="button"
                          className={styles.toggleButton}
                          aria-label="Pay off cops"
                          aria-pressed={slot.isProtected}
                          onClick={() => toggleDealerProtection(slot.id)}
                        >
                          <span className={styles.toggleTrack} data-active={slot.isProtected}>
                            <span className={styles.toggleThumb} data-active={slot.isProtected} />
                          </span>
                        </button>
                      </div>

                      <div className={`${styles.statRow} ${styles.incomeRow}`}>
                        <span className={styles.label}>Earnings:</span>
                        <span className={`${styles.productionRate} ${styles.boldValue}`}>
                          +${(state.lastEarningsPerDealer[slot.id] || 0).toFixed(2)}/s
                        </span>
                      </div>

                      <div className={`${styles.statRow} ${styles.equipmentRow}`}>
                        <span className={styles.label}>Equip Slots:</span>
                        <span className={styles.equipmentSlots}>
                          {dealer.equipmentCount}/{dealer.maxEquipmentSlots} filled
                        </span>
                      </div>

                      <div className={styles.actionStack}>
                        <button
                          className={styles.buyButton}
                          disabled={isMaxed || isInsufficientFunds}
                          onClick={() => {
                            if (isMaxed) return;
                            startDealerUpgrade(dealer.id);
                            setUpgradingDealerId(dealer.id);
                          }}
                        >
                          {isMaxed ? 'MAXED OUT' : `Upgrade ($${Math.floor(upgradeCost).toLocaleString()})`}
                        </button>
                        {dealer.maxEquipmentSlots < 5 && (() => {
                          const slotCost = getDealerSlotUnlockCost(dealer.maxEquipmentSlots);
                          return (
                            <button
                              className={styles.buyButton}
                              disabled={state.money < slotCost}
                              onClick={() => unlockDealerEquipmentSlot(dealer.id)}
                            >
                              Unlock Slot {dealer.maxEquipmentSlots + 1} ({formatMoney(slotCost)})
                            </button>
                          );
                        })()}
                        <button
                          className={styles.dangerButton}
                          onClick={async () => {
                            const confirmed = await confirm({
                              title: 'Fire Dealer?',
                              message: `Fire ${dealer.name}? All equipment upgrades will be lost forever.`,
                              confirmLabel: 'Fire',
                              cancelLabel: 'Cancel',
                            });
                            if (confirmed) {
                              fireDealer(slot.id);
                            }
                          }}
                        >
                          Fire Dealer
                        </button>
                      </div>
                    </div>
                  </div>
);
      })}
        </section>
      </div>
      )}

      {activeTab === 'operations' && (
        <div className={styles.operationsLayout}>
          <section className={`glass-panel ${styles.operationsPanel}`}>
            <h3 className={`heading-section ${styles.columnHeader}`}>Dealer Operations</h3>
            {Object.entries(OPERATION_UPGRADE_DEFINITIONS).map(([id, definition]) => {
              const typedId = id as keyof typeof OPERATION_UPGRADE_DEFINITIONS;
              const level = state.operationUpgrades[typedId];
              const nextCost = definition.costs[level];
              return (
                <div key={id} className={styles.operationCard}>
                  <div>
                    <h4 className={`heading-label ${styles.operationTitle}`}>{definition.label}</h4>
                    <p className={styles.label}>{definition.description}</p>
                    <span className={styles.label}>Level {level}/{definition.maxLevel}</span>
                  </div>
                  <button
                    className={styles.buyButton}
                    disabled={level >= definition.maxLevel || state.money < nextCost}
                    onClick={() => buyOperationUpgrade(typedId)}
                  >
                    {level >= definition.maxLevel ? 'Maxed' : `Upgrade (${formatMoney(nextCost)})`}
                  </button>
                </div>
              );
            })}
          </section>

          <section className={`glass-panel ${styles.operationsPanel}`}>
            <h3 className={`heading-section ${styles.columnHeader}`}>Product Specialization</h3>
            {state.unlockedProduction.map(productId => {
              const product = state.production[productId];
              const tracks = state.productUpgrades[productId];
              if (!product || !tracks) return null;
              return (
                <div key={productId} className={styles.productUpgradeCard}>
                  <h4 className={`heading-label ${styles.operationTitle}`}>{product.name}</h4>
                  {Object.values(tracks).map(track => {
                    const cost = getProductUpgradeCost(track.category, track.level);
                    return (
                      <button
                        key={track.category}
                        className={styles.upgradeTrackButton}
                        disabled={track.level >= track.maxLevel || state.money < cost}
                        onClick={() => buyProductUpgrade(productId, track.category)}
                      >
                        {track.category}: {track.level}/{track.maxLevel} ({track.level >= track.maxLevel ? 'Maxed' : formatMoney(cost)})
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </section>

          <section className={`glass-panel ${styles.operationsPanel}`}>
            <h3 className={`heading-section ${styles.columnHeader}`}>Bulk Market</h3>
            {visibleProduction.filter(product => state.unlockedProduction.includes(product.id)).map(product => {
              const remainingMs = Math.max(0, state.bulkMarket.cooldownUntil - Date.now());
              const hasCooldown = remainingMs > 0;
              const streetValuePercent = getBestBulkStreetValue(state.activeDealers, state.operationUpgrades.bulkNetwork);
              const isLocked = streetValuePercent <= 0;
              return (
                <div key={product.id} className={styles.bulkRow}>
                  <span>{product.name}: {product.stock.toFixed(2)}g</span>
                  <button
                    className={styles.buyButton}
                    disabled={isLocked || hasCooldown || product.stock <= 0}
                    onClick={() => sellBulk(product.id)}
                  >
                    {isLocked ? 'Bulk Locked' : hasCooldown ? `Cooldown ${formatBulkCooldown(remainingMs)}` : 'Sell Bulk'}
                  </button>
                </div>
              );
            })}
          </section>
        </div>
      )}

      {upgradingDealer?.hasPendingUpgrade && upgradingDealer.pendingUpgradeOptions.length === 3 && !upgradingDealer.isArrested && (
        <div className={styles.equipmentModalOverlay}>
          <div className={`glass-panel ${styles.equipmentModal}`}>
            <h3 className={`heading-section ${styles.columnHeader}`}>Select Equipment</h3>
            <div className={styles.equipmentOptions}>
              {upgradingDealer.pendingUpgradeOptions.map((opt, i) => (
                <button 
                  key={i} 
                  className={opt.type === 'SIDE_HUSTLE' ? `${styles.dangerButton} ${styles.sideHustleOption}` : styles.buyButton}
                  onClick={() => {
                    buyEquipment(upgradingDealer.id, opt);
                    setUpgradingDealerId(null);
                  }}
                >
                  <div className={styles.equipmentOptionLabel}>{opt.label}</div>
                  <div className={styles.rarityPill} data-rarity={opt.rarity.toLowerCase()}>{opt.rarity}</div>
                  {opt.tone === 'MIXED' && <div className={styles.highRiskLabel}>High Risk</div>}
                  <div className={styles.equipmentOptionDescription}>{opt.description}</div>
                  <div className={styles.effectList}>
                    {opt.effects.map(effect => (
                      <span
                        key={`${effect.stat}-${effect.label}`}
                        className={effect.isNegative ? styles.negativeEffect : styles.positiveEffect}
                      >
                        {effect.label}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {state.offlineEarningsSummary && (
        <div className={styles.equipmentModalOverlay}>
          <div className={`glass-panel animate-slide-up ${styles.offlineSummaryModal}`}>
            <h3 className={`heading-section ${styles.columnHeader}`}>Welcome back</h3>
            <p className={styles.offlineSummaryText}>
              You've been away for {formatAwayDuration(state.offlineEarningsSummary.awayMs)}.
            </p>
            <p className={styles.offlineSummaryText}>
              In that time, you've earned {formatMoney(state.offlineEarningsSummary.earned)}.
            </p>
            <button className={styles.buyButton} onClick={dismissOfflineEarningsSummary}>
              Accept
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
