import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsHelp } from './SettingsHelp';

describe('SettingsHelp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders an accessible question-mark help button with tooltip content', () => {
    render(<SettingsHelp content="Higher quality uses more bandwidth" label="More information about quality" />);

    const button = screen.getByRole('button', { name: 'More information about quality' });
    expect(button).toHaveTextContent('?');
    expect(button).toHaveClass('settings-info-btn');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.focus(button);
    act(() => { vi.advanceTimersByTime(400); });

    expect(screen.getByRole('tooltip')).toHaveTextContent('Higher quality uses more bandwidth');
  });
});
