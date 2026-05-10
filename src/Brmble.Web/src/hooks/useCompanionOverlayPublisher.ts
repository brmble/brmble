import { useEffect, useMemo } from 'react';
import bridge from '../bridge';
import type { OverlaySettings } from '../components/SettingsModal/InterfaceSettingsTypes';
import type { CompanionOverlaySnapshot } from '../components/CompanionOverlay/overlayTypes';

export interface OverlaySyncPayload {
  enabled: boolean;
  mode: 'full' | 'minimal';
  settings: OverlaySettings | null;
  snapshot: CompanionOverlaySnapshot | null;
}

export function useCompanionOverlayPublisher(
  overlaySettings: OverlaySettings,
  snapshot: CompanionOverlaySnapshot | null,
) {
  const payload = useMemo<OverlaySyncPayload>(() => ({
    enabled: overlaySettings.overlayEnabled,
    mode: overlaySettings.mode,
    settings: overlaySettings,
    snapshot,
  }), [overlaySettings, snapshot]);

  useEffect(() => {
    bridge.send('overlay.sync', payload);
  }, [payload]);

  return payload;
}
