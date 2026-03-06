import { useCallback, useRef, useState } from 'react';
import { Room, RoomEvent } from 'livekit-client';
import bridge from '../bridge';

export function useScreenShare(onDisconnected?: () => void) {
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roomRef = useRef<Room | null>(null);
  const onDisconnectedRef = useRef(onDisconnected);
  onDisconnectedRef.current = onDisconnected;

  const startSharing = useCallback(async (roomName: string) => {
    setError(null);

    // Disconnect any existing room to avoid duplicate identity
    if (roomRef.current) {
      try { await roomRef.current.disconnect(); } catch { /* ignore */ }
      roomRef.current = null;
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
          const d = data as { token: string; url: string };
          resolve(d);
        };
        const onError = (data: unknown) => {
          cleanup();
          const d = data as { error: string };
          reject(new Error(d.error));
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error('Token request timed out'));
        }, 15000);
        bridge.on('livekit.token', onToken);
        bridge.on('livekit.tokenError', onError);
        bridge.send('livekit.requestToken', { roomName });
      });

      const room = new Room();
      room.on(RoomEvent.Disconnected, () => {
        setIsSharing(false);
        roomRef.current = null;
        onDisconnectedRef.current?.();
      });

      await room.connect(url, token);
      await room.localParticipant.setScreenShareEnabled(true);

      roomRef.current = room;
      setIsSharing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Screen share failed');
      setIsSharing(false);
    }
  }, []);

  const stopSharing = useCallback(async () => {
    const room = roomRef.current;
    if (room) {
      try {
        await room.localParticipant.setScreenShareEnabled(false);
      } catch { /* already stopped */ }
      try {
        await room.disconnect();
      } catch {
        // ignore disconnect errors
      } finally {
        roomRef.current = null;
      }
    }
    setIsSharing(false);
  }, []);

  return { isSharing, startSharing, stopSharing, error };
}
