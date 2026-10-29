import { useState } from 'react';
import { useViewportThumbnail } from '../../../customCompanions/useViewportThumbnail';
import type { CustomCompanionEntry } from '../../../customCompanions/customCompanionTypes';
import type { CustomCompanionGalleryController } from '../../../hooks/useCustomCompanionGallery';
import { confirm } from '../../../hooks/usePrompt';
import { Icon } from '../../Icon/Icon';
import './CustomCompanionModerationPanel.css';

interface CustomCompanionModerationPanelProps {
  gallery: CustomCompanionGalleryController;
  onDelete: (eventId: string) => Promise<void>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${Number(value.toFixed(1))} ${units[unitIndex]}`;
}

function errorMessage(error: unknown): string {
  const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
    ? (error as { statusCode?: unknown }).statusCode
    : undefined;
  if (statusCode === 403) {
    return 'You no longer have permission to remove custom companions.';
  }
  if (statusCode === 503) {
    return 'Custom companion removal is temporarily unavailable. Please try again.';
  }
  return 'Could not remove the custom companion. Please try again.';
}

function CompanionPreview({
  entry,
  thumbnailUrl,
  className,
}: {
  entry: CustomCompanionEntry;
  thumbnailUrl: string | null;
  className: string;
}) {
  return (
    <span className={className}>
      {thumbnailUrl ? (
        <span className="custom-companion-moderation-sprite" role="img" aria-label={`${entry.name} preview`} style={{ backgroundImage: `url(${thumbnailUrl})` }} />
      ) : (
        <span
          className="custom-companion-moderation-placeholder"
          role="img"
          aria-label={`${entry.name} preview unavailable`}
        >
          <Icon name="palette" />
        </span>
      )}
    </span>
  );
}

function CustomCompanionModerationRow({
  entry,
  gallery,
  onDelete,
}: {
  entry: CustomCompanionEntry;
  gallery: CustomCompanionGalleryController;
  onDelete: (eventId: string) => Promise<void>;
}) {
  const { ref, thumbnailUrl } = useViewportThumbnail(entry, gallery);
  const [showSheet, setShowSheet] = useState(false);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleSheet = () => {
    if (showSheet) {
      setShowSheet(false);
      return;
    }
    setShowSheet(true);
    setSheetError(false);
    if (!sheetUrl) {
      void gallery.requestAtlas(entry, new Set([entry.atlasCacheKey]))
        .then(setSheetUrl)
        .catch(() => setSheetError(true));
    }
  };

  const remove = async () => {
    const accepted = await confirm({
      title: 'Remove custom companion?',
      message: 'This sprite will be removed for everyone on this server and cannot be restored through Brmble.',
      content: (
        <div className="custom-companion-confirmation">
          <CompanionPreview
            entry={entry}
            thumbnailUrl={thumbnailUrl}
            className="custom-companion-confirmation-preview"
          />
          <div className="custom-companion-confirmation-copy">
            <strong>{entry.name}</strong>
            <span>Uploaded by {entry.uploaderDisplayName}</span>
          </div>
        </div>
      ),
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!accepted) return;

    setDeleting(true);
    setError(null);
    try {
      await onDelete(entry.eventId);
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <article
      ref={ref}
      className={`custom-companion-moderation-row${deleting ? ' custom-companion-moderation-row--deleting' : ''}`}
      aria-label={entry.name}
      aria-busy={deleting}
      aria-disabled={deleting}
    >
      <CompanionPreview
        entry={entry}
        thumbnailUrl={thumbnailUrl}
        className="custom-companion-moderation-thumbnail"
      />
      <div className="custom-companion-moderation-details">
        <strong className="custom-companion-moderation-name">{entry.name}</strong>
        <span>Uploaded by {entry.uploaderDisplayName}</span>
        <span>{new Date(entry.createdAt).toLocaleDateString()}</span>
        <span className="custom-companion-moderation-metadata">
          <span>{formatBytes(entry.byteSize)}</span>
          <span aria-hidden="true">{'\u00b7'}</span>
          <span>{entry.mimeType === 'image/png' ? 'PNG' : 'WebP'}</span>
          <span aria-hidden="true">{'\u00b7'}</span>
          <span>{entry.width} {'\u00d7'} {entry.height}</span>
        </span>
        {thumbnailUrl && (
          <button type="button" className="custom-companion-sheet-toggle" aria-expanded={showSheet}
            aria-label={`${showSheet ? 'Hide' : 'Show'} sprite sheet for ${entry.name}`}
            onClick={toggleSheet}>
            {showSheet ? 'Hide sprite sheet' : 'View sprite sheet'}
          </button>
        )}
        {error && <span className="custom-companion-moderation-error" role="alert">{error}</span>}
      </div>
      <button
        type="button"
        className="btn btn-danger btn-sm custom-companion-moderation-remove"
        aria-label={deleting ? `Removing ${entry.name}` : `Remove ${entry.name}`}
        disabled={deleting}
        onClick={() => void remove()}
      >
        {deleting ? 'Removing\u2026' : 'Remove'}
      </button>
      {showSheet && (
        <div className="custom-companion-moderation-sheet">
          {sheetUrl ? <img src={sheetUrl} alt={`${entry.name} sprite sheet`} />
            : <p role="status">{sheetError ? 'Could not load the sprite sheet. Close and try again.' : 'Loading sprite sheet…'}</p>}
        </div>
      )}
    </article>
  );
}

export function CustomCompanionModerationPanel({
  gallery,
  onDelete,
}: CustomCompanionModerationPanelProps) {
  return (
    <div className="custom-companion-moderation-panel">
      <h4 className="custom-companion-moderation-heading">Custom Companions</h4>
      {gallery.status === 'loading' && (
        <p className="custom-companion-moderation-state">{'Loading custom companion gallery\u2026'}</p>
      )}
      {gallery.status === 'unavailable' && (
        <p className="custom-companion-moderation-state">Custom companion gallery unavailable.</p>
      )}
      {gallery.status === 'empty' && (
        <p className="custom-companion-moderation-state">No custom companions have been uploaded.</p>
      )}
      {gallery.status === 'ready' && (
        <div className="custom-companion-moderation-list">
          {gallery.entries.map(entry => (
            <CustomCompanionModerationRow
              key={entry.eventId}
              entry={entry}
              gallery={gallery}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
