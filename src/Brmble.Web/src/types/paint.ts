export type PaintTool = 'pen' | 'eraser';

export interface PaintPoint {
  x: number;
  y: number;
  pressure?: number;
}

export interface PaintStrokeInput {
  correlationId: string;
  generation: number;
  tool: PaintTool;
  color?: string;
  width: number;
  points: PaintPoint[];
}

export interface PaintStroke extends PaintStrokeInput {
  id: string;
  authorUserId: number;
  authorMatrixUserId: string;
  sequence: number;
  active: boolean;
}

export interface PaintSource {
  matrixRoomId: string;
  sourceEventId: string;
  mxcUrl: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface PaintParticipant {
  userId: number;
  mumbleSessionId: number;
  matrixUserId: string;
}

export type PaintSessionStatus = 'pendingSource' | 'active' | 'ended' | 'expired' | 'unavailable';

export interface PaintSessionSummary {
  sessionId: string;
  channelId: number;
  hostUserId: number;
  status: PaintSessionStatus;
  canJoin: boolean;
  isParticipant: boolean;
}

export interface PaintSessionSnapshot {
  sessionId: string;
  channelId: number;
  hostUserId: number;
  currentUserId?: number;
  isHost?: boolean;
  matrixRoomId: string;
  sourceEventId: string | null;
  status: PaintSessionStatus;
  expiresAt: string;
  source: PaintSource | null;
  participants: PaintParticipant[];
  strokes: PaintStroke[];
  generation: number;
  revision: number;
}

export interface PaintPreview extends PaintStrokeInput {
  sessionId: string;
  authorUserId: number;
  authorMatrixUserId: string;
}

export interface PaintPermanentEvent {
  sessionId: string;
  revision: number;
  generation: number;
}

export interface PaintStrokeCommittedEvent extends PaintPermanentEvent {
  stroke: PaintStroke;
}

export interface PaintStrokeUndoneEvent extends PaintPermanentEvent {
  undoneStrokeId: string;
}
