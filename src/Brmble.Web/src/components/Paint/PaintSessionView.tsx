import type { MatrixClient } from 'matrix-js-sdk';
import { paintApi } from '../../api/paint';
import { usePaintSession } from '../../hooks/usePaintSession';
import { PaintEditor } from './PaintEditor';

export function PaintSessionView({ sessionId, currentUserId, matrixClient, channelRoomMap, onClose }: { sessionId: string; currentUserId: number; matrixClient: MatrixClient | null; channelRoomMap: Record<string, string> | undefined; onClose: () => void }) {
  const { snapshot, previews } = usePaintSession(sessionId);

  if (!snapshot) return <section className="paint-session-view" aria-label="Collaborative paint">Loading paint session...</section>;
  const channelRoomId = channelRoomMap?.[String(snapshot.channelId)] ?? null;
  if (!matrixClient || !channelRoomId) return <section className="paint-session-view" aria-label="Collaborative paint">This paint session's chat channel is unavailable.<button onClick={onClose}>Close</button></section>;

  const saveToChat = async (png: Blob) => {
    const file = new File([png], 'collaborative-paint.png', { type: 'image/png' });
    const uploaded = await matrixClient.uploadContent(file, { type: file.type, name: file.name });
    await matrixClient.sendMessage(channelRoomId, {
      msgtype: 'm.image',
      body: file.name,
      url: uploaded.content_uri,
      info: { mimetype: file.type, size: file.size },
    } as never);
  };

  return <section className="paint-session-view" aria-label="Collaborative paint"><button onClick={onClose}>Back to chat</button><PaintEditor sessionId={sessionId} paintApi={paintApi} snapshot={snapshot} previews={previews} currentUserId={currentUserId} matrixClient={matrixClient} onSave={saveToChat} /></section>;
}
