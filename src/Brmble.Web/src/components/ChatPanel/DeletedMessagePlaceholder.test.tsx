import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DeletedMessagePlaceholder } from './DeletedMessagePlaceholder';

describe('DeletedMessagePlaceholder', () => {
  it('renders provided text accessibly', () => {
    render(<DeletedMessagePlaceholder text="This message was deleted" />);
    expect(screen.getByLabelText('This message was deleted')).toBeInTheDocument();
  });
});
