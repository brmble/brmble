export interface AppearanceSettings {
  theme: string;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'classic',
};

export interface OverlaySettings {
  overlayEnabled: boolean;
  mode: CompanionOverlayMode;
  showChannelMessages: boolean;
  showDirectMessages: boolean;
  showJoinLeaveEvents: boolean;
  showModerationEvents: boolean;
  showActiveSpeakers: boolean;
}

export type CompanionOverlayMode = 'full' | 'minimal';

export const DEFAULT_OVERLAY: OverlaySettings = {
  overlayEnabled: false,
  mode: 'minimal',
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
