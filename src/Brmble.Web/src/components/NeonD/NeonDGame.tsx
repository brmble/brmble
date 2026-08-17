import { useRef, useState, type ChangeEvent } from 'react';
import { useGameEngine } from './hooks/useGameEngine';
import {
  getCaptainCost,
  getProductDefinition,
  getRespectPerSecond,
  isCaptainVisible,
} from './economy';
import { MARKET_DURATION_MAX_MS } from './constants';
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
    dismissOfflineEarningsSummary,
    buyCaptain,
    claimCaptainLevel,
    purchaseCaptainTalent,
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
  const captainProgressValue = Math.min(
    captainCost,
    Math.max(0, Math.floor(state.cash)),
  );
  const captainProgress = captainCost > 0 ? captainProgressValue / captainCost : 0;
  const renderNow = state.lastTickAt;
  const activeMarketEvent = state.activeMarketEvent;
  const activeMarketProduct = activeMarketEvent
    ? getProductDefinition(activeMarketEvent.productId)
    : null;
  const marketRemainingMs = activeMarketEvent
    ? Math.max(0, activeMarketEvent.endsAt - renderNow)
    : 0;
  const marketRemainingSeconds = Math.ceil(marketRemainingMs / 1_000);
  const marketProgress = Math.min(1, Math.max(0, marketRemainingMs / MARKET_DURATION_MAX_MS));

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

  const handleFireDealer = async (dealerId: string) => {
    const dealer = state.activeDealers.find((candidate) => candidate?.id === dealerId);
    const confirmed = await confirm({
      title: 'Fire dealer?',
      message: `Are you sure you want to fire ${dealer?.name ?? 'this dealer'}?`,
      confirmLabel: 'Fire Dealer',
      cancelLabel: 'Cancel',
      destructive: true,
    });

    if (confirmed) fireDealer(dealerId);
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
          <section className={styles.statsGrid} aria-label="Empire statistics">
            <div className={styles.metric} data-stat-priority="primary">
              <span className={styles.metricLabel}>Seller income/sec</span>
              <strong className={styles.primaryMetricValue}>
                {formatPreciseMoney(sellerIncomePerSecond)}
              </strong>
            </div>
            <div className={styles.metric} data-stat-priority="secondary">
              <span className={styles.metricLabel}>Respect/sec</span>
              <strong className={styles.secondaryMetricValue}>{respectPerSecond.toFixed(2)}</strong>
            </div>
            <div className={styles.metric} data-stat-priority="tertiary">
              <span className={styles.metricLabel}>Cash</span>
              <strong className={styles.cashMetricValue}>{formatPreciseMoney(state.cash)}</strong>
            </div>
            <div className={styles.prestigeMetrics} data-stat-priority="prestige">
              <span><span className={styles.metricLabel}>Captains</span> <strong>{state.captains.length}</strong></span>
              <span><span className={styles.metricLabel}>Kingpins</span> <strong>{state.kingpins}</strong></span>
            </div>
          </section>
          <div className={styles.headerActions}>
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

      {activeMarketEvent && activeMarketProduct && activeMarketEvent.endsAt > renderNow && (
        <section className={styles.marketEventCard} aria-labelledby="market-event-title">
          <div className={styles.marketEventAccent} aria-hidden="true" />
          <div className={styles.marketEventContent}>
            <span className={styles.marketEventBadge}>LIVE MARKET</span>
            <h3 id="market-event-title" className={styles.marketEventHeading}>
              {activeMarketProduct.name} market spike
            </h3>
            <span className={styles.marketEventLabel}>Street value boost</span>
            <strong className={styles.marketEventMultiplier}>
              {activeMarketEvent.multiplier.toFixed(2)}x
            </strong>
          </div>
          <div className={styles.marketEventStatus}>
            <span className={styles.marketEventLabel}>Time remaining</span>
            <strong>{marketRemainingSeconds}s remaining</strong>
          </div>
          <div className={styles.marketEventProgressTrack} aria-hidden="true">
            <span className={styles.marketEventProgress} style={{ width: `${marketProgress * 100}%` }} />
          </div>
        </section>
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
        <div className={styles.rightWorkspace} data-testid="distribution-workspace">
          {captainVisible && (
            <section className={`glass-panel ${styles.captainMilestone}`} aria-labelledby="captain-milestone-title">
              <div className={styles.captainMilestoneCopy}>
                <span id="captain-milestone-title" className={styles.metricLabel}>Next Captain — Cash saved:</span>
                <strong>{formatMoney(captainProgressValue)} / {formatMoney(captainCost)}</strong>
              </div>
              <div className={styles.captainProgressBlock}>
                <div
                  className={styles.captainProgressTrack}
                  role="progressbar"
                  aria-label="Captain recruitment fund"
                  aria-valuemin={0}
                  aria-valuemax={captainCost}
                  aria-valuenow={captainProgressValue}
                  aria-valuetext={`${formatMoney(captainProgressValue)} of ${formatMoney(captainCost)}`}
                >
                  <span
                    className={styles.captainProgressFill}
                    style={{ width: `${captainProgress * 100}%` }}
                  />
                </div>
              </div>
              {captainProgressValue >= captainCost && (
                <button type="button" className="btn btn-primary" onClick={buyCaptain}>
                  Hire Captain
                </button>
              )}
            </section>
          )}
          <DistributionPanel
            state={state}
            hireDealer={hireDealer}
            fireDealer={handleFireDealer}
            setSellerProduct={setSellerProduct}
            buySellerEquipment={buySellerEquipment}
            toggleDealerProtection={toggleDealerProtection}
            payDealerBail={payDealerBail}
            claimCaptainLevel={claimCaptainLevel}
            purchaseCaptainTalent={purchaseCaptainTalent}
            promoteCaptain={promoteCaptain}
          />
        </div>
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
