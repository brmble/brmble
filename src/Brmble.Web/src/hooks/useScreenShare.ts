import { useCallback, useRef, useState, useEffect } from 'react';
import { Room, RoomEvent, Track, RemoteTrackPublication } from 'livekit-client';
import bridge from '../bridge';

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
}

export function useScreenShare(onDisconnected?: () => void, screenShareSettings?: ScreenShareSettings) {
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeShares, setActiveShares] = useState<ShareInfo[]>([]);
  const [watchingShare, setWatchingShare] = useState<ShareInfo | null>(null);
  const [remoteVideoEl, setRemoteVideoEl] = useState<HTMLVideoElement | null>(null);

  // Single room connection per channel — used for both publishing and subscribing
  const roomRef = useRef<Room | null>(null);
  const watchingShareRef = useRef<ShareInfo | null>(null);
  const isSharingRef = useRef(false);
  const onDisconnectedRef = useRef(onDisconnected);
  onDisconnectedRef.current = onDisconnected;

  const updateWatchingShare = useCallback((share: ShareInfo | null) => {
    watchingShareRef.current = share;
    setWatchingShare(share);
  }, []);

  // Helper: request a LiveKit token via bridge
  const requestToken = useCallback((roomName: string) => {
    return new Promise<{ token: string; url: string }>((resolve, reject) => {
      const cleanup = () => {
        bridge.off('livekit.token', onToken);
        bridge.off('livekit.tokenError', onError);
        clearTimeout(timer);
      };
      const onToken = (data: unknown) => {
        cleanup();
        resolve(data as { token: string; url: string });
      };
      const onError = (data: unknown) => {
        cleanup();
        reject(new Error((data as { error: string }).error));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Token request timed out'));
      }, 20000);
      bridge.on('livekit.token', onToken);
      bridge.on('livekit.tokenError', onError);
      bridge.send('livekit.requestToken', { roomName });
    });
  }, []);

  // Ensure we have a connected room for the given channel.
  // Returns the existing room if already connected to this channel, otherwise connects.
  const ensureRoom = useCallback(async (roomName: string): Promise<Room> => {
    const existing = roomRef.current;
    if (existing?.name === roomName && (existing as Room & { state?: string })?.state === 'connected') {
      return existing;
    }

    // Disconnect from any other room
    if (existing) {
      try { await existing.disconnect(); } catch { /* ignore */ }
      roomRef.current = null;
    }

    const { token, url } = await requestToken(roomName);
    const room = new Room();

    room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
      const watching = watchingShareRef.current;
      if (!watching) return;
      const targetIdentity = watching.matrixUserId ?? String(watching.userId);
      if (
        track.kind === Track.Kind.Video &&
        track.source === Track.Source.ScreenShare &&
        participant.identity === targetIdentity
      ) {
        const el = track.attach() as HTMLVideoElement;
        setRemoteVideoEl(el);
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
      const watching = watchingShareRef.current;
      if (!watching) return;
      const targetIdentity = watching.matrixUserId ?? String(watching.userId);
      if (
        track.kind === Track.Kind.Video &&
        track.source === Track.Source.ScreenShare &&
        participant.identity === targetIdentity
      ) {
        track.detach();
        setRemoteVideoEl(null);
      }
    });

    room.on(RoomEvent.Disconnected, () => {
      roomRef.current = null;
      setRemoteVideoEl(null);
      if (isSharingRef.current) {
        setIsSharing(false);
        isSharingRef.current = false;
        onDisconnectedRef.current?.();
      }
      updateWatchingShare(null);
    });

    await room.connect(url, token);
    roomRef.current = room;
    return room;
  }, [requestToken, updateWatchingShare]);

  // Try to disconnect the room, but only if we're not sharing AND not watching
  const maybeDisconnectRoom = useCallback(async () => {
    if (!isSharingRef.current && !watchingShareRef.current && roomRef.current) {
      try { await roomRef.current.disconnect(); } catch { /* ignore */ }
      roomRef.current = null;
    }
  }, []);

  const startSharing = useCallback(async (roomName: string) => {
    setError(null);

    try {
      const room = await ensureRoom(roomName);

      let captureOptions: Record<string, unknown> | undefined;
      if (screenShareSettings) {
        const resolutionMap: Record<string, { width: number; height: number }> = {
          '720p': { width: 1280, height: 720 },
          '1080p': { width: 1920, height: 1080 },
          '1440p': { width: 2560, height: 1440 },
          '4k': { width: 3840, height: 2160 },
        };

        const bitrateMap: Record<string, number> = {
          '720p': 2_000_000,
          '1080p': 4_000_000,
          '1440p': 8_000_000,
          '4k': 15_000_000,
        };

        captureOptions = {};

        if (screenShareSettings.captureAudio) {
          captureOptions.audio = true;
        }

        if (screenShareSettings.captureAudio && screenShareSettings.systemAudio) {
          captureOptions.systemAudio = 'include';
        }

        if (screenShareSettings.resolution || screenShareSettings.fps) {
          const res = resolutionMap[screenShareSettings.resolution];
          captureOptions.resolution = {
            ...res,
            frameRate: screenShareSettings.fps,
          };
          captureOptions.videoEncoding = {
            maxBitrate: bitrateMap[screenShareSettings.resolution],
            maxFramerate: screenShareSettings.fps,
          };
        }

        if (Object.keys(captureOptions).length === 0) {
          captureOptions = undefined;
        }
      }

      await room.localParticipant.setScreenShareEnabled(true, captureOptions);

      isSharingRef.current = true;
      setIsSharing(true);

      bridge.send('livekit.shareStarted', { roomName });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Screen share failed');
      setIsSharing(false);
      isSharingRef.current = false;
    }
  }, [screenShareSettings, ensureRoom]);

  const stopSharing = useCallback(async () => {
    const room = roomRef.current;
    if (room) {
      const roomName = room.name;
      try { await room.localParticipant.setScreenShareEnabled(false); } catch { /* already stopped */ }
      isSharingRef.current = false;
      setIsSharing(false);
      if (roomName) {
        bridge.send('livekit.shareStopped', { roomName });
      }

      // Disconnect only if not watching anyone
      await maybeDisconnectRoom();
    } else {
      isSharingRef.current = false;
      setIsSharing(false);
    }
  }, [maybeDisconnectRoom]);

  // --- Viewer logic ---

  const connectAsViewer = useCallback(async (roomName: string, targetUserId: number, matrixUserId?: string) => {
    // Already watching this exact share — no-op
    const current = watchingShareRef.current;
    if (current && current.roomName === roomName && current.userId === targetUserId) {
      return;
    }

    const shareInfo = activeShares.find(s => s.userId === targetUserId && s.roomName === roomName);
    const participantIdentity = matrixUserId ?? shareInfo?.matrixUserId ?? String(targetUserId);

    try {
      const room = await ensureRoom(roomName);

      // Detach any previously watched track
      const prevWatching = watchingShareRef.current;
      if (prevWatching) {
        const prevIdentity = prevWatching.matrixUserId ?? String(prevWatching.userId);
        const prevParticipant = room.remoteParticipants.get(prevIdentity);
        if (prevParticipant) {
          prevParticipant.trackPublications.forEach((pub: RemoteTrackPublication) => {
            if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
              pub.track.detach();
            }
          });
        }
        setRemoteVideoEl(null);
      }

      // Update watching state before subscribing (so TrackSubscribed handler picks it up)
      updateWatchingShare(shareInfo ?? { roomName, userName: '', userId: targetUserId, matrixUserId });

      // Subscribe to the target's screen share track
      const participant = room.remoteParticipants.get(participantIdentity);
      if (participant) {
        participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
          if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
            const el = pub.track.attach() as HTMLVideoElement;
            setRemoteVideoEl(el);
          }
        });
      }
      // If track not yet available, TrackSubscribed event will pick it up
    } catch (err) {
      console.error('Failed to connect as viewer:', err);
    }
  }, [activeShares, ensureRoom, updateWatchingShare]);

  const disconnectViewer = useCallback(async () => {
    // Detach the remote track we're watching
    const watching = watchingShareRef.current;
    const room = roomRef.current;
    if (watching && room) {
      const targetIdentity = watching.matrixUserId ?? String(watching.userId);
      const participant = room.remoteParticipants.get(targetIdentity);
      if (participant) {
        participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
          if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
            pub.track.detach();
          }
        });
      }
    }
    setRemoteVideoEl(null);
    updateWatchingShare(null);

    // Disconnect only if not sharing
    await maybeDisconnectRoom();
  }, [updateWatchingShare, maybeDisconnectRoom]);

  // Listen for screen share events from bridge
  useEffect(() => {
    const onShareStarted = (data: unknown) => {
      const d = data as { roomName: string; userName: string; userId: number; matrixUserId?: string; sessionId?: number };
      setActiveShares(prev => {
        if (prev.some(s => s.userId === d.userId && s.roomName === d.roomName)) return prev;
        return [...prev, { roomName: d.roomName, userName: d.userName, userId: d.userId, matrixUserId: d.matrixUserId, sessionId: d.sessionId }];
      });
    };

    const onShareStopped = (data: unknown) => {
      const d = data as { roomName: string; userId: number };
      setActiveShares(prev => prev.filter(s => !(s.roomName === d.roomName && s.userId === d.userId)));
      const current = watchingShareRef.current;
      if (current && current.roomName === d.roomName && current.userId === d.userId) {
        // The share we were watching stopped — detach but don't disconnect room
        const room = roomRef.current;
        if (room) {
          const targetIdentity = current.matrixUserId ?? String(current.userId);
          const participant = room.remoteParticipants.get(targetIdentity);
          if (participant) {
            participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
              if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
                pub.track.detach();
              }
            });
          }
        }
        setRemoteVideoEl(null);
        updateWatchingShare(null);
        // Disconnect room if also not sharing
        if (!isSharingRef.current && room) {
          room.disconnect().catch(() => {});
          roomRef.current = null;
        }
      }
    };

    const onActiveShareResult = (data: unknown) => {
      const d = data as { roomName: string; shares: Array<{ userId: number; userName: string; matrixUserId?: string; sessionId?: number }> };
      if (d.shares && d.shares.length > 0) {
        setActiveShares(d.shares.map(s => ({
          roomName: d.roomName,
          userName: s.userName,
          userId: s.userId,
          matrixUserId: s.matrixUserId,
          sessionId: s.sessionId,
        })));
      } else {
        setActiveShares([]);
      }
    };

    bridge.on('livekit.screenShareStarted', onShareStarted);
    bridge.on('livekit.screenShareStopped', onShareStopped);
    bridge.on('livekit.activeShareResult', onActiveShareResult);

    return () => {
      bridge.off('livekit.screenShareStarted', onShareStarted);
      bridge.off('livekit.screenShareStopped', onShareStopped);
      bridge.off('livekit.activeShareResult', onActiveShareResult);
    };
  }, []);

  // Backward compat: expose first active share as activeShare
  const activeShare: ActiveShare | null = activeShares.length > 0
    ? { roomName: activeShares[0].roomName, userName: activeShares[0].userName, sessionId: activeShares[0].sessionId }
    : null;

  return {
    isSharing,
    startSharing,
    stopSharing,
    error,
    activeShare,       // backward compat
    activeShares,      // new: all active shares
    watchingShare,     // new: which share you're viewing
    remoteVideoEl,
    disconnectViewer,
    connectAsViewer,
  };
}
