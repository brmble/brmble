import { useOverlayBridgeState, type OverlayBridgeState } from './useOverlayBridgeState';
import { CompanionOverlayRoot } from './CompanionOverlayRoot';

export function OverlayApp({ initialState }: { initialState?: OverlayBridgeState } = {}) {
  const liveState = useOverlayBridgeState();
  const state = initialState ?? liveState;

  if (!state.enabled || !state.snapshot) {
    return null;
  }

  return (
    <CompanionOverlayRoot
      mode={state.mode}
      snapshot={state.snapshot}
    />
  );
}
