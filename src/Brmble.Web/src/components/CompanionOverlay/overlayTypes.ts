export type OverlayEventKind =
  | 'channel-message'
  | 'direct-message'
  | 'user-joined'
  | 'user-left'
  | 'user-kicked'
  | 'user-banned';

export type OverlayVisualState =
  | 'idle'
  | 'message'
  | 'dm'
  | 'moderation-alert'
  | 'speaking-nearby'
  | 'quiet';

export interface CompanionOverlayEvent {
  id: string;
  kind: OverlayEventKind;
  actorName: string;
  targetName?: string;
  line: string;
  timestamp: number;
  channelId?: string;
}

export interface CompanionSpeakerEntry {
  session: number;
  name: string;
  channelId: number;
  isSpeaking: boolean;
  startedAt: number;
  lastSpokeAt: number;
  expiresAt: number;
}

export type CompanionAtlasRow = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type CompanionDisplayKind = 'idle' | 'chat' | 'speaking' | 'join' | 'leave';
export type CompanionId = 'clip' | 'eren' | 'kid-goku' | 'kirito' | 'paul';

export interface CompanionLookupEntry {
  session: number;
  name: string;
  companionId?: CompanionId;
  isProxy?: boolean;
}

export interface FullCompanionDisplay {
  id: string;
  kind: CompanionDisplayKind;
  representedSession: number;
  representedName: string;
  companionId: CompanionId;
  row: CompanionAtlasRow;
  bubble: string | null;
  startedAt: number;
  expiresAt: number | null;
  isProxy: boolean;
  badges: {
    muted: boolean;
    live: boolean;
  };
}

export interface CompanionSpeakerCandidate {
  session: number;
  name: string;
  channelId: number;
  startedAt: number;
  eligibleAt: number;
  lastSpokeAt: number;
  stoppedAt: number | null;
  arrivalOrder: number;
}

export interface FullCompanionState {
  activeDisplay: FullCompanionDisplay | null;
  chatQueue: CompanionOverlayEvent[];
  eventQueue: CompanionOverlayEvent[];
  speakerCandidates: CompanionSpeakerCandidate[];
  companionsByUser: Record<number, CompanionLookupEntry>;
  localUser: {
    session: number;
    name: string;
    companionId: CompanionId;
  };
  flags: {
    localMuted: boolean;
    liveUserSessions: number[];
  };
}

export interface CompanionOverlaySnapshot {
  currentChannelId: string | null;
  currentChannelName: string;
  recentEvents: CompanionOverlayEvent[];
  activeSpeakers: CompanionSpeakerEntry[];
  visualState: OverlayVisualState;
  lastActivityAt: number;
  fullCompanion: FullCompanionState;
}
