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
  companionSelectionsByServer: Record<string, CompanionSelection>;
  showChannelMessages: boolean;
  showDirectMessages: boolean;
  showJoinLeaveEvents: boolean;
  showModerationEvents: boolean;
  showActiveSpeakers: boolean;
  showLocalCompanionWhenIdle: boolean;
}

export type CompanionOverlayMode = 'full' | 'minimal';
export type CompanionOverlayPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export const BUILT_IN_COMPANIONS = ['bee', 'engineer', 'floppy', 'patch', 'pip', 'retro'] as const;
export type BuiltInCompanionId = typeof BUILT_IN_COMPANIONS[number];
export type CustomCompanionId = `custom:${string}`;
export type CompanionSelection = BuiltInCompanionId | CustomCompanionId;

export interface CompanionDisplayGallery {
  entries: ReadonlyArray<{
    id: CustomCompanionId;
    eventId: string;
    atlasCacheKey: string;
  }>;
  redactedEventIds: ReadonlySet<string>;
  readyAtlasCacheKeys: ReadonlySet<string>;
}

export interface ResolvedCompanionDisplay {
  companionId: CompanionSelection;
  atlasCacheKey?: string;
}

function isCustomCompanionId(value: string): value is CustomCompanionId {
  if (!value.startsWith('custom:$')) return false;
  const eventId = value.slice('custom:'.length);
  return eventId.length >= 2 && !Array.from(eventId).some(character => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

/**
 * Validates and migrates a companion ID to ensure it's a valid CompanionSelection.
 * Legacy companion IDs (e.g., "clip") are migrated to the default 'floppy'.
 * 
 * @param companionId - The companion ID to validate (may be from persisted settings)
 * @returns A valid CompanionSelection, or 'floppy' if the input is invalid
 */
export function normalizeCompanionId(companionId: unknown): CompanionSelection {
  if (typeof companionId === 'string'
    && (BUILT_IN_COMPANIONS.includes(companionId as BuiltInCompanionId) || isCustomCompanionId(companionId))) {
    return companionId as CompanionSelection;
  }
  
  // Legacy or invalid value - fallback to floppy
  return 'floppy';
}

/**
 * Normalizes overlay settings loaded from storage/bridge to ensure all companion IDs are valid.
 * Should be called when deserializing settings from localStorage or backend config.
 * 
 * @param settings - Partial overlay settings from storage
 * @returns Normalized overlay settings with valid companion IDs
 */
export function normalizeOverlaySettings(settings: Partial<OverlaySettings>): OverlaySettings {
  const selections = settings.companionSelectionsByServer;
  const companionSelectionsByServer = selections && typeof selections === 'object'
    ? Object.fromEntries(Object.entries(selections)
      .filter(([serverKey]) => serverKey.length > 0)
      .map(([serverKey, selection]) => [serverKey, normalizeCompanionId(selection)]))
    : {};

  return {
    ...DEFAULT_OVERLAY,
    ...settings,
    myCompanion: normalizeCompanionId(settings.myCompanion),
    companionSelectionsByServer,
  };
}

export function companionForServer(settings: OverlaySettings, serverKey: string): CompanionSelection {
  return normalizeCompanionId(settings.companionSelectionsByServer[serverKey] ?? settings.myCompanion);
}

/**
 * Picks the companion from a native wire payload. `customCompanionId` is additive and only
 * ever carries `custom:$…` values, so anything else there (a built-in name, a malformed
 * custom id) is ignored in favour of the legacy `companionId` field.
 */
export function normalizeCompanionBridgeSelection(payload: {
  companionId?: unknown;
  customCompanionId?: unknown;
}): CompanionSelection {
  const custom = payload.customCompanionId;
  return typeof custom === 'string' && isCustomCompanionId(custom)
    ? custom
    : normalizeCompanionId(payload.companionId);
}

/**
 * Resolves a companion selection to something renderable.
 *
 * `null` means the server has not told us this session's companion yet. It resolves to
 * `floppy` for display only — the caller must never write that back, or an unknown value
 * becomes a wrong one and the row stops self-correcting when the real value arrives.
 */
export function resolveCompanionDisplay(
  selection: CompanionSelection | null,
  gallery: CompanionDisplayGallery,
): ResolvedCompanionDisplay {
  const normalized = normalizeCompanionId(selection);
  if (!isCustomCompanionId(normalized)) return { companionId: normalized };

  const entry = gallery.entries.find(candidate => candidate.id === normalized);
  if (!entry
    || gallery.redactedEventIds.has(entry.eventId)
    || !gallery.readyAtlasCacheKeys.has(entry.atlasCacheKey)) {
    return { companionId: 'floppy' };
  }

  return {
    companionId: normalized,
    atlasCacheKey: entry.atlasCacheKey,
  };
}

export const DEFAULT_OVERLAY: OverlaySettings = {
  overlayEnabled: false,
  mode: 'minimal',
  position: 'bottom-right',
  myCompanion: 'floppy',
  companionSelectionsByServer: {},
  showChannelMessages: true,
  showDirectMessages: true,
  showJoinLeaveEvents: true,
  showModerationEvents: true,
  showActiveSpeakers: true,
  showLocalCompanionWhenIdle: true,
};

export interface BrmblegotchiSettings {
  enabled: boolean;
  theme: 'original' | 'dino' | 'cat';
}

export const DEFAULT_BRMBLEGOTCHI: BrmblegotchiSettings = {
  enabled: true,
  theme: 'original',
};
