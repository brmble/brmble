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
  type?: 'voice' | 'text';
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
  html?: boolean;
  media?: MediaAttachment[];
  pending?: boolean;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'disconnected';

export type ServiceName = 'voice' | 'chat' | 'server' | 'livekit';

export type ServiceState = 'connected' | 'connecting' | 'disconnected' | 'unavailable' | 'idle';

export interface ServiceStatus {
  state: ServiceState;
  error?: string;
  label?: string;
}

export type ServiceStatusMap = Record<ServiceName, ServiceStatus>;

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
