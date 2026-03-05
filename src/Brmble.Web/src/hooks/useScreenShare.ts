import { useCallback, useRef, useState } from 'react';
import { Room, RoomEvent } from 'livekit-client';
import bridge from '../bridge';

export function useScreenShare() {
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roomRef = useRef<Room | null>(null);

  const startSharing = useCallback(async (roomName: string) => {
    setError(null);

    // Disconnect any existing room to avoid duplicate identity
    if (roomRef.current) {
      try { await roomRef.current.disconnect(); } catch { /* ignore */ }
      roomRef.current = null;
    }

    try {
      const { token, url } = await new Promise<{ token: string; url: string }>((resolve, reject) => {
        const onToken = (data: unknown) => {
          bridge.off('livekit.token', onToken);
          bridge.off('livekit.tokenError', onError);
          const d = data as { token: string; url: string };
          resolve(d);
        };
        const onError = (data: unknown) => {
          bridge.off('livekit.token', onToken);
          bridge.off('livekit.tokenError', onError);
          const d = data as { error: string };
          reject(new Error(d.error));
        };
        bridge.on('livekit.token', onToken);
        bridge.on('livekit.tokenError', onError);
        bridge.send('livekit.requestToken', { roomName });
      });

      const room = new Room();
      room.on(RoomEvent.Disconnected, () => {
        setIsSharing(false);
        roomRef.current = null;
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
      await room.disconnect();
      roomRef.current = null;
    }
    setIsSharing(false);
  }, []);

  return { isSharing, startSharing, stopSharing, error };
}
