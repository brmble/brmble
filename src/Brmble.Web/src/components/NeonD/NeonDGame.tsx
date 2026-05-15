import { useEffect, useState } from 'react';
import { useGameEngine } from './hooks/useGameEngine';
import { UNLOCK_COSTS, PRODUCT_TIERS, SLOT_UNLOCK_COSTS, PRODUCT_ARREST_RISK } from './constants';
import { getBailCost } from './economy';
import { confirm } from '../../hooks/usePrompt';
import { Tooltip } from '../Tooltip/Tooltip';
import styles from './NeonD.module.css';



function StarRating({ rating, label, tooltipText }: { rating: number; label?: string; tooltipText?: string }) {
  const clampedRating = Math.min(5, Math.max(0, Math.round(rating)));
  const stars = '★'.repeat(clampedRating) + '☆'.repeat(5 - clampedRating);
  const text = tooltipText || (label ? `${label}: ${clampedRating}/5` : `Rating: ${clampedRating}/5`);
  return (
    <Tooltip content={text}>
      <button 
        tabIndex={0}
        aria-label={`Rating: ${clampedRating}/5`} 
        style={{ cursor: 'help', background: 'none', border: 'none', padding: 0, font: 'inherit' }}
      >
        <span style={{ color: 'gold' }} aria-hidden="true">{stars}</span>
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
  } = useGameEngine();
  const [upgradingDealerId, setUpgradingDealerId] = useState<string | null>(null);

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className={styles.title}>Brmble Empire</h2>
          {onClose && (
            <button 
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.5rem' }}
            >
              ×
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
            className={styles.upgradeButton} 
            onClick={resetGame}
            style={{ marginLeft: 'auto', flex: 0, backgroundColor: 'var(--accent-secondary)', color: 'var(--text-primary)' }}
          >
            Reset
          </button>
        </div>
      </header>

      <div className={styles.gridLayout}>
        <section>
          <h3 className={styles.productionColumnHeader}>Production</h3>
          
          {visibleProduction.map(prod => {
            const isUnlocked = state.unlockedProduction.includes(prod.id);
            const dealerSalesRate = productSalesRates[prod.id] ?? 0;
            const salesDelta = prod.rate - dealerSalesRate;
            const isProductionAhead = salesDelta > 0.001;
            const isSalesAhead = salesDelta < -0.001;

            return (
              <div key={prod.id} className={`glass-panel ${styles.productionCard}`}>
                <div className={styles.statRow}>
                  <h3 className={styles.columnHeader} style={{ margin: 0, color: 'var(--text-primary)' }}>
                      {prod.name}
                  </h3>
                  {isUnlocked && <span style={{ color: 'var(--accent-success)' }}>{prod.stock.toFixed(2)}g</span>}
                </div>
                
                {isUnlocked && (
                  <>
                    <div className={styles.statRow} style={{ marginBottom: 'var(--space-sm)' }}>
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

                    <div style={{ marginTop: 'var(--space-sm)' }}>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className={styles.distributionColumnHeader}>Distribution</h3>
            <button 
              onClick={refreshPool} 
              className={styles.label} 
              style={{ cursor: refreshCooldown ? 'not-allowed' : 'pointer', border: 'none', background: 'none', color: refreshCooldown ? 'var(--text-muted)' : 'var(--accent-primary)' }}
              disabled={!!refreshCooldown}
            >
              🔄 Refresh {refreshCooldown ? `(${refreshCooldown})` : ''}
            </button>
          </div>
          
          {state.activeDealers.map((slot, slotIndex) => {
            if (slotIndex >= state.unlockedSlots) {
              const cost = SLOT_UNLOCK_COSTS[slotIndex] || 0;
              return (
                <div key={`locked-${slotIndex}`} className="glass-panel" style={{ marginBottom: 'var(--space-md)', padding: 'var(--space-md)', opacity: 0.6 }}>
                  <div className={styles.statRow}>
                    <span className={styles.label}>Slot {slotIndex + 1}</span>
                    <span className={styles.label}>🔒 Locked</span>
                  </div>
                  <button 
                    className={styles.unlockButton}
                    style={{ width: '100%', marginTop: 'var(--space-sm)' }}
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
                <div key={`empty-${slotIndex}`} className="glass-panel" style={{ marginBottom: 'var(--space-md)', padding: 'var(--space-sm)' }}>
                  <p className={styles.label} style={{ marginBottom: 'var(--space-sm)' }}>Slot {slotIndex + 1} - Empty</p>
                  {state.availableDealers.length > 0 && (
                    <div>
                      {state.availableDealers.map((dealer) => (
                        <div key={dealer.id} className="glass-panel" style={{ marginBottom: 'var(--space-md)', padding: 'var(--space-md)' }}>
                          <h4 style={{ color: 'var(--accent-primary)', margin: '0 0 12px 0' }}>{dealer.name}</h4>
                          <div className={styles.statRow}>
                            <span className={styles.label}>Volume:</span>
                            <StarRating rating={dealer.volumeStars} label="Volume" tooltipText={`can sell up to ${Number((dealer.volume * (1 + dealer.volumeBonus)).toFixed(2))}g of ${state.production[dealer.selling]?.name || 'Weed'} per second.`} />
                          </div>
                          <div className={styles.statRow}>
                            <span className={styles.label}>Margin:</span>
                            <StarRating rating={dealer.marginStars} label="Margin" tooltipText={`sells 1g of ${state.production[dealer.selling]?.name || 'Weed'} for $${(dealer.margin * (1 + dealer.marginBonus) * (PRODUCT_TIERS[dealer.selling] || 1)).toFixed(2)}`} />
                          </div>
                          <button 
                            className={styles.buyButton} 
                            style={{ background: 'var(--accent-primary)', marginTop: 'var(--space-sm)' }}
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
                <div key={slot.id} className={`glass-panel ${styles.distributionCard}`} style={{ padding: 0, overflow: 'hidden', marginBottom: 'var(--space-md)' }}>
                  <div className={styles.dealerHeader}>
                    {slot.name} ({state.production[slot.selling]?.name})
                  </div>
                  <div style={{ padding: 'var(--space-md)' }}>
                    <div className={styles.statRow}>
                      <span className={styles.label}>Status:</span>
                      <span style={{ color: 'var(--accent-secondary)' }}>Arrested</span>
                    </div>
                    <div className={styles.statRow}>
                      <span className={styles.label}>Earnings:</span>
                      <span>$0.00/s</span>
                    </div>
                    <div style={{ display: 'grid', gap: 'var(--space-xs)', marginTop: 'var(--space-md)' }}>
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
                const upgradeCost = 500 * Math.pow(2.5, dealer.equipmentCount);
                const isMaxed = dealer.equipmentCount >= 3;
                const hasStoredPendingUpgrade = dealer.hasPendingUpgrade && dealer.pendingUpgradeOptions.length > 0;
                const isInsufficientFunds = !hasStoredPendingUpgrade && state.money < upgradeCost;
                
                return (
                  <div key={slot.id} className={`glass-panel ${styles.distributionCard}`} style={{ padding: 0, overflow: 'hidden', marginBottom: 'var(--space-md)' }}>
                    <div className={styles.dealerHeader}>
                      {slot.name} ({state.production[slot.selling]?.name})
                    </div>
                    
                    <div style={{ padding: 'var(--space-md)' }}>
                      <div className={styles.statRow}>
                        <span className={styles.label}>Slot {slotIndex + 1}</span>
                      </div>
                      
                      <div className={styles.statRow}>
                        <span className={styles.label}>Selling now:</span>
                        <select
                          value={slot.selling}
                          onChange={(e) => handleDealerChange(slot.id, e.target.value)}
                          className={styles.select}
                        >
                          {visibleProduction.filter(p => state.unlockedProduction.includes(p.id)).map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className={styles.statRow}>
                        <span className={styles.label}>Volume:</span>
                        <StarRating rating={slot.volumeStars} label="Volume" tooltipText={`can sell up to ${Number((slot.volume * (1 + slot.volumeBonus)).toFixed(2))}g of ${state.production[slot.selling]?.name || 'Weed'} per second.`} />
                        <span style={{ color: 'var(--accent-primary)', fontSize: '0.85rem' }}>({(1 + slot.volumeBonus).toFixed(1)}x)</span>
                      </div>
                      <div className={styles.statRow}>
                        <span className={styles.label}>Margin:</span>
                        <StarRating rating={slot.marginStars} label="Margin" tooltipText={`sells 1g of ${state.production[slot.selling]?.name || 'Weed'} for $${(slot.margin * (1 + slot.marginBonus) * (PRODUCT_TIERS[slot.selling] || 1)).toFixed(2)}`} />
                        <span style={{ color: 'var(--accent-primary)', fontSize: '0.85rem' }}>({(1 + slot.marginBonus).toFixed(1)}x)</span>
                      </div>
                      {!slot.isProtected && (
                        <div className={styles.statRow}>
                          <span className={styles.label}>Risk:</span>
                          <span style={{ color: 'var(--accent-secondary)' }}>
                            {PRODUCT_ARREST_RISK[slot.selling]?.label ?? 'LOW'} Risk
                          </span>
                        </div>
                      )}
                      {slot.isProtected && (
                        <div className={styles.statRow}>
                          <span className={styles.label}>Status:</span>
                          <span style={{ color: 'var(--accent-success)' }}>Protected</span>
                        </div>
                      )}

                      {slot.sideVolume > 0 && (
                        <div className={styles.statRow}>
                          <span className={styles.label}>Side Volume:</span>
                          <span style={{ color: 'var(--accent-primary)' }}>{(slot.sideVolume * 100).toFixed(1)}%</span>
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

                      <div className={styles.statRow} style={{ marginTop: 'var(--space-xs)', borderTop: '1px solid var(--glass-border)', paddingTop: 'var(--space-xs)' }}>
                        <span className={styles.label}>Earnings:</span>
                        <span className={styles.productionRate} style={{ fontWeight: 'bold' }}>
                          +${(state.lastEarningsPerDealer[slot.id] || 0).toFixed(2)}/s
                        </span>
                      </div>

                      <div className={styles.statRow} style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-sm)', borderTop: '1px solid var(--glass-border)' }}>
                        <span className={styles.label}>Equip Slots:</span>
                        <span style={{ color: 'var(--accent-primary)', fontSize: '1.2rem' }}>
                          {'●'.repeat(dealer.equipmentCount)}
                          <span style={{ opacity: 0.3 }}>{'○'.repeat(3 - dealer.equipmentCount)}</span>
                        </span>
                      </div>

                      <div style={{ marginTop: 'var(--space-sm)', display: 'grid', gap: 'var(--space-xs)' }}>
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

      {upgradingDealer?.hasPendingUpgrade && upgradingDealer.pendingUpgradeOptions.length === 3 && !upgradingDealer.isArrested && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)', display: 'flex', 
          alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div className="glass-panel" style={{ padding: 'var(--space-xl)', maxWidth: '500px' }}>
            <h3 className={styles.columnHeader}>Select Equipment</h3>
            <div style={{ display: 'grid', gap: '10px', marginTop: '20px' }}>
              {upgradingDealer.pendingUpgradeOptions.map((opt, i) => (
                <button 
                  key={i} 
                  className={opt.type === 'SIDE_HUSTLE' ? styles.dangerButton : styles.buyButton}
                  style={opt.type === 'SIDE_HUSTLE' ? { 
                    border: '2px solid gold', 
                    boxShadow: '0 0 20px rgba(255, 215, 0, 0.5)'
                  } : {}}
                  onClick={() => {
                    buyEquipment(upgradingDealer.id, opt);
                    setUpgradingDealerId(null);
                  }}
                >
                  <div style={{ fontWeight: 'bold' }}>{opt.label}</div>
                  <div style={{ fontSize: '10px', opacity: 0.8 }}>{opt.description}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
