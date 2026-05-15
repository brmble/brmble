import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UserPanel } from './UserPanel';

describe('UserPanel', () => {
  it('runs the screen share action on a normal click', () => {
    const onToggleScreenShare = vi.fn();

    const { container } = render(
      <UserPanel
        username="alice"
        onOpenSettings={vi.fn()}
        onToggleScreenShare={onToggleScreenShare}
        canScreenShare={true}
      />
    );

    const button = container.querySelector('.screen-share-btn');
    expect(button).not.toBeNull();

    fireEvent.click(button!);

    expect(onToggleScreenShare).toHaveBeenCalledTimes(1);
  });

  it('runs the screen share action on keyboard activation', () => {
    const onToggleScreenShare = vi.fn();

    const { container } = render(
      <UserPanel
        username="alice"
        onOpenSettings={vi.fn()}
        onToggleScreenShare={onToggleScreenShare}
        canScreenShare={true}
      />
    );

    const button = container.querySelector('.screen-share-btn');
    expect(button).not.toBeNull();

    fireEvent.keyDown(button!, { key: 'Enter' });
    fireEvent.keyUp(button!, { key: 'Enter' });

    expect(onToggleScreenShare).toHaveBeenCalledTimes(1);
  });
});
