import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomCompanionEntry } from '../../../customCompanions/customCompanionTypes';
import type { CustomCompanionGalleryController } from '../../../hooks/useCustomCompanionGallery';
import { usePrompt } from '../../../hooks/usePrompt';
import { CustomCompanionModerationPanel } from './CustomCompanionModerationPanel';

const orbit: CustomCompanionEntry = {
  id: 'custom:$sprite:test',
  eventId: '$sprite:test',
  roomId: '!gallery:test',
  name: 'Orbit',
  mediaUri: 'mxc://test/orbit',
  mimeType: 'image/webp',
  width: 1536,
  height: 1872,
  frameCount: 1,
  byteSize: 1536,
  uploaderMatrixUserId: '@alice:test',
  uploaderDisplayName: 'Alice',
  createdAt: new Date(2026, 6, 29, 12).getTime(),
  atlasCacheKey: '!gallery:test\u0000$sprite:test',
};

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

function ModerationHarness({
  companionGallery,
  onDelete,
}: {
  companionGallery: CustomCompanionGalleryController;
  onDelete: (eventId: string) => Promise<void>;
}) {
  const { Prompt } = usePrompt();
  return (
    <>
      <CustomCompanionModerationPanel gallery={companionGallery} onDelete={onDelete} />
      <Prompt />
    </>
  );
}

describe('CustomCompanionModerationPanel', () => {
  let intersectionCallback: IntersectionObserverCallback;
  let observedElement: Element | null;

  beforeEach(() => {
    observedElement = null;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }

      observe(element: Element) {
        observedElement = element;
      }

      unobserve() {}
      disconnect() {}
    });
  });

  it('distinguishes unavailable from empty', () => {
    const { rerender } = render(
      <CustomCompanionModerationPanel gallery={gallery('unavailable')} onDelete={vi.fn()} />,
    );
    expect(screen.getByText('Custom companion gallery unavailable.')).toBeVisible();

    rerender(<CustomCompanionModerationPanel gallery={gallery('empty')} onDelete={vi.fn()} />);
    expect(screen.getByText('No custom companions have been uploaded.')).toBeVisible();
  });

  it('shows authoritative metadata for ready entries', () => {
    render(<CustomCompanionModerationPanel gallery={gallery('ready', [orbit])} onDelete={vi.fn()} />);

    const row = screen.getByRole('article', { name: 'Orbit' });
    expect(within(row).getByText('Uploaded by Alice')).toBeVisible();
    expect(within(row).getByText(new Date(orbit.createdAt).toLocaleDateString())).toBeVisible();
    expect(within(row).getByText('1.5 KB')).toBeVisible();
    expect(within(row).getByText('WebP')).toBeVisible();
    expect(within(row).getByText('1536 \u00d7 1872')).toBeVisible();
  });

  it('loads only a viewport thumbnail for a moderation row', async () => {
    const readyGallery = gallery('ready', [orbit]);
    render(<CustomCompanionModerationPanel gallery={readyGallery} onDelete={vi.fn()} />);

    expect(readyGallery.requestThumbnail).not.toHaveBeenCalled();
    expect(readyGallery.requestAtlas).not.toHaveBeenCalled();

    act(() => {
      intersectionCallback(
        [{ isIntersecting: true, target: observedElement } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(await screen.findByRole('img', { name: 'Orbit preview' })).toHaveAttribute('src', 'blob:thumbnail');
    expect(readyGallery.requestThumbnail).toHaveBeenCalledWith(orbit, expect.any(Symbol));
    expect(readyGallery.requestAtlas).not.toHaveBeenCalled();
  });

  it('confirms with preview, name, and uploader before deleting', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const readyGallery = gallery('ready', [orbit]);
    render(<ModerationHarness companionGallery={readyGallery} onDelete={onDelete} />);

    act(() => {
      intersectionCallback(
        [{ isIntersecting: true, target: observedElement } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    await screen.findByRole('img', { name: 'Orbit preview' });

    await user.click(screen.getByRole('button', { name: 'Remove Orbit' }));

    const dialog = screen.getByRole('dialog', { name: 'Remove custom companion?' });
    expect(within(dialog).getByRole('img', { name: 'Orbit preview' })).toBeVisible();
    expect(within(dialog).getByText('Orbit')).toBeVisible();
    expect(within(dialog).getByText('Uploaded by Alice')).toBeVisible();
    expect(within(dialog).getByText(/removed for everyone/i)).toBeVisible();
    expect(within(dialog).getByText(/cannot be restored through Brmble/i)).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Remove' })).toHaveClass('btn-danger');

    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(onDelete).toHaveBeenCalledWith('$sprite:test');
  });

  it('disables the row while deletion is active', async () => {
    const user = userEvent.setup();
    let resolveDelete!: () => void;
    const onDelete = vi.fn(() => new Promise<void>(resolve => {
      resolveDelete = resolve;
    }));
    render(<ModerationHarness companionGallery={gallery('ready', [orbit])} onDelete={onDelete} />);

    await user.click(screen.getByRole('button', { name: 'Remove Orbit' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(screen.getByRole('article', { name: 'Orbit' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('article', { name: 'Orbit' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Removing Orbit' })).toBeDisabled();

    resolveDelete();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Remove Orbit' })).toBeEnabled();
    });
  });

  it.each([
    [403, 'You no longer have permission to remove custom companions.'],
    [503, 'Custom companion removal is temporarily unavailable. Please try again.'],
  ])('maps a %s deletion response to an inline error', async (statusCode, message) => {
    const user = userEvent.setup();
    const error = Object.assign(new Error('request failed'), { statusCode });
    const onDelete = vi.fn().mockRejectedValue(error);
    render(<ModerationHarness companionGallery={gallery('ready', [orbit])} onDelete={onDelete} />);

    await user.click(screen.getByRole('button', { name: 'Remove Orbit' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText(message)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remove Orbit' })).toBeEnabled();
  });

  it('keeps removal available when the thumbnail fails', async () => {
    const user = userEvent.setup();
    const readyGallery = gallery('ready', [orbit]);
    vi.mocked(readyGallery.requestThumbnail).mockRejectedValue(new Error('thumbnail failed'));
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<ModerationHarness companionGallery={readyGallery} onDelete={onDelete} />);

    act(() => {
      intersectionCallback(
        [{ isIntersecting: true, target: observedElement } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    await waitFor(() => {
      expect(readyGallery.requestThumbnail).toHaveBeenCalled();
    });

    await user.click(screen.getByRole('button', { name: 'Remove Orbit' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(onDelete).toHaveBeenCalledWith('$sprite:test');
    expect(readyGallery.requestAtlas).not.toHaveBeenCalled();
  });
});
