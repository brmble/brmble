import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanionSprite } from './CompanionSprite';

const { getAtlas } = vi.hoisted(() => ({
  getAtlas: vi.fn(),
}));

vi.mock('../../customCompanions/customCompanionAtlasStore', () => ({ getAtlas }));

describe('CompanionSprite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getAtlas.mockReset();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:custom-atlas');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  it('renders row-aware playback metadata for a 6-frame row', () => {
    render(
      <CompanionSprite
        companionId="retro"
        row={9}
        badges={{ muted: false, live: true }}
      />,
    );

    const sprite = screen.getByTestId('companion-sprite');

    expect(sprite).toHaveClass('companion-sprite--animated');
    expect(sprite).toHaveAttribute('data-frame-count', '6');
    expect(sprite).toHaveAttribute('data-frame-step-count', '5');
    expect(sprite).toHaveStyle({
      '--companion-last-frame-position': '71.428571%',
    });
    expect(sprite).toHaveStyle({
      '--companion-frame-count': '6',
      '--companion-frame-step-count': '5',
      '--companion-cycle-duration': '6000ms',
    });
  });

  it('renders row-aware playback metadata for a 4-frame row', () => {
    render(
      <CompanionSprite
        companionId="retro"
        row={4}
        badges={{ muted: false, live: false }}
      />,
    );

    const sprite = screen.getByTestId('companion-sprite');

    expect(sprite).toHaveAttribute('data-frame-count', '4');
    expect(sprite).toHaveAttribute('data-frame-step-count', '3');
    expect(sprite).toHaveStyle({
      '--companion-last-frame-position': '42.857143%',
    });
    expect(sprite).toHaveStyle({
      '--companion-frame-count': '4',
      '--companion-frame-step-count': '3',
      '--companion-cycle-duration': '4000ms',
    });
  });

  it('loads a ready custom atlas from IndexedDB and revokes its URL on unmount', async () => {
    getAtlas.mockResolvedValue(new Blob(['atlas'], { type: 'image/webp' }));
    const { unmount } = render(
      <CompanionSprite
        companionId="custom:$sprite:test"
        atlasCacheKey="!gallery:test\u0000$sprite:test"
        row={1}
        badges={{ muted: false, live: false }}
      />,
    );

    expect(screen.getByTestId('companion-sprite').style.backgroundImage).toContain('Floppy');
    await waitFor(() => {
      expect(screen.getByTestId('companion-sprite')).toHaveStyle({
        backgroundImage: 'url(blob:custom-atlas)',
      });
    });

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:custom-atlas');
  });

  it('keeps the floppy atlas when a custom cache read fails', async () => {
    getAtlas.mockRejectedValue(new Error('IndexedDB unavailable'));
    render(
      <CompanionSprite
        companionId="custom:$sprite:test"
        atlasCacheKey="!gallery:test\u0000$sprite:test"
        row={1}
        badges={{ muted: false, live: false }}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('companion-sprite').style.backgroundImage).toContain('Floppy');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('renders floppy immediately when a resolved custom companion changes to floppy', async () => {
    getAtlas.mockResolvedValue(new Blob(['atlas'], { type: 'image/webp' }));
    const view = render(
      <CompanionSprite
        companionId="custom:$sprite:test"
        atlasCacheKey="!gallery:test\u0000$sprite:test"
        row={1}
        badges={{ muted: false, live: false }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('companion-sprite')).toHaveStyle({
        backgroundImage: 'url(blob:custom-atlas)',
      });
    });

    view.rerender(
      <CompanionSprite
        companionId="floppy"
        row={1}
        badges={{ muted: false, live: false }}
      />,
    );

    expect(screen.getByTestId('companion-sprite').style.backgroundImage).toContain('Floppy');
  });

  it('renders floppy immediately while loading a replacement custom atlas', async () => {
    getAtlas.mockResolvedValue(new Blob(['atlas'], { type: 'image/webp' }));
    const view = render(
      <CompanionSprite
        companionId="custom:$first:test"
        atlasCacheKey="!gallery:test\u0000$first:test"
        row={1}
        badges={{ muted: false, live: false }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('companion-sprite')).toHaveStyle({
        backgroundImage: 'url(blob:custom-atlas)',
      });
    });

    getAtlas.mockImplementationOnce(() => new Promise<Blob>(() => undefined));

    view.rerender(
      <CompanionSprite
        companionId="custom:$second:test"
        atlasCacheKey="!gallery:test\u0000$second:test"
        row={1}
        badges={{ muted: false, live: false }}
      />,
    );

    expect(screen.getByTestId('companion-sprite').style.backgroundImage).toContain('Floppy');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:custom-atlas');
  });
});
