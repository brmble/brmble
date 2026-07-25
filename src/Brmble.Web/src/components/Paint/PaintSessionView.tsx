import type { MatrixClient } from 'matrix-js-sdk';
import { useRef } from 'react';
import { paintApi } from '../../api/paint';
import { usePaintSession } from '../../hooks/usePaintSession';
import { PaintEditor } from './PaintEditor';

export function PaintSessionView({ sessionId, currentUserId, matrixClient, channelRoomMap, onClose }: { sessionId: string; currentUserId: number; matrixClient: MatrixClient | null; channelRoomMap: Record<string, string> | undefined; onClose: () => void }) {
  const { snapshot, previews } = usePaintSession(sessionId);
  const saveOperationIdRef = useRef(`save-${sessionId}`);
  const saveTxnIdRef = useRef(`brmble-paint-save-${sessionId}-${saveOperationIdRef.current}`);
  const saveFileRef = useRef<File | null>(null);
  const uploadedImageRef = useRef<{ contentUri: string; size: number } | null>(null);
  const postedImageRef = useRef<{ contentUri: string; eventId?: string; size: number } | null>(null);

  if (!snapshot) return <section className="paint-session-view" aria-label="Collaborative paint">Loading paint session...</section>;
  const channelRoomId = channelRoomMap?.[String(snapshot.channelId)] ?? null;
  if (!matrixClient || !channelRoomId) return <section className="paint-session-view" aria-label="Collaborative paint">This paint session's chat channel is unavailable.<button onClick={onClose}>Close</button></section>;

  const findPostedSaveEvent = () => {
    const room = matrixClient.getRoom(channelRoomId);
    return room?.timeline?.find(event => {
      const content = event.getContent();
      return event.getType() === 'm.room.message'
        && content.msgtype === 'm.image'
        && content['org.brmble.paintSaveOperationId'] === saveOperationIdRef.current;
    });
  };

  const saveToChat = async (png: Blob) => {
    let posted = postedImageRef.current;
    if (!posted) {
      const existing = findPostedSaveEvent();
      if (existing) {
        const content = existing.getContent();
        posted = { contentUri: content.url, eventId: existing.getId(), size: content.info?.size ?? 0 };
        postedImageRef.current = posted;
      } else {
        const file = saveFileRef.current ?? new File([png], 'collaborative-paint.png', { type: 'image/png' });
        saveFileRef.current = file;
        let uploaded = uploadedImageRef.current;
        if (!uploaded) {
          const response = await matrixClient.uploadContent(file, { type: file.type, name: file.name });
          uploaded = { contentUri: response.content_uri, size: file.size };
          uploadedImageRef.current = uploaded;
        }
        const event = await matrixClient.sendMessage(channelRoomId, {
          msgtype: 'm.image',
          body: file.name,
          url: uploaded.contentUri,
          info: { mimetype: file.type, size: file.size },
          'org.brmble.paintSaveOperationId': saveOperationIdRef.current,
        } as never, saveTxnIdRef.current);
        posted = { contentUri: uploaded.contentUri, eventId: event.event_id, size: file.size };
        postedImageRef.current = posted;
      }
    }

    await paintApi.end(sessionId);
    onClose();
  };

  return <section className="paint-session-view" aria-label="Collaborative paint"><button onClick={onClose}>Back to chat</button><PaintEditor sessionId={sessionId} paintApi={paintApi} snapshot={snapshot} previews={previews} currentUserId={currentUserId} matrixClient={matrixClient} onSave={saveToChat} /></section>;
}
