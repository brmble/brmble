export interface AppearanceSettings {
  theme: string;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'classic',
};

export interface OverlaySettings {
  overlayEnabled: boolean;
}

export const DEFAULT_OVERLAY: OverlaySettings = {
  overlayEnabled: false,
};
