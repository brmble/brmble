import { useCallback, useRef, useState } from 'react';
import { Room, RoomEvent } from 'livekit-client';

export function useScreenShare() {
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roomRef = useRef<Room | null>(null);

  const startSharing = useCallback(async (roomName: string) => {
    setError(null);
    try {
      const res = await fetch('/livekit/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName }),
      });

      if (!res.ok) {
        setError(`Token request failed: ${res.status}`);
        return;
      }

      const { token, url } = await res.json();

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
