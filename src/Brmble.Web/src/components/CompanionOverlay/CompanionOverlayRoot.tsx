import type { OverlaySettings } from '../SettingsModal/InterfaceSettingsTypes';
import type { CompanionOverlaySnapshot } from './overlayTypes';
import { FullCompanionOverlay } from './FullCompanionOverlay';
import { MinimalOverlay } from './MinimalOverlay';
import './CompanionOverlay.css';

export function CompanionOverlayRoot({
  mode,
  position,
  snapshot,
}: {
  mode: OverlaySettings['mode'];
  position: OverlaySettings['position'];
  snapshot: CompanionOverlaySnapshot;
}) {
  if (mode === 'full') {
    return <FullCompanionOverlay snapshot={snapshot} position={position} />;
  }

  return <MinimalOverlay snapshot={snapshot} position={position} />;
}
