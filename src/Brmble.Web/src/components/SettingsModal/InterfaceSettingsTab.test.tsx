import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InterfaceSettingsTab } from './InterfaceSettingsTab';
import { DEFAULT_BRMBLEGOTCHI, DEFAULT_OVERLAY } from './InterfaceSettingsTypes';
import type { CustomCompanionGalleryController } from '../../hooks/useCustomCompanionGallery';
import type { CustomCompanionEntry } from '../../customCompanions/customCompanionTypes';

const disabledGallery: CustomCompanionGalleryController = {
  status: 'disabled',
  entries: [],
  redactedEventIds: new Set(),
  error: null,
  requestAtlas: vi.fn(),
  requestThumbnail: vi.fn(),
  releaseAtlas: vi.fn(),
  releaseThumbnail: vi.fn(),
  createCompanion: vi.fn(),
  deleteCompanion: vi.fn(),
};

describe('InterfaceSettingsTab', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', class {
      constructor() {}
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not render plain inline overlay help text', () => {
    render(
      <InterfaceSettingsTab
        appearanceSettings={{ theme: 'classic' }}
        overlaySettings={DEFAULT_OVERLAY}
        brmblegotchiSettings={DEFAULT_BRMBLEGOTCHI}
        onAppearanceChange={vi.fn()}
        onOverlayChange={vi.fn()}
        onBrmblegotchiChange={vi.fn()}
      />
    );

    expect(screen.queryByText(/Keep a small Brmblegotchi companion overlay/)).not.toBeInTheDocument();
  });

  it('uses the sectioned picker in full mode and opens the upload dialog', async () => {
    const user = userEvent.setup();
    render(
      <InterfaceSettingsTab
        appearanceSettings={{ theme: 'classic' }}
        overlaySettings={{ ...DEFAULT_OVERLAY, mode: 'full' }}
        brmblegotchiSettings={DEFAULT_BRMBLEGOTCHI}
        customCompanionGallery={{ ...disabledGallery, status: 'empty' }}
        customCompanionMatrixClient={{
          uploadContent: vi.fn().mockResolvedValue({ content_uri: 'mxc://test/sprite' }),
        }}
        onAppearanceChange={vi.fn()}
        onOverlayChange={vi.fn()}
        onBrmblegotchiChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Built-in' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Custom' })).toBeVisible();
    await user.click(screen.getAllByRole('button', { name: /Upload custom sprite/ })[0]);
    expect(screen.getByRole('dialog', { name: 'Upload custom companion' })).toBeVisible();
  });

  it('highlights the effective custom selection instead of the built-in fallback', () => {
    const customEntry: CustomCompanionEntry = {
      id: 'custom:$orbit:test',
      eventId: '$orbit:test',
      roomId: '!gallery:test',
      name: 'Orbit',
      mediaUri: 'mxc://test/orbit',
      mimeType: 'image/png',
      width: 1536,
      height: 1872,
      frameCount: 1,
      byteSize: 1024,
      uploaderMatrixUserId: '@alice:test',
      uploaderDisplayName: 'Alice',
      createdAt: 1,
      atlasCacheKey: '!gallery:test\u0000$orbit:test',
    };

    render(
      <InterfaceSettingsTab
        appearanceSettings={{ theme: 'classic' }}
        overlaySettings={{ ...DEFAULT_OVERLAY, mode: 'full', myCompanion: 'floppy' }}
        brmblegotchiSettings={DEFAULT_BRMBLEGOTCHI}
        customCompanionGallery={{ ...disabledGallery, status: 'ready', entries: [customEntry] }}
        selectedCompanion={customEntry.id}
        onAppearanceChange={vi.fn()}
        onOverlayChange={vi.fn()}
        onBrmblegotchiChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /Orbit, uploaded by Alice/ }))
      .toHaveAttribute('aria-pressed', 'true');
    for (const label of ['Bee', 'Engineer', 'Floppy', 'Patch', 'Pip', 'Retro']) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false');
    }
  });
});
