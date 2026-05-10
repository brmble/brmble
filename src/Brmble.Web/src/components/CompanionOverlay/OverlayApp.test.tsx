import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OverlayApp } from './OverlayApp';

describe('OverlayApp', () => {
  it('renders nothing when the overlay is disabled', () => {
    render(<OverlayApp initialState={{ enabled: false, mode: 'minimal', settings: null, snapshot: null }} />);
    expect(screen.queryByTestId('companion-overlay-root')).toBeNull();
  });
});
