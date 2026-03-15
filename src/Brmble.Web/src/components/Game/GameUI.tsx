import { useState } from 'react';
import { GameState, GameActions, Crop } from './types';
import './GameUI.css';

interface GameUIProps {
  state: GameState;
  actions: GameActions;
  onClose: () => void;
}

type TabId = 'crops' | 'upgrades' | 'options';

export function GameUI({ state, actions, onClose }: GameUIProps) {
  const [activeTab, setActiveTab] = useState<TabId>('crops');
  
  const visibleCrops = state.crops.filter((crop, index) => {
    if (crop.unlocked) return true;
    const prevCrop = state.crops[index - 1];
    return prevCrop && prevCrop.unlocked;
  });

  return (
    <div className="game-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="game-modal">
        <button className="game-close-btn" onClick={onClose} aria-label="Close">×</button>
        <div className="game-ui">
          <Header money={state.money} income={state.incomePerSecond} />
          <div className="game-body">
            <TabNav activeTab={activeTab} onTabChange={setActiveTab} />
            <div className="game-content">
              {activeTab === 'crops' && (
                <CropsTab 
                  crops={visibleCrops} 
                  onBuy={actions.buyCrop} 
                  onUpgradeSoil={actions.upgradeSoil}
                  onUpgradeFertilizer={actions.upgradeFertilizer}
                  onUpgradeSeeds={actions.upgradeSeeds}
                  money={state.money} 
                />
              )}
              {activeTab === 'upgrades' && (
                <UpgradesTab 
                  crops={state.crops} 
                  money={state.money}
                  onUnlock={actions.unlockCrop}
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

function Header({ money, income }: { money: number; income: number }) {
  return (
    <header className="game-header">
      <div className="header-stat">
        <span className="header-label">MONEY:</span>
        <span className="header-value currency">${formatNumber(money)}</span>
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
    { id: 'crops', label: 'Crops' },
    { id: 'upgrades', label: 'Upgrades' },
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

interface CropsTabProps {
  crops: Crop[];
  onBuy: (cropId: string) => void;
  onUpgradeSoil: (cropId: string) => void;
  onUpgradeFertilizer: (cropId: string) => void;
  onUpgradeSeeds: (cropId: string) => void;
  money: number;
}

function calculateCost(crop: Crop): number {
  return Math.floor(crop.baseCost * Math.pow(1.15, crop.owned));
}

function calculateIncome(crop: Crop): number {
  const soilMultiplier = 1 + (crop.soilLevel * 0.5);
  const fertilizerMultiplier = 1 + (crop.fertilizerLevel * 0.25);
  const seedsMultiplier = 1 + (crop.seedsLevel * 1.0);
  const totalMultiplier = soilMultiplier * fertilizerMultiplier * seedsMultiplier;
  return Math.floor(crop.baseIncome * totalMultiplier);
}

function CropsTab({ crops, onBuy, onUpgradeSoil, onUpgradeFertilizer, onUpgradeSeeds, money }: CropsTabProps) {
  const getNextUpgrade = (crop: Crop) => {
    if (crop.soilLevel < 10) {
      return { name: 'Soil', cost: crop.soilUpgradeCost, action: () => onUpgradeSoil(crop.id), canBuy: money >= crop.soilUpgradeCost };
    }
    if (crop.fertilizerLevel < 10) {
      return { name: 'Fert', cost: crop.fertilizerUpgradeCost, action: () => onUpgradeFertilizer(crop.id), canBuy: money >= crop.fertilizerUpgradeCost };
    }
    if (crop.seedsLevel < 5) {
      return { name: 'Seeds', cost: crop.seedsUpgradeCost, action: () => onUpgradeSeeds(crop.id), canBuy: money >= crop.seedsUpgradeCost };
    }
    return { name: 'MAX', cost: 0, action: () => {}, canBuy: false };
  };

  return (
    <div className="crops-tab">
      <h2 className="heading-section">Crops</h2>
      <table className="crops-table">
        <thead>
          <tr>
            <th>CROP</th>
            <th>COST</th>
            <th>OWNED</th>
            <th>GAIN/s</th>
            <th>UPGRADE</th>
            <th>BUY</th>
          </tr>
        </thead>
        <tbody>
          {crops.map(crop => {
            const cost = calculateCost(crop);
            const incomePerCrop = calculateIncome(crop);
            const totalIncome = incomePerCrop * crop.owned;
            const canBuy = crop.unlocked && money >= cost;
            const nextUpgrade = getNextUpgrade(crop);

            return (
              <tr key={crop.id} className={!crop.unlocked ? 'locked' : ''}>
                <td className="crop-name">{crop.name}</td>
                <td className="crop-cost">
                  {crop.unlocked ? `$${cost.toLocaleString()}` : `$${crop.unlockCost?.toLocaleString()}`}
                </td>
                <td className="crop-owned">
                  {crop.unlocked ? crop.owned : 'LOCKED'}
                </td>
                <td className="crop-gain">
                  {crop.unlocked && crop.owned > 0 ? (
                    <span className="gain-detail">
                      {crop.owned} × ${incomePerCrop.toLocaleString()} = <span className="gain-total">${totalIncome.toLocaleString()}/s</span>
                    </span>
                  ) : crop.unlocked ? (
                    <span className="gain-base">${incomePerCrop.toLocaleString()}/s</span>
                  ) : '-'}
                </td>
                <td className="crop-upgrade">
                  {crop.unlocked ? (
                    <button
                      className="btn btn-secondary upgrade-btn"
                      disabled={!nextUpgrade.canBuy}
                      onClick={nextUpgrade.action}
                    >
                      {nextUpgrade.name === 'MAX' ? 'MAXED' : `${nextUpgrade.name}+ $${nextUpgrade.cost.toLocaleString()}`}
                    </button>
                  ) : '-'}
                </td>
                <td className="crop-actions">
                  {crop.unlocked && (
                    <button
                      className="btn btn-primary buy-button"
                      disabled={!canBuy}
                      onClick={() => onBuy(crop.id)}
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

function UpgradesTab({ crops, money, onUnlock }: { crops: Crop[]; money: number; onUnlock: (cropId: string) => void }) {
  const nextUnlock = crops.find(c => !c.unlocked && c.unlockCost);
  const unlockedCrops = crops.filter(c => c.unlocked);

  const progress = nextUnlock ? Math.min((money / nextUnlock.unlockCost!) * 100, 100) : 100;

  return (
    <div className="upgrades-tab">
      <h2 className="heading-section">Unlocks</h2>
      
      {unlockedCrops.length > 0 && (
        <div className="unlocked-section">
          <h3 className="unlocked-title">Unlocked Crops</h3>
          <div className="unlocked-list">
            {unlockedCrops.map(crop => (
              <div key={crop.id} className="unlocked-item">
                <span className="unlocked-check">✓</span>
                <span className="unlocked-name">{crop.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {nextUnlock ? (
        <div className="unlock-card">
          <div className="unlock-info">
            <span className="unlock-label">Next Crop:</span>
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
          <p>All crops unlocked!</p>
        </div>
      )}
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

  const handleExport = () => {
    const data = onExport();
    navigator.clipboard.writeText(data);
    setImportStatus('Save data copied to clipboard!');
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

  const handleReset = () => {
    if (confirm('Are you sure you want to reset all progress? This cannot be undone.')) {
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
        <select 
          className="options-select"
          onChange={(e) => onSetTheme(e.target.value)}
          defaultValue="classic"
        >
          <option value="classic">Classic</option>
          <option value="retro-terminal">Retro Terminal</option>
        </select>
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

export { Header, TabNav, CropsTab, UpgradesTab, OptionsTab };
