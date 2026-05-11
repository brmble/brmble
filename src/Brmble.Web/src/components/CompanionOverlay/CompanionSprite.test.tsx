import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CompanionSprite } from './CompanionSprite';

describe('CompanionSprite', () => {
  it('renders row-aware playback metadata for a 6-frame row', () => {
    render(
      <CompanionSprite
        companionId="kirito"
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
        companionId="kirito"
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
});
