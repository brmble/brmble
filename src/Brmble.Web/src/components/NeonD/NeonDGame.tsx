import React from 'react';
import { useGameEngine } from './hooks/useGameEngine';
import styles from './NeonD.module.css';

export function NeonDGame() {
  const { state, upgrade, setDealer } = useGameEngine();

  const handleDealerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setDealer({
      ...state.dealer,
      selling: e.target.value
    });
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h2 className={styles.title}>Brmble Empire</h2>
        <div className={`glass-panel ${styles.statsBar}`}>
          <div className={styles.label}>
            Research Speed: {state.researchSpeed.toFixed(1)}x
          </div>
          <div className={styles.money}>
            ${state.money.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
        </div>
      </header>

      <div className={styles.gridLayout}>
        <section>
          <h3 className={styles.productionColumnHeader}>Productie</h3>
          
          {Object.values(state.production).map(prod => (
            <div key={prod.id} className="glass-panel production-card">
              <div className={styles.statRow}>
                <h3 className={styles.columnHeader} style={{ margin: 0, color: 'var(--text-primary)' }}>
                    {prod.name}: {prod.stock.toFixed(2)}kg
                </h3>
              </div>
              
              <div className={`${styles.statRow} ${styles.price}`}>
                <span>Gem. straatprijs: <strong>${prod.price.toFixed(2)}</strong> per gram</span>
              </div>

              <div className={styles.statRow}>
                <span className={styles.productionRate}>↑ {prod.rate.toFixed(2)}g / sec</span>
                <span className={styles.salesRate}>
                    ↓ {state.dealer.selling === prod.id ? state.dealer.salesRate.toFixed(2) : "0.00"}g / sec
                </span>
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                <button 
                  className={styles.upgradeButton}
                  onClick={() => upgrade(prod.id)}
                >
                  <span>
                    <span className={styles.level}>{prod.level}</span>
                    {" "}{prod.id === 'meth' ? 'Meth Laboratorium' : prod.id === 'weed' ? 'Cannabis Plant' : 'Paddo Farm'}
                  </span>
                  <span className={styles.upgradeCost}>(${prod.upgradeCost.toFixed(2)})</span>
                </button>
              </div>
            </div>
          ))}
        </section>

        <section>
          <h3 className={styles.distributionColumnHeader}>Distributie</h3>
          
          <div className="glass-panel" style={{ marginBottom: 'var(--space-md)', padding: 'var(--space-xs)' }}>
             <button className={styles.upgradeButton} style={{ width: '100%', justifyContent: 'center' }}>
                Dealer inhuren 1/1
             </button>
          </div>

          <div className={`glass-panel ${styles.distributionCard}`} style={{ padding: 0, overflow: 'hidden' }}>
            <div className={styles.dealerHeader}>
               {state.dealer.name} ({state.production[state.dealer.selling]?.name})
            </div>
            
            <div style={{ padding: 'var(--space-md)' }}>
                <button className={styles.upgradeButton} style={{ marginBottom: 'var(--space-md)', width: '100%' }}>
                    Politie afkopen
                </button>

                <div className={styles.statRow}>
                    <span className={styles.label}>Totaal verdiend:</span>
                    <span style={{ fontWeight: 'bold' }}>$57.49K</span>
                </div>
                <div className={`${styles.statRow} ${styles.salesRate}`} style={{ marginBottom: 'var(--space-md)' }}>
                    <span className={styles.label}>Omzet snelheid:</span>
                    <span>${(state.dealer.salesRate * state.production[state.dealer.selling]?.price).toFixed(2)} / sec</span>
                </div>

                <div className={styles.statRow}>
                    <span className={styles.label}>Verkoopt nu:</span>
                    <select 
                        value={state.dealer.selling} 
                        onChange={handleDealerChange}
                        className={styles.select}
                    >
                        {Object.values(state.production).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                </div>

                <div className={styles.statRow}>
                    <span className={styles.label}>Volume:</span>
                    <span style={{ color: 'gold' }}>★★★★</span>
                </div>
                
                <div style={{ marginTop: 'var(--space-lg)', display: 'grid', gap: 'var(--space-xs)' }}>
                    <button className={styles.upgradeButton}>Apparatuur Kopen</button>
                    <button className={styles.upgradeButton} style={{ color: 'var(--accent-secondary)' }}>Thomas Ontslaan</button>
                </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}