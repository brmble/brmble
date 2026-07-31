import { useEffect, useRef, useState } from 'react';
import { MsgType, type MatrixClient } from 'matrix-js-sdk';
import './PaintSessionSetupModal.css';

type Candidate = { userId: number; name: string };
type Created = { sessionId: string; matrixRoomId: string; channelId: number };
type Matrix = Pick<
  MatrixClient,
  'getMediaConfig' | 'joinRoom' | 'uploadContent' | 'sendMessage'
>;

type PaintSessionSetupModalProps = {
  channelId: number;
  channelRoomId: string;
  candidates: Candidate[];
  hostUserId: number;
  paintApi: {
    createSession(input: {
      channelId: number;
      participantSessionIds: number[];
    }): Promise<Created>;
    leave(sessionId: string): Promise<unknown>;
  };
  matrixClient: Matrix;
  onAttachSource(
    sessionId: string,
    sourceEventId: string,
  ): Promise<unknown>;
  initialSourceFile?: File | null;
  onComplete?: (sessionId: string) => void;
  onClose?: () => void;
};

export function PaintSessionSetupModal({
  channelId,
  channelRoomId,
  candidates,
  paintApi,
  matrixClient,
  onAttachSource,
  initialSourceFile,
  onComplete,
  onClose,
}: PaintSessionSetupModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [file, setFile] = useState<File | null>(
    () => initialSourceFile ?? null,
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    setPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const start = async () => {
    if (!file) {
      setError('Choose a source image.');
      return;
    }

    setSaving(true);
    setError(null);
    let created: Created | null = null;

    try {
      const config = await matrixClient.getMediaConfig();
      const limit = config['m.upload.size'];
      if (limit && file.size > limit) {
        throw new Error('The source image exceeds the Matrix upload limit.');
      }
      created = await paintApi.createSession({
        channelId,
        participantSessionIds: selected,
      });
      await matrixClient.joinRoom(created.matrixRoomId);
      const uploaded = await matrixClient.uploadContent(file, {
        type: file.type,
        name: file.name,
      });
      const source = await matrixClient.sendMessage(created.matrixRoomId, {
        msgtype: MsgType.Image,
        body: file.name,
        url: uploaded.content_uri,
        info: { mimetype: file.type, size: file.size },
      });
      await onAttachSource(created.sessionId, source.event_id);
      const invitation = {
        version: 2 as const,
        sessionId: created.sessionId,
        channelId: created.channelId,
        status: 'active' as const,
      };
      await matrixClient.sendMessage(channelRoomId, {
        msgtype: MsgType.Text,
        body: `[brmble-paint]${JSON.stringify(invitation)}`,
        'com.brmble.paint': invitation,
      } as never);
      onComplete?.(created.sessionId);
    } catch (reason) {
      if (created) {
        try {
          await paintApi.leave(created.sessionId);
        } catch {
          // Preserve the setup error; the server-side expiry remains a fallback cleanup.
        }
      }
      setError(
        reason instanceof Error
          ? reason.message
          : 'Unable to start paint. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" data-testid="paint-setup-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="paint-setup-modal glass-panel animate-slide-up"
        role="dialog"
        aria-modal="true"
        aria-label="Start collaborative paint"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose?.();
            return;
          }
          if (event.key !== 'Tab') return;
          const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? []);
          if (!focusable.length) return;
          const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
          const nextIndex = event.shiftKey
            ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
            : (currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
          if (nextIndex !== currentIndex) {
            event.preventDefault();
            focusable[nextIndex].focus();
          }
        }}
      >
        <div className="modal-header">
          <h2 className="heading-title modal-title">
            Start collaborative paint
          </h2>
        </div>
        {candidates.map((candidate) => (
          <label key={candidate.userId}>
            <input
              aria-label={candidate.name}
              type="checkbox"
              checked={selected.includes(candidate.userId)}
              onChange={() => setSelected((value) => (
                value.includes(candidate.userId)
                  ? value.filter((id) => id !== candidate.userId)
                  : [...value, candidate.userId]
              ))}
            />
            {candidate.name}
          </label>
        ))}
        <label>
          Source image
          <input
            aria-label="Source image"
            type="file"
            accept="image/*"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        {file && previewUrl && (
          <div className="paint-setup-source">
            <img
              className="paint-setup-source__preview"
              src={previewUrl}
              alt="Selected paint source"
            />
            <span className="paint-setup-source__name">{file.name}</span>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="paint-setup-footer">
          <button ref={cancelRef} type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void start()}
            disabled={saving}
          >
            {saving ? 'Starting...' : 'Start paint'}
          </button>
        </div>
      </div>
    </div>
  );
}
