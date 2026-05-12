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
  myCompanion: CompanionSelection;
  showChannelMessages: boolean;
  showDirectMessages: boolean;
  showJoinLeaveEvents: boolean;
  showModerationEvents: boolean;
  showActiveSpeakers: boolean;
}

export type CompanionOverlayMode = 'full' | 'minimal';
export type CompanionOverlayPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type CompanionSelection = 'bee' | 'engineer' | 'floppy' | 'patch' | 'pip' | 'retro';

/**
 * Validates and migrates a companion ID to ensure it's a valid CompanionSelection.
 * Legacy companion IDs (e.g., "clip") are migrated to the default 'bee'.
 * 
 * @param companionId - The companion ID to validate (may be from persisted settings)
 * @returns A valid CompanionSelection, or 'bee' if the input is invalid
 */
export function normalizeCompanionId(companionId: unknown): CompanionSelection {
  const validCompanions: CompanionSelection[] = ['bee', 'engineer', 'floppy', 'patch', 'pip', 'retro'];
  
  if (typeof companionId === 'string' && validCompanions.includes(companionId as CompanionSelection)) {
    return companionId as CompanionSelection;
  }
  
  // Legacy or invalid value - fallback to bee
  return 'bee';
}

/**
 * Normalizes overlay settings loaded from storage/bridge to ensure all companion IDs are valid.
 * Should be called when deserializing settings from localStorage or backend config.
 * 
 * @param settings - Partial overlay settings from storage
 * @returns Normalized overlay settings with valid companion IDs
 */
export function normalizeOverlaySettings(settings: Partial<OverlaySettings>): OverlaySettings {
  return {
    ...DEFAULT_OVERLAY,
    ...settings,
    myCompanion: normalizeCompanionId(settings.myCompanion),
  };
}

export const DEFAULT_OVERLAY: OverlaySettings = {
  overlayEnabled: false,
  mode: 'minimal',
  position: 'bottom-right',
  myCompanion: 'bee',
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
