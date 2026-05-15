import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScreenShareTile } from './ScreenShareTile';

describe('ScreenShareTile', () => {
  const createVideoEl = () => {
    const el = document.createElement('video');
    return el;
  };

  it('renders sharer name', () => {
    render(<ScreenShareTile videoEl={createVideoEl()} sharerName="Alice" isFocused={false} isThumbnail={false} onClick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("Alice's screen")).toBeTruthy();
  });

  it('calls onClick when tile is clicked', () => {
    const onClick = vi.fn();
    render(<ScreenShareTile videoEl={createVideoEl()} sharerName="Alice" isFocused={false} isThumbnail={false} onClick={onClick} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('screen-share-tile'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<ScreenShareTile videoEl={createVideoEl()} sharerName="Alice" isFocused={false} isThumbnail={false} onClick={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Stop watching'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not propagate close click to tile onClick', () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    render(<ScreenShareTile videoEl={createVideoEl()} sharerName="Alice" isFocused={false} isThumbnail={false} onClick={onClick} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Stop watching'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('adds focused class when isFocused is true', () => {
    render(<ScreenShareTile videoEl={createVideoEl()} sharerName="Alice" isFocused={true} isThumbnail={false} onClick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('screen-share-tile').classList.contains('screen-share-tile--focused')).toBe(true);
  });

  it('adds thumbnail class when isThumbnail is true', () => {
    render(<ScreenShareTile videoEl={createVideoEl()} sharerName="Alice" isFocused={false} isThumbnail={true} onClick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('screen-share-tile').classList.contains('screen-share-tile--thumbnail')).toBe(true);
  });

  it('shows reconnecting overlay while keeping the tile mounted', () => {
    render(<ScreenShareTile videoEl={createVideoEl()} sharerName="Alice" isFocused={false} isThumbnail={false} quality="reconnecting" onClick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('screen-share-tile')).toBeTruthy();
    expect(screen.getByText('Reconnecting...')).toBeTruthy();
  });

  it('shows poor connection badge', () => {
    render(<ScreenShareTile videoEl={createVideoEl()} sharerName="Alice" isFocused={false} isThumbnail={false} quality="poor" onClick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Poor connection')).toBeTruthy();
  });
});
