import { useCallback, useRef, useState, useEffect, type SetStateAction } from 'react';
import { Room, RoomEvent, Track, RemoteTrackPublication, VideoPreset, VideoQuality } from 'livekit-client';
import bridge from '../bridge';
import { type ScreenShareQuality, mapLiveKitQuality, worstQuality } from '../utils/screenShareQuality';

/** Viewer-selected receive quality for a watched screen share. 'auto' defers to adaptive stream. */
export type ViewerQuality = 'auto' | 'high' | 'medium' | 'low';

const VIEWER_QUALITY_TO_LIVEKIT: Record<Exclude<ViewerQuality, 'auto'>, VideoQuality> = {
  high: VideoQuality.HIGH,
  medium: VideoQuality.MEDIUM,
  low: VideoQuality.LOW,
};

export interface ShareInfo {
  roomName: string;
  userName: string;
  userId: number;
  matrixUserId?: string;
  sessionId?: number;
}

/** @deprecated Use ShareInfo instead */
export interface ActiveShare {
  roomName: string;
  userName: string;
  sessionId?: number;
}

export interface ScreenShareSettings {
  captureAudio: boolean;
  resolution: '720p' | '1080p' | '1440p' | '4k';
  fps: 15 | 30 | 60;
  systemAudio: boolean;
  preferredCaptureSource: 'auto' | 'window' | 'screen' | 'browser';
  /** Optimize encoding for smooth motion (games/video) or sharp detail (text/code). */
  contentType?: 'motion' | 'detail';
}

/** Debounce window before applying edited settings to an already-active share. */
const APPLY_SETTINGS_DEBOUNCE_MS = 400;

const SCREEN_SHARE_RESOLUTION_MAP: Record<string, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '4k': { width: 3840, height: 2160 },
};

// Motion/video/game content needs substantially more bitrate than static desktops to
// avoid the blocky degradation weak-bandwidth viewers were seeing. Raised across the board.
const SCREEN_SHARE_BITRATE_MAP: Record<string, number> = {
  '720p': 3_000_000,
  '1080p': 6_000_000,
  '1440p': 10_000_000,
  '4k': 18_000_000,
};

const screenShareDegradationPreference = (settings: ScreenShareSettings): 'maintain-resolution' | 'maintain-framerate' =>
  settings.contentType === 'detail' ? 'maintain-resolution' : 'maintain-framerate';

const screenShareContentHint = (settings: ScreenShareSettings): 'detail' | 'motion' =>
  settings.contentType === 'detail' ? 'detail' : 'motion';

/**
 * Build the getDisplayMedia capture options (2nd arg) and publish options (3rd arg)
 * for setScreenShareEnabled from user settings. Shared by initial share start and by
 * the re-capture path when resolution/capture-source settings change mid-share.
 */
const buildScreenShareOptions = (settings: ScreenShareSettings): {
  captureOptions: Record<string, unknown> | undefined;
  publishOptions: Record<string, unknown>;
} => {
  let captureOptions: Record<string, unknown> | undefined = {};

  const displaySurfaceMap: Partial<Record<ScreenShareSettings['preferredCaptureSource'], 'window' | 'monitor' | 'browser'>> = {
    window: 'window',
    screen: 'monitor',
    browser: 'browser',
  };
  const displaySurface = displaySurfaceMap[settings.preferredCaptureSource];
  if (displaySurface) {
    captureOptions.video = { displaySurface };
  }

  if (settings.captureAudio) {
    captureOptions.audio = true;
  }

  if (settings.captureAudio && settings.systemAudio) {
    captureOptions.systemAudio = 'include';
  }

  // Steer the encoder: motion content keeps framerate smooth (drop resolution under
  // pressure); detail content preserves sharpness (drop framerate under pressure).
  captureOptions.contentHint = screenShareContentHint(settings);

  // publishOptions (3rd arg) — NOT capture options. videoEncoding/codec/simulcast belong here.
  const publishOptions: Record<string, unknown> = {
    degradationPreference: screenShareDegradationPreference(settings),
    // Two-layer simulcast (high + one low) so weak-bandwidth viewers subscribe to the low
    // layer cleanly instead of receiving a single high-res stream degraded by packet loss.
    simulcast: true,
    screenShareSimulcastLayers: [new VideoPreset(640, 360, 500_000, settings.fps ?? 15)],
  };

  if (settings.resolution || settings.fps) {
    const res = SCREEN_SHARE_RESOLUTION_MAP[settings.resolution];
    captureOptions.resolution = {
      ...res,
      frameRate: settings.fps,
    };
    publishOptions.videoEncoding = {
      maxBitrate: SCREEN_SHARE_BITRATE_MAP[settings.resolution],
      maxFramerate: settings.fps,
    };
  }

  if (Object.keys(captureOptions).length === 0) {
    captureOptions = undefined;
  }

  return { captureOptions, publishOptions };
};

/** Settings whose changes require a fresh getDisplayMedia capture (picker prompt). */
const screenShareNeedsRecapture = (prev: ScreenShareSettings, next: ScreenShareSettings): boolean =>
  prev.resolution !== next.resolution ||
  prev.preferredCaptureSource !== next.preferredCaptureSource ||
  prev.captureAudio !== next.captureAudio ||
  prev.systemAudio !== next.systemAudio;

/** Settings whose changes can be applied to the live track without re-capturing. */
const screenShareNeedsLiveApply = (prev: ScreenShareSettings, next: ScreenShareSettings): boolean =>
  prev.contentType !== next.contentType || prev.fps !== next.fps;


export type LocalShareStopReason = 'manual' | 'source-closed' | 'interrupted' | 'error' | 'blocked-capture' | 'moved-channel';
export type WatchedShareEndReason = 'ended' | 'unexpected';
export type WatchedShareEndedCallback = (share: ShareInfo, reason: WatchedShareEndReason) => void;

type LocalTrackLike = {
  addEventListener?: (event: string, handler: () => void) => void;
  removeEventListener?: (event: string, handler: () => void) => void;
  on?: (event: string, handler: () => void) => void;
  off?: (event: string, handler: () => void) => void;
};

type LiveKitAccessMode = 'publish' | 'subscribe';
type LiveKitTokenResponse = { token: string; url: string; expiresAt?: string };

type DiscoveryTarget = (({ scope: 'all' } | { roomName: string }) & { requestId?: number; baselineShareEventVersion?: number }) | null;

type PendingRoomRequest = {
  roomName: string;
  accessMode: LiveKitAccessMode;
  promise: Promise<Room>;
  reject: (err: unknown) => void;
};

type PendingTokenRequest = {
  cancel: () => void;
};

type ActiveTokenLease = {
  roomName: string;
  accessMode: LiveKitAccessMode;
  token: string;
  url: string;
  expiresAt: string;
  isRefreshed: boolean;
  generation: number;
};

type PendingViewerAttempt = {
  id: number;
  roomName: string;
  userId: number;
  cancel: () => void;
  promise: Promise<never>;
};

type SupersededRoomRequest = Error & { code: 'LIVEKIT_ROOM_REQUEST_SUPERSEDED' };

const TOKEN_REFRESH_SAFETY_WINDOW_MS = 2 * 60 * 1000;
const MIN_TOKEN_REFRESH_DELAY_MS = 5 * 1000;

const watchedShareKey = (roomName: string, userId: number) => `${roomName}:${userId}`;

const sendScreenShareDebugEvent = (eventName: string) => {
  try {
    bridge.send(`livekit.debug.${eventName}`, {});
  } catch {
    // Diagnostics must never affect the share lifecycle.
  }
};

/**
 * Phase 0 instrumentation: log the actual received layer/resolution/quality per viewer so we
 * can confirm whether pixelation is per-viewer (bandwidth/layer) or per-broadcaster (encode).
 * Cheap console diagnostics only — never affects the share lifecycle.
 */
const logScreenShareDiag = (
  where: string,
  userId: number,
  el: HTMLVideoElement | null,
  pub?: { videoQuality?: unknown; dimensions?: { width: number; height: number } },
) => {
  try {
    const dims = pub?.dimensions;
    console.info('[LiveKit][screenshare-diag]', where, {
      userId,
      elementSize: el ? `${el.clientWidth}x${el.clientHeight}` : 'n/a',
      videoResolution: el ? `${el.videoWidth}x${el.videoHeight}` : 'n/a',
      publishedDimensions: dims ? `${dims.width}x${dims.height}` : 'n/a',
      videoQuality: pub?.videoQuality,
    });
  } catch {
    // Diagnostics must never throw.
  }
};

type ErrorLike = {
  name?: unknown;
  message?: unknown;
  constructor?: {
    name?: unknown;
  };
};

const getErrorLikeDetails = (err: unknown) => {
  if (!err || typeof err !== 'object') {
    return null;
  }

  const { name, message } = err as ErrorLike;
  return {
    name: typeof name === 'string' ? name : '',
    message: typeof message === 'string' ? message : '',
  };
};

const isScreenSharePickerCancel = (err: unknown) => {
  const details = getErrorLikeDetails(err);
  if (!details) {
    return false;
  }

   const normalizedMessage = details.message.trim().toLowerCase();

   if (normalizedMessage === 'permission denied by user') {
     return true;
   }

  const isDomExceptionLike = err instanceof DOMException
    || (typeof (err as ErrorLike).constructor?.name === 'string' && (err as ErrorLike).constructor?.name === 'DOMException');

  if (!isDomExceptionLike) {
    return false;
  }

  const normalizedName = details.name.trim().toLowerCase();

  if (normalizedName === 'aborterror') {
    const knownAbortCancelMessages = new Set([
      'canceled',
      'cancelled',
      'permission denied by user',
      'selection canceled by user',
      'selection cancelled by user',
    ]);

    return knownAbortCancelMessages.has(normalizedMessage);
  }

  if (normalizedName === 'notallowederror') {
    const knownDismissMessages = new Set([
      'permission denied by user',
      'dismissed',
      'permission dismissed',
    ]);

    return knownDismissMessages.has(normalizedMessage);
  }

  return false;
};

const isBlockedWindowCaptureError = (err: unknown) => {
  const details = getErrorLikeDetails(err);
  const message = details?.message.toLowerCase() ?? '';
  const name = details?.name.toLowerCase() ?? '';

  return name === 'aborterror' && message.includes('starting capture pipeline');
};

const createSupersededRoomRequestError = (): SupersededRoomRequest => Object.assign(
  new Error('LiveKit room request was superseded'),
  { code: 'LIVEKIT_ROOM_REQUEST_SUPERSEDED' as const },
);

const isSupersededRoomRequestError = (err: unknown) => (
  !!err && typeof err === 'object' && (err as { code?: unknown }).code === 'LIVEKIT_ROOM_REQUEST_SUPERSEDED'
);

export function useScreenShare(
  onDisconnected?: () => void,
  screenShareSettings?: ScreenShareSettings,
  onLocalShareEnded?: (reason: LocalShareStopReason) => void,
  onWatchedShareEnded?: WatchedShareEndedCallback,
) {
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeShares, setActiveShares] = useState<ShareInfo[]>([]);
  const [watchingShares, setWatchingShares] = useState<ShareInfo[]>([]);
  const [isViewerConnectPending, setIsViewerConnectPending] = useState(false);
  const [focusedShare, _setFocusedShare] = useState<ShareInfo | null>(null);
  const [remoteVideoEls, setRemoteVideoEls] = useState<Map<number, HTMLVideoElement>>(new Map());
  const remoteAudioElsRef = useRef<Map<number, HTMLAudioElement>>(new Map());
  const [roomQuality, setRoomQuality] = useState<ScreenShareQuality>('unknown');
  const [shareQualities, setShareQualities] = useState<Map<number, ScreenShareQuality>>(new Map());
  const [viewerQualities, setViewerQualities] = useState<Map<number, ViewerQuality>>(new Map());

  // Single room connection per channel — used for both publishing and subscribing
  const roomRef = useRef<Room | null>(null);
  const watchingSharesRef = useRef<ShareInfo[]>([]);
  const activeSharesRef = useRef<ShareInfo[]>([]);
  const shareQualitiesRef = useRef<Map<number, ScreenShareQuality>>(new Map());
  const viewerQualitiesRef = useRef<Map<number, ViewerQuality>>(new Map());
  const shareQualitiesBeforeReconnectRef = useRef<Map<number, ScreenShareQuality> | null>(null);
  const localQualityRef = useRef<ScreenShareQuality>('unknown');
  const isRoomReconnectingRef = useRef(false);
  const isSharingRef = useRef(false);
  const isStartingShareRef = useRef(false);
  // Snapshot of the settings currently applied to the active share, so an edit can be
  // diffed to decide between a silent live-apply and a re-capture.
  const appliedShareSettingsRef = useRef<ScreenShareSettings | null>(null);
  const focusedShareRef = useRef<ShareInfo | null>(null);
  const discoveryTargetRef = useRef<DiscoveryTarget>(null);
  const shareEventVersionRef = useRef(0);
  const shareEventVersionByRoomRef = useRef(new Map<string, number>());
  const nextTokenRequestIdRef = useRef(0);
  const pendingTokenRequestRef = useRef<PendingTokenRequest | null>(null);
  const activeTokenLeaseRef = useRef<ActiveTokenLease | null>(null);
  const tokenRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDisconnectedRef = useRef(onDisconnected);
  const onLocalShareEndedRef = useRef(onLocalShareEnded);
  const onWatchedShareEndedRef = useRef<WatchedShareEndedCallback | undefined>(onWatchedShareEnded);
  const localShareEndCleanupRef = useRef<(() => void) | null>(null);
  const localShareStopHandledRef = useRef(false);
  const localShareTeardownIntentRef = useRef<LocalShareStopReason | null>(null);
  const viewerConnectPendingCountRef = useRef(0);
  const pendingViewerAttemptIdRef = useRef(0);
  const pendingViewerAttemptsRef = useRef(new Map<number, PendingViewerAttempt>());
  const endedWatchedShareKeysRef = useRef(new Set<string>());
  const pendingUnsubscribedWatchedSharesRef = useRef(new Map<string, ShareInfo>());
  onDisconnectedRef.current = onDisconnected;
  onLocalShareEndedRef.current = onLocalShareEnded;
  onWatchedShareEndedRef.current = onWatchedShareEnded;

  const clearLocalShareEndListener = useCallback(() => {
    localShareEndCleanupRef.current?.();
    localShareEndCleanupRef.current = null;
  }, []);

  const beginViewerConnectAttempt = useCallback(() => {
    viewerConnectPendingCountRef.current += 1;
    setIsViewerConnectPending(true);
  }, []);

  const endViewerConnectAttempt = useCallback(() => {
    viewerConnectPendingCountRef.current = Math.max(0, viewerConnectPendingCountRef.current - 1);
    setIsViewerConnectPending(viewerConnectPendingCountRef.current > 0);
  }, []);

  const registerPendingViewerAttempt = useCallback((roomName: string, userId: number) => {
    const id = ++pendingViewerAttemptIdRef.current;
    let cancel!: () => void;
    const promise = new Promise<never>((_, reject) => {
      cancel = () => reject(createSupersededRoomRequestError());
    });
    const attempt: PendingViewerAttempt = { id, roomName, userId, cancel, promise };
    pendingViewerAttemptsRef.current.set(id, attempt);
    return attempt;
  }, []);

  const unregisterPendingViewerAttempt = useCallback((attempt: PendingViewerAttempt) => {
    pendingViewerAttemptsRef.current.delete(attempt.id);
  }, []);

  const setFocusedShare: typeof _setFocusedShare = useCallback((action) => {
    _setFocusedShare(prev => {
      const next = typeof action === 'function' ? action(prev) : action;
      focusedShareRef.current = next;
      return next;
    });
  }, []);

  const updateActiveShares = useCallback((action: SetStateAction<ShareInfo[]>) => {
    setActiveShares(prev => {
      const next = typeof action === 'function' ? action(prev) : action;
      activeSharesRef.current = next;
      return next;
    });
  }, []);

  const updateWatchingShares = useCallback((shares: ShareInfo[]) => {
    watchingSharesRef.current = shares;
    setWatchingShares(shares);
  }, []);

  const recomputeRoomQuality = useCallback(() => {
    if (isRoomReconnectingRef.current) {
      setRoomQuality('reconnecting');
      return;
    }

    const qualities: ScreenShareQuality[] = [];
    if (isSharingRef.current) {
      qualities.push(localQualityRef.current);
    }

    for (const share of watchingSharesRef.current) {
      qualities.push(shareQualitiesRef.current.get(share.userId) ?? 'unknown');
    }

    setRoomQuality(qualities.length > 0 ? worstQuality(qualities) : 'unknown');
  }, []);

  const resetQualityState = useCallback(() => {
    isRoomReconnectingRef.current = false;
    shareQualitiesBeforeReconnectRef.current = null;
    localQualityRef.current = 'unknown';
    shareQualitiesRef.current = new Map();
    setShareQualities(new Map());
    viewerQualitiesRef.current = new Map();
    setViewerQualities(new Map());
    setRoomQuality('unknown');
  }, []);

  const updateShareQuality = useCallback((userId: number, quality: ScreenShareQuality) => {
    shareQualitiesRef.current = new Map(shareQualitiesRef.current).set(userId, quality);
    setShareQualities(shareQualitiesRef.current);
    recomputeRoomQuality();
  }, [recomputeRoomQuality]);

  const removeShareQuality = useCallback((userId: number) => {
    if (!shareQualitiesRef.current.has(userId)) {
      return;
    }
    const next = new Map(shareQualitiesRef.current);
    next.delete(userId);
    shareQualitiesRef.current = next;
    setShareQualities(next);
    recomputeRoomQuality();
  }, [recomputeRoomQuality]);

  // Apply the viewer-selected receive quality to a participant's screen-share video track.
  // 'auto' pins to HIGH so, with a 2-layer simulcast publish, adaptive stream is free to
  // pick the best layer up to full quality; explicit levels force a fixed layer.
  const applyViewerQuality = useCallback((participant: { trackPublications: Map<string, RemoteTrackPublication> }, userId: number) => {
    const pref = viewerQualitiesRef.current.get(userId) ?? 'auto';
    const target = pref === 'auto' ? VideoQuality.HIGH : VIEWER_QUALITY_TO_LIVEKIT[pref];
    participant.trackPublications?.forEach((pub) => {
      if (pub.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
        try {
          pub.setVideoQuality?.(target);
        } catch {
          // Quality selection is best-effort; never break playback.
        }
      }
    });
  }, []);

  const removeViewerQuality = useCallback((userId: number) => {
    if (!viewerQualitiesRef.current.has(userId)) {
      return;
    }
    const next = new Map(viewerQualitiesRef.current);
    next.delete(userId);
    viewerQualitiesRef.current = next;
    setViewerQualities(next);
  }, []);

  const setViewerQuality = useCallback((userId: number, quality: ViewerQuality) => {
    viewerQualitiesRef.current = new Map(viewerQualitiesRef.current).set(userId, quality);
    setViewerQualities(viewerQualitiesRef.current);

    const room = roomRef.current;
    const share = watchingSharesRef.current.find(s => s.userId === userId);
    if (!room || !share) {
      return;
    }
    const identity = share.matrixUserId ?? String(userId);
    const participant = room.remoteParticipants.get(identity);
    if (participant) {
      applyViewerQuality(participant, userId);
    }
  }, [applyViewerQuality]);

  const detachRemoteAudio = useCallback((userId: number) => {
    const audioEl = remoteAudioElsRef.current.get(userId);
    if (!audioEl) return;

    audioEl.remove();
    remoteAudioElsRef.current.delete(userId);
  }, []);

  const attachRemoteAudio = useCallback((userId: number, track: { attach: () => HTMLElement }) => {
    detachRemoteAudio(userId);
    const el = track.attach() as HTMLAudioElement;
    el.autoplay = true;
    el.dataset.screenShareAudio = String(userId);
    document.body.appendChild(el);
    remoteAudioElsRef.current.set(userId, el);
    void roomRef.current?.startAudio?.().catch((err: unknown) => {
      console.warn('[LiveKit] screen-share audio playback could not start', err);
    });
  }, [detachRemoteAudio]);

  const clearTokenRefreshTimer = useCallback(() => {
    if (tokenRefreshTimerRef.current) {
      clearTimeout(tokenRefreshTimerRef.current);
      tokenRefreshTimerRef.current = null;
    }
  }, []);

  const clearTokenLease = useCallback(() => {
    clearTokenRefreshTimer();
    activeTokenLeaseRef.current = null;
  }, [clearTokenRefreshTimer]);

  const markLocalShareTeardownIntent = useCallback((reason: LocalShareStopReason) => {
    localShareTeardownIntentRef.current = reason;
  }, []);

  const setDiscoveryTarget = useCallback((target: DiscoveryTarget) => {
    if (!target) {
      discoveryTargetRef.current = null;
      updateActiveShares([]);
      return;
    }

    const baselineShareEventVersion = 'scope' in target
      ? shareEventVersionRef.current
      : shareEventVersionByRoomRef.current.get(target.roomName) ?? 0;
    discoveryTargetRef.current = { ...target, baselineShareEventVersion };
  }, [updateActiveShares]);

  const addWatchingShare = useCallback((share: ShareInfo) => {
    endedWatchedShareKeysRef.current.delete(watchedShareKey(share.roomName, share.userId));
    const prev = watchingSharesRef.current;
    if (prev.some(s => s.userId === share.userId)) return;

    let evictedUserId: number | undefined;
    let next: ShareInfo[];
    if (prev.length >= 4) {
      // Evict oldest non-focused share; fall back to oldest if all focused
      const focusId = focusedShareRef.current?.userId;
      const nonFocusedIndex = prev.findIndex(s => s.userId !== focusId);
      const evictIndex = nonFocusedIndex >= 0 ? nonFocusedIndex : 0;
      evictedUserId = prev[evictIndex].userId;
      next = [...prev.slice(0, evictIndex), ...prev.slice(evictIndex + 1), share];
    } else {
      next = [...prev, share];
    }
    watchingSharesRef.current = next;
    setWatchingShares(next);

    // Clean up evicted share state
    if (evictedUserId != null) {
      const evicted = evictedUserId;
      setFocusedShare(p => p?.userId === evicted ? null : p);
      detachRemoteAudio(evicted);
      removeShareQuality(evicted);
      setRemoteVideoEls(p => {
        const m = new Map(p);
        m.delete(evicted);
        return m;
      });
    }

    recomputeRoomQuality();
  }, [detachRemoteAudio, recomputeRoomQuality, removeShareQuality, setFocusedShare]);

  const removeWatchingShare = useCallback((userId: number, options?: { clearPending?: boolean }) => {
    const removedShares = watchingSharesRef.current.filter(s => s.userId === userId);
    if (options?.clearPending !== false) {
      for (const share of removedShares) {
        pendingUnsubscribedWatchedSharesRef.current.delete(watchedShareKey(share.roomName, share.userId));
      }
    }
    const next = watchingSharesRef.current.filter(s => s.userId !== userId);
    watchingSharesRef.current = next;
    setWatchingShares(next);
    setFocusedShare(prev => prev?.userId === userId ? null : prev);
    detachRemoteAudio(userId);
    setRemoteVideoEls(prev => {
      const next = new Map(prev);
      next.delete(userId);
      return next;
    });
    removeShareQuality(userId);
    removeViewerQuality(userId);
    return next;
  }, [detachRemoteAudio, removeShareQuality, removeViewerQuality, setFocusedShare]);

  const clearWatchingState = useCallback(() => {
    setRemoteVideoEls(new Map());
    for (const userId of remoteAudioElsRef.current.keys()) {
      detachRemoteAudio(userId);
    }
    updateWatchingShares([]);
    setFocusedShare(null);
    shareQualitiesRef.current = new Map();
    setShareQualities(new Map());
    viewerQualitiesRef.current = new Map();
    setViewerQualities(new Map());
    recomputeRoomQuality();
  }, [detachRemoteAudio, recomputeRoomQuality, setFocusedShare, updateWatchingShares]);

  const endWatchedShare = useCallback((share: ShareInfo, reason: WatchedShareEndReason) => {
    const key = watchedShareKey(share.roomName, share.userId);
    if (!endedWatchedShareKeysRef.current.has(key)) {
      endedWatchedShareKeysRef.current.add(key);
      onWatchedShareEndedRef.current?.(share, reason);
    }
    pendingUnsubscribedWatchedSharesRef.current.delete(key);
    return removeWatchingShare(share.userId);
  }, [removeWatchingShare]);

  const clearPendingUnsubscribedWatchedShare = useCallback((userId: number) => {
    for (const [key, share] of pendingUnsubscribedWatchedSharesRef.current) {
      if (share.userId === userId) {
        pendingUnsubscribedWatchedSharesRef.current.delete(key);
      }
    }
  }, []);

  const notifyUnexpectedWatchedShareEnds = useCallback(() => {
    for (const share of [...watchingSharesRef.current]) {
      endWatchedShare(share, 'unexpected');
    }
    for (const share of [...pendingUnsubscribedWatchedSharesRef.current.values()]) {
      endWatchedShare(share, 'unexpected');
    }
  }, [endWatchedShare]);

  // Helper: request a LiveKit token via bridge
  const requestToken = useCallback((roomName: string, accessMode: LiveKitAccessMode) => {
    return new Promise<LiveKitTokenResponse>((resolve, reject) => {
      const requestId = ++nextTokenRequestIdRef.current;
      let settled = false;
      const cancel = () => {
        settle(() => reject(createSupersededRoomRequestError()));
      };
      const cleanup = () => {
        if (pendingTokenRequestRef.current?.cancel === cancel) {
          pendingTokenRequestRef.current = null;
        }
        bridge.off('livekit.token', onToken);
        bridge.off('livekit.tokenError', onError);
        clearTimeout(timer);
      };
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };
      const onToken = (data: unknown) => {
        const responseRequestId = (data as { requestId?: number }).requestId;
        if (responseRequestId !== requestId) {
          return;
        }

        settle(() => resolve(data as LiveKitTokenResponse));
      };
      const onError = (data: unknown) => {
        const responseRequestId = (data as { requestId?: number }).requestId;
        if (responseRequestId !== requestId) {
          return;
        }

        settle(() => reject(new Error((data as { error: string }).error)));
      };
      const timer = setTimeout(() => {
        settle(() => reject(new Error('Token request timed out')));
      }, 20000);
      pendingTokenRequestRef.current = { cancel };
      bridge.on('livekit.token', onToken);
      bridge.on('livekit.tokenError', onError);
      bridge.send('livekit.requestToken', { roomName, accessMode, requestId });
    });
  }, []);

  const roomAccessModeRef = useRef<LiveKitAccessMode | null>(null);
  const roomReconnectUpgradeRef = useRef(false);
  const roomLifecycleGenerationRef = useRef(0);
  const shareStartCancelGenerationRef = useRef(0);
  const pendingRoomRequestRef = useRef<PendingRoomRequest | null>(null);

  const cancelPendingRoomRequest = useCallback(() => {
    pendingTokenRequestRef.current?.cancel();
    pendingTokenRequestRef.current = null;
    const pending = pendingRoomRequestRef.current;
    pendingRoomRequestRef.current = null;
    pending?.reject(createSupersededRoomRequestError());
  }, []);

  const invalidateRoomLifecycle = useCallback((reason = 'unknown') => {
    sendScreenShareDebugEvent(`invalidateRoomLifecycle.${reason}`);
    roomLifecycleGenerationRef.current += 1;
    cancelPendingRoomRequest();
  }, [cancelPendingRoomRequest]);

  const maybeCancelPendingRoomForViewerRoom = useCallback((roomName: string) => {
    const hasRemainingPendingViewersForRoom = Array.from(pendingViewerAttemptsRef.current.values()).some(attempt => attempt.roomName === roomName);
    if (pendingRoomRequestRef.current?.roomName === roomName && !hasRemainingPendingViewersForRoom && watchingSharesRef.current.length === 0 && !isSharingRef.current) {
      invalidateRoomLifecycle('maybeCancelPendingRoomForViewerRoom');
    }
  }, [invalidateRoomLifecycle]);

  const cancelPendingViewerAttempts = useCallback((predicate?: (attempt: PendingViewerAttempt) => boolean) => {
    const canceledRooms = new Set<string>();
    for (const attempt of pendingViewerAttemptsRef.current.values()) {
      if (!predicate || predicate(attempt)) {
        pendingViewerAttemptsRef.current.delete(attempt.id);
        canceledRooms.add(attempt.roomName);
        attempt.cancel();
      }
    }
    for (const roomName of canceledRooms) {
      maybeCancelPendingRoomForViewerRoom(roomName);
    }
  }, [maybeCancelPendingRoomForViewerRoom]);

  // Try to disconnect the room, but only if we're not sharing AND not watching
  const maybeDisconnectRoom = useCallback(async () => {
    const room = roomRef.current;
    if (!isSharingRef.current && watchingSharesRef.current.length === 0 && room) {
      sendScreenShareDebugEvent('maybeDisconnectRoom.disconnect');
      roomRef.current = null;
      roomAccessModeRef.current = null;
      roomReconnectUpgradeRef.current = false;
      resetQualityState();
      clearTokenLease();
      invalidateRoomLifecycle('maybeDisconnectRoom');
      try { await room.disconnect(); } catch { /* ignore */ }
    } else {
      sendScreenShareDebugEvent('maybeDisconnectRoom.skip');
    }
  }, [clearTokenLease, invalidateRoomLifecycle, resetQualityState]);

  const stopLocalShare = useCallback(async (
    reason: LocalShareStopReason,
    roomOverride?: Room | null,
  ) => {
    const wasSharing = isSharingRef.current;
    const shouldHandleErrorBeforeShareStarts = (reason === 'error' || reason === 'blocked-capture') && !localShareStopHandledRef.current;

    sendScreenShareDebugEvent(`stopLocalShare.${reason}.entered`);

    if (localShareStopHandledRef.current || (!wasSharing && !shouldHandleErrorBeforeShareStarts)) {
      sendScreenShareDebugEvent(`stopLocalShare.${reason}.ignored`);
      return;
    }

    localShareStopHandledRef.current = true;
    clearLocalShareEndListener();
    localShareTeardownIntentRef.current = null;

    const room = roomOverride ?? roomRef.current;
    const roomName = room?.name;

    if (wasSharing && reason !== 'interrupted' && room) {
      try { await room.localParticipant.setScreenShareEnabled(false); } catch { /* ignore */ }
    }

    isSharingRef.current = false;
    setIsSharing(false);
    appliedShareSettingsRef.current = null;
    recomputeRoomQuality();

    if (wasSharing && roomName) {
      bridge.send('livekit.shareStopped', { roomName });
      sendScreenShareDebugEvent(`stopLocalShare.${reason}.sentShareStopped`);
    }

    onLocalShareEndedRef.current?.(reason);

    if (reason === 'interrupted') {
      onDisconnectedRef.current?.();
    }

    await maybeDisconnectRoom();
    sendScreenShareDebugEvent(`stopLocalShare.${reason}.done`);
  }, [clearLocalShareEndListener, maybeDisconnectRoom, recomputeRoomQuality]);

  const scheduleTokenRefresh = useCallback((lease: ActiveTokenLease) => {
    clearTokenRefreshTimer();

    const expiresAtMs = Date.parse(lease.expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      return;
    }

    const delayMs = Math.max(MIN_TOKEN_REFRESH_DELAY_MS, expiresAtMs - Date.now() - TOKEN_REFRESH_SAFETY_WINDOW_MS);
    tokenRefreshTimerRef.current = setTimeout(() => {
      void (async () => {
        const currentLease = activeTokenLeaseRef.current;
        if (!currentLease || currentLease.generation !== lease.generation) {
          return;
        }

        try {
          const refreshed = await requestToken(currentLease.roomName, currentLease.accessMode);
          if (!refreshed.expiresAt || activeTokenLeaseRef.current?.generation !== currentLease.generation) {
            return;
          }

          const nextLease = { ...currentLease, token: refreshed.token, url: refreshed.url, expiresAt: refreshed.expiresAt, isRefreshed: true };
          activeTokenLeaseRef.current = nextLease;
          scheduleTokenRefresh(nextLease);
        } catch {
          if (activeTokenLeaseRef.current?.generation !== currentLease.generation) {
            return;
          }

          setError('LiveKit access could not be renewed');
          const room = roomRef.current;
          roomRef.current = null;
          roomAccessModeRef.current = null;
          roomReconnectUpgradeRef.current = false;
          resetQualityState();
          clearTokenLease();
          invalidateRoomLifecycle('tokenRefreshFailed');
          cancelPendingViewerAttempts();
          notifyUnexpectedWatchedShareEnds();
          clearWatchingState();
          if (isSharingRef.current) {
            await stopLocalShare('interrupted', room);
          }
          try { await room?.disconnect(); } catch { /* ignore */ }
        }
      })();
    }, delayMs);
  }, [cancelPendingViewerAttempts, clearTokenLease, clearTokenRefreshTimer, clearWatchingState, invalidateRoomLifecycle, notifyUnexpectedWatchedShareEnds, requestToken, resetQualityState, stopLocalShare]);

  const bindLocalShareEndListener = useCallback((room: Room) => {
    clearLocalShareEndListener();

    const publication = (room.localParticipant as {
      getTrackPublication?: (source: string) => { track?: LocalTrackLike } | undefined;
    }).getTrackPublication?.(Track.Source.ScreenShare);
    const track = publication?.track;
    if (!track) {
      sendScreenShareDebugEvent('bindLocalShareEndListener.noTrack');
      return;
    }

    sendScreenShareDebugEvent('bindLocalShareEndListener.bound');

    const onEnded = () => {
      sendScreenShareDebugEvent('localTrack.ended');
      void stopLocalShare('source-closed', room);
    };

    if (typeof track.addEventListener === 'function' && typeof track.removeEventListener === 'function') {
      track.addEventListener('ended', onEnded);
      localShareEndCleanupRef.current = () => track.removeEventListener?.('ended', onEnded);
      return;
    }

    if (typeof track.on === 'function' && typeof track.off === 'function') {
      track.on('ended', onEnded);
      localShareEndCleanupRef.current = () => track.off?.('ended', onEnded);
    }
  }, [clearLocalShareEndListener, stopLocalShare]);

  const bindRoomEvents = useCallback((room: Room) => {
    room.on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
      if (roomRef.current !== room) {
        return;
      }

      const watching = watchingSharesRef.current;
      let matchedShare = watching.find(s => {
        const identity = s.matrixUserId ?? String(s.userId);
        return identity === participant.identity;
      });
      // Self-heal: a broadcaster restarting their share (e.g. applying new
      // resolution/capture-source settings) briefly unpublishes and republishes
      // the track WITHOUT sending a livekit.screenShareStopped bridge event. That
      // leaves the viewer's share parked in pendingUnsubscribedWatchedSharesRef.
      // When the new track subscribes, restore the share so the tile keeps playing
      // instead of staying blank — no "Share ended" notification is involved.
      if (!matchedShare) {
        for (const pending of pendingUnsubscribedWatchedSharesRef.current.values()) {
          const identity = pending.matrixUserId ?? String(pending.userId);
          if (identity === participant.identity) {
            matchedShare = pending;
            pendingUnsubscribedWatchedSharesRef.current.delete(watchedShareKey(pending.roomName, pending.userId));
            addWatchingShare(pending);
            break;
          }
        }
      }
      if (!matchedShare) return;
      if (
        track.kind === Track.Kind.Video &&
        track.source === Track.Source.ScreenShare
      ) {
        const el = track.attach() as HTMLVideoElement;
        setRemoteVideoEls(prev => new Map(prev).set(matchedShare.userId, el));
        applyViewerQuality(participant, matchedShare.userId);
        logScreenShareDiag('trackSubscribed', matchedShare.userId, el, pub);
      }
      if (
        track.kind === Track.Kind.Audio &&
        (track.source === Track.Source.ScreenShareAudio || pub.source === Track.Source.ScreenShareAudio)
      ) {
        attachRemoteAudio(matchedShare.userId, track as { attach: () => HTMLElement });
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track, pub, participant) => {
      if (roomRef.current !== room) {
        return;
      }

      const watching = watchingSharesRef.current;
      const matchedShare = watching.find(s => {
        const identity = s.matrixUserId ?? String(s.userId);
        return identity === participant.identity;
      });
      if (!matchedShare) return;
      if (
        track.kind === Track.Kind.Video &&
        track.source === Track.Source.ScreenShare
      ) {
        track.detach();
        pendingUnsubscribedWatchedSharesRef.current.set(watchedShareKey(matchedShare.roomName, matchedShare.userId), matchedShare);
        removeWatchingShare(matchedShare.userId, { clearPending: false });
      }
      if (
        track.kind === Track.Kind.Audio &&
        (track.source === Track.Source.ScreenShareAudio || pub.source === Track.Source.ScreenShareAudio)
      ) {
        track.detach();
        detachRemoteAudio(matchedShare.userId);
      }
    });

    room.on(RoomEvent.Reconnecting, () => {
      if (roomRef.current !== room) {
        return;
      }

      isRoomReconnectingRef.current = true;
      shareQualitiesBeforeReconnectRef.current = new Map(shareQualitiesRef.current);
      const nextShareQualities = new Map(shareQualitiesRef.current);
      for (const share of watchingSharesRef.current) {
        nextShareQualities.set(share.userId, 'reconnecting');
      }
      shareQualitiesRef.current = nextShareQualities;
      setShareQualities(nextShareQualities);
      setRoomQuality('reconnecting');
    });

    const onReconnected = () => {
      if (roomRef.current !== room) {
        return;
      }

      isRoomReconnectingRef.current = false;
      if (shareQualitiesBeforeReconnectRef.current) {
        shareQualitiesRef.current = shareQualitiesBeforeReconnectRef.current;
        shareQualitiesBeforeReconnectRef.current = null;
        setShareQualities(shareQualitiesRef.current);
      }
      recomputeRoomQuality();
    };

    room.on(RoomEvent.Connected, onReconnected);
    room.on(RoomEvent.Reconnected, onReconnected);

    room.on(RoomEvent.ConnectionQualityChanged, (connectionQuality, participant) => {
      if (roomRef.current !== room) {
        return;
      }

      const quality = mapLiveKitQuality(connectionQuality);
      const participantIdentity = participant.identity;
      if (participantIdentity === room.localParticipant.identity) {
        localQualityRef.current = quality;
        recomputeRoomQuality();
        return;
      }

      const matchedShare = watchingSharesRef.current.find(s => {
        const identity = s.matrixUserId ?? String(s.userId);
        return identity === participantIdentity;
      });
      if (matchedShare) {
        updateShareQuality(matchedShare.userId, quality);
      }
    });

    room.on(RoomEvent.Disconnected, () => {
      sendScreenShareDebugEvent('room.disconnected.event');
      if (roomRef.current !== room) {
        sendScreenShareDebugEvent('room.disconnected.stale');
        return;
      }

      const isUpgradeReconnect = roomReconnectUpgradeRef.current;
      if (isUpgradeReconnect) {
        roomReconnectUpgradeRef.current = false;
        sendScreenShareDebugEvent('room.disconnected.upgradeReconnect');
        return;
      }

      roomRef.current = null;
      roomAccessModeRef.current = null;
      resetQualityState();
      clearTokenLease();
      invalidateRoomLifecycle('roomDisconnected');
      notifyUnexpectedWatchedShareEnds();
      clearWatchingState();
      const teardownIntent = localShareTeardownIntentRef.current;
      localShareTeardownIntentRef.current = null;
      if (isSharingRef.current) {
        sendScreenShareDebugEvent(`room.disconnected.stopLocalShare.${teardownIntent ?? 'interrupted'}`);
        void stopLocalShare(teardownIntent ?? 'interrupted', room);
      }
    });
  }, [addWatchingShare, attachRemoteAudio, applyViewerQuality, clearTokenLease, clearWatchingState, detachRemoteAudio, invalidateRoomLifecycle, notifyUnexpectedWatchedShareEnds, recomputeRoomQuality, removeWatchingShare, resetQualityState, stopLocalShare, updateShareQuality]);

  // Ensure we have a connected room for the given channel.
  // Returns the existing room if already connected to this channel, otherwise connects.
  const ensureRoom = useCallback(async (roomName: string, accessMode: LiveKitAccessMode): Promise<Room> => {
    const existing = roomRef.current;
    const currentAccessMode = roomAccessModeRef.current;
    const existingCanSatisfyRequest = currentAccessMode === 'publish' || currentAccessMode === accessMode;
    if (existing?.name === roomName && (existing as Room & { state?: string })?.state === 'connected' && existingCanSatisfyRequest) {
      return existing;
    }

    const pending = pendingRoomRequestRef.current;
    const pendingCanSatisfyRequest = pending?.accessMode === 'publish' || pending?.accessMode === accessMode;
    if (pending?.roomName === roomName && pendingCanSatisfyRequest) {
      return pending.promise;
    }

    if (pending) {
      invalidateRoomLifecycle('ensureRoom.replacePending');
    }

    let lifecycleGeneration = roomLifecycleGenerationRef.current;
    let isUpgradeReconnect = false;
    let rejectRoomRequest!: (err: unknown) => void;

    const createRoomPromise = (async () => {
      // Disconnect from any other room
      if (existing) {
        isUpgradeReconnect = existing.name === roomName && currentAccessMode === 'subscribe' && accessMode === 'publish';
        roomReconnectUpgradeRef.current = isUpgradeReconnect;
        roomRef.current = null;
        roomAccessModeRef.current = null;
        clearTokenLease();
        invalidateRoomLifecycle('ensureRoom.disconnectExisting');
        lifecycleGeneration = roomLifecycleGenerationRef.current;
        try { await existing.disconnect(); } catch { /* ignore */ }
      }

      const tokenResponse = await requestToken(roomName, accessMode);
      const { token, url } = tokenResponse;
      if (roomLifecycleGenerationRef.current !== lifecycleGeneration) {
        throw createSupersededRoomRequestError();
      }

      const room = new Room({
        // Let subscribers request only the layers they can render, and pause tracks
        // for off-screen/hidden tiles — the core fix for per-viewer pixelation.
        adaptiveStream: true,
        // Stop publishing simulcast layers no viewer is consuming, saving upstream bandwidth.
        dynacast: true,
        publishDefaults: {
          // Motion-heavy screen content (games/video) benefits most from VP9's efficiency;
          // VP8 backup keeps older/limited WebView2 receivers working without forcing an upgrade.
          videoCodec: 'vp9',
          backupCodec: { codec: 'vp8' },
          // Prefer dropping resolution over framerate for smooth motion; per-share overrides
          // are applied in startSharing based on the broadcaster's contentType toggle.
          degradationPreference: 'maintain-framerate',
        },
      });
      bindRoomEvents(room);

      roomRef.current = room;
      roomAccessModeRef.current = accessMode;

      try {
        await room.connect(url, token);
      } catch (err) {
        if (roomRef.current === room) {
          roomRef.current = null;
          roomAccessModeRef.current = null;
          roomReconnectUpgradeRef.current = false;
          resetQualityState();
          clearTokenLease();
          roomLifecycleGenerationRef.current += 1;
        }
        try { await room.disconnect(); } catch { /* ignore */ }
        throw err;
      }
      if (roomLifecycleGenerationRef.current !== lifecycleGeneration || roomRef.current !== room) {
        try { await room.disconnect(); } catch { /* ignore */ }
        throw createSupersededRoomRequestError();
      }

      if (tokenResponse.expiresAt) {
        const lease = {
          roomName,
          accessMode,
          token,
          url,
          expiresAt: tokenResponse.expiresAt,
          isRefreshed: false,
          generation: roomLifecycleGenerationRef.current,
        };
        activeTokenLeaseRef.current = lease;
        scheduleTokenRefresh(lease);
      } else {
        clearTokenLease();
      }

      roomReconnectUpgradeRef.current = false;
      recomputeRoomQuality();
      return room;
    })();

    const roomPromise = new Promise<Room>((resolve, reject) => {
      rejectRoomRequest = reject;
      createRoomPromise.then(resolve, reject);
    });
    roomPromise.catch(() => {});

    pendingRoomRequestRef.current = { roomName, accessMode, promise: roomPromise, reject: rejectRoomRequest };

    try {
      return await roomPromise;
    } finally {
      if (isUpgradeReconnect) {
        roomReconnectUpgradeRef.current = false;
        if (roomRef.current === null && !isSharingRef.current) {
          clearWatchingState();
        }
      }
      if (pendingRoomRequestRef.current?.promise === roomPromise) {
        pendingRoomRequestRef.current = null;
      }
    }
  }, [requestToken, clearWatchingState, invalidateRoomLifecycle, clearTokenLease, scheduleTokenRefresh, bindRoomEvents, recomputeRoomQuality, resetQualityState]);

  const startSharing = useCallback(async (roomName: string): Promise<boolean> => {
    if (isStartingShareRef.current) {
      sendScreenShareDebugEvent('startSharing.alreadyStarting');
      return false;
    }

    sendScreenShareDebugEvent('startSharing.begin');
    isStartingShareRef.current = true;
    setError(null);
    localShareStopHandledRef.current = false;
    const shareStartCancelGeneration = shareStartCancelGenerationRef.current;

    try {
      sendScreenShareDebugEvent('startSharing.ensureRoom.begin');
      const room = await ensureRoom(roomName, 'publish');
      sendScreenShareDebugEvent('startSharing.ensureRoom.done');

      let captureOptions: Record<string, unknown> | undefined;
      let publishOptions: Record<string, unknown> | undefined;
      if (screenShareSettings) {
        ({ captureOptions, publishOptions } = buildScreenShareOptions(screenShareSettings));
      }

      sendScreenShareDebugEvent('startSharing.setScreenShareEnabled.begin');
      await room.localParticipant.setScreenShareEnabled(true, captureOptions, publishOptions);
      sendScreenShareDebugEvent('startSharing.setScreenShareEnabled.done');

      if (shareStartCancelGenerationRef.current !== shareStartCancelGeneration || roomRef.current !== room) {
        sendScreenShareDebugEvent('startSharing.canceledAfterCapture');
        try { await room.localParticipant.setScreenShareEnabled(false); } catch { /* ignore */ }
        try { await maybeDisconnectRoom(); } catch { /* ignore */ }
        return false;
      }

      isSharingRef.current = true;
      setIsSharing(true);
      appliedShareSettingsRef.current = screenShareSettings ?? null;
      recomputeRoomQuality();
      bindLocalShareEndListener(room);

      bridge.send('livekit.shareStarted', { roomName });
      sendScreenShareDebugEvent('startSharing.sentShareStarted');
      return true;
    } catch (err) {
      clearLocalShareEndListener();

      if (isSupersededRoomRequestError(err)) {
        sendScreenShareDebugEvent('startSharing.error.superseded');
        return false;
      }

      if (isScreenSharePickerCancel(err)) {
        sendScreenShareDebugEvent('startSharing.error.pickerCancel');
        await maybeDisconnectRoom();
        return false;
      }

      if (isBlockedWindowCaptureError(err)) {
        sendScreenShareDebugEvent('startSharing.error.blockedCapture');
        setError('Windows could not share that app or window. Try sharing your full screen or a different window.');
        await stopLocalShare('blocked-capture', roomRef.current);
      } else {
        sendScreenShareDebugEvent('startSharing.error.generic');
        setError(getErrorLikeDetails(err)?.message || 'Screen share failed');
        await stopLocalShare('error', roomRef.current);
      }
      // Disconnect room if we're not watching anyone either
      await maybeDisconnectRoom();
      return false;
    } finally {
      isStartingShareRef.current = false;
      sendScreenShareDebugEvent('startSharing.finally');
    }
  }, [screenShareSettings, ensureRoom, bindLocalShareEndListener, clearLocalShareEndListener, maybeDisconnectRoom, recomputeRoomQuality, stopLocalShare]);

  const stopSharing = useCallback(async () => {
    if (isStartingShareRef.current) {
      shareStartCancelGenerationRef.current += 1;
      invalidateRoomLifecycle('stopSharing');
    }
    await stopLocalShare('manual');
  }, [invalidateRoomLifecycle, stopLocalShare]);

  // Apply encoder-only changes (content type, framerate, degradation preference) to the
  // already-published track. No getDisplayMedia re-prompt, no flicker, and viewers keep
  // watching the same track uninterrupted.
  const applyLiveScreenShareSettings = useCallback((settings: ScreenShareSettings) => {
    const room = roomRef.current;
    const pub = room?.localParticipant.getTrackPublication?.(Track.Source.ScreenShare);
    const track = pub?.track as { mediaStreamTrack?: MediaStreamTrack; sender?: RTCRtpSender } | undefined;
    if (!track) {
      return;
    }
    if (track.mediaStreamTrack) {
      try { track.mediaStreamTrack.contentHint = screenShareContentHint(settings); } catch { /* ignore */ }
    }
    const sender = track.sender;
    if (sender && typeof sender.getParameters === 'function' && typeof sender.setParameters === 'function') {
      try {
        const params = sender.getParameters();
        params.degradationPreference = screenShareDegradationPreference(settings) as RTCDegradationPreference;
        if (params.encodings?.length && settings.fps) {
          for (const enc of params.encodings) {
            enc.maxFramerate = settings.fps;
          }
        }
        void sender.setParameters(params);
      } catch { /* ignore */ }
    }
    sendScreenShareDebugEvent('applySettings.liveApplied');
  }, []);

  // Re-acquire the capture (resolution or capture-source changed) by toggling the local
  // screen share off then on with fresh options. Deliberately does NOT send the
  // livekit.shareStopped/shareStarted bridge events, so viewers get no "Share ended"
  // notification — their track briefly unsubscribes then self-heals on resubscribe.
  const recaptureActiveScreenShare = useCallback(async (settings: ScreenShareSettings) => {
    const room = roomRef.current;
    if (!room || !isSharingRef.current) {
      return;
    }
    const { captureOptions, publishOptions } = buildScreenShareOptions(settings);
    sendScreenShareDebugEvent('applySettings.recapture.begin');
    try {
      await room.localParticipant.setScreenShareEnabled(false);
      if (!isSharingRef.current || roomRef.current !== room) {
        return;
      }
      await room.localParticipant.setScreenShareEnabled(true, captureOptions, publishOptions);
      bindLocalShareEndListener(room);
      sendScreenShareDebugEvent('applySettings.recapture.done');
    } catch (err) {
      sendScreenShareDebugEvent('applySettings.recapture.error');
      setError(getErrorLikeDetails(err)?.message || 'Screen share failed');
    }
  }, [bindLocalShareEndListener]);

  const applyScreenShareSettingsToActiveShare = useCallback(async (
    prev: ScreenShareSettings,
    next: ScreenShareSettings,
  ) => {
    appliedShareSettingsRef.current = next;
    if (screenShareNeedsRecapture(prev, next)) {
      await recaptureActiveScreenShare(next);
    } else if (screenShareNeedsLiveApply(prev, next)) {
      applyLiveScreenShareSettings(next);
    }
  }, [applyLiveScreenShareSettings, recaptureActiveScreenShare]);

  // Auto-apply edited screenshare settings to a running share (debounced so slider drags
  // don't thrash). Live-applies encoder changes; re-captures only for resolution/source.
  useEffect(() => {
    if (!isSharing || !screenShareSettings) {
      return;
    }
    const prev = appliedShareSettingsRef.current;
    if (!prev || (!screenShareNeedsRecapture(prev, screenShareSettings) && !screenShareNeedsLiveApply(prev, screenShareSettings))) {
      return;
    }
    const timer = setTimeout(() => {
      void applyScreenShareSettingsToActiveShare(prev, screenShareSettings);
    }, APPLY_SETTINGS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isSharing, screenShareSettings, applyScreenShareSettingsToActiveShare]);

  // --- Viewer logic ---

  const connectAsViewer = useCallback(async (roomName: string, targetUserId: number, matrixUserId?: string) => {
    // Toggle: if already watching this user, remove them
    const existingShare = watchingSharesRef.current.find(s => s.userId === targetUserId);
    if (existingShare) {
      setError(null);
      // Detach track
      const room = roomRef.current;
      if (room) {
        const identity = existingShare.matrixUserId ?? String(targetUserId);
        const participant = room.remoteParticipants.get(identity);
        if (participant) {
          participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
            if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
              pub.track.detach();
            }
            if (pub.track && pub.track.kind === Track.Kind.Audio && pub.source === Track.Source.ScreenShareAudio) {
              pub.track.detach();
            }
          });
        }
      }
      removeWatchingShare(targetUserId);
      // Disconnect room if nothing left
      if (watchingSharesRef.current.length === 0) {
        await maybeDisconnectRoom();
      }
      return;
    }

    beginViewerConnectAttempt();
    const pendingAttempt = registerPendingViewerAttempt(roomName, targetUserId);
    setError(null);

    try {
      const shareInfo = activeShares.find(s => s.userId === targetUserId && s.roomName === roomName);
      const participantIdentity = matrixUserId ?? shareInfo?.matrixUserId ?? String(targetUserId);
      const newShare: ShareInfo = { ...(shareInfo ?? { roomName, userName: '', userId: targetUserId }), matrixUserId: participantIdentity };

      const room = await Promise.race([
        ensureRoom(roomName, 'subscribe'),
        pendingAttempt.promise,
      ]);

      if (!pendingViewerAttemptsRef.current.has(pendingAttempt.id)) {
        return;
      }
      const isShareStillActive = activeSharesRef.current.some(s => s.roomName === roomName && s.userId === targetUserId);
      if (!isShareStillActive) {
        await maybeDisconnectRoom();
        return;
      }

      // Add to watching list (handles max 4 enforcement via addWatchingShare)
      addWatchingShare(newShare);
      void room.startAudio?.().catch((err: unknown) => {
        console.warn('[LiveKit] viewer audio playback could not start', err);
      });

      // Subscribe to the target's screen share track
      const participant = room.remoteParticipants.get(participantIdentity);
      if (participant) {
        updateShareQuality(targetUserId, mapLiveKitQuality(participant.connectionQuality));
        participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
          if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
            const el = pub.track.attach() as HTMLVideoElement;
            setRemoteVideoEls(prev => new Map(prev).set(targetUserId, el));
            applyViewerQuality(participant, targetUserId);
            logScreenShareDiag('connectAsViewer', targetUserId, el, pub);
          }
          if (pub.track && pub.track.kind === Track.Kind.Audio && pub.source === Track.Source.ScreenShareAudio) {
            attachRemoteAudio(targetUserId, pub.track as unknown as { attach: () => HTMLElement });
          }
        });
      }
      // If track not yet available, TrackSubscribed event will pick it up
    } catch (err) {
      if (isSupersededRoomRequestError(err)) {
        return;
      }

      console.error('Failed to connect as viewer:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect as viewer');
      throw err;
    } finally {
      unregisterPendingViewerAttempt(pendingAttempt);
      endViewerConnectAttempt();
    }
  }, [activeShares, ensureRoom, addWatchingShare, removeWatchingShare, maybeDisconnectRoom, beginViewerConnectAttempt, endViewerConnectAttempt, registerPendingViewerAttempt, unregisterPendingViewerAttempt, updateShareQuality, attachRemoteAudio, applyViewerQuality]);

  const disconnectViewer = useCallback(async (userId?: number) => {
    const room = roomRef.current;

    if (userId !== undefined) {
      cancelPendingViewerAttempts(attempt => attempt.userId === userId);
      // Remove a specific stream
      const share = watchingSharesRef.current.find(s => s.userId === userId);
      if (share && room) {
        const targetIdentity = share.matrixUserId ?? String(share.userId);
        const participant = room.remoteParticipants.get(targetIdentity);
        if (participant) {
          participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
            if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
              pub.track.detach();
            }
            if (pub.track && pub.track.kind === Track.Kind.Audio && pub.source === Track.Source.ScreenShareAudio) {
              pub.track.detach();
            }
          });
        }
      }
      removeWatchingShare(userId);
      clearPendingUnsubscribedWatchedShare(userId);
      if (watchingSharesRef.current.length === 0) {
        await maybeDisconnectRoom();
      }
      return;
    }

    // No userId: remove all streams (channel switch / full cleanup)
    cancelPendingViewerAttempts();
    if (room) {
      for (const share of watchingSharesRef.current) {
        const targetIdentity = share.matrixUserId ?? String(share.userId);
        const participant = room.remoteParticipants.get(targetIdentity);
        if (participant) {
          participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
            if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
              pub.track.detach();
            }
          });
        }
      }
    }
    setRemoteVideoEls(new Map());
    updateWatchingShares([]);
    pendingUnsubscribedWatchedSharesRef.current.clear();
    setFocusedShare(null);
    clearTokenLease();
    invalidateRoomLifecycle('disconnectViewer');
    await maybeDisconnectRoom();
  }, [removeWatchingShare, updateWatchingShares, maybeDisconnectRoom, invalidateRoomLifecycle, cancelPendingViewerAttempts, clearTokenLease, clearPendingUnsubscribedWatchedShare]);

  // Listen for screen share events from bridge
  useEffect(() => {
    const onShareStarted = (data: unknown) => {
      const d = data as { roomName: string; userName: string; userId: number; matrixUserId?: string; sessionId?: number };
      shareEventVersionRef.current += 1;
      shareEventVersionByRoomRef.current.set(d.roomName, (shareEventVersionByRoomRef.current.get(d.roomName) ?? 0) + 1);
      updateActiveShares(prev => {
        if (prev.some(s => s.userId === d.userId && s.roomName === d.roomName)) return prev;
        return [...prev, { roomName: d.roomName, userName: d.userName, userId: d.userId, matrixUserId: d.matrixUserId, sessionId: d.sessionId }];
      });
    };

    const onShareStopped = (data: unknown) => {
      const d = data as { roomName: string; userId: number };
      shareEventVersionRef.current += 1;
      shareEventVersionByRoomRef.current.set(d.roomName, (shareEventVersionByRoomRef.current.get(d.roomName) ?? 0) + 1);
      updateActiveShares(prev => prev.filter(s => !(s.roomName === d.roomName && s.userId === d.userId)));

      // If we were watching this user, remove their tile
      const pendingUnsubscribedShare = pendingUnsubscribedWatchedSharesRef.current.get(watchedShareKey(d.roomName, d.userId));
      const wasWatching = watchingSharesRef.current.some(s => s.roomName === d.roomName && s.userId === d.userId) || !!pendingUnsubscribedShare;
      cancelPendingViewerAttempts(attempt => attempt.roomName === d.roomName && attempt.userId === d.userId);
      if (wasWatching) {
        const stoppedShare = watchingSharesRef.current.find(s => s.roomName === d.roomName && s.userId === d.userId)
          ?? pendingUnsubscribedShare
          ?? activeSharesRef.current.find(s => s.roomName === d.roomName && s.userId === d.userId);
        const room = roomRef.current;
        if (room && stoppedShare) {
          const targetIdentity = stoppedShare.matrixUserId ?? String(stoppedShare.userId);
          const participant = room.remoteParticipants.get(targetIdentity);
          if (participant) {
            participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
              if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
                pub.track.detach();
              }
              if (pub.track && pub.track.kind === Track.Kind.Audio && pub.source === Track.Source.ScreenShareAudio) {
                pub.track.detach();
              }
            });
          }
        }
        if (stoppedShare) {
          endWatchedShare(stoppedShare, 'ended');
        }
        // Disconnect room if nothing left and not sharing
        if (watchingSharesRef.current.length === 0 && !isSharingRef.current && room) {
          room.disconnect().catch(() => {});
          roomRef.current = null;
          roomAccessModeRef.current = null;
          roomReconnectUpgradeRef.current = false;
          resetQualityState();
          clearTokenLease();
          invalidateRoomLifecycle('shareStoppedDisconnectRoom');
        }
      }
    };

    const onActiveShareResult = (data: unknown) => {
      const d = data as {
        roomName?: string;
        scope?: string;
        requestId?: number;
        shares: Array<{ roomName?: string; userId: number; userName: string; matrixUserId?: string; sessionId?: number }>;
      };
      const nextRoomShares = (d.shares ?? []).map(s => ({
        roomName: s.roomName ?? d.roomName ?? '',
        userName: s.userName,
        userId: s.userId,
        matrixUserId: s.matrixUserId,
        sessionId: s.sessionId,
      })).filter(s => s.roomName);
      const target = discoveryTargetRef.current;

      if (!target) {
        return;
      }

      if (target.requestId != null && d.requestId !== target.requestId) {
        return;
      }

      if (d.scope === 'all') {
        if (!('scope' in target)) {
          return;
        }

        if (target.baselineShareEventVersion !== shareEventVersionRef.current) {
          return;
        }

        updateActiveShares(nextRoomShares);
        return;
      }

      if (!d.roomName) {
        return;
      }

      if ('scope' in target || target.roomName !== d.roomName) {
        return;
      }

      if (target.baselineShareEventVersion !== (shareEventVersionByRoomRef.current.get(d.roomName) ?? 0)) {
        return;
      }

      const nextScopedRoomShares = nextRoomShares.filter(s => s.roomName === d.roomName);

      updateActiveShares(prev => [
        ...prev.filter(s => s.roomName !== d.roomName),
        ...nextScopedRoomShares,
      ]);
    };

    const onActiveShareError = (data: unknown) => {
      const d = data as { roomName?: string; reason?: string; statusCode?: number; message?: string };
      console.warn('[LiveKit] activeShare discovery failed', d);
    };

    bridge.on('livekit.screenShareStarted', onShareStarted);
    bridge.on('livekit.screenShareStopped', onShareStopped);
    bridge.on('livekit.activeShareResult', onActiveShareResult);
    bridge.on('livekit.activeShareError', onActiveShareError);

    return () => {
      bridge.off('livekit.screenShareStarted', onShareStarted);
      bridge.off('livekit.screenShareStopped', onShareStopped);
      bridge.off('livekit.activeShareResult', onActiveShareResult);
      bridge.off('livekit.activeShareError', onActiveShareError);
    };
  }, [endWatchedShare, removeWatchingShare, updateActiveShares, invalidateRoomLifecycle, cancelPendingViewerAttempts, clearTokenLease, resetQualityState]);

  useEffect(() => {
    return () => {
      clearLocalShareEndListener();
      cancelPendingViewerAttempts();
      clearTokenLease();
      invalidateRoomLifecycle('unmount');
    };
  }, [clearLocalShareEndListener, cancelPendingViewerAttempts, clearTokenLease, invalidateRoomLifecycle]);

  // Backward compat: expose first active share as activeShare
  const activeShare: ActiveShare | null = activeShares.length > 0
    ? { roomName: activeShares[0].roomName, userName: activeShares[0].userName, sessionId: activeShares[0].sessionId }
    : null;

  // Backward compat
  const watchingShare = watchingShares.length > 0 ? watchingShares[0] : null;
  const remoteVideoEl = remoteVideoEls.size > 0 ? remoteVideoEls.values().next().value ?? null : null;

  const handleScreenShareServiceUnavailable = useCallback(async () => {
    cancelPendingViewerAttempts();
    const room = roomRef.current;
    roomRef.current = null;
    roomAccessModeRef.current = null;
    roomReconnectUpgradeRef.current = false;
    resetQualityState();
    clearTokenLease();
    invalidateRoomLifecycle('serviceUnavailable');
    setDiscoveryTarget(null);
    notifyUnexpectedWatchedShareEnds();
    clearWatchingState();
    if (isSharingRef.current) {
      await stopLocalShare('interrupted', room);
    }
    try { await room?.disconnect(); } catch { /* ignore */ }
  }, [cancelPendingViewerAttempts, clearTokenLease, clearWatchingState, invalidateRoomLifecycle, notifyUnexpectedWatchedShareEnds, resetQualityState, setDiscoveryTarget, stopLocalShare]);

  return {
    isSharing,
    startSharing,
    stopSharing,
    markLocalShareTeardownIntent,
    error,
    activeShare,       // backward compat
    activeShares,      // new: all active shares
    watchingShare,     // backward compat
    watchingShares,    // new
    isViewerConnectPending,
    focusedShare,      // new
    setFocusedShare,   // new
    setDiscoveryTarget,
    remoteVideoEl,     // backward compat
    remoteVideoEls,    // new
    roomQuality,
    shareQualities,
    viewerQualities,      // new: per-viewer receive-quality overrides
    setViewerQuality,     // new
    addWatchingShare,      // new
    removeWatchingShare,   // new
    disconnectViewer,
    connectAsViewer,
    handleScreenShareServiceUnavailable,
  };
}
