import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
} from 'react';
import { MsgType, type MatrixClient } from 'matrix-js-sdk';
import {
  PAINT_SOURCE_ACCEPT,
  preparePaintSourceFile,
  type PaintSourceOrigin,
} from '../../utils/paintSourceFile';
import './PaintSessionSetupModal.css';

type Created = { sessionId: string; matrixRoomId: string; channelId: number };
type Matrix = Pick<
  MatrixClient,
  'getMediaConfig' | 'joinRoom' | 'uploadContent' | 'sendMessage'
>;

type PaintSessionSetupModalProps = {
  channelId: number;
  channelRoomId: string;
  /** @deprecated Participant selection is no longer used; channel members can join later. */
  candidates?: unknown;
  /** @deprecated Kept for compatibility with older callers. */
  hostUserId?: number;
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
  paintApi,
  matrixClient,
  onAttachSource,
  initialSourceFile,
  onComplete,
  onClose,
}: PaintSessionSetupModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceRevisionRef = useRef(0);
  const uploadLimitPromiseRef = useRef<Promise<number | undefined> | null>(null);
  const [file, setFile] = useState<File | null>(
    () => initialSourceFile ?? null,
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preparingSource, setPreparingSource] = useState(false);

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

  const getUploadLimit = useCallback(() => {
    uploadLimitPromiseRef.current ??= matrixClient.getMediaConfig()
      .then((config) => config['m.upload.size'])
      .catch(() => {
        uploadLimitPromiseRef.current = null;
        throw new Error(
          'Unable to check this image right now. Try again or choose a file.',
        );
      });
    return uploadLimitPromiseRef.current;
  }, [matrixClient]);

  const stageSource = useCallback(async (
    candidate: File,
    origin: PaintSourceOrigin,
  ) => {
    if (saving) return;
    const revision = ++sourceRevisionRef.current;
    setPreparingSource(true);
    setError(null);

    try {
      const prepared = await preparePaintSourceFile(
        candidate,
        origin,
        await getUploadLimit(),
      );
      if (revision !== sourceRevisionRef.current) return;
      setFile(prepared);
      if (origin === 'paste' && fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (reason) {
      if (revision !== sourceRevisionRef.current) return;
      if (origin === 'file' && fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setError(
        reason instanceof Error
          ? reason.message
          : 'This image cannot be used. Try another image or choose a file.',
      );
    } finally {
      if (revision === sourceRevisionRef.current) {
        setPreparingSource(false);
      }
    }
  }, [getUploadLimit, saving]);

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const candidate = event.currentTarget.files?.[0];
    if (candidate) void stageSource(candidate, 'file');
  }, [stageSource]);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    if (saving) return;
    const imageItem = Array.from(event.clipboardData.items)
      .find((item) => item.type.startsWith('image/'));
    event.preventDefault();

    if (!imageItem) {
      setError('The clipboard does not contain an image.');
      return;
    }

    const candidate = imageItem.getAsFile();
    if (!candidate) {
      setError(
        'This clipboard image cannot be used. Try copying another image or choose a file.',
      );
      return;
    }
    void stageSource(candidate, 'paste');
  }, [saving, stageSource]);

  const start = async () => {
    if (!file) {
      setError('Choose a source image.');
      return;
    }

    setSaving(true);
    setError(null);
    let created: Created | null = null;

    try {
      const limit = await getUploadLimit();
      if (limit && file.size > limit) {
        throw new Error('The source image exceeds the Matrix upload limit.');
      }
      created = await paintApi.createSession({
        channelId,
        participantSessionIds: [],
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
        onPaste={handlePaste}
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
        <label>
          Source image
          <input
            ref={fileInputRef}
            aria-label="Source image"
            type="file"
            accept={PAINT_SOURCE_ACCEPT}
            onChange={handleFileChange}
            disabled={saving}
          />
        </label>
        {file && previewUrl && (
          <div
            className="paint-setup-source"
            role="status"
            aria-live="polite"
          >
            <img
              className="paint-setup-source__preview"
              src={previewUrl}
              alt={`Selected paint source: ${file.name}`}
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
            disabled={saving || preparingSource}
          >
            {saving ? 'Starting...' : 'Start paint'}
          </button>
        </div>
      </div>
    </div>
  );
}
