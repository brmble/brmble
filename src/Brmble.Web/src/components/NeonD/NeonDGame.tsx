import { useState } from 'react';
import { useGameEngine } from './hooks/useGameEngine';
import type { Dealer, DealerUpgrade } from './types';
import { UNLOCK_COSTS, PRODUCT_TIERS, SLOT_UNLOCK_COSTS } from './constants';
import styles from './NeonD.module.css';



function StarRating({ rating }: { rating: number }) {
  const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
  return (
    <span aria-label={`Rating: ${rating}/5`} title={`Rating: ${rating}/5`}>
      <span style={{ color: 'gold' }} aria-hidden="true">{stars}</span>
    </span>
  );
}

function getUpgradeName(id: string): string {
  const names: Record<string, string> = {
    weed: 'Grow Op',
    mushrooms: 'Mushroom Farm',
    meth: 'Meth Lab',
    bluelotus: 'Club Lab',
    frostbite: 'Lab',
    electriclace: 'Micro-Drip',
    pharmgrade: 'Factory',
    khole: 'Lab',
    lunarregolith: 'Zero-G Lab',
    martianspores: 'Mars Chamber',
    nebulamist: 'Siphon',
    voidcrystals: 'Event Horizon',
    chronosalt: 'Accelerator',
    stardustresin: 'Solar Extractor',
    darkmatterink: 'Telepathy Lab',
    singularityshards: 'Void Rift',
    neutronflakes: 'Particle Accel',
    galacticcore: 'Core Fusion',
  };
  return names[id] || 'Lab';
}

export function NeonDGame({ onClose }: { onClose?: () => void }) {
  const { state, upgrade, unlockProduction, hireDealer, fireDealer, refreshPool, resetGame, unlockSlot, setDealerSelling, buyEquipment } = useGameEngine();
  const [upgradingDealer, setUpgradingDealer] = useState<{ dealerId: string; options: DealerUpgrade[] } | null>(null);

  const generateUpgradeOptions = (dealer: Dealer): DealerUpgrade[] => {
    const options: DealerUpgrade[] = [];
    const sideHustleProducts = state.unlockedProduction.filter(id => id !== dealer.selling);

    const rollRarity = () => {
      const roll = Math.random();
      if (roll < 0.10 && sideHustleProducts.length > 0) return 'jackpot';
      if (roll < 0.30) return 'uncommon';
      return 'common';
    };

    const commonUpgrades: DealerUpgrade[] = [
      { type: 'VOLUME', label: 'High Capacity', description: 'Volume +15%', value: 0.15 },
      { type: 'MARGIN', label: 'Premium Cut', description: 'Margin +15%', value: 0.15 },
      { type: 'ALL_AROUNDER', label: 'Packaging Expert', description: 'Volume & Margin +5%', value: 0.05 },
    ];

    const uncommonUpgrades: DealerUpgrade[] = [
      { type: 'BULK', label: 'Bulk Specialist', description: 'Volume +35%, Margin -10%', value: 0.35, marginPenalty: 0.1 },
      { type: 'NETWORK', label: 'The Network', description: 'Side Hustle Efficiency +10%', value: 0.1 },
    ];

    for (let i = 0; i < 3; i++) {
      const rarity = rollRarity();
      if (rarity === 'jackpot' && sideHustleProducts.length > 0) {
        const productId = sideHustleProducts[Math.floor(Math.random() * sideHustleProducts.length)];
        options.push({
          type: 'SIDE_HUSTLE',
          label: 'JACKPOT: Side Hustle',
          description: `Sell ${state.production[productId]?.name} at 10% volume`,
          value: 0.1,
          targetProductId: productId
        });
      } else if (rarity === 'uncommon') {
        const upgrade = uncommonUpgrades[Math.floor(Math.random() * uncommonUpgrades.length)];
        options.push({ ...upgrade });
      } else {
        const upgrade = commonUpgrades[Math.floor(Math.random() * commonUpgrades.length)];
        options.push({ ...upgrade });
      }
    }

    return options;
  };

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

  const getEffectiveSideHustle = (dealer: Dealer) =>
    Object.fromEntries(
      Object.entries(dealer.sideHustle).map(([k, v]) => [k, v * (1 + dealer.networkBonus)])
    );

  const getTotalEarningsDisplay = () => {
    const activeDealers = state.activeDealers.filter((d): d is Dealer => d !== null);
    if (activeDealers.length === 0) return 0;

    // Simulate sequential stock consumption matching the tick, so earnings can't be overstated
    const stockSnapshot: Record<string, number> = Object.fromEntries(
      Object.entries(state.production).map(([id, prod]) => [id, prod.stock])
    );

    let total = 0;
    activeDealers.forEach(dealer => {
      const totalVol = dealer.volume * dealer.volumeBonus;
      const effectiveSide = getEffectiveSideHustle(dealer);
      const sideRatio = Math.min(0.9, Object.values(effectiveSide).reduce((a, b) => a + b, 0));

      const primaryStock = stockSnapshot[dealer.selling] ?? 0;
      const primarySold = Math.min(primaryStock, totalVol * (1 - sideRatio));
      stockSnapshot[dealer.selling] = Math.max(0, primaryStock - primarySold);
      total += primarySold * (dealer.margin * dealer.marginBonus * (PRODUCT_TIERS[dealer.selling] || 1));

      Object.entries(effectiveSide).forEach(([prodId, ratio]) => {
        const sideStock = stockSnapshot[prodId] ?? 0;
        const sold = Math.min(sideStock, totalVol * ratio);
        stockSnapshot[prodId] = Math.max(0, sideStock - sold);
        total += sold * (dealer.margin * dealer.marginBonus * (PRODUCT_TIERS[prodId] || 1));
      });
    });

    return total;
  };

  const getIndividualDealerEarnings = (dealer: Dealer) => {
    const activeProd = state.production[dealer.selling];
    if (!activeProd) return 0;

    const totalVol = dealer.volume * dealer.volumeBonus;
    const effectiveSide = getEffectiveSideHustle(dealer);
    const sideRatio = Math.min(0.9, Object.values(effectiveSide).reduce((a, b) => a + b, 0));
    const primarySold = Math.min(activeProd.stock, totalVol * (1 - sideRatio));
    const tierMult = PRODUCT_TIERS[dealer.selling] || 1;
    const primaryRev = primarySold * (dealer.margin * dealer.marginBonus * tierMult);

    let sideRev = 0;
    Object.entries(effectiveSide).forEach(([prodId, ratio]) => {
      const sideProd = state.production[prodId];
      if (!sideProd) return;
      const sold = Math.min(sideProd.stock, totalVol * ratio);
      sideRev += sold * (dealer.margin * dealer.marginBonus * (PRODUCT_TIERS[prodId] || 1));
    });

    return primaryRev + sideRev;
  };

  const refreshCooldown = getRefreshCooldown();
  const allIds = Object.keys(state.production);
  const nextUnlockIndex = state.unlockedProduction.length;
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
            {state.activeDealers.filter(d => d !== null).length > 0 ? `($${(getTotalEarningsDisplay()).toFixed(2)}/s)` : ''}
          </div>
          <button 
            className={styles.upgradeButton} 
            onClick={resetGame}
            style={{ marginLeft: 'var(--space-md)', backgroundColor: 'var(--accent-secondary)', color: 'var(--text-primary)' }}
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
                      {state.availableDealers.slice(0, 2).map((dealer) => (
                        <div key={dealer.id} className="glass-panel" style={{ marginBottom: 'var(--space-md)', padding: 'var(--space-md)' }}>
                          <h4 style={{ color: 'var(--accent-primary)', margin: '0 0 12px 0' }}>{dealer.name}</h4>
                          <div className={styles.statRow}>
                            <span className={styles.label}>Volume:</span>
                            <StarRating rating={dealer.volume} />
                          </div>
                          <div className={styles.statRow}>
                            <span className={styles.label}>Margin:</span>
                            <StarRating rating={dealer.margin} />
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
            
            const dealer = slot;
                const upgradeCost = 500 * Math.pow(2.5, dealer.equipmentCount);
                const isMaxed = dealer.equipmentCount >= 3;
                
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
                        <StarRating rating={slot.volume} />
                        <span style={{ color: 'var(--accent-primary)', fontSize: '0.85rem' }}>({slot.volumeBonus.toFixed(1)}x)</span>
                      </div>
                      <div className={styles.statRow}>
                        <span className={styles.label}>Margin:</span>
                        <StarRating rating={slot.margin} />
                        <span style={{ color: 'var(--accent-primary)', fontSize: '0.85rem' }}>({slot.marginBonus.toFixed(1)}x)</span>
                      </div>

                      <div className={styles.statRow} style={{ marginTop: 'var(--space-xs)', borderTop: '1px solid var(--glass-border)', paddingTop: 'var(--space-xs)' }}>
                        <span className={styles.label}>Earnings:</span>
                        <span className={styles.productionRate} style={{ fontWeight: 'bold' }}>
                          +${getIndividualDealerEarnings(slot).toFixed(2)}/s
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
                          disabled={isMaxed || state.money < upgradeCost}
                          onClick={() => {
                            if (isMaxed) return;
                            const options = generateUpgradeOptions(dealer);
                            setUpgradingDealer({ dealerId: dealer.id, options });
                          }}
                        >
                          {isMaxed ? 'MAXED OUT' : `Upgrade ($${Math.floor(upgradeCost).toLocaleString()})`}
                        </button>
                        <button
                          className={styles.dangerButton}
                          onClick={() => {
                            if (window.confirm(`Fire ${dealer.name}? All equipment upgrades will be lost forever.`)) {
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

      {upgradingDealer && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)', display: 'flex', 
          alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div className="glass-panel" style={{ padding: 'var(--space-xl)', maxWidth: '500px' }}>
            <h3 className={styles.columnHeader}>Select Equipment</h3>
            <div style={{ display: 'grid', gap: '10px', marginTop: '20px' }}>
              {upgradingDealer.options.map((opt, i) => (
                <button 
                  key={i} 
                  className={opt.type === 'SIDE_HUSTLE' ? styles.dangerButton : styles.buyButton}
                  style={opt.type === 'SIDE_HUSTLE' ? { 
                    border: '2px solid gold', 
                    boxShadow: '0 0 20px rgba(255, 215, 0, 0.5)',
                    animation: 'pulse 1s infinite'
                  } : {}}
                  onClick={() => {
                    buyEquipment(upgradingDealer.dealerId, opt);
                    setUpgradingDealer(null);
                  }}
                >
                  <div style={{ fontWeight: 'bold' }}>{opt.label}</div>
                  <div style={{ fontSize: '10px', opacity: 0.8 }}>{opt.description}</div>
                </button>
              ))}
            </div>
            <button 
              className={styles.dangerButton} 
              style={{ marginTop: '20px', width: '100%' }}
              onClick={() => setUpgradingDealer(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}