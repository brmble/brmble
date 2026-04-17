import { useCallback, useRef, useState, useEffect } from 'react';
import { Room, RoomEvent, Track, RemoteTrackPublication, RemoteParticipant } from 'livekit-client';
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
  const publishRoomRef = useRef<Room | null>(null);
  const viewerRoomRef = useRef<Room | null>(null);
  const onDisconnectedRef = useRef(onDisconnected);
  onDisconnectedRef.current = onDisconnected;

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

  const startSharing = useCallback(async (roomName: string) => {
    setError(null);

    if (publishRoomRef.current) {
      try { await publishRoomRef.current.disconnect(); } catch { /* ignore */ }
      publishRoomRef.current = null;
    }

    try {
      const { token, url } = await requestToken(roomName);

      const room = new Room();
      room.on(RoomEvent.Disconnected, () => {
        setIsSharing(false);
        publishRoomRef.current = null;
        onDisconnectedRef.current?.();
      });

      await room.connect(url, token);

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

      publishRoomRef.current = room;
      setIsSharing(true);

      bridge.send('livekit.shareStarted', { roomName });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Screen share failed');
      setIsSharing(false);
    }
  }, [screenShareSettings, requestToken]);

  const stopSharing = useCallback(async () => {
    const room = publishRoomRef.current;
    if (room) {
      const roomName = room.name;
      try { await room.localParticipant.setScreenShareEnabled(false); } catch { /* already stopped */ }
      try { await room.disconnect(); } catch { /* ignore */ }
      publishRoomRef.current = null;
      if (roomName) {
        bridge.send('livekit.shareStopped', { roomName });
      }
    }
    setIsSharing(false);
  }, []);

  // --- Viewer logic ---

  const connectAsViewer = useCallback(async (roomName: string, targetUserId: number, matrixUserId?: string) => {
    // Find the share info for this user
    const shareInfo = activeShares.find(s => s.userId === targetUserId && s.roomName === roomName);
    // Use matrixUserId as the LiveKit participant identity (falls back to shareInfo or numeric userId)
    const participantIdentity = matrixUserId ?? shareInfo?.matrixUserId ?? String(targetUserId);

    // If already connected to this room (sharing or viewing), just subscribe to the track
    const existingRoom = viewerRoomRef.current ?? publishRoomRef.current;
    if (existingRoom?.name === roomName && (existingRoom as Room & { state?: string })?.state === 'connected') {
      // Already in the room, just find and subscribe to the target's track
      const participant = existingRoom.remoteParticipants.get(participantIdentity);
      if (participant) {
        participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
          if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
            const el = pub.track.attach() as HTMLVideoElement;
            setRemoteVideoEl(el);
          }
        });
      }
      setWatchingShare(shareInfo ?? { roomName, userName: '', userId: targetUserId, matrixUserId });
      return;
    }

    // Disconnect existing viewer connection if switching rooms
    if (viewerRoomRef.current) {
      try { await viewerRoomRef.current.disconnect(); } catch { /* ignore */ }
      viewerRoomRef.current = null;
    }

    try {
      const { token, url } = await requestToken(roomName);

      const room = new Room();

      room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (
          track.kind === Track.Kind.Video &&
          track.source === Track.Source.ScreenShare &&
          participant.identity === participantIdentity
        ) {
          const el = track.attach() as HTMLVideoElement;
          setRemoteVideoEl(el);
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
        if (
          track.kind === Track.Kind.Video &&
          track.source === Track.Source.ScreenShare &&
          participant.identity === participantIdentity
        ) {
          track.detach();
          setRemoteVideoEl(null);
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        viewerRoomRef.current = null;
        setRemoteVideoEl(null);
      });

      await room.connect(url, token);
      viewerRoomRef.current = room;

      // Check for already-published screen share tracks from target user
      room.remoteParticipants.forEach((participant: RemoteParticipant) => {
        if (participant.identity === participantIdentity) {
          participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
            if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
              const el = pub.track.attach() as HTMLVideoElement;
              setRemoteVideoEl(el);
            }
          });
        }
      });

      setWatchingShare(shareInfo ?? { roomName, userName: '', userId: targetUserId, matrixUserId });
    } catch (err) {
      console.error('Failed to connect as viewer:', err);
    }
  }, [activeShares, requestToken]);

  const disconnectViewer = useCallback(async () => {
    const room = viewerRoomRef.current;
    if (room) {
      // Only disconnect if we're not also sharing in this room
      if (publishRoomRef.current?.name !== room.name) {
        try { await room.disconnect(); } catch { /* ignore */ }
      }
      viewerRoomRef.current = null;
    }
    setRemoteVideoEl(null);
    setWatchingShare(null);
  }, []);

  // Listen for screen share events from bridge
  useEffect(() => {
    const onShareStarted = (data: unknown) => {
      const d = data as { roomName: string; userName: string; userId: number; matrixUserId?: string; sessionId?: number };
      setActiveShares(prev => {
        // Don't add duplicates
        if (prev.some(s => s.userId === d.userId && s.roomName === d.roomName)) return prev;
        return [...prev, { roomName: d.roomName, userName: d.userName, userId: d.userId, matrixUserId: d.matrixUserId, sessionId: d.sessionId }];
      });
    };

    const onShareStopped = (data: unknown) => {
      const d = data as { roomName: string; userId: number };
      setActiveShares(prev => prev.filter(s => !(s.roomName === d.roomName && s.userId === d.userId)));
      setWatchingShare(prev => {
        if (prev && prev.roomName === d.roomName && prev.userId === d.userId) {
          // The share we were watching stopped
          if (viewerRoomRef.current) {
            viewerRoomRef.current.disconnect().catch(() => {});
            viewerRoomRef.current = null;
          }
          setRemoteVideoEl(null);
          return null;
        }
        return prev;
      });
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
