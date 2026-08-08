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
  connected: boolean,
) {
  const visible = overlaySettings.overlayEnabled && connected;
  const payload = useMemo<OverlaySyncPayload>(() => ({
    enabled: visible,
    mode: overlaySettings.mode,
    settings: visible ? overlaySettings : null,
    snapshot: visible ? snapshot : null,
  }), [overlaySettings, snapshot, visible]);

  useEffect(() => {
    bridge.send('overlay.sync', payload);
  }, [payload]);

  return payload;
}
