export const CHANNEL_REQUEST_STATUSES = ['pending', 'approved', 'denied'] as const;
export type ChannelRequestStatus = typeof CHANNEL_REQUEST_STATUSES[number];

export interface ChannelRequestItem {
  id: number;
  channelName: string;
  reason: string | null;
  status: ChannelRequestStatus;
  createdAtUtc: string;
  handledAtUtc: string | null;
  decisionReason: string | null;
  requesterDisplayName?: string | null;
  handledByDisplayName?: string | null;
  lastApprovalError?: string | null;
}

export interface ChannelRequestApiError {
  code: string;
  message: string;
}

export interface ChannelRequestListResponse {
  items: ChannelRequestItem[];
}
