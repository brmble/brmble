import { useViewportThumbnail } from '../../../customCompanions/useViewportThumbnail';
import type { CustomCompanionEntry } from '../../../customCompanions/customCompanionTypes';
import type { CustomCompanionGalleryController } from '../../../hooks/useCustomCompanionGallery';
import { Icon } from '../../Icon/Icon';
import {
  type BuiltInCompanionId,
  type CompanionSelection,
} from '../InterfaceSettingsTypes';
import './CompanionPicker.css';

const BUILT_INS: Array<{
  id: BuiltInCompanionId;
  label: string;
}> = [
  { id: 'bee', label: 'Bee' },
  { id: 'engineer', label: 'Engineer' },
  { id: 'floppy', label: 'Floppy' },
  { id: 'patch', label: 'Patch' },
  { id: 'pip', label: 'Pip' },
  { id: 'retro', label: 'Retro' },
];

interface CompanionPickerProps {
  value: CompanionSelection;
  gallery: CustomCompanionGalleryController;
  onChange: (value: CompanionSelection) => void;
  onRequestCustomAtlas?: (value: CompanionSelection) => void;
  onUpload: () => void;
}

function CustomCompanionRow({
  entry,
  selected,
  gallery,
  onSelect,
}: {
  entry: CustomCompanionEntry;
  selected: boolean;
  gallery: CustomCompanionGalleryController;
  onSelect: () => void;
}) {
  const { ref, thumbnailUrl } = useViewportThumbnail(entry, gallery);
  const accessibleName = `${entry.name}, uploaded by ${entry.uploaderDisplayName}`;

  return (
    <button
      ref={ref}
      type="button"
      className={`companion-picker-row${selected ? ' companion-picker-row--selected' : ''}`}
      aria-label={accessibleName}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="companion-picker-thumbnail" aria-hidden="true">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" />
        ) : (
          <Icon name="palette" />
        )}
      </span>
      <span className="companion-picker-copy">
        <span className="companion-picker-name">{entry.name}</span>
        <span className="companion-picker-uploader">Uploaded by {entry.uploaderDisplayName}</span>
      </span>
      {selected && <Icon name="check" className="companion-picker-selected-icon" />}
    </button>
  );
}

export function CompanionPicker({
  value,
  gallery,
  onChange,
  onRequestCustomAtlas,
  onUpload,
}: CompanionPickerProps) {
  const selectCustom = (entry: CustomCompanionEntry) => {
    onChange(entry.id);
    onRequestCustomAtlas?.(entry.id);
  };

  return (
    <div className="companion-picker">
      <section className="companion-picker-section companion-picker-built-ins">
        <h4 className="companion-picker-heading">Built-in</h4>
        <div className="companion-picker-built-in-grid">
          {BUILT_INS.map(companion => {
            const selected = value === companion.id;
            return (
              <button
                key={companion.id}
                type="button"
                className={`companion-picker-built-in${selected ? ' companion-picker-built-in--selected' : ''}`}
                aria-pressed={selected}
                aria-label={companion.label}
                onClick={() => onChange(companion.id)}
              >
                <span
                  className={`companion-picker-built-in-sprite companion-picker-built-in-sprite--${companion.id}`}
                  aria-hidden="true"
                />
                <span>{companion.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {gallery.status !== 'disabled' && (
        <section className="companion-picker-section companion-picker-custom">
          <div className="companion-picker-custom-header">
            <h4 className="companion-picker-heading">Custom</h4>
            <button type="button" className="btn btn-secondary" onClick={onUpload}>
              <Icon name="upload" />
              Upload custom sprite
            </button>
          </div>
          <div className="companion-picker-custom-list">
            {gallery.status === 'loading' && (
              <p className="companion-picker-state">{'Loading custom companions\u2026'}</p>
            )}
            {gallery.status === 'unavailable' && (
              <p className="companion-picker-state">Custom companions are unavailable.</p>
            )}
            {gallery.status === 'empty' && (
              <div className="companion-picker-empty">
                <p className="companion-picker-state">No custom companions yet.</p>
                <button type="button" className="btn btn-secondary" onClick={onUpload}>
                  <Icon name="upload" />
                  Upload custom sprite
                </button>
              </div>
            )}
            {gallery.status === 'ready' && gallery.entries.map(entry => (
              <CustomCompanionRow
                key={entry.id}
                entry={entry}
                selected={value === entry.id}
                gallery={gallery}
                onSelect={() => selectCustom(entry)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
