import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DealerRating } from '../DealerRating';
import { getDealerStarRating } from '../DealerRating.utils';

describe('getDealerStarRating', () => {
  it.each([
    [0.5, 1],
    [0.75, 2],
    [1, 3],
    [1.25, 4],
    [1.5, 5],
  ])('maps %s multiplier to %s stars', (multiplier, expected) => {
    expect(getDealerStarRating(multiplier)).toBe(expected);
  });

  it('clamps malformed out-of-range values to the visible scale', () => {
    expect(getDealerStarRating(0)).toBe(1);
    expect(getDealerStarRating(2)).toBe(5);
  });
});

describe('DealerRating', () => {
  it('exposes the exact multiplier through its label and title', () => {
    render(<DealerRating label="Volume" multiplier={1.125} />);

    const rating = screen.getByRole('img', { name: 'Volume: 1.13x' });
    expect(rating).toHaveAttribute('title', 'Volume: 1.13x');
    expect(rating.querySelectorAll('[data-star-state="full"]')).toHaveLength(3);
    expect(rating.querySelector('[data-star-state="half"]')).not.toBeNull();
  });
});
