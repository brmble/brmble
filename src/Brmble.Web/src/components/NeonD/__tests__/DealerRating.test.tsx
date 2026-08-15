import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DealerRating } from '../DealerRating';
import { getDealerStarRating } from '../DealerRating.utils';

describe('getDealerStarRating', () => {
  it.each([
    [0.5, 1],
    [0.625, 2],
    [0.75, 2],
    [1.0, 3],
    [1.25, 4],
    [1.3, 4],
    [1.5, 5],
    [1.75, 6],
  ])('maps %s multiplier to %s whole stars', (multiplier, expected) => {
    expect(getDealerStarRating(multiplier)).toBe(expected);
  });

  it('clamps malformed out-of-range values to the visible scale', () => {
    expect(getDealerStarRating(0)).toBe(1);
    expect(getDealerStarRating(2)).toBe(6);
  });
});

describe('DealerRating', () => {
  it('exposes the exact multiplier through its label and title', () => {
    render(<DealerRating label="Volume" multiplier={1.3} />);

    const rating = screen.getByRole('img', { name: 'Volume: 1.30x' });
    expect(rating).toHaveAttribute('title', 'Volume: 1.30x');
    expect(rating.querySelectorAll('[data-star-state="full"]')).toHaveLength(4);
    expect(rating.querySelectorAll('[data-star-state="half"]')).toHaveLength(0);
  });

  it('renders six full stars for the Captain maximum multiplier', () => {
    render(<DealerRating label="Volume" multiplier={1.75} />);

    const rating = screen.getByRole('img', { name: 'Volume: 1.75x' });
    expect(rating.querySelectorAll('[data-star-state="full"]')).toHaveLength(6);
  });
});
