import type { ShareInfo } from '../../hooks/useScreenShare';
import type { ScreenShareQuality } from '../../utils/screenShareQuality';

export interface LiveKitTooltipInput {
  /** Display name for the service (e.g. 'Screenshare'). */
  name: string;
  /** Whether the underlying livekit service status is 'connected'. */
  connected: boolean;
  /** True when a LiveKit room is active (sharing and/or watching). */
  isLiveKitRoomConnected: boolean;
  /** Aggregate room quality. */
  screenShareQuality: ScreenShareQuality;
  /** True when the local user is broadcasting a share. */
  isSharing: boolean;
  /** Preformatted broadcast summary, e.g. '1080p 30fps'. Undefined when not broadcasting. */
  broadcastSummary?: string;
  /** Shares the local user is currently watching. */
  watchingShares: ShareInfo[];
  /** Per-share quality keyed by ShareInfo.userId. */
  shareQualities: Map<number, ScreenShareQuality>;
  /** Live remote <video> elements keyed by ShareInfo.userId (for live dimensions). */
  remoteVideoEls: Map<number, HTMLVideoElement>;
}

/**
 * Builds the multi-line LiveKit/Screenshare status tooltip string.
 *
 * Pure: inputs -> string. Returns `null` when there is nothing livekit-specific
 * to say (e.g. not connected), so the caller can fall through to its generic
 * tooltip. Uses the existing `\n` multi-line convention shared with the voice
 * and server tooltips.
 */
export function buildLiveKitTooltip(input: LiveKitTooltipInput): string | null {
  const {
    name,
    connected,
    isLiveKitRoomConnected,
    screenShareQuality,
    isSharing,
    broadcastSummary,
    watchingShares,
    shareQualities,
    remoteVideoEls,
  } = input;

  if (connected && !isLiveKitRoomConnected) {
    return `${name}: Available`;
  }

  if (isLiveKitRoomConnected && screenShareQuality === 'reconnecting') {
    return `${name}: Reconnecting`;
  }

  if (!(connected && isLiveKitRoomConnected)) {
    return null;
  }

  const firstLine =
    screenShareQuality !== 'unknown'
      ? `${name}: Connected - ${screenShareQuality}`
      : `${name}: Connected`;

  const lines: string[] = [firstLine];

  if (isSharing && broadcastSummary) {
    lines.push(`Broadcasting: ${broadcastSummary}`);
  }

  if (watchingShares.length > 0) {
    const n = watchingShares.length;
    lines.push(`Watching ${n} share${n === 1 ? '' : 's'}`);
    for (const share of watchingShares) {
      lines.push(buildShareLine(share, shareQualities, remoteVideoEls));
    }
  }

  return lines.join('\n');
}

function buildShareLine(
  share: ShareInfo,
  shareQualities: Map<number, ScreenShareQuality>,
  remoteVideoEls: Map<number, HTMLVideoElement>,
): string {
  const trimmedName = share.userName?.trim() ?? '';
  const trimmedMatrixId = share.matrixUserId?.trim() ?? '';
  const label =
    trimmedName !== '' ? trimmedName : trimmedMatrixId !== '' ? trimmedMatrixId : String(share.userId);

  const el = remoteVideoEls.get(share.userId);
  const w = el?.videoWidth ?? 0;
  const h = el?.videoHeight ?? 0;
  const res = w > 0 && h > 0 ? `${w}\u00D7${h}` : '';

  const q = shareQualities.get(share.userId);
  const qualSuffix = q && q !== 'unknown' ? ` (${q})` : '';

  return res !== '' ? `${label}: ${res}${qualSuffix}` : `${label}${qualSuffix}`;
}
