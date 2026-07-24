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
  eventId: string;
  mxcUrl: string;
  mimeType: string;
  width: number;
  height: number;
}

export interface PaintParticipant {
  userId: number;
  matrixUserId: string;
  displayName?: string;
}

export type PaintSessionStatus = 'active' | 'ended' | 'expired' | 'unavailable';

export interface PaintSessionSnapshot {
  id: string;
  channelId: number;
  hostUserId: number;
  matrixRoomId: string;
  status: PaintSessionStatus;
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
