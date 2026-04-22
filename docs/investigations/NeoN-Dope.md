import React, { useState, useEffect, useMemo } from 'react';

// --- Voor de preview: Simulatie van de Brmble CSS Tokens ---
const BrmbleTokens = () => (
  <style>{`
    :root {
      --space-2xs: 4px; --space-xs: 8px; --space-sm: 12px; --space-md: 16px;
      --space-lg: 24px; --space-xl: 32px;
      --text-2xs: 10px; --text-xs: 12px; --text-sm: 14px; --text-base: 16px;
      --text-lg: 20px; --text-xl: 24px; --text-4xl: 40px;
      
      --bg-deep: #0f0a1a;
      --bg-surface: rgba(255, 255, 255, 0.05);
      --bg-hover: rgba(255, 255, 255, 0.1);
      
      --accent-primary: #a855f7;
      /* Groen voor productie (success) */
      --accent-success: #22c55e;
      --accent-success-subtle: rgba(34, 197, 94, 0.2);
      /* Paars voor distributie (secondary) */
      --accent-secondary: #ec4899;
      
      --text-primary: #f5f0e8;
      --text-muted: #a1a1aa;
      
      --radius-sm: 6px; --radius-md: 8px; --radius-lg: 12px;
      --font-display: 'Inter', sans-serif;
      --font-body: 'Inter', sans-serif;
      --shadow-elevated: 0 8px 32px rgba(0,0,0,0.4);
      --glass-border: rgba(255, 255, 255, 0.1);
    }

    .app-container {
      background: var(--bg-deep);
      color: var(--text-primary);
      font-family: var(--font-body);
      min-height: 100vh;
      padding: var(--space-xl);
    }

    .glass-panel {
      background: var(--bg-surface);
      backdrop-filter: blur(12px);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-elevated);
      padding: var(--space-md);
    }

    .heading-title { font-size: 28px; font-family: var(--font-display); font-weight: 600; margin-bottom: var(--space-md); }
    .heading-section { 
        font-size: 18px; 
        text-transform: uppercase; 
        letter-spacing: 0.05em; 
        color: var(--accent-success); 
        margin-bottom: var(--space-sm);
        font-weight: 600;
    }
    .heading-label { 
        font-size: 10px; 
        text-transform: uppercase; 
        letter-spacing: 0.18em; 
        font-style: italic; 
        color: var(--text-muted);
    }

    .btn {
      padding: var(--space-xs) var(--space-md);
      border-radius: var(--radius-md);
      border: none;
      cursor: pointer;
      font-weight: 600;
      transition: transform 0.1s;
    }
    .btn:active { transform: scale(0.95); }
    .btn-primary { background: var(--accent-primary); color: white; }
    .btn-ghost { background: transparent; border: 1px solid var(--glass-border); color: var(--text-primary); }
    .btn-sm { font-size: var(--text-xs); padding: var(--space-2xs) var(--space-sm); }

    .grid-layout {
      display: grid;
      grid-template-columns: 1fr 350px;
      gap: var(--space-xl);
    }

    .production-card {
      margin-bottom: var(--space-md);
      border-left: 4px solid var(--accent-success);
    }

    .distribution-card {
      border-left: 4px solid var(--accent-secondary);
    }

    .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--space-xs);
    }

    .progress-bar {
      height: 4px;
      background: rgba(255,255,255,0.1);
      border-radius: 2px;
      overflow: hidden;
    }
    .progress-fill { height: 100%; background: var(--accent-success); transition: width 0.3s; }

    .w-full { width: 100%; }
  `}</style>
);

// --- Icons (Inline SVGs volgens gids, verpakt in Fragments om syntaxfouten te voorkomen) ---
const Icon = ({ name, size = 16, className = "" }) => {
  const icons = {
    info: (
      <>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </>
    ),
    plus: (
      <>
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </>
    ),
    user: (
      <>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </>
    ),
    zap: (
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    ),
  };

  return (
    <svg 
      width={size} height={size} viewBox="0 0 24 24" fill="none" 
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={className}
    >
      {icons[name]}
    </svg>
  );
};

// --- Hoofd Component ---
export default function App() {
  // State
  const [money, setMoney] = useState(250.00);
  const [researchSpeed, setResearchSpeed] = useState(1.0);

  const [production, setProduction] = useState({
    weed: { id: 'weed', name: 'Wiet', stock: 33.16, price: 4.20, rate: 0.2, level: 1, upgradeCost: 16.80 },
    mushrooms: { id: 'mushrooms', name: 'Paddo\'s', stock: 183.91, price: 6.00, rate: 1.2, level: 4, upgradeCost: 262.35 },
    meth: { id: 'meth', name: 'Meth', stock: 124.92, price: 10.00, rate: 1.0, level: 2, upgradeCost: 1440.00 }
  });

  const [dealer, setDealer] = useState({
    name: 'Thomas "G" Palmer',
    selling: 'weed',
    volume: 4,
    margin: 2,
    salesRate: 3.45,
    copsOff: false
  });

  // Game Tick (1 seconde)
  useEffect(() => {
    const timer = setInterval(() => {
      setProduction(prev => {
        const next = { ...prev };
        // Produceer voor elk type
        Object.keys(next).forEach(key => {
          next[key].stock += next[key].rate;
        });

        // Verkoop logica (Dealer verkoopt momenteel 'selling' type)
        const activeProd = next[dealer.selling];
        if (activeProd.stock >= dealer.salesRate) {
          activeProd.stock -= dealer.salesRate;
          setMoney(m => m + (dealer.salesRate * activeProd.price));
        }

        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [dealer.selling, dealer.salesRate]);

  // Handlers
  const buyProduction = (id) => {
    const item = production[id];
    if (money >= item.upgradeCost) {
      setMoney(m => m - item.upgradeCost);
      setProduction(prev => ({
        ...prev,
        [id]: { 
            ...item, 
            level: item.level + 1, 
            rate: item.rate + 0.1, 
            upgradeCost: item.upgradeCost * 1.5 
        }
      }));
    }
  };

  return (
    <div className="app-container">
      <BrmbleTokens />
      
      <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-xl)', alignItems: 'center' }}>
        <h2 className="heading-title" style={{ color: 'var(--accent-primary)', margin: 0 }}>Brmble Empire</h2>
        <div className="glass-panel" style={{ display: 'flex', gap: 'var(--space-lg)', alignItems: 'center', padding: 'var(--space-xs) var(--space-lg)' }}>
           <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
             <Icon name="zap" size={14} className="text-muted" />
             <span className="heading-label">Research Speed: {researchSpeed.toFixed(1)}x</span>
           </div>
           <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'bold', color: 'var(--accent-success)' }}>
             ${money.toLocaleString(undefined, { minimumFractionDigits: 2 })}
           </div>
        </div>
      </header>

      <div className="grid-layout">
        {/* Productie Kolom */}
        <section>
          <h3 className="heading-section" style={{ color: 'var(--accent-success)' }}>Productie</h3>
          
          {Object.values(production).map(prod => (
            <div key={prod.id} className="glass-panel production-card">
              <div className="stat-row">
                <h3 className="heading-section" style={{ margin: 0, color: 'var(--text-primary)' }}>
                    {prod.name}: {prod.stock.toFixed(2)}kg
                </h3>
              </div>
              
              <div className="stat-row" style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                <span>Gem. straatprijs: <strong>${prod.price.toFixed(2)}</strong> per gram</span>
              </div>

              <div className="stat-row" style={{ fontSize: 'var(--text-xs)', marginBottom: 'var(--space-md)' }}>
                <span style={{ color: 'var(--accent-success)' }}>↑ {prod.rate.toFixed(2)}g / sec</span>
                <span style={{ color: 'var(--accent-secondary)' }}>
                    ↓ {dealer.selling === prod.id ? dealer.salesRate.toFixed(2) : "0.00"}g / sec
                </span>
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                <button 
                  className="btn btn-ghost" 
                  style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  onClick={() => buyProduction(prod.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                    <span style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: '4px' }}>{prod.level}</span>
                    <span>{prod.id === 'meth' ? 'Meth Laboratorium' : prod.id === 'weed' ? 'Cannabis Plant' : 'Paddo Farm'}</span>
                  </div>
                  <span style={{ color: 'var(--accent-success)' }}>(${prod.upgradeCost.toFixed(2)})</span>
                </button>
                <button className="btn btn-ghost btn-sm"><Icon name="info" size={14} /></button>
              </div>
            </div>
          ))}
        </section>

        {/* Distributie Kolom */}
        <section>
          <h3 className="heading-section" style={{ color: 'var(--accent-secondary)' }}>Distributie</h3>
          
          <div className="glass-panel" style={{ marginBottom: 'var(--space-md)', padding: 'var(--space-xs)' }}>
             <button className="btn btn-ghost btn-sm w-full" style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-xs)' }}>
                <Icon name="user" size={14} /> Dealer inhuren 1/1
             </button>
          </div>

          <div className="glass-panel distribution-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ background: 'var(--accent-secondary)', padding: 'var(--space-xs)', textAlign: 'center', fontWeight: 'bold' }}>
               {dealer.name} ({production[dealer.selling].name})
            </div>
            
            <div style={{ padding: 'var(--space-md)' }}>
                <button className="btn btn-ghost w-full" style={{ marginBottom: 'var(--space-md)' }}>
                    Politie afkopen ({dealer.copsOff ? 'Aan' : 'Uit'})
                </button>

                <div className="stat-row">
                    <span className="heading-label">Totaal verdiend:</span>
                    <span style={{ fontWeight: 'bold' }}>$57.49K</span>
                </div>
                <div className="stat-row" style={{ color: 'var(--accent-secondary)', marginBottom: 'var(--space-md)' }}>
                    <span className="heading-label">Omzet snelheid:</span>
                    <span>${(dealer.salesRate * production[dealer.selling].price).toFixed(2)} / sec</span>
                </div>

                <div className="stat-row">
                    <span className="heading-label">Verkoopt nu:</span>
                    <select 
                        value={dealer.selling} 
                        onChange={(e) => setDealer({...dealer, selling: e.target.value})}
                        style={{ background: 'var(--bg-deep)', color: 'white', border: '1px solid var(--glass-border)', borderRadius: '4px', padding: '2px 8px' }}
                    >
                        {Object.values(production).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                </div>

                <div className="stat-row">
                    <span className="heading-label">Volume:</span>
                    <span style={{ color: 'gold' }}>★★★★</span>
                </div>
                
                <div style={{ marginTop: 'var(--space-lg)', display: 'grid', gap: 'var(--space-xs)' }}>
                    <button className="btn btn-ghost w-full">Apparatuur Kopen</button>
                    <button className="btn btn-ghost w-full" style={{ color: 'var(--accent-secondary)' }}>Thomas Ontslaan</button>
                </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}