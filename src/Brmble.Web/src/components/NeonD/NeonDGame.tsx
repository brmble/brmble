import { useRef, useState, type ChangeEvent } from 'react';
import { useGameEngine } from './hooks/useGameEngine';
import { CAPTAIN_VISIBLE_EARNINGS } from './constants';
import {
  getCaptainCost,
  getProductDefinition,
  getRespectPerSecond,
  isCaptainVisible,
} from './economy';
import { confirm } from '../../hooks/usePrompt';
import { Icon } from '../Icon/Icon';
import { parseNeonDSave, serializeNeonDSave } from './saveFormat';
import { ProductionPanel } from './ProductionPanel';
import { DistributionPanel } from './DistributionPanel';
import { MusclePanel } from './MusclePanel';
import styles from './NeonD.module.css';

const formatMoney = (value: number) =>
  `$${Math.round(value).toLocaleString()}`;

const formatPreciseMoney = (value: number) =>
  `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatDuration = (durationMs: number) => {
  const totalSeconds = Math.floor(durationMs / 1_000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(durationMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
};

type LeftPanel = 'production' | 'muscle';

export function NeonDGame({ onClose }: { onClose?: () => void }) {
  const {
    state,
    buyProducer,
    researchProduct,
    buyProductUpgrade,
    buyMuscleWorker,
    buyTerritory,
    buyDiscount,
    hireDealer,
    fireDealer,
    setSellerProduct,
    buySellerEquipment,
    toggleDealerProtection,
    payDealerBail,
    unlockBulkSelling,
    bulkSellProduct,
    setAutoBulkEnabled,
    dismissOfflineEarningsSummary,
    buyCaptain,
    promoteCaptain,
    resetGame,
    importGame,
  } = useGameEngine();
  const [importError, setImportError] = useState<string | null>(null);
  const [activeLeftPanel, setActiveLeftPanel] = useState<LeftPanel>('production');
  const importInputRef = useRef<HTMLInputElement>(null);

  const sellerIncomePerSecond = Object.values(state.lastEarningsPerSeller)
    .reduce((sum, value) => sum + value, 0);
  const respectPerSecond = getRespectPerSecond(state);
  const captainVisible = isCaptainVisible(state);
  const captainCost = getCaptainCost(state);
  const renderNow = state.lastTickAt;

  const handleReset = async () => {
    const confirmed = await confirm({
      title: 'Reset Neon-D empire?',
      message: 'Are you sure you want to reset your Neon-D empire? All progress will be lost.',
      confirmLabel: 'Reset',
      cancelLabel: 'Cancel',
      destructive: true,
    });

    if (confirmed) resetGame();
  };

  const handleExport = () => {
    const blob = new Blob([serializeNeonDSave(state)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'brmble-neon-d-save.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const importedState = parseNeonDSave(await file.text());
      const confirmed = await confirm({
        title: 'Import Neon-D save?',
        message: 'Import this Neon-D save? Your current empire will be replaced.',
        confirmLabel: 'Import',
        cancelLabel: 'Cancel',
        destructive: true,
      });

      if (confirmed) importGame(importedState);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'The Neon-D save could not be imported.');
    }
  };

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
          <div className={styles.money}>{formatPreciseMoney(state.cash)}</div>
          <div className={styles.label}>Seller income/sec {formatPreciseMoney(sellerIncomePerSecond)}</div>
          <div className={styles.label}>Respect {Math.floor(state.respect).toLocaleString()}</div>
          <div className={styles.label}>Respect/sec {respectPerSecond.toFixed(2)}</div>
          <div className={styles.label}>Captains {state.captains.length}</div>
          <div className={styles.kingpinBadge}>Kingpins {state.kingpins}</div>
          <div className={styles.headerActions}>
            {captainVisible ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={buyCaptain}
                disabled={state.cash < captainCost}
              >
                Hire Captain - {formatMoney(captainCost)}
              </button>
            ) : (
              <span className={styles.label}>
                Captain progress {formatMoney(state.runEarnings)} / {formatMoney(CAPTAIN_VISIBLE_EARNINGS)}
              </span>
            )}
            <button type="button" className="btn btn-primary" onClick={handleExport}>
              <Icon name="save" size={14} />
              Export
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setImportError(null);
                importInputRef.current?.click();
              }}
            >
              <Icon name="upload" size={14} />
              Import
            </button>
            <input
              ref={importInputRef}
              className={styles.hiddenFileInput}
              aria-label="Neon-D save file"
              type="file"
              accept="application/json,.json"
              onChange={handleImport}
            />
            <button type="button" onClick={handleReset} className="btn btn-danger">
              Reset
            </button>
          </div>
        </div>
        {importError && <p className={styles.importError} role="alert">{importError}</p>}
      </header>

      {state.activeMarketEvent && state.activeMarketEvent.endsAt > renderNow && (
        <div className={`glass-panel ${styles.marketBanner}`}>
          <strong>Market spike: {getProductDefinition(state.activeMarketEvent.productId).name}</strong>
          <span>{state.activeMarketEvent.multiplier.toFixed(2)}x street value</span>
          <span>{Math.ceil((state.activeMarketEvent.endsAt - renderNow) / 1000)}s remaining</span>
        </div>
      )}

      <div className={styles.gameplayGrid}>
        <div className={styles.leftWorkspace}>
          <div className={styles.panelTabs} role="tablist" aria-label="Neon-D management panels">
            <button
              type="button"
              role="tab"
              aria-selected={activeLeftPanel === 'production'}
              className={styles.panelTab}
              onClick={() => setActiveLeftPanel('production')}
            >
              Production
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeLeftPanel === 'muscle'}
              className={styles.panelTab}
              onClick={() => setActiveLeftPanel('muscle')}
            >
              Muscle
            </button>
          </div>
          {activeLeftPanel === 'production' ? (
            <ProductionPanel
              state={state}
              buyProducer={buyProducer}
              researchProduct={researchProduct}
              buyProductUpgrade={buyProductUpgrade}
              unlockBulkSelling={unlockBulkSelling}
              bulkSellProduct={bulkSellProduct}
              setAutoBulkEnabled={setAutoBulkEnabled}
            />
          ) : (
            <MusclePanel
              state={state}
              buyMuscleWorker={buyMuscleWorker}
              buyTerritory={buyTerritory}
              buyDiscount={buyDiscount}
            />
          )}
        </div>
        <DistributionPanel
          state={state}
          hireDealer={hireDealer}
          fireDealer={fireDealer}
          setSellerProduct={setSellerProduct}
          buySellerEquipment={buySellerEquipment}
          toggleDealerProtection={toggleDealerProtection}
          payDealerBail={payDealerBail}
          promoteCaptain={promoteCaptain}
        />
      </div>

      {state.offlineEarningsSummary && (
        <div className="modal-overlay" onClick={dismissOfflineEarningsSummary}>
          <div
            className={`glass-panel animate-slide-up ${styles.offlineSummaryModal}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="neond-offline-summary-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="neond-offline-summary-title" className="heading-title modal-title">Welcome back</h2>
            <div className={styles.offlineSummaryGrid}>
              <span>Away</span>
              <strong>{formatDuration(state.offlineEarningsSummary.actualAwayMs)}</strong>
            </div>
            <div className={styles.offlineSummaryGrid}>
              <span>Simulated</span>
              <strong>{formatDuration(state.offlineEarningsSummary.simulatedMs)} simulated</strong>
            </div>
            <div className={styles.offlineSummaryGrid}>
              <span>Cash earned</span>
              <strong>{formatMoney(state.offlineEarningsSummary.cashEarned)}</strong>
            </div>
            <div className={styles.offlineSummaryGrid}>
              <span>Respect earned</span>
              <strong>{Math.round(state.offlineEarningsSummary.respectEarned).toLocaleString()} Respect</strong>
            </div>
            <button className={styles.buyButton} onClick={dismissOfflineEarningsSummary}>
              Accept
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
