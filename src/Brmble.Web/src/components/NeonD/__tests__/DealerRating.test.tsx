import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DealerRating } from '../DealerRating';
import { getDealerStarRating } from '../DealerRating.utils';

describe('getDealerStarRating', () => {
  it.each([
    [0.5, 1],
    [0.75, 1],
    [1.3, 1],
    [1.5, 2],
    [1.6, 2],
  ])('rounds %s multiplier to %s whole stars', (multiplier, expected) => {
    expect(getDealerStarRating(multiplier)).toBe(expected);
  });

  it('clamps malformed out-of-range values to the visible scale', () => {
    expect(getDealerStarRating(0)).toBe(0);
    expect(getDealerStarRating(5)).toBe(5);
  });
});

describe('DealerRating', () => {
  it('exposes the exact multiplier through its label and title', () => {
    render(<DealerRating label="Volume" multiplier={1.3} />);

    const rating = screen.getByRole('img', { name: 'Volume: 1.30x' });
    expect(rating).toHaveAttribute('title', 'Volume: 1.30x');
    expect(rating.querySelectorAll('[data-star-state="full"]')).toHaveLength(1);
    expect(rating.querySelectorAll('[data-star-state="half"]')).toHaveLength(0);
  });
});
