import { useState, useCallback, useEffect } from 'react';
import type { Infrastructure, License, Advertisement } from './types';
import { useGameState } from './useGameState';
import { confirm } from '../../hooks/usePrompt';
import { Select } from '../Select/Select';
import { Tooltip } from '../Tooltip/Tooltip';
import './GameUI.css';

interface GameUIProps {
  onClose: () => void;
}

type TabId = 'infrastructure' | 'upgrades' | 'hosting';

export function GameUI({ onClose }: GameUIProps) {
  const { state, actions } = useGameState();
  const [activeTab, setActiveTab] = useState<TabId>('infrastructure');
  const [showImportModal, setShowImportModal] = useState(false);
  const [importData, setImportData] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);

  useEffect(() => {
    return () => {
      actions.saveGame();
    };
  }, [actions]);
  
  const handleClose = useCallback(() => {
    actions.saveGame();
    onClose();
  }, [actions, onClose]);
  
  const handleReset = useCallback(async () => {
    const confirmed = await confirm({
      title: 'Reset Game',
      message: 'Are you sure you want to reset all progress? This cannot be undone.',
      confirmLabel: 'Reset',
    });
    if (confirmed) {
      actions.resetGame();
    }
  }, [actions]);
  
  const visibleInfrastructure = state.infrastructure.filter((infra, index) => {
    if (infra.unlocked) return true;
    const prevInfra = state.infrastructure[index - 1];
    return prevInfra && prevInfra.unlocked;
  });

  return (
    <div className="game-container">
      <div className="game-header-row">
        <Header 
          money={state.money} 
          income={state.incomePerSecond} 
          uploadSpeed={state.uploadSpeed} 
          bandwidthAllocated={state.bandwidthAllocated} 
          onClose={handleClose}
          onExport={actions.exportSave}
          onReset={handleReset}
          onOpenImport={() => setShowImportModal(true)}
          onShowSaveConfirm={() => setShowSaveConfirm(true)}
        />
      </div>
      <div className="game-body">
        <TabNav activeTab={activeTab} onTabChange={setActiveTab} />
        <div className="game-content">
        {activeTab === 'infrastructure' && (
          <InfrastructureTab 
            infrastructure={visibleInfrastructure} 
            onBuy={actions.buyInfrastructure} 
            onUpgrade={actions.upgradeInfrastructure}
            money={state.money} 
          />
        )}
        {activeTab === 'upgrades' && (
          <TechUpgradesTab 
            infrastructure={state.infrastructure} 
            licenses={state.licenses}
            money={state.money}
            onUnlockLicense={actions.unlockLicense}
          />
        )}
        {activeTab === 'hosting' && (
          <HostingTab 
            licenses={state.licenses}
            uploadSpeed={state.uploadSpeed}
            bandwidthAllocated={state.bandwidthAllocated}
            onUnlockLicense={actions.unlockLicense}
            onUpgradeLicense={actions.upgradeLicense}
            onAllocate={actions.allocateBandwidth}
            money={state.money}
            advertisements={state.advertisements}
            adSlots={state.adSlots}
            lastAdRefresh={state.lastAdRefresh}
            onRefreshAd={actions.refreshAdvertisement}
            onAssignAd={actions.assignAdToLicense}
            generateAdOptions={actions.generateAdOptions}
          />
        )}
        </div>
      </div>
      
      {showImportModal && (
        <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="prompt glass-panel animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="heading-title modal-title">Load Save</h2>
              <p className="modal-subtitle">Paste your save data below:</p>
            </div>
            <div className="modal-body">
              <textarea
                className="import-textarea"
                value={importData}
                onChange={e => setImportData(e.target.value)}
                placeholder="Paste save data here..."
                rows={6}
              />
              {importStatus && (
                <p className={`import-status ${importStatus.includes('Invalid') ? 'error' : 'success'}`}>
                  {importStatus}
                </p>
              )}
            </div>
            <div className="prompt-footer">
              <button className="btn btn-secondary" onClick={() => {
                setShowImportModal(false);
                setImportData('');
                setImportStatus(null);
              }}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={() => {
                if (!importData.trim()) {
                  setImportStatus('Please paste save data first');
                  return;
                }
                const success = actions.importSave(importData);
                if (success) {
                  setImportStatus('Game loaded!');
                  setTimeout(() => {
                    setShowImportModal(false);
                    setImportData('');
                    setImportStatus(null);
                  }, 1000);
                } else {
                  setImportStatus('Invalid save data');
                }
              }}>
                Load
              </button>
            </div>
          </div>
        </div>
      )}
      
      {showSaveConfirm && (
        <div className="modal-overlay" onClick={() => setShowSaveConfirm(false)}>
          <div className="prompt glass-panel animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="heading-title modal-title">Save Copied!</h2>
              <p className="modal-subtitle">Your save data has been copied to clipboard.</p>
            </div>
            <div className="prompt-footer">
              <button className="btn btn-primary" onClick={() => setShowSaveConfirm(false)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
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

function Header({ money, income, uploadSpeed, bandwidthAllocated, onClose, onExport, onReset, onOpenImport, onShowSaveConfirm }: { money: number; income: number; uploadSpeed: number; bandwidthAllocated: number; onClose?: () => void; onExport?: () => string; onReset?: () => void; onOpenImport?: () => void; onShowSaveConfirm?: () => void }) {
  const freeAmount = Math.max(0, uploadSpeed - bandwidthAllocated);
  
  const handleExport = async () => {
    if (!onExport) return;
    const data = onExport();
    try {
      await navigator.clipboard.writeText(data);
      onShowSaveConfirm?.();
    } catch {
      // silent fail
    }
  };
  
  return (
    <header className="game-header" id="game-title">
      <Tooltip content="Your hosting empire" position="bottom">
        <div className="header-title">Hosting Empire</div>
      </Tooltip>
      <Tooltip content="Total upload capacity from your infrastructure" position="bottom">
        <div className="header-stat">
          <span className="header-label">UPLOAD:</span>
          <span className="header-value upload">{formatBandwidth(uploadSpeed)}</span>
        </div>
      </Tooltip>
      <Tooltip content="Bandwidth allocated to licenses" position="bottom">
        <div className="header-stat">
          <span className="header-label">USED:</span>
          <span className="header-value bandwidth">{formatBandwidth(bandwidthAllocated)}</span>
        </div>
      </Tooltip>
      <Tooltip content="Available bandwidth for new licenses" position="bottom">
        <div className="header-stat">
          <span className="header-label">FREE:</span>
          <span className="header-value free">{formatBandwidth(freeAmount)}</span>
        </div>
      </Tooltip>
      <Tooltip content="Money earned per second from services" position="bottom">
        <div className="header-stat">
          <span className="header-label">INCOME:</span>
          <span className="header-value income">+${formatNumber(income)}/s</span>
        </div>
      </Tooltip>
      <Tooltip content="Your current balance" position="bottom">
        <div className="header-stat">
          <span className="header-label">MONEY:</span>
          <span className="header-value currency">${formatNumber(money)}</span>
        </div>
      </Tooltip>
      <div className="header-actions">
        {onExport && (
          <button className="btn btn-secondary btn-sm" onClick={handleExport}>
            Save
          </button>
        )}
        {onOpenImport && (
          <button className="btn btn-secondary btn-sm" onClick={onOpenImport}>
            Load
          </button>
        )}
        {onReset && (
          <button className="btn btn-danger btn-sm" onClick={onReset}>
            Reset
          </button>
        )}
        {onClose && (
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            Close
          </button>
        )}
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
    { id: 'hosting', label: 'Hosting' },
    { id: 'upgrades', label: 'Tech Upgrades' },
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
  onUpgrade: (infrastructureId: string) => void;
  money: number;
}

function calculateCost(infra: Infrastructure): number {
  return Math.floor(infra.baseCost * Math.pow(1.15, infra.owned));
}

function calculateBandwidth(infra: Infrastructure): number {
  const multiplier = 1 + (infra.upgrade1Level * 0.25);
  return Math.floor(infra.bandwidthBytesPerSecond * infra.owned * multiplier);
}

function InfrastructureTab({ infrastructure, onBuy, onUpgrade, money }: InfrastructureTabProps) {
  const getNextUpgrade = (infra: Infrastructure) => {
    const upgradeName = 'Upgrade';
    return { name: upgradeName, level: infra.upgrade1Level, cost: infra.upgrade1Cost, action: () => onUpgrade(infra.id), canBuy: money >= infra.upgrade1Cost };
  };

  return (
    <div className="hosting-tab">
      <div className="services-section">
        {infrastructure.map(infra => {
          const cost = calculateCost(infra);
          const bandwidthPerUnit = calculateBandwidth(infra);
          const canBuy = infra.unlocked && money >= cost;
          const nextUpgrade = getNextUpgrade(infra);

          if (!infra.unlocked) {
            return (
              <div key={infra.id} className="infra-row locked">
                <span className="service-name">{infra.name}</span>
                <span className="service-requirement">Unlock: ${infra.unlockCost?.toLocaleString()}</span>
              </div>
            );
          }

          return (
            <div key={infra.id} className="infra-row">
              <div className="infra-info">
                <span className="service-name">{infra.name}</span>
                <span className="infra-stats">
                  Owned: {infra.owned} | {formatBandwidth(bandwidthPerUnit)}/unit
                </span>
              </div>
              <div className="infra-upgrades">
                <button
                  className="btn btn-secondary upgrade-btn"
                  disabled={!nextUpgrade.canBuy}
                  onClick={nextUpgrade.action}
                >
                  {`Lv.${nextUpgrade.level + 1} $${nextUpgrade.cost.toLocaleString()}`}
                </button>
              </div>
              <div className="service-cost-col">
                <span className="service-cost">${cost.toLocaleString()}</span>
              </div>
              <button
                className="btn btn-primary"
                disabled={!canBuy}
                onClick={() => onBuy(infra.id)}
              >
                Buy
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TechUpgradesTab({ infrastructure, licenses, money, onUnlockLicense }: { infrastructure: Infrastructure[]; licenses: License[]; money: number; onUnlockLicense: (licenseId: string) => void }) {
  const nextInfraUnlock = infrastructure.find(i => !i.unlocked && i.unlockCost);
  const unlockedInfrastructure = infrastructure.filter(i => i.unlocked);
  const nextLicenseUnlock = licenses.find(l => !l.unlocked);
  const unlockedLicenses = licenses.filter(l => l.unlocked);

  const infraProgress = nextInfraUnlock ? Math.min((money / nextInfraUnlock.unlockCost!) * 100, 100) : 100;
  const licenseProgress = nextLicenseUnlock ? Math.min((money / nextLicenseUnlock.unlockCost) * 100, 100) : 100;

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

      {unlockedLicenses.length > 0 && (
        <div className="unlocked-section">
          <h3 className="unlocked-title">Unlocked Licenses</h3>
          <div className="unlocked-list">
            {unlockedLicenses.map(license => (
              <div key={license.id} className="unlocked-item">
                <span className="unlocked-check">✓</span>
                <span className="unlocked-name">{license.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {nextInfraUnlock ? (
        <div className="unlock-card">
          <div className="unlock-info">
            <span className="unlock-label">Next Infrastructure:</span>
            <span className="unlock-value">{nextInfraUnlock.name}</span>
          </div>
          <div className="unlock-info">
            <span className="unlock-label">Unlock Requirement:</span>
            <span className="unlock-value cost">${nextInfraUnlock.unlockCost?.toLocaleString()}</span>
          </div>
          
          <div className="unlock-progress">
            <div className="progress-container">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${infraProgress}%` }} />
              </div>
              <span className="progress-percent">{Math.round(infraProgress)}%</span>
            </div>
          </div>

          {infraProgress >= 100 ? (
            <div className="unlock-rewards">
              <span className="rewards-label">Available - Purchase infrastructure to unlock</span>
            </div>
          ) : (
            <div className="unlock-rewards">
              <span className="rewards-label">Reward:</span>
              <ul className="rewards-list">
                <li>Unlock {nextInfraUnlock.name}</li>
              </ul>
            </div>
          )}
        </div>
      ) : nextLicenseUnlock ? null : (
        <div className="all-unlocked">
          <p>All infrastructure unlocked!</p>
        </div>
      )}

      {nextLicenseUnlock && (
        <div className="unlock-card">
          <div className="unlock-info">
            <span className="unlock-label">Next License:</span>
            <span className="unlock-value">{nextLicenseUnlock.name}</span>
          </div>
          <div className="unlock-info">
            <span className="unlock-label">Unlock Requirement:</span>
            <span className="unlock-value cost">${nextLicenseUnlock.unlockCost.toLocaleString()}</span>
          </div>
          
          <div className="unlock-progress">
            <div className="progress-container">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${licenseProgress}%` }} />
              </div>
              <span className="progress-percent">{Math.round(licenseProgress)}%</span>
            </div>
          </div>

          {licenseProgress >= 100 ? (
            <button
              className="btn btn-primary unlock-btn"
              onClick={() => onUnlockLicense(nextLicenseUnlock.id)}
            >
              UNLOCK {nextLicenseUnlock.name.toUpperCase()}
            </button>
          ) : (
            <div className="unlock-rewards">
              <span className="rewards-label">Reward:</span>
              <ul className="rewards-list">
                <li>Unlock {nextLicenseUnlock.name}</li>
              </ul>
            </div>
          )}
        </div>
      )}

      {!nextInfraUnlock && !nextLicenseUnlock && (
        <div className="all-unlocked">
          <p>All upgrades unlocked!</p>
        </div>
      )}
    </div>
  );
}

interface HostingTabProps {
  licenses: License[];
  uploadSpeed: number;
  bandwidthAllocated: number;
  onUnlockLicense: (licenseId: string) => void;
  onUpgradeLicense: (licenseId: string) => void;
  onAllocate: (licenseId: string, amount: number) => void;
  money: number;
  advertisements: Advertisement[];
  adSlots: number;
  lastAdRefresh: number;
  onRefreshAd: (ad: Advertisement) => void;
  onAssignAd: (adId: string, licenseId: string) => void;
  generateAdOptions: () => Advertisement[];
}

interface AdSelectionModalProps {
  isOpen: boolean;
  options: Advertisement[];
  onSelect: (ad: Advertisement) => void;
  onClose: () => void;
}

function AdSelectionModal({ isOpen, options, onSelect, onClose }: AdSelectionModalProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="ad-modal glass-panel animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="ad-modal-header">
          <h2 className="heading-title">Choose Your Ad Contract</h2>
        </div>
        <div className="ad-modal-cards">
          {options.map(ad => (
            <div key={ad.id} className="ad-card">
              <span className="ad-card-type">{ad.type}</span>
              <span className="ad-card-name">{ad.name}</span>
              <div className="ad-card-stats">
                <span>Vol: {'★'.repeat(ad.volume)}{'☆'.repeat(5-ad.volume)}</span>
                <span>Mar: {'★'.repeat(ad.margin)}{'☆'.repeat(5-ad.margin)}</span>
              </div>
              <button className="btn btn-primary" onClick={() => onSelect(ad)}>
                Select
              </button>
            </div>
          ))}
        </div>
        <div className="ad-modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

interface AdSlotsSectionProps {
  advertisements: Advertisement[];
  adSlots: number;
  lastAdRefresh: number;
  onRefreshAd: (ad: Advertisement) => void;
  onAssignAd: (adId: string, licenseId: string) => void;
  onFindNewAd: () => void;
  licenses: License[];
}

function AdSlotsSection({ advertisements, adSlots, lastAdRefresh, onRefreshAd, onAssignAd, onFindNewAd, licenses }: AdSlotsSectionProps) {
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const cooldown = 5 * 60 * 1000;
      setTimeLeft(Math.max(0, cooldown - (now - lastAdRefresh)));
    }, 1000);
    return () => clearInterval(interval);
  }, [lastAdRefresh]);

  const canRefresh = timeLeft === 0;
  const minutes = Math.floor(timeLeft / 60000);
  const seconds = Math.floor((timeLeft % 60000) / 1000);

  const getAdVolumeKB = (ad: Advertisement, license: License): number => {
    const cap = calculateCap(license.baseCap, license.capPerLevel, license.level);
    const effectiveCap = 0.6 + license.bonus.capacityBonus;
    const maxAdKB = cap * effectiveCap;
    return maxAdKB * (ad.volume / 5);
  };

  return (
    <div className="ad-slots-section">
      <div className="ad-header">
        <h3 className="heading-label">Advertisement Slots ({advertisements.length}/{adSlots})</h3>
        <button
          className="btn btn-secondary"
          disabled={!canRefresh}
          onClick={onFindNewAd}
        >
          {canRefresh ? 'Find New Ad' : `Wait ${minutes}:${seconds.toString().padStart(2, '0')}`}
        </button>
      </div>

      {advertisements.map((ad) => {
        const adsOnSameLicense = advertisements.filter(a => a.licenseId === ad.licenseId && a.id !== ad.id).length + 1;
        const efficiency = adsOnSameLicense === 1 ? 1.0 : adsOnSameLicense === 2 ? 0.8 : adsOnSameLicense === 3 ? 0.6 : 0.4;

        return (
          <div key={ad.id} className="ad-slot">
            <span className="ad-type">{ad.type}</span>
            <span className="ad-name">{ad.name}</span>
            <span className="ad-stars">Vol: {'★'.repeat(ad.volume)}{'☆'.repeat(5-ad.volume)}</span>
            <span className="ad-stars">Mar: {'★'.repeat(ad.margin)}{'☆'.repeat(5-ad.margin)}</span>
            <span className="ad-efficiency">{Math.round(efficiency * 100)}%</span>
            <select
              value={ad.licenseId}
              onChange={(e) => onAssignAd(ad.id, e.target.value)}
            >
              <option value="">Unassigned</option>
              {licenses.filter(l => l.unlocked).map(l => {
                const cap = calculateCap(l.baseCap, l.capPerLevel, l.level);
                const effectiveCap = 0.6 + l.bonus.capacityBonus;
                const maxAdKB = cap * effectiveCap;
                const otherAds = advertisements
                  .filter(a => a.id !== ad.id && a.licenseId === l.id)
                  .reduce((sum, a) => sum + getAdVolumeKB(a, l), 0);
                const available = maxAdKB - otherAds;
                const adKB = getAdVolumeKB(ad, l);
                return (
                  <option key={l.id} value={l.id} disabled={available < adKB}>
                    {l.name} ({formatBandwidth(Math.max(0, available))} ad space)
                  </option>
                );
              })}
            </select>
          </div>
        );
      })}
    </div>
  );
}

interface LicenseRowProps {
  license: License;
  cap: number;
  maxSlider: number;
  upgradeCost: number;
  canUpgrade: boolean;
  money: number;
  onUpgrade: () => void;
  onAllocate: (amount: number) => void;
}

function LicenseRow({ license, cap, maxSlider, upgradeCost, canUpgrade, money, onUpgrade, onAllocate }: LicenseRowProps) {
  const [localAllocated, setLocalAllocated] = useState(license.allocated);
  
  useEffect(() => {
    setLocalAllocated(license.allocated);
  }, [license.allocated]);
  
  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
    setLocalAllocated(value);
  };
  
  const handleSliderCommit = () => {
    onAllocate(localAllocated);
  };
  
  const income = license.allocated * license.incomePerKB;
  const incomeRate = license.incomePerKB * 1000;
  const isLocked = !license.unlocked;
  
  if (isLocked) {
    return (
      <div className="license-row locked">
        <div className="license-info">
          <span className="license-name">{license.name}</span>
          <span className="license-cap">Cap: {formatBandwidth(license.baseCap)} | ${incomeRate.toFixed(2)}/KB</span>
        </div>
        <span className="license-unlock-cost">${license.unlockCost.toLocaleString()}</span>
        <button className="btn btn-secondary" disabled={money < license.unlockCost} onClick={() => onUpgrade()}>
          Unlock
        </button>
      </div>
    );
  }
  
  return (
    <div className="license-row">
      <div className="license-info">
        <span className="license-name">{license.name}</span>
        <span className="license-level">Lv.{license.level} | Cap: {formatBandwidth(cap)} | ${incomeRate.toFixed(2)}/KB</span>
      </div>
      <div className="license-slider-container">
        <input
          type="range"
          className="license-slider"
          min={0}
          max={maxSlider}
          value={localAllocated}
          onChange={handleSliderChange}
          onMouseUp={handleSliderCommit}
          onTouchEnd={handleSliderCommit}
        />
        <span className="license-allocated">{formatBandwidth(localAllocated)}</span>
      </div>
      <span className="license-income">+${income.toFixed(2)}/s</span>
      <button
        className="btn btn-secondary upgrade-btn"
        disabled={!canUpgrade}
        onClick={onUpgrade}
      >
        {`Upgrade Lv.${license.level + 1} $${upgradeCost.toLocaleString()}`}
      </button>
    </div>
  );
}

const MAX_SAFE_INTEGER = 9007199254740991;

const calculateCap = (baseCap: number, capPerLevel: number, level: number): number => {
  const raw = baseCap + (level * capPerLevel);
  return Math.min(raw, MAX_SAFE_INTEGER);
};

const noop = () => {};

function HostingTab({ licenses, uploadSpeed, bandwidthAllocated, onUnlockLicense, onUpgradeLicense, onAllocate, money, advertisements, adSlots, lastAdRefresh, onRefreshAd, onAssignAd, generateAdOptions }: HostingTabProps) {
  const [showAdModal, setShowAdModal] = useState(false);
  const [adOptions, setAdOptions] = useState<Advertisement[]>([]);

  const handleFindNewAd = () => {
    setAdOptions(generateAdOptions());
    setShowAdModal(true);
  };

  const handleSelectAd = (ad: Advertisement) => {
    onRefreshAd(ad);
    setShowAdModal(false);
  };

  const freeBandwidth = uploadSpeed - bandwidthAllocated;
  
  const unlockedLicenses = licenses.filter(l => l.unlocked);
  const lockedLicenses = licenses.filter(l => !l.unlocked);
  
  return (
    <div className="hosting-tab">
      <AdSlotsSection
        advertisements={advertisements}
        adSlots={adSlots}
        lastAdRefresh={lastAdRefresh}
        onRefreshAd={onRefreshAd}
        onAssignAd={onAssignAd}
        onFindNewAd={handleFindNewAd}
        licenses={licenses}
      />

      <AdSelectionModal
        isOpen={showAdModal}
        options={adOptions}
        onSelect={handleSelectAd}
        onClose={() => setShowAdModal(false)}
      />

      <div className="bandwidth-summary">
        <div className="summary-stat">
          <span className="summary-label">Total Upload:</span>
          <span className="summary-value">{formatBandwidth(uploadSpeed)}</span>
        </div>
        <div className="summary-stat">
          <span className="summary-label">Allocated:</span>
          <span className="summary-value allocated">{formatBandwidth(bandwidthAllocated)}</span>
        </div>
        <div className="summary-stat">
          <span className="summary-label">Free:</span>
          <span className="summary-value free">{formatBandwidth(freeBandwidth)}</span>
        </div>
      </div>
      
      <div className="licenses-section">
        <h3 className="heading-label">Active Licenses</h3>
        {unlockedLicenses.map(license => {
          const cap = calculateCap(license.baseCap, license.capPerLevel, license.level);
          const upgradeCost = Math.floor(license.baseUpgradeCost * Math.pow(1.15, license.level));
          const canUpgrade = money >= upgradeCost;
          const otherAllocated = licenses
            .filter(l => l.id !== license.id)
            .reduce((sum, l) => sum + l.allocated, 0);
          const maxSlider = Math.min(cap, Math.max(0, uploadSpeed - otherAllocated));
          
          return (
            <LicenseRow
              key={license.id}
              license={license}
              cap={cap}
              maxSlider={maxSlider}
              upgradeCost={upgradeCost}
              canUpgrade={canUpgrade}
              money={money}
              onUpgrade={() => onUpgradeLicense(license.id)}
              onAllocate={(amount) => onAllocate(license.id, amount)}
            />
          );
        })}
        
        {lockedLicenses.length > 0 && (
          <>
            <h3 className="heading-label locked-title">Locked Licenses</h3>
            {lockedLicenses.map(license => (
              <LicenseRow
                key={license.id}
                license={license}
                cap={license.baseCap}
                maxSlider={0}
                upgradeCost={0}
                canUpgrade={false}
                money={money}
                onUpgrade={() => onUnlockLicense(license.id)}
                onAllocate={noop}
              />
            ))}
          </>
        )}
      </div>
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
  const [importStatus, setImportStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [volume, setVolume] = useState(50);
  const [theme, setTheme] = useState('classic');

  const handleExport = async () => {
    const data = onExport();
    try {
      await navigator.clipboard.writeText(data);
      setImportStatus({ kind: 'success', message: 'Save data copied to clipboard!' });
    } catch {
      setImportStatus({ kind: 'error', message: 'Failed to copy to clipboard' });
    }
    setTimeout(() => setImportStatus(null), 3000);
  };

  const handleImport = () => {
    if (!importData.trim()) {
      setImportStatus({ kind: 'error', message: 'Please paste save data first' });
      return;
    }
    const success = onImport(importData);
    setImportStatus(success 
      ? { kind: 'success', message: 'Save imported successfully!' } 
      : { kind: 'error', message: 'Invalid save data' });
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
      setImportStatus({ kind: 'success', message: 'Game reset!' });
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
        <div className={`import-status ${importStatus.kind}`}>{importStatus.message}</div>
      )}
    </div>
  );
}

export { Header, TabNav, InfrastructureTab, TechUpgradesTab, HostingTab, OptionsTab };
