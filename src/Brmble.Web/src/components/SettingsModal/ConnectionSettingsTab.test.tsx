import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionSettingsTab, DEFAULT_CONNECTION } from './ConnectionSettingsTab';

describe('ConnectionSettingsTab', () => {
  it('does not render plain inline server help text', () => {
    render(<ConnectionSettingsTab settings={DEFAULT_CONNECTION} onChange={vi.fn()} servers={[]} />);

    expect(screen.queryByText("You can also choose a specific server once you've added one.")).not.toBeInTheDocument();
  });
});
