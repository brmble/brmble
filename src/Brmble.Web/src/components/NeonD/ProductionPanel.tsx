import { useState } from 'react';
import {
  AUTO_BULK_RETAIN_STOCK,
  BULK_SELL_COOLDOWN_MS,
  BULK_UNLOCK_COST,
} from './constants';
import {
  getEffectiveStreetValue,
  getProducerCost,
  getProductDefinition,
  getProductProductionRate,
  getProductUpgradeCost,
  getVisibleProductIds,
  isProductFullyUpgraded,
} from './economy';
import { getProductSalesRates } from './simulation';
import type { GameState, ProductId } from './types';
import { Icon } from '../Icon/Icon';
import styles from './NeonD.module.css';

type ProductionPanelProps = {
  state: GameState;
  buyProducer: (productId: ProductId) => void;
  researchProduct: (productId: ProductId) => void;
  buyProductUpgrade: (productId: ProductId, upgradeId: string) => void;
  unlockBulkSelling: (productId: ProductId) => void;
  bulkSellProduct: (productId: ProductId) => void;
};

const formatMoney = (value: number) => `$${Math.round(value).toLocaleString()}`;

export function ProductionPanel(props: ProductionPanelProps) {
  const [collapsedProductIds, setCollapsedProductIds] = useState<Set<ProductId>>(() => new Set());
  const visibleIds = getVisibleProductIds(props.state);
  const salesRates = getProductSalesRates(props.state);
  const renderNow = props.state.lastTickAt;
  const hasPreviousBulkSale = props.state.lastBulkSellAt !== renderNow;
  const bulkCooldownRemainingMs = hasPreviousBulkSale
    ? Math.max(0, props.state.lastBulkSellAt + BULK_SELL_COOLDOWN_MS - renderNow)
    : 0;
  const bulkCooldownSeconds = Math.ceil(bulkCooldownRemainingMs / 1_000);
  const bulkCooldownLabel = bulkCooldownSeconds >= 60
    ? `${Math.ceil(bulkCooldownSeconds / 60)}m`
    : `${bulkCooldownSeconds}s`;

  const toggleProductCard = (productId: ProductId) => {
    setCollapsedProductIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  return (
    <section className={styles.panel} aria-labelledby="neond-production-heading">
      <h3 id="neond-production-heading" className={styles.columnHeader}>Production</h3>
      <div className={styles.cardStack}>
        {visibleIds.map((productId) => {
          const definition = getProductDefinition(productId);
          const product = props.state.production[productId];
          const productionRate = getProductProductionRate(props.state, productId);
          const salesRate = salesRates[productId];
          const delta = productionRate - salesRate;
          const unlocked = props.state.unlockedProducts.includes(productId);
          const nextUpgrade = definition.upgrades.find(
            (upgrade) => !product.purchasedUpgradeIds.includes(upgrade.id),
          );
          const baseStreetValue = definition.streetValue;
          const effectiveStreetValue = getEffectiveStreetValue(props.state, productId);
          const hasMarketSpike =
            props.state.activeMarketEvent?.productId === productId &&
            props.state.activeMarketEvent.endsAt > renderNow;
          const isCollapsed = collapsedProductIds.has(productId);
          const bodyId = `production-body-${productId}`;

          return (
            <article key={productId} className={styles.productionCard} aria-label={definition.name}>
              <div className={styles.productionHeader}>
                <h4 className={styles.productTitle}>{definition.name}</h4>
                <div className={styles.cardHeaderActions}>
                  <span className={styles.price}>Street {formatMoney(effectiveStreetValue)}/g</span>
                  <button
                    type="button"
                    className={styles.cardCollapseButton}
                    aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${definition.name} production`}
                    aria-expanded={!isCollapsed}
                    aria-controls={bodyId}
                    onClick={() => toggleProductCard(productId)}
                  >
                    <Icon name={isCollapsed ? 'chevron-down' : 'chevron-up'} size={16} />
                  </button>
                </div>
              </div>

              {isCollapsed ? (
                <div id={bodyId} hidden />
              ) : (
              <div id={bodyId} className={styles.productionBody}>
                {unlocked ? (
                <>
                  <div className={styles.productionMetrics}>
                    <div className={styles.metricRow}>
                      <span>Stock</span>
                      <strong>{product.stock.toFixed(2)}g</strong>
                    </div>
                    <div className={styles.productionFlow}>
                      <div className={styles.productionSide}>
                        <span>Production</span>
                        <span
                          className={styles.productionUpIndicator}
                          role="img"
                          aria-label="Production increasing"
                        />
                        <strong>{productionRate.toFixed(2)}g/s</strong>
                      </div>
                      <div className={`${styles.productionSide} ${styles.productionSideSales}`}>
                        <strong>{salesRate.toFixed(2)}g/s</strong>
                        <span
                          className={styles.productionDownIndicator}
                          role="img"
                          aria-label="Sales decreasing"
                        />
                        <span>Sales</span>
                      </div>
                    </div>
                    <div
                      className={`${styles.productionDelta} ${
                      delta >= 0 ? styles.bottleneckPositive : styles.bottleneckNegative
                    }`}
                    >
                      <span>Delta</span>
                      <strong>{delta >= 0 ? '+' : ''}{delta.toFixed(2)}g/s</strong>
                    </div>
                  </div>
                  <button
                    className={styles.buyButton}
                    onClick={() => props.buyProducer(productId)}
                    disabled={props.state.cash < getProducerCost(productId, product.producersOwned, props.state.discountLevel)}
                  >
                    Buy one {definition.producer.name} - {formatMoney(getProducerCost(productId, product.producersOwned, props.state.discountLevel))}
                  </button>
                  {nextUpgrade ? (
                    <button
                      className={styles.unlockButton}
                      onClick={() => props.buyProductUpgrade(productId, nextUpgrade.id)}
                      disabled={props.state.cash < getProductUpgradeCost(productId, nextUpgrade.id, props.state.discountLevel)}
                    >
                      {nextUpgrade.name} +{Math.round(nextUpgrade.productionBonus * 100)}% - {formatMoney(getProductUpgradeCost(productId, nextUpgrade.id, props.state.discountLevel))}
                    </button>
                  ) : (
                    <div className={styles.label}>All production upgrades owned</div>
                  )}
                  {hasMarketSpike && props.state.activeMarketEvent && (
                    <div className={styles.marketBanner}>
                      <span>Market spike: {formatMoney(baseStreetValue)}/g → {formatMoney(effectiveStreetValue)}/g</span>
                      <span>{Math.ceil((props.state.activeMarketEvent.endsAt - renderNow) / 1000)}s remaining</span>
                    </div>
                  )}
                  {isProductFullyUpgraded(props.state, productId) && !props.state.bulkUnlockedProductIds.includes(productId) && (
                    <button
                      className={styles.unlockButton}
                      onClick={() => props.unlockBulkSelling(productId)}
                      disabled={props.state.cash < BULK_UNLOCK_COST}
                    >
                      Unlock Bulk Selling - {formatMoney(BULK_UNLOCK_COST)}
                    </button>
                  )}
                  {props.state.bulkUnlockedProductIds.includes(productId) && (
                    <div className={styles.actionStack}>
                      <button
                        className={styles.buyButton}
                        onClick={() => props.bulkSellProduct(productId)}
                        disabled={product.stock <= AUTO_BULK_RETAIN_STOCK || bulkCooldownRemainingMs > 0}
                      >
                        Bulk sell overflow{bulkCooldownRemainingMs > 0 ? ` (${bulkCooldownLabel})` : ''}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <button
                  className={styles.unlockButton}
                  onClick={() => props.researchProduct(productId)}
                  disabled={props.state.cash < definition.researchCost}
                >
                  Research - {formatMoney(definition.researchCost)}
                </button>
                )}
              </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
