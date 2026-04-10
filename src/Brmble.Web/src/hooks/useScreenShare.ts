import { useCallback, useRef, useState, useEffect } from 'react';
import { Room, RoomEvent, Track, RemoteTrackPublication, RemoteParticipant } from 'livekit-client';
import bridge from '../bridge';

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
  const [activeShare, setActiveShare] = useState<ActiveShare | null>(null);
  const [remoteVideoEl, setRemoteVideoEl] = useState<HTMLVideoElement | null>(null);
  const publishRoomRef = useRef<Room | null>(null);
  const viewerRoomRef = useRef<Room | null>(null);
  const onDisconnectedRef = useRef(onDisconnected);
  onDisconnectedRef.current = onDisconnected;

  const startSharing = useCallback(async (roomName: string) => {
    setError(null);

    if (publishRoomRef.current) {
      try { await publishRoomRef.current.disconnect(); } catch { /* ignore */ }
      publishRoomRef.current = null;
    }

    try {
      const { token, url } = await new Promise<{ token: string; url: string }>((resolve, reject) => {
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

        captureOptions = {};

        if (screenShareSettings.captureAudio) {
          captureOptions.audio = true;
        }

        if (screenShareSettings.systemAudio) {
          captureOptions.systemAudio = 'include';
        }

        if (screenShareSettings.resolution) {
          captureOptions.resolution = resolutionMap[screenShareSettings.resolution];
        }

        if (screenShareSettings.fps) {
          captureOptions.fps = screenShareSettings.fps;
        }

        // Remove empty options
        if (Object.keys(captureOptions).length === 0) {
          captureOptions = undefined;
        }
      }

      await room.localParticipant.setScreenShareEnabled(true, captureOptions);

      publishRoomRef.current = room;
      setIsSharing(true);

      // Notify server that sharing has started
      bridge.send('livekit.shareStarted', { roomName });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Screen share failed');
      setIsSharing(false);
    }
  }, []);

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

  const connectAsViewer = useCallback(async (roomName: string) => {
    if (viewerRoomRef.current) {
      try { await viewerRoomRef.current.disconnect(); } catch { /* ignore */ }
      viewerRoomRef.current = null;
    }

    try {
      const { token, url } = await new Promise<{ token: string; url: string }>((resolve, reject) => {
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

      const room = new Room();

      room.on(RoomEvent.TrackSubscribed, (track, _pub, _participant) => {
        if (track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare) {
          const el = track.attach() as HTMLVideoElement;
          setRemoteVideoEl(el);
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare) {
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

      // Check for already-published screen share tracks
      room.remoteParticipants.forEach((participant: RemoteParticipant) => {
        participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
          if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
            const el = pub.track.attach() as HTMLVideoElement;
            setRemoteVideoEl(el);
          }
        });
      });
    } catch (err) {
      console.error('Failed to connect as viewer:', err);
    }
  }, []);

  const disconnectViewer = useCallback(async () => {
    const room = viewerRoomRef.current;
    if (room) {
      try { await room.disconnect(); } catch { /* ignore */ }
      viewerRoomRef.current = null;
    }
    setRemoteVideoEl(null);
    setActiveShare(null);
  }, []);

  // Listen for screen share events from bridge
  useEffect(() => {
    const onShareStarted = (data: unknown) => {
      const d = data as { roomName: string; userName: string; sessionId?: number };
      setActiveShare({ roomName: d.roomName, userName: d.userName, sessionId: d.sessionId });
    };

    const onShareStopped = (data: unknown) => {
      const d = data as { roomName: string };
      setActiveShare(prev => {
        if (prev?.roomName !== d.roomName) return prev;
        return null;
      });
      if (viewerRoomRef.current) {
        viewerRoomRef.current.disconnect().catch(() => {});
        viewerRoomRef.current = null;
      }
      setRemoteVideoEl(null);
    };

    const onActiveShareResult = (data: unknown) => {
      const d = data as { roomName: string; active: boolean; userName?: string; sessionId?: number };
      if (d.active && d.userName) {
        setActiveShare({ roomName: d.roomName, userName: d.userName, sessionId: d.sessionId });
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

  return {
    isSharing,
    startSharing,
    stopSharing,
    error,
    activeShare,
    remoteVideoEl,
    disconnectViewer,
    connectAsViewer,
  };
}
