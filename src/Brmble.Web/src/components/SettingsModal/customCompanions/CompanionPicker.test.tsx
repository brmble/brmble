import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomCompanionEntry } from '../../../customCompanions/customCompanionTypes';
import type { CustomCompanionGalleryController } from '../../../hooks/useCustomCompanionGallery';
import { CompanionPicker } from './CompanionPicker';

const entry = (
  eventId: string,
  uploaderDisplayName: string,
  createdAt: number,
): CustomCompanionEntry => ({
  id: `custom:${eventId}`,
  eventId,
  roomId: '!gallery:test',
  name: 'Orbit',
  mediaUri: `mxc://test/${eventId.slice(1)}`,
  mimeType: 'image/png',
  width: 1536,
  height: 1872,
  frameCount: 1,
  byteSize: 1024,
  uploaderMatrixUserId: `@${uploaderDisplayName.toLowerCase()}:test`,
  uploaderDisplayName,
  createdAt,
  atlasCacheKey: `!gallery:test\u0000${eventId}`,
});

function gallery(
  status: CustomCompanionGalleryController['status'],
  entries: CustomCompanionEntry[] = [],
): CustomCompanionGalleryController {
  return {
    status,
    entries,
    redactedEventIds: new Set(),
    error: status === 'unavailable' ? 'offline' : null,
    requestAtlas: vi.fn().mockResolvedValue('blob:atlas'),
    requestThumbnail: vi.fn().mockResolvedValue('blob:thumbnail'),
    releaseAtlas: vi.fn(),
    releaseThumbnail: vi.fn(),
    createCompanion: vi.fn(),
    deleteCompanion: vi.fn(),
  };
}

describe('CompanionPicker', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  });

  it('keeps built-ins visible while the custom section is loading', () => {
    render(
      <CompanionPicker
        value="floppy"
        gallery={gallery('loading')}
        onChange={vi.fn()}
        onUpload={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Built-in' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Floppy' })).toBeEnabled();
    expect(screen.getByText('Loading custom companions\u2026')).toBeVisible();
  });

  it('shows duplicate names with uploader context and stable identity', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onRequestCustomAtlas = vi.fn();
    const duplicateNameGallery = gallery('ready', [
      entry('$alice:test', 'Alice', 2),
      entry('$bob:test', 'Bob', 1),
    ]);

    render(
      <CompanionPicker
        value="floppy"
        gallery={duplicateNameGallery}
        onChange={onChange}
        onRequestCustomAtlas={onRequestCustomAtlas}
        onUpload={vi.fn()}
      />,
    );

    expect(screen.getAllByText('Orbit')).toHaveLength(2);
    expect(screen.getByText('Uploaded by Alice')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Orbit, uploaded by Bob/ }));
    expect(onChange).toHaveBeenCalledWith('custom:$bob:test');
    expect(onRequestCustomAtlas).toHaveBeenCalledWith('custom:$bob:test');
    expect(duplicateNameGallery.requestAtlas).not.toHaveBeenCalled();
  });

  it('omits Custom when the capability is absent', () => {
    render(
      <CompanionPicker
        value="floppy"
        gallery={gallery('disabled')}
        onChange={vi.fn()}
        onUpload={vi.fn()}
      />,
    );

    expect(screen.queryByRole('heading', { name: 'Custom' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upload custom sprite/ })).not.toBeInTheDocument();
  });

  it.each([
    ['empty', 'No custom companions yet.'],
    ['unavailable', 'Custom companions are unavailable.'],
  ] as const)('shows the %s state without hiding built-ins', (status, message) => {
    render(
      <CompanionPicker
        value="floppy"
        gallery={gallery(status)}
        onChange={vi.fn()}
        onUpload={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Floppy' })).toBeEnabled();
    expect(screen.getByText(message)).toBeVisible();
  });

  it('does not request thumbnails or atlases merely because metadata rendered', () => {
    const readyGallery = gallery('ready', [entry('$orbit:test', 'Alice', 1)]);
    render(
      <CompanionPicker
        value="floppy"
        gallery={readyGallery}
        onChange={vi.fn()}
        onUpload={vi.fn()}
      />,
    );

    expect(readyGallery.requestThumbnail).not.toHaveBeenCalled();
    expect(readyGallery.requestAtlas).not.toHaveBeenCalled();
  });
});
