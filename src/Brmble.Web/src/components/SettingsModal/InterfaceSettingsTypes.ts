export interface AppearanceSettings {
  theme: string;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'classic',
};

export interface OverlaySettings {
  overlayEnabled: boolean;
  mode: CompanionOverlayMode;
  position: CompanionOverlayPosition;
  showChannelMessages: boolean;
  showDirectMessages: boolean;
  showJoinLeaveEvents: boolean;
  showModerationEvents: boolean;
  showActiveSpeakers: boolean;
}

export type CompanionOverlayMode = 'full' | 'minimal';
export type CompanionOverlayPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export const DEFAULT_OVERLAY: OverlaySettings = {
  overlayEnabled: false,
  mode: 'minimal',
  position: 'bottom-right',
  showChannelMessages: true,
  showDirectMessages: true,
  showJoinLeaveEvents: true,
  showModerationEvents: true,
  showActiveSpeakers: true,
};

export interface BrmblegotchiSettings {
  enabled: boolean;
  theme: 'original' | 'dino' | 'cat';
}

export const DEFAULT_BRMBLEGOTCHI: BrmblegotchiSettings = {
  enabled: true,
  theme: 'original',
};
