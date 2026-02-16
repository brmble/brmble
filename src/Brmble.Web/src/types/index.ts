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
}

export interface ChatMessage {
  id: string;
  channelId: string;
  sender: string;
  content: string;
  timestamp: Date;
}

export interface DMConversation {
  id: string;
  recipientId: string;
  recipientName: string;
  messages: ChatMessage[];
  unreadCount: number;
}
