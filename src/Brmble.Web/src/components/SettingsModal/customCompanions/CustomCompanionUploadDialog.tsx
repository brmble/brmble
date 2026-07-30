import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from 'react';
import { Icon } from '../../Icon/Icon';
import {
  getSupportedCompanionMime,
  type SupportedCompanionMime,
} from './customCompanionFilePolicy';
import './CustomCompanionUploadDialog.css';

const MAX_FILE_BYTES = 5_242_880;
const NAME_PATTERN = /^[\p{L}\p{N} _-]{1,32}$/u;
const GUIDANCE = 'For correct animation, use a PNG or WebP sheet with 8 columns \u00d7 9 rows of equal cells. 1536 \u00d7 1872 px is recommended; for predictable results, do not exceed 3072 \u00d7 3744 px. Keep the file under 5 MiB.';
const PRIVACY = 'Only upload artwork you own or have permission to share. Your name will be shown to everyone on this server, and moderators can remove the sprite.';

type SubmissionState = 'idle' | 'uploading-media' | 'creating-entry' | 'success' | 'error';
type PreviewState = 'unknown' | 'loading' | 'ready' | 'unavailable';

export interface MatrixUploadClient {
  uploadContent(
    file: File,
    options: { name: string; type: SupportedCompanionMime },
  ): Promise<{ content_uri?: string }>;
}

export interface CompanionCreator {
  createCompanion(name: string, mediaUri: string): Promise<unknown>;
}

interface CustomCompanionUploadDialogProps {
  isOpen: boolean;
  matrixClient: MatrixUploadClient;
  companions: CompanionCreator;
  onClose: () => void;
  onSuccess?: () => void;
  onActivityChange?: (active: boolean) => void;
}

const SERVER_ERROR_MESSAGES: Record<string, string> = {
  unsupported_file_type: 'Choose a PNG or WebP file.',
  invalid_image: 'This image is damaged or could not be decoded.',
  unsafe_image_dimensions: 'Image dimensions are too large. Use at most 4096 \u00d7 4096 px and 12,000,000 total pixels.',
  animated_image_not_supported: 'Animated PNG and WebP files aren\u2019t supported. Upload a still sprite sheet.',
};

function getServerCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === 'string') return direct;
  const body = (error as { body?: unknown }).body;
  if (typeof body !== 'string') return null;
  try {
    const parsed = JSON.parse(body) as { code?: unknown; error?: { code?: unknown } };
    if (typeof parsed.code === 'string') return parsed.code;
    return typeof parsed.error?.code === 'string' ? parsed.error.code : null;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  const code = getServerCode(error);
  if (code && SERVER_ERROR_MESSAGES[code]) return SERVER_ERROR_MESSAGES[code];
  return 'The custom companion could not be uploaded. Check your connection and try again.';
}

function RepresentativePreview({
  label,
  row,
  objectUrl,
}: {
  label: string;
  row: 1 | 4 | 9;
  objectUrl: string;
}) {
  const frameCounts = { 1: 6, 4: 4, 9: 6 } as const;
  const frameCount = frameCounts[row];
  const lastFramePosition = `${(((frameCount - 1) / (8 - 1)) * 100).toFixed(6)}%`;
  const style = {
    '--custom-preview-image': `url(${objectUrl})`,
    '--custom-preview-row-position': `${((row - 1) / 8) * 100}%`,
    '--custom-preview-frame-count': frameCount,
    '--custom-preview-frame-step-count': frameCount - 1,
    '--custom-preview-last-frame-position': lastFramePosition,
    '--custom-preview-cycle': `${frameCount}s`,
  } as CSSProperties;

  return (
    <div className="custom-companion-preview-sample">
      <span
        className="custom-companion-preview-sprite"
        data-testid={`companion-preview-row-${row}`}
        style={style}
        aria-hidden="true"
      />
      <span>{label}</span>
    </div>
  );
}

export function CustomCompanionUploadDialog({
  isOpen,
  matrixClient,
  companions,
  onClose,
  onSuccess,
  onActivityChange,
}: CustomCompanionUploadDialogProps) {
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [mime, setMime] = useState<SupportedCompanionMime | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submissionState, setSubmissionState] = useState<SubmissionState>('idle');
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>('unknown');
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number } | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const active = submissionState === 'uploading-media' || submissionState === 'creating-entry';
  const trimmedName = name.trim();
  const validName = NAME_PATTERN.test(trimmedName);
  const canSubmit = !!file
    && !!mime
    && file.size <= MAX_FILE_BYTES
    && validName
    && (submissionState === 'idle' || submissionState === 'error');

  const revokePreview = () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
  };

  useEffect(() => () => revokePreview(), []);

  useEffect(() => {
    onActivityChange?.(active);
    return () => {
      if (active) onActivityChange?.(false);
    };
  }, [active, onActivityChange]);

  useEffect(() => {
    if (!isOpen || !objectUrl) return;
    let current = true;
    const image = new Image();
    setPreviewState('loading');
    setPreviewSize(null);
    image.onload = () => {
      if (!current) return;
      setPreviewSize({ width: image.naturalWidth, height: image.naturalHeight });
      setPreviewState('ready');
    };
    image.onerror = () => {
      if (!current) return;
      setPreviewState('unavailable');
      setPreviewSize(null);
    };
    image.src = objectUrl;
    return () => {
      current = false;
      image.onload = null;
      image.onerror = null;
    };
  }, [isOpen, objectUrl]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (!active) onClose();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [active, isOpen, onClose]);

  if (!isOpen) return null;

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (active) return;
    const selected = event.target.files?.[0] ?? null;
    revokePreview();
    setObjectUrl(null);
    setPreviewState('unknown');
    setPreviewSize(null);
    setFile(selected);
    setSubmissionError(null);
    if (!selected) {
      setMime(null);
      setFileError(null);
      return;
    }

    const supportedMime = getSupportedCompanionMime(selected);
    setMime(supportedMime);
    if (!supportedMime) {
      setFileError('Choose a PNG or WebP file.');
      return;
    }
    if (selected.size > MAX_FILE_BYTES) {
      setFileError('Keep the file under 5 MiB.');
      return;
    }

    setFileError(null);
    const nextUrl = URL.createObjectURL(selected);
    objectUrlRef.current = nextUrl;
    setObjectUrl(nextUrl);
  };

  const handleClose = () => {
    if (!active) onClose();
  };

  const handleSubmit = async () => {
    if (!canSubmit || !file || !mime) return;
    setSubmissionError(null);
    setSubmissionState('uploading-media');
    try {
      const upload = await matrixClient.uploadContent(file, { name: file.name, type: mime });
      if (!upload.content_uri) throw new Error('Matrix upload did not return a content URI.');
      setSubmissionState('creating-entry');
      await companions.createCompanion(trimmedName, upload.content_uri);
      setSubmissionState('success');
      onSuccess?.();
    } catch (error) {
      setSubmissionError(errorMessage(error));
      setSubmissionState('error');
    }
  };

  return (
    <div
      className="modal-overlay custom-companion-upload-overlay"
      data-testid="custom-companion-upload-overlay"
      onClick={event => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <div
        className="custom-companion-upload-dialog glass-panel animate-slide-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-companion-upload-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="custom-companion-upload-title" className="heading-title modal-title">
            Upload custom companion
          </h2>
        </div>

        <div className="custom-companion-upload-body">
          <p className="custom-companion-upload-guidance">{GUIDANCE}</p>

          <label className="custom-companion-upload-field">
            <span>Companion name</span>
            <input
              className="brmble-input"
              value={name}
              disabled={active}
              onChange={event => {
                setName(event.target.value);
                setSubmissionError(null);
              }}
            />
          </label>
          {name.length > 0 && !validName && (
            <p className="custom-companion-upload-error">
              {'Use 1\u201332 letters, numbers, spaces, underscores, or hyphens.'}
            </p>
          )}

          <label className="custom-companion-upload-field">
            <span>Sprite sheet</span>
            <input
              className="brmble-input"
              type="file"
              accept=".png,.webp,image/png,image/webp"
              disabled={active}
              onChange={handleFileChange}
            />
          </label>
          {fileError && <p className="custom-companion-upload-error">{fileError}</p>}

          {previewState === 'loading' && (
            <p className="custom-companion-upload-status">{'Preparing preview\u2026'}</p>
          )}
          {previewState === 'ready' && objectUrl && (
            <div className="custom-companion-preview">
              {previewSize && (
                <p className="custom-companion-upload-status">
                  {`${previewSize.width} \u00d7 ${previewSize.height} px`}
                </p>
              )}
              <div className="custom-companion-preview-grid">
                <RepresentativePreview label="Idle" row={1} objectUrl={objectUrl} />
                <RepresentativePreview label="Message" row={4} objectUrl={objectUrl} />
                <RepresentativePreview label="Speaking" row={9} objectUrl={objectUrl} />
              </div>
            </div>
          )}
          {previewState === 'unavailable' && (
            <p className="custom-companion-upload-status">
              Preview unavailable; the server will verify this image before accepting it.
            </p>
          )}

          {submissionError && (
            <p className="custom-companion-upload-error" role="alert">{submissionError}</p>
          )}
          {submissionState === 'success' && (
            <p className="custom-companion-upload-success" role="status">
              Custom companion uploaded.
            </p>
          )}
          {active && (
            <p className="custom-companion-upload-status" role="status">
              Keep this dialog open while the upload finishes.
            </p>
          )}

          <p className="custom-companion-upload-privacy">{PRIVACY}</p>
        </div>

        <div className="custom-companion-upload-actions">
          <button type="button" className="btn btn-secondary" disabled={active} onClick={handleClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSubmit || active}
            onClick={() => void handleSubmit()}
          >
            <Icon name="upload" />
            Upload sprite
          </button>
        </div>
      </div>
    </div>
  );
}
