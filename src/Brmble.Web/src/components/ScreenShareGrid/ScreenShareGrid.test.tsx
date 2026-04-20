import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScreenShareGrid } from './ScreenShareGrid';
import type { ShareInfo } from '../../hooks/useScreenShare';

const makeShare = (userId: number, name: string): ShareInfo => ({
  roomName: 'channel-1',
  userName: name,
  userId,
});

const makeVideoMap = (userIds: number[]) => {
  const map = new Map<number, HTMLVideoElement>();
  for (const id of userIds) {
    map.set(id, document.createElement('video'));
  }
  return map;
};

describe('ScreenShareGrid', () => {
  it('renders single layout for 1 stream', () => {
    const shares = [makeShare(1, 'Alice')];
    const { container } = render(
      <ScreenShareGrid
        watchingShares={shares}
        focusedShare={null}
        videoElements={makeVideoMap([1])}
        onFocus={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(container.querySelector('[data-layout="single"]')).toBeTruthy();
  });

  it('renders grid-2 layout for 2 streams', () => {
    const shares = [makeShare(1, 'Alice'), makeShare(2, 'Bob')];
    const { container } = render(
      <ScreenShareGrid
        watchingShares={shares}
        focusedShare={null}
        videoElements={makeVideoMap([1, 2])}
        onFocus={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(container.querySelector('[data-layout="grid-2"]')).toBeTruthy();
  });

  it('renders grid-4 layout for 4 streams', () => {
    const shares = [makeShare(1, 'A'), makeShare(2, 'B'), makeShare(3, 'C'), makeShare(4, 'D')];
    const { container } = render(
      <ScreenShareGrid
        watchingShares={shares}
        focusedShare={null}
        videoElements={makeVideoMap([1, 2, 3, 4])}
        onFocus={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(container.querySelector('[data-layout="grid-4"]')).toBeTruthy();
  });

  it('renders focused layout when focusedShare is set', () => {
    const shares = [makeShare(1, 'Alice'), makeShare(2, 'Bob'), makeShare(3, 'Charlie')];
    const { container } = render(
      <ScreenShareGrid
        watchingShares={shares}
        focusedShare={shares[0]}
        videoElements={makeVideoMap([1, 2, 3])}
        onFocus={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(container.querySelector('[data-layout="focused-3"]')).toBeTruthy();
  });

  it('calls onFocus with share when tile is clicked in grid mode', () => {
    const onFocus = vi.fn();
    const shares = [makeShare(1, 'Alice'), makeShare(2, 'Bob')];
    render(
      <ScreenShareGrid
        watchingShares={shares}
        focusedShare={null}
        videoElements={makeVideoMap([1, 2])}
        onFocus={onFocus}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getAllByTestId('screen-share-tile')[0]);
    expect(onFocus).toHaveBeenCalledWith(shares[0]);
  });

  it('calls onFocus(null) when focused tile is clicked again', () => {
    const onFocus = vi.fn();
    const shares = [makeShare(1, 'Alice'), makeShare(2, 'Bob')];
    render(
      <ScreenShareGrid
        watchingShares={shares}
        focusedShare={shares[0]}
        videoElements={makeVideoMap([1, 2])}
        onFocus={onFocus}
        onClose={vi.fn()}
      />
    );
    // Click the focused tile (first one rendered in focused mode)
    fireEvent.click(screen.getAllByTestId('screen-share-tile')[0]);
    expect(onFocus).toHaveBeenCalledWith(null);
  });

  it('calls onFocus with new share when thumbnail is clicked in focused mode', () => {
    const onFocus = vi.fn();
    const shares = [makeShare(1, 'Alice'), makeShare(2, 'Bob')];
    render(
      <ScreenShareGrid
        watchingShares={shares}
        focusedShare={shares[0]}
        videoElements={makeVideoMap([1, 2])}
        onFocus={onFocus}
        onClose={vi.fn()}
      />
    );
    // Click the thumbnail (second tile)
    fireEvent.click(screen.getAllByTestId('screen-share-tile')[1]);
    expect(onFocus).toHaveBeenCalledWith(shares[1]);
  });

  it('renders nothing when watchingShares is empty', () => {
    const { container } = render(
      <ScreenShareGrid
        watchingShares={[]}
        focusedShare={null}
        videoElements={new Map()}
        onFocus={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(container.querySelector('.screen-share-grid')).toBeNull();
  });
});
