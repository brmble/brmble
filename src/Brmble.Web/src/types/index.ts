export interface Server {
  id: string;
  name: string;
  host?: string;
  port?: number;
}

export interface Channel {
  id: number;
  name: string;
  parent?: number;
  position?: number;
  type?: 'voice' | 'text';
  description?: string;
  isEnterRestricted?: boolean;
  canEnter?: boolean;
  hasPasswordRestriction?: boolean;
  canOpenChat?: boolean;
  canSendChat?: boolean;
}

export interface User {
  id?: string;
  session: number;
  name: string;
  channelId?: number;
  muted?: boolean;
  deafened?: boolean;
  self?: boolean;
  matrixUserId?: string;
  speaking?: boolean;
  comment?: string;
  prioritySpeaker?: boolean;
  avatarUrl?: string;
  certHash?: string;
  isBrmbleClient?: boolean;
}

export interface IdleUpdate {
  voiceIdle: Record<number, number>;
  systemIdle: number;
  isLocked: boolean;
}

export interface MediaAttachment {
  type: 'image' | 'gif';
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  mimetype?: string;
  size?: number;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  sender: string;
  senderMatrixUserId?: string;
  content: string;
  timestamp: Date;
  type?: 'system';
  systemType?: string;
  html?: boolean;
  media?: MediaAttachment[];
  pending?: boolean;
  error?: boolean;
  mumbleDelivery?: 'too-large';
  redacted?: boolean;
  reactions?: Record<string, string[]>;
  replyToEventId?: string;
  replyToSender?: string;
  replyToContent?: string;
  msgType?: string;
  edited?: boolean;
  originalContent?: string;
  latestEditTimestamp?: number;
  latestEditEventId?: string;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'disconnected';

export type ServiceName = 'voice' | 'chat' | 'server' | 'livekit';

export type ServiceState = 'connected' | 'connecting' | 'disconnected' | 'unavailable' | 'idle';

export interface ServiceStatus {
  state: ServiceState;
  error?: string;
  label?: string;
  loss?: number;
  /** SemVer string for the connected Brmble server (only set for svc === 'server'). */
  version?: string;
}

export type ServiceStatusMap = Record<ServiceName, ServiceStatus>;

export type NativeBrmbleServiceName = 'server' | 'session' | 'screenshare';
export type NativeBrmbleServiceState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface NativeBrmbleServiceStatus {
  service?: NativeBrmbleServiceName;
  state?: NativeBrmbleServiceState;
  reason?: string;
  attempt?: number;
  delayMs?: number;
}

export const SERVICE_DISPLAY_NAMES: Record<ServiceName, string> = {
  voice: 'Voice',
  chat: 'Chat',
  server: 'Brmble',
  livekit: 'Screenshare',
};

export interface MentionableUser {
  displayName: string;
  matrixUserId?: string;
  avatarUrl?: string;
  isOnline: boolean;
}
