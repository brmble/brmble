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
  const [watchingShares, setWatchingShares] = useState<ShareInfo[]>([]);
  const [focusedShare, _setFocusedShare] = useState<ShareInfo | null>(null);
  const [remoteVideoEls, setRemoteVideoEls] = useState<Map<number, HTMLVideoElement>>(new Map());

  // Single room connection per channel — used for both publishing and subscribing
  const roomRef = useRef<Room | null>(null);
  const watchingSharesRef = useRef<ShareInfo[]>([]);
  const isSharingRef = useRef(false);
  const focusedShareRef = useRef<ShareInfo | null>(null);
  const onDisconnectedRef = useRef(onDisconnected);
  onDisconnectedRef.current = onDisconnected;

  const setFocusedShare: typeof _setFocusedShare = useCallback((action) => {
    _setFocusedShare(prev => {
      const next = typeof action === 'function' ? action(prev) : action;
      focusedShareRef.current = next;
      return next;
    });
  }, []);

  const updateWatchingShares = useCallback((shares: ShareInfo[]) => {
    watchingSharesRef.current = shares;
    setWatchingShares(shares);
  }, []);

  const addWatchingShare = useCallback((share: ShareInfo) => {
    setWatchingShares(prev => {
      if (prev.some(s => s.userId === share.userId)) return prev;
      let evictedUserId: number | undefined;
      let next: ShareInfo[];
      if (prev.length >= 4) {
        // Evict oldest non-focused share; fall back to oldest if all focused
        const focusId = focusedShareRef.current?.userId;
        const evictIndex = prev.findIndex(s => s.userId !== focusId) ?? 0;
        evictedUserId = prev[evictIndex].userId;
        next = [...prev.slice(0, evictIndex), ...prev.slice(evictIndex + 1), share];
      } else {
        next = [...prev, share];
      }
      watchingSharesRef.current = next;

      // Clean up evicted share state
      if (evictedUserId != null) {
        const evicted = evictedUserId;
        setFocusedShare(p => p?.userId === evicted ? null : p);
        setRemoteVideoEls(p => {
          const m = new Map(p);
          m.delete(evicted);
          return m;
        });
      }
      return next;
    });
  }, []);

  const removeWatchingShare = useCallback((userId: number) => {
    setWatchingShares(prev => {
      const next = prev.filter(s => s.userId !== userId);
      watchingSharesRef.current = next;
      return next;
    });
    setFocusedShare(prev => prev?.userId === userId ? null : prev);
    setRemoteVideoEls(prev => {
      const next = new Map(prev);
      next.delete(userId);
      return next;
    });
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
        const el = track.attach() as HTMLVideoElement;
        setRemoteVideoEls(prev => new Map(prev).set(matchedShare.userId, el));
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
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
        setRemoteVideoEls(prev => {
          const next = new Map(prev);
          next.delete(matchedShare.userId);
          return next;
        });
      }
    });

    room.on(RoomEvent.Disconnected, () => {
      roomRef.current = null;
      setRemoteVideoEls(new Map());
      if (isSharingRef.current) {
        setIsSharing(false);
        isSharingRef.current = false;
        onDisconnectedRef.current?.();
      }
      updateWatchingShares([]);
      setFocusedShare(null);
    });

    await room.connect(url, token);
    roomRef.current = room;
    return room;
  }, [requestToken, updateWatchingShares]);

  // Try to disconnect the room, but only if we're not sharing AND not watching
  const maybeDisconnectRoom = useCallback(async () => {
    if (!isSharingRef.current && watchingSharesRef.current.length === 0 && roomRef.current) {
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
      // Disconnect room if we're not watching anyone either
      await maybeDisconnectRoom();
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
    // Toggle: if already watching this user, remove them
    const existingShare = watchingSharesRef.current.find(s => s.userId === targetUserId);
    if (existingShare) {
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

    const shareInfo = activeShares.find(s => s.userId === targetUserId && s.roomName === roomName);
    const participantIdentity = matrixUserId ?? shareInfo?.matrixUserId ?? String(targetUserId);
    const newShare: ShareInfo = shareInfo ?? { roomName, userName: '', userId: targetUserId, matrixUserId };

    try {
      const room = await ensureRoom(roomName);

      // Add to watching list (handles max 4 enforcement via addWatchingShare)
      addWatchingShare(newShare);

      // Subscribe to the target's screen share track
      const participant = room.remoteParticipants.get(participantIdentity);
      if (participant) {
        participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
          if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
            const el = pub.track.attach() as HTMLVideoElement;
            setRemoteVideoEls(prev => new Map(prev).set(targetUserId, el));
          }
        });
      }
      // If track not yet available, TrackSubscribed event will pick it up
    } catch (err) {
      console.error('Failed to connect as viewer:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect as viewer');
      throw err;
    }
  }, [activeShares, ensureRoom, addWatchingShare, removeWatchingShare, maybeDisconnectRoom]);

  const disconnectViewer = useCallback(async (userId?: number) => {
    const room = roomRef.current;

    if (userId !== undefined) {
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
          });
        }
      }
      removeWatchingShare(userId);
      if (watchingSharesRef.current.length === 0) {
        await maybeDisconnectRoom();
      }
      return;
    }

    // No userId: remove all streams (channel switch / full cleanup)
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
    setFocusedShare(null);
    await maybeDisconnectRoom();
  }, [removeWatchingShare, updateWatchingShares, maybeDisconnectRoom]);

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

      // If we were watching this user, remove their tile
      const wasWatching = watchingSharesRef.current.some(s => s.roomName === d.roomName && s.userId === d.userId);
      if (wasWatching) {
        const room = roomRef.current;
        if (room) {
          const share = watchingSharesRef.current.find(s => s.userId === d.userId);
          if (share) {
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
        removeWatchingShare(d.userId);
        // Disconnect room if nothing left and not sharing
        if (watchingSharesRef.current.length === 0 && !isSharingRef.current && room) {
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
  }, [removeWatchingShare]);

  // Backward compat: expose first active share as activeShare
  const activeShare: ActiveShare | null = activeShares.length > 0
    ? { roomName: activeShares[0].roomName, userName: activeShares[0].userName, sessionId: activeShares[0].sessionId }
    : null;

  // Backward compat
  const watchingShare = watchingShares.length > 0 ? watchingShares[0] : null;
  const remoteVideoEl = remoteVideoEls.size > 0 ? remoteVideoEls.values().next().value ?? null : null;

  return {
    isSharing,
    startSharing,
    stopSharing,
    error,
    activeShare,       // backward compat
    activeShares,      // new: all active shares
    watchingShare,     // backward compat
    watchingShares,    // new
    focusedShare,      // new
    setFocusedShare,   // new
    remoteVideoEl,     // backward compat
    remoteVideoEls,    // new
    addWatchingShare,      // new
    removeWatchingShare,   // new
    disconnectViewer,
    connectAsViewer,
  };
}
