import React from 'react';
import { useGameEngine } from './hooks/useGameEngine';
import { UNLOCK_COSTS, PRODUCT_TIERS } from './constants';
import styles from './NeonD.module.css';

const DEALERS = [
  { name: 'Thomas "G" Palmer', selling: 'weed', volume: 3, margin: 3, bribeLevel: 0 },
  { name: 'Dutch Dave', selling: 'weed', volume: 4, margin: 2, bribeLevel: 0 },
  { name: 'Belgian Bob', selling: 'mushrooms', volume: 2, margin: 4, bribeLevel: 0 },
  { name: 'Chemist Carlos', selling: 'meth', volume: 1, margin: 5, bribeLevel: 0 },
];



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
  const { state, upgrade, unlockProduction, hireDealer, fireDealer, setBribeLevel, resetGame } = useGameEngine();

  const handleDealerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!state.dealer) return;
    hireDealer({
      ...state.dealer,
      selling: e.target.value
    });
  };

  const handleSetBribe = (level: number) => {
    setBribeLevel(level);
  };

  const getGrossRate = () => {
    if (!state.dealer) return 0;
    const activeProd = state.production[state.dealer.selling];
    const availableStock = activeProd?.stock ?? 0;
    const actualGramsSold = Math.min(availableStock, state.dealer.volume);
    const tierMult = PRODUCT_TIERS[state.dealer.selling] || 1;
    return actualGramsSold * (state.dealer.margin * tierMult);
  };

  const getNetRate = () => {
    if (!state.dealer) return 0;
    return getGrossRate();
  };

  const getBribeCost = () => {
    if (!state.dealer || state.dealer.bribeLevel === 0) return 0;
    return getNetRate() * 0.1;
  };

  const handleHireDealer = (dealerIndex: number) => {
    hireDealer(DEALERS[dealerIndex]);
  };

  const totalEarnings = state.totalEarned;

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
            ${Math.floor(state.money).toLocaleString()}
          </div>
          <div className={styles.label}>
            {state.dealer ? `($${(getNetRate() - getBribeCost()).toFixed(2)}/s)` : ''}
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
          <h3 className={styles.distributionColumnHeader}>Distribution</h3>
          
          {!state.dealer ? (
            <div className="glass-panel" style={{ marginBottom: 'var(--space-md)', padding: 'var(--space-sm)' }}>
              <p className={styles.label} style={{ marginBottom: 'var(--space-sm)' }}>Hire a dealer:</p>
              {DEALERS.map((dealer, index) => {
                const product = state.production[dealer.selling];
                const firstName = dealer.name.split(' ')[0];
                const tierMult = PRODUCT_TIERS[dealer.selling] || 1;
                const pricePerGram = dealer.margin * tierMult;
                const totalSaleValue = dealer.volume * pricePerGram;

                return (
                  <div key={index} className="glass-panel" style={{ marginBottom: 'var(--space-md)', padding: 'var(--space-md)' }}>
                    <h4 style={{ color: 'var(--accent-primary)', margin: '0 0 12px 0' }}>{dealer.name}</h4>
                    
                    <div style={{ marginBottom: '10px' }}>
                      <div className={styles.label}>Volume:</div>
                      <p style={{ fontSize: '13px', margin: '4px 0' }}>
                        {firstName} can sell up to <strong>{dealer.volume}g</strong> of <strong>{product?.name}</strong> per second, 
                        as well as <strong>0g</strong> of other drugs.
                      </p>
                    </div>

                    <div style={{ marginBottom: '15px' }}>
                      <div className={styles.label}>Margin:</div>
                      <p style={{ fontSize: '13px', margin: '4px 0' }}>
                        {firstName} sells <strong>{dealer.volume}g</strong> of {product?.name} for <strong>${totalSaleValue.toFixed(2)}</strong>.
                      </p>
                      <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        Street Price: ${pricePerGram.toFixed(2)}/g ({product?.name})
                      </p>
                    </div>

                    <button 
                      className={styles.buyButton} 
                      style={{ background: 'var(--accent-primary)' }}
                      onClick={() => handleHireDealer(index)}
                    >
                      Hire
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              <div className={`glass-panel ${styles.distributionCard}`} style={{ padding: 0, overflow: 'hidden', marginBottom: 'var(--space-md)' }}>
                <div className={styles.dealerHeader}>
                  {state.dealer.name} ({state.production[state.dealer.selling]?.name})
                </div>
                
<div style={{ padding: 'var(--space-md)' }}>
                  <div className={styles.statRow}>
                    <span className={styles.label}>Total earned:</span>
                    <span style={{ fontWeight: 'bold' }}>
                      ${Math.floor(totalEarnings).toLocaleString()} {getGrossRate() > 0 ? `($${getGrossRate().toFixed(2)}/s)` : ''}
                    </span>
                  </div>
                  <div className={styles.statRow}>
                    <span className={styles.label}>Police Bribe:</span>
                    <span style={{ color: getBribeCost() > 0 ? 'var(--accent-success)' : 'var(--text-muted)' }}>
                      {getBribeCost() > 0 ? `$${getBribeCost().toFixed(2)}/s cost` : 'None'}
                    </span>
                  </div>

                  <div className={styles.statRow} style={{ marginTop: 'var(--space-md)' }}>
                    <span className={styles.label}>Selling now:</span>
                    <select
                      value={state.dealer.selling}
                      onChange={handleDealerChange}
                      className={styles.select}
                    >
                      {visibleProduction.filter(p => state.unlockedProduction.includes(p.id)).map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.statRow}>
                    <span className={styles.label}>Volume:</span>
                    <StarRating rating={state.dealer.volume} />
                  </div>
                  <div className={styles.statRow}>
                    <span className={styles.label}>Margin:</span>
                    <StarRating rating={state.dealer.margin} />
                  </div>

                  <div style={{ marginTop: 'var(--space-sm)', display: 'grid', gap: 'var(--space-xs)' }}>
                    <button
                      className={styles.buyButton}
                      style={{ opacity: state.dealer.bribeLevel === 0 ? 1 : 0.5 }}
                      onClick={() => handleSetBribe(0)}
                    >
                      Bribe Off
                    </button>
                    <button
                      className={styles.buyButton}
                      style={{ background: 'var(--accent-success)', opacity: state.dealer.bribeLevel === 1 ? 1 : 0.5 }}
                      onClick={() => handleSetBribe(1)}
                    >
                      Bribe On
                    </button>
                  </div>

                  <div style={{ marginTop: 'var(--space-lg)', display: 'grid', gap: 'var(--space-xs)' }}>
                    <button className={styles.buyButton}>Buy Equipment</button>
                    <button
                      className={styles.dangerButton}
                      onClick={fireDealer}
                    >
                      Fire
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}