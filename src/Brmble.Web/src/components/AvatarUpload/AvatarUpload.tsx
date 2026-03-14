import { useState, useCallback, useRef, useEffect } from 'react';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import './AvatarUpload.css';

interface AvatarUploadProps {
  onUpload: (blob: Blob, contentType: string) => void;
  onCancel: () => void;
}

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const CROP_SIZE = 512; // output square dimension in px

/**
 * Crop the selected region from a loaded image onto an off-screen canvas,
 * then return the result as a Blob.
 */
function cropImage(
  image: HTMLImageElement,
  crop: Area,
  contentType: string,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = CROP_SIZE;
  canvas.height = CROP_SIZE;
  const ctx = canvas.getContext('2d')!;

  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    CROP_SIZE,
    CROP_SIZE,
  );

  // GIF → PNG (canvas can't encode GIF)
  const mimeType = contentType === 'image/gif' ? 'image/png' : contentType;

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))),
      mimeType,
      0.92,
    );
  });
}

export default function AvatarUpload({ onUpload, onCancel }: AvatarUploadProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [contentType, setContentType] = useState('image/png');
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const imageRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Handle the file input change event */
  const onFileSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Unsupported file type. Use PNG, JPEG, WebP, or GIF.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('File is too large. Maximum size is 5 MB.');
      return;
    }

    setError(null);
    setContentType(file.type);
    setZoom(1);
    setCrop({ x: 0, y: 0 });

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setImageSrc(dataUrl);

      // Pre-load and decode the image before storing ref for canvas drawing
      const img = new Image();
      img.src = dataUrl;
      try {
        await img.decode();
        imageRef.current = img;
      } catch {
        setError('Failed to load image. Please try another file.');
        setImageSrc(null);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const onCropComplete = useCallback((_croppedAreaPct: Area, croppedAreaPx: Area) => {
    setCroppedArea(croppedAreaPx);
  }, []);

  /** Crop and deliver the blob to the parent */
  const handleUpload = useCallback(async () => {
    if (!imageRef.current || !croppedArea) return;

    setUploading(true);
    try {
      const blob = await cropImage(imageRef.current, croppedArea, contentType);
      const outType = contentType === 'image/gif' ? 'image/png' : contentType;
      onUpload(blob, outType);
    } catch {
      setError('Failed to process image. Please try another file.');
    } finally {
      setUploading(false);
    }
  }, [croppedArea, contentType, onUpload]);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape key to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  // Focus trap
  useEffect(() => {
    const card = dialogRef.current;
    if (!card) return;

    const focusable = card.querySelectorAll<HTMLElement>(
      'button, input, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    first.focus();

    const handleTrap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      // Re-query in case DOM changed (e.g. crop area appeared)
      const current = card.querySelectorAll<HTMLElement>(
        'button, input, [tabindex]:not([tabindex="-1"])'
      );
      if (current.length === 0) return;
      const f = current[0];
      const l = current[current.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === f) {
          e.preventDefault();
          l.focus();
        }
      } else {
        if (document.activeElement === l) {
          e.preventDefault();
          f.focus();
        }
      }
    };

    window.addEventListener('keydown', handleTrap);
    return () => window.removeEventListener('keydown', handleTrap);
  }, [imageSrc]);

  return (
    <div className="avatar-upload-overlay" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="avatar-upload glass-panel animate-slide-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-upload-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="avatar-upload-title" className="heading-title modal-title">Upload Avatar</h2>
          <p className="modal-subtitle">Choose an image and crop to fit</p>
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          onChange={onFileSelected}
          style={{ display: 'none' }}
        />

        {!imageSrc ? (
          /* File picker area */
          <div
            className="avatar-upload-picker"
            onClick={openFilePicker}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openFilePicker();
              }
            }}
          >
            <svg
              className="avatar-upload-picker-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className="avatar-upload-picker-text">Click to choose an image</span>
            <span className="avatar-upload-picker-hint">
              PNG, JPEG, WebP, or GIF &middot; Max 5 MB
            </span>
          </div>
        ) : (
          /* Crop area */
          <>
            <div className="avatar-upload-crop-area">
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </div>

            <div className="avatar-upload-zoom">
              <span className="avatar-upload-zoom-label">Zoom</span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                aria-label="Zoom"
              />
            </div>
          </>
        )}

        {error && <p className="avatar-upload-error">{error}</p>}

        <div className="avatar-upload-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          {imageSrc ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleUpload}
              disabled={uploading || !croppedArea}
            >
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={openFilePicker}
            >
              Choose File
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
