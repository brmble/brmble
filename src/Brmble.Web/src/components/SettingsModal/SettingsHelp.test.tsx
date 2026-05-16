import { act, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsHelp } from './SettingsHelp';

const settingsModalCss = readFileSync('src/components/SettingsModal/SettingsModal.css', 'utf-8');

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

  it('uses a 24px hit target for the help button', () => {
    expect(settingsModalCss).toMatch(/--settings-help-hit-size:\s*var\(--space-lg\);/);
    expect(settingsModalCss).toMatch(/\.settings-info-btn\s*{[^}]*width:\s*var\(--settings-help-hit-size\);/s);
    expect(settingsModalCss).toMatch(/\.settings-info-btn\s*{[^}]*height:\s*var\(--settings-help-hit-size\);/s);
  });

  it('keeps the visible mark compact inside the larger hit target', () => {
    render(<SettingsHelp content="Higher quality uses more bandwidth" label="More information about quality" />);

    expect(screen.getByText('?')).toHaveClass('settings-info-mark');
    expect(settingsModalCss).toMatch(/--settings-help-mark-size:\s*calc\(var\(--space-md\) \+ var\(--space-2xs\)\);/);
    expect(settingsModalCss).toMatch(/\.settings-info-mark\s*{[^}]*width:\s*var\(--settings-help-mark-size\);/s);
    expect(settingsModalCss).toMatch(/\.settings-info-mark\s*{[^}]*height:\s*var\(--settings-help-mark-size\);/s);
    expect(settingsModalCss).toMatch(/\.settings-info-mark\s*{[^}]*font-size:\s*var\(--text-xs\);/s);
  });
});
