import type { OverlaySettings } from '../SettingsModal/InterfaceSettingsTypes';
import type { CompanionOverlaySnapshot } from './overlayTypes';
import { FullCompanionOverlay } from './FullCompanionOverlay';
import { MinimalOverlay } from './MinimalOverlay';
import './CompanionOverlay.css';

export function CompanionOverlayRoot({
  mode,
  snapshot,
}: {
  mode: OverlaySettings['mode'];
  snapshot: CompanionOverlaySnapshot;
}) {
  if (mode === 'full') {
    return <FullCompanionOverlay snapshot={snapshot} />;
  }

  return <MinimalOverlay snapshot={snapshot} />;
}
