import { useState, useRef, useEffect, useCallback } from 'react';
import type { Infrastructure, Service } from './types';
import { useGameState } from './useGameState';
import { confirm } from '../../hooks/usePrompt';
import { Select } from '../Select/Select';
import './GameUI.css';

interface GameUIProps {
  onClose: () => void;
}

type TabId = 'infrastructure' | 'upgrades' | 'hosting' | 'options';

export function GameUI({ onClose }: GameUIProps) {
  const { state, actions } = useGameState();
  const [activeTab, setActiveTab] = useState<TabId>('infrastructure');
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      actions.saveGame();
    };
  }, [actions]);

  const handleClose = useCallback(() => {
    actions.saveGame();
    onClose();
  }, [actions, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClose]);

  useEffect(() => {
    return () => {
      actions.saveGame();
    };
  }, [actions]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === 'BUTTON') return;
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - (modalRef.current?.offsetLeft || 0),
      y: e.clientY - (modalRef.current?.offsetTop || 0)
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !modalRef.current) return;
    modalRef.current.style.position = 'absolute';
    modalRef.current.style.left = `${e.clientX - dragOffset.x}px`;
    modalRef.current.style.top = `${e.clientY - dragOffset.y}px`;
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };
  
  const visibleInfrastructure = state.infrastructure.filter((infra, index) => {
    if (infra.unlocked) return true;
    const prevInfra = state.infrastructure[index - 1];
    return prevInfra && prevInfra.unlocked;
  });

  return (
    <div className="game-overlay" onClick={(e) => e.target === e.currentTarget && handleClose()}>
      <div 
        ref={modalRef}
        className="game-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-title"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        <button className="game-close-btn" onClick={handleClose} aria-label="Close">×</button>
        <div className="game-ui">
          <Header money={state.money} income={state.incomePerSecond} uploadSpeed={state.uploadSpeed} bandwidthSold={state.bandwidthSold} />
          <div className="game-body" id="game-title">
            <TabNav activeTab={activeTab} onTabChange={setActiveTab} />
            <div className="game-content">
              {activeTab === 'infrastructure' && (
                <InfrastructureTab 
                  infrastructure={visibleInfrastructure} 
                  onBuy={actions.buyInfrastructure} 
                  onUpgrade1={actions.upgrade1}
                  onUpgrade2={actions.upgrade2}
                  onUpgrade3={actions.upgrade3}
                  money={state.money} 
                />
              )}
              {activeTab === 'upgrades' && (
                <TechUpgradesTab 
                  infrastructure={state.infrastructure} 
                  money={state.money}
                  onUnlock={actions.unlockInfrastructure}
                />
              )}
              {activeTab === 'hosting' && (
                <HostingTab 
                  services={state.services}
                  uploadSpeed={state.uploadSpeed}
                  bandwidthSold={state.bandwidthSold}
                  onToggleService={actions.toggleService}
                />
              )}
              {activeTab === 'options' && (
                <OptionsTab 
                  onSetTheme={actions.setTheme}
                  onSave={actions.saveGame}
                  onLoad={actions.loadGame}
                  onReset={actions.resetGame}
                  onExport={actions.exportSave}
                  onImport={actions.importSave}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatNumber(value: number): string {
  if (value >= 1e12) return (value / 1e12).toFixed(2) + 'T';
  if (value >= 1e9) return (value / 1e9).toFixed(2) + 'B';
  if (value >= 1e6) return (value / 1e6).toFixed(2) + 'M';
  if (value >= 1e3) return (value / 1e3).toFixed(2) + 'K';
  return Math.floor(value).toLocaleString();
}

function formatBandwidth(bytes: number): string {
  if (bytes >= 1099511627776) return (bytes / 1099511627776).toFixed(2) + ' TB/s';
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB/s';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB/s';
  if (bytes >= 1024) return (bytes / 1024).toFixed(2) + ' KB/s';
  return bytes + ' B/s';
}

function Header({ money, income, uploadSpeed, bandwidthSold }: { money: number; income: number; uploadSpeed: number; bandwidthSold: number }) {
  return (
    <header className="game-header" id="game-title">
      <div className="header-stat">
        <span className="header-label">MONEY:</span>
        <span className="header-value currency">${formatNumber(money)}</span>
      </div>
      <div className="header-stat">
        <span className="header-label">UPLOAD:</span>
        <span className="header-value upload">{formatBandwidth(uploadSpeed)}</span>
      </div>
      <div className="header-stat">
        <span className="header-label">SOLD:</span>
        <span className="header-value bandwidth">{formatBandwidth(bandwidthSold)}</span>
      </div>
      <div className="header-stat">
        <span className="header-label">INCOME:</span>
        <span className="header-value income">+${formatNumber(income)}/s</span>
      </div>
    </header>
  );
}

type TabNavProps = {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
};

function TabNav({ activeTab, onTabChange }: TabNavProps) {
  const tabs: { id: TabId; label: string }[] = [
    { id: 'infrastructure', label: 'Infrastructure' },
    { id: 'upgrades', label: 'Tech Upgrades' },
    { id: 'hosting', label: 'Hosting' },
    { id: 'options', label: 'Options' },
  ];

  return (
    <nav className="tab-nav">
      {tabs.map(tab => (
        <button
          key={tab.id}
          className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

interface InfrastructureTabProps {
  infrastructure: Infrastructure[];
  onBuy: (infrastructureId: string) => void;
  onUpgrade1: (infrastructureId: string) => void;
  onUpgrade2: (infrastructureId: string) => void;
  onUpgrade3: (infrastructureId: string) => void;
  money: number;
}

function calculateCost(infra: Infrastructure): number {
  return Math.floor(infra.baseCost * Math.pow(1.15, infra.owned));
}

function calculateBandwidth(infra: Infrastructure): number {
  const upgrade1Multiplier = 1 + (infra.upgrade1Level * 0.25);
  const upgrade2Multiplier = 1 + (infra.upgrade2Level * 0.25);
  const upgrade3Multiplier = 1 + (infra.upgrade3Level * 0.25);
  const totalMultiplier = upgrade1Multiplier * upgrade2Multiplier * upgrade3Multiplier;
  return Math.floor(infra.bandwidthBytesPerSecond * totalMultiplier);
}

function InfrastructureTab({ infrastructure, onBuy, onUpgrade1, onUpgrade2, onUpgrade3, money }: InfrastructureTabProps) {
  const getNextUpgrade = (infra: Infrastructure) => {
    if (infra.upgrade1Level < 10) {
      return { name: 'Cooling', cost: infra.upgrade1Cost, action: () => onUpgrade1(infra.id), canBuy: money >= infra.upgrade1Cost };
    }
    if (infra.upgrade2Level < 10) {
      return { name: 'Heat Sink', cost: infra.upgrade2Cost, action: () => onUpgrade2(infra.id), canBuy: money >= infra.upgrade2Cost };
    }
    if (infra.upgrade3Level < 5) {
      return { name: 'Modem', cost: infra.upgrade3Cost, action: () => onUpgrade3(infra.id), canBuy: money >= infra.upgrade3Cost };
    }
    return { name: 'MAX', cost: 0, action: () => {}, canBuy: false };
  };

  return (
    <div className="infrastructure-tab">
      <h2 className="heading-section">Infrastructure</h2>
      <table className="infrastructure-table">
        <thead>
          <tr>
            <th>INFRA</th>
            <th>COST</th>
            <th>OWNED</th>
            <th>UPLOAD</th>
            <th>UPGRADE</th>
            <th>BUY</th>
          </tr>
        </thead>
        <tbody>
          {infrastructure.map(infra => {
            const cost = calculateCost(infra);
            const bandwidthPerUnit = calculateBandwidth(infra);
            const totalBandwidth = bandwidthPerUnit * infra.owned;
            const canBuy = infra.unlocked && money >= cost;
            const nextUpgrade = getNextUpgrade(infra);

            return (
              <tr key={infra.id} className={!infra.unlocked ? 'locked' : ''}>
                <td className="infra-name">{infra.name}</td>
                <td className="infra-cost">
                  {infra.unlocked ? `$${cost.toLocaleString()}` : `$${infra.unlockCost?.toLocaleString()}`}
                </td>
                <td className="infra-owned">
                  {infra.unlocked ? infra.owned : 'LOCKED'}
                </td>
                <td className="infra-bandwidth">
                  {infra.unlocked && infra.owned > 0 ? (
                    <span className="bandwidth-detail">
                      {infra.owned} × {formatBandwidth(bandwidthPerUnit)} = <span className="bandwidth-total">{formatBandwidth(totalBandwidth)}</span>
                    </span>
                  ) : infra.unlocked ? (
                    <span className="bandwidth-base">{formatBandwidth(bandwidthPerUnit)}</span>
                  ) : '-'}
                </td>
                <td className="infra-upgrade">
                  {infra.unlocked ? (
                    <button
                      className="btn btn-secondary upgrade-btn"
                      disabled={!nextUpgrade.canBuy}
                      onClick={nextUpgrade.action}
                    >
                      {nextUpgrade.name === 'MAX' ? 'MAXED' : `${nextUpgrade.name}+ $${nextUpgrade.cost.toLocaleString()}`}
                    </button>
                  ) : '-'}
                </td>
                <td className="infra-actions">
                  {infra.unlocked && (
                    <button
                      className="btn btn-primary buy-button"
                      disabled={!canBuy}
                      onClick={() => onBuy(infra.id)}
                    >
                      BUY
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TechUpgradesTab({ infrastructure, money, onUnlock }: { infrastructure: Infrastructure[]; money: number; onUnlock: (infrastructureId: string) => void }) {
  const nextUnlock = infrastructure.find(i => !i.unlocked && i.unlockCost);
  const unlockedInfrastructure = infrastructure.filter(i => i.unlocked);

  const progress = nextUnlock ? Math.min((money / nextUnlock.unlockCost!) * 100, 100) : 100;

  return (
    <div className="upgrades-tab">
      <h2 className="heading-section">Unlocks</h2>
      
      {unlockedInfrastructure.length > 0 && (
        <div className="unlocked-section">
          <h3 className="unlocked-title">Unlocked Infrastructure</h3>
          <div className="unlocked-list">
            {unlockedInfrastructure.map(infra => (
              <div key={infra.id} className="unlocked-item">
                <span className="unlocked-check">✓</span>
                <span className="unlocked-name">{infra.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {nextUnlock ? (
        <div className="unlock-card">
          <div className="unlock-info">
            <span className="unlock-label">Next Infrastructure:</span>
            <span className="unlock-value">{nextUnlock.name}</span>
          </div>
          <div className="unlock-info">
            <span className="unlock-label">Unlock Requirement:</span>
            <span className="unlock-value cost">${nextUnlock.unlockCost?.toLocaleString()}</span>
          </div>
          
          <div className="unlock-progress">
            <div className="progress-container">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <span className="progress-percent">{Math.round(progress)}%</span>
            </div>
          </div>

          {progress >= 100 ? (
            <button
              className="btn btn-primary unlock-btn"
              onClick={() => onUnlock(nextUnlock.id)}
            >
              UNLOCK {nextUnlock.name.toUpperCase()}
            </button>
          ) : (
            <div className="unlock-rewards">
              <span className="rewards-label">Reward:</span>
              <ul className="rewards-list">
                <li>Unlock {nextUnlock.name}</li>
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="all-unlocked">
          <p>All infrastructure unlocked!</p>
        </div>
      )}
    </div>
  );
}

interface HostingTabProps {
  services: Service[];
  uploadSpeed: number;
  bandwidthSold: number;
  onToggleService: (serviceId: string) => void;
}

function HostingTab({ services, uploadSpeed, bandwidthSold, onToggleService }: HostingTabProps) {
  return (
    <div className="hosting-tab">
      <div className="hosting-stats">
        <div className="stat">
          <span className="stat-label">Available:</span>
          <span className="stat-value">{formatBandwidth(uploadSpeed - bandwidthSold)}</span>
        </div>
      </div>
      
      <div className="services-section">
        <h3 className="heading-label">Automatic Services</h3>
        {services.filter(s => s.automatic).map(service => (
          <ServiceRow key={service.id} service={service} onToggle={onToggleService} />
        ))}
      </div>
      
      <div className="services-section">
        <h3 className="heading-label">Manual Services</h3>
        {services.filter(s => !s.automatic).map(service => (
          <ServiceRow key={service.id} service={service} onToggle={onToggleService} />
        ))}
      </div>
    </div>
  );
}

function ServiceRow({ service, onToggle }: { service: Service; onToggle: (id: string) => void }) {
  if (!service.unlocked) {
    return (
      <div className="service-row locked">
        <span className="service-name">{service.name}</span>
        <span className="service-requirement">Unlock: ${service.unlockRequirement.toLocaleString()}</span>
      </div>
    );
  }
  
  return (
    <div className={`service-row ${service.active ? 'active' : 'inactive'}`}>
      <span className="service-name">{service.name}</span>
      <span className="service-bandwidth">{formatBandwidth(service.bandwidthRequired)}</span>
      <span className="service-income">${service.incomePerSecond.toLocaleString()}/s</span>
      <button className={`btn ${service.active ? 'btn-danger' : 'btn-primary'}`} onClick={() => onToggle(service.id)}>
        {service.active ? 'Stop' : 'Start'}
      </button>
    </div>
  );
}

function OptionsTab({ 
  onSetTheme, 
  onSave, 
  onLoad, 
  onReset, 
  onExport,
  onImport 
}: {
  onSetTheme: (theme: string) => void;
  onSave: () => void;
  onLoad: () => void;
  onReset: () => void;
  onExport: () => string;
  onImport: (data: string) => boolean;
}) {
  const [importData, setImportData] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [volume, setVolume] = useState(50);
  const [theme, setTheme] = useState('classic');

  const handleExport = async () => {
    const data = onExport();
    try {
      await navigator.clipboard.writeText(data);
      setImportStatus('Save data copied to clipboard!');
    } catch {
      setImportStatus('Failed to copy to clipboard');
    }
    setTimeout(() => setImportStatus(null), 3000);
  };

  const handleImport = () => {
    if (!importData.trim()) {
      setImportStatus('Please paste save data first');
      return;
    }
    const success = onImport(importData);
    setImportStatus(success ? 'Save imported successfully!' : 'Invalid save data');
    if (success) setImportData('');
    setTimeout(() => setImportStatus(null), 3000);
  };

  const handleReset = async () => {
    const confirmed = await confirm({
      title: 'Reset Game',
      message: 'Are you sure you want to reset all progress? This cannot be undone.',
      confirmLabel: 'Reset',
    });
    if (confirmed) {
      onReset();
      setImportStatus('Game reset!');
      setTimeout(() => setImportStatus(null), 3000);
    }
  };

  return (
    <div className="options-tab">
      <h2 className="heading-section">Options</h2>

      <div className="options-section">
        <h3 className="options-section-title">Theme</h3>
        <Select
          value={theme}
          onChange={(val) => { setTheme(val); onSetTheme(val); }}
          options={[
            { value: 'classic', label: 'Classic' },
            { value: 'retro-terminal', label: 'Retro Terminal' },
          ]}
        />
      </div>

      <div className="options-section">
        <h3 className="options-section-title">Sound</h3>
        <div className="options-slider-container">
          <label className="options-label">Volume</label>
          <input 
            type="range" 
            min="0" 
            max="100" 
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="options-slider"
          />
          <span className="options-value">{volume}%</span>
        </div>
      </div>

      <div className="options-section">
        <h3 className="options-section-title">Game Data</h3>
        <div className="options-buttons">
          <button className="btn btn-secondary" onClick={onSave}>
            Save Now
          </button>
          <button className="btn btn-secondary" onClick={onLoad}>
            Load Save
          </button>
          <button className="btn btn-secondary" onClick={handleExport}>
            Export
          </button>
        </div>
        
        <div className="import-section">
          <label className="options-label">Import Save Data</label>
          <textarea
            className="options-textarea"
            value={importData}
            onChange={(e) => setImportData(e.target.value)}
            placeholder="Paste save data here..."
            rows={3}
          />
          <button className="btn btn-secondary" onClick={handleImport}>
            Import
          </button>
        </div>

        <div className="danger-zone">
          <button className="btn btn-danger" onClick={handleReset}>
            Reset Game
          </button>
        </div>
      </div>

      {importStatus && (
        <div className="import-status">{importStatus}</div>
      )}
    </div>
  );
}

export { Header, TabNav, InfrastructureTab, TechUpgradesTab, HostingTab, OptionsTab };
