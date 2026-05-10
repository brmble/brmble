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
  startedAt: number;
  lastSpokeAt: number;
  expiresAt: number;
}

export interface CompanionOverlaySnapshot {
  currentChannelId: string | null;
  currentChannelName: string;
  recentEvents: CompanionOverlayEvent[];
  activeSpeakers: CompanionSpeakerEntry[];
  visualState: OverlayVisualState;
  lastActivityAt: number;
}
