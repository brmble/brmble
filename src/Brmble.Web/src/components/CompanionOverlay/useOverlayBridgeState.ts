import { useEffect, useState } from 'react';
import bridge from '../../bridge';
import type { OverlaySettings } from '../SettingsModal/InterfaceSettingsTypes';
import type { CompanionOverlaySnapshot } from './overlayTypes';

export interface OverlayBridgeState {
  enabled: boolean;
  mode: 'full' | 'minimal';
  settings: OverlaySettings | null;
  snapshot: CompanionOverlaySnapshot | null;
}

const DEFAULT_STATE: OverlayBridgeState = {
  enabled: false,
  mode: 'minimal',
  settings: null,
  snapshot: null,
};

export function useOverlayBridgeState() {
  const [state, setState] = useState<OverlayBridgeState>(DEFAULT_STATE);

  useEffect(() => {
    const handleSync = (data: unknown) => {
      const next = data as Partial<OverlayBridgeState> | null;
      if (!next) return;
      setState((prev) => ({ ...prev, ...next }));
    };

    bridge.on('overlay.sync', handleSync);
    return () => bridge.off('overlay.sync', handleSync);
  }, []);

  return state;
}
