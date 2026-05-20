import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { prompt, usePrompt } from './usePrompt';

function PromptHarness() {
  const { PromptWithInput } = usePrompt();

  return <PromptWithInput />;
}

describe('usePrompt input prompts', () => {
  it('renders password prompts with the shared icon reveal pattern', async () => {
    render(<PromptHarness />);

    let result!: Promise<string | null>;
    await act(async () => {
      result = prompt({
        title: 'Channel Password',
        message: 'Enter the password.',
        placeholder: 'Password',
        confirmLabel: 'Join',
        isPassword: true,
      });
    });

    const input = await screen.findByPlaceholderText('Password');

    expect(screen.queryByRole('button', { name: 'Show password' })).not.toBeInTheDocument();

    fireEvent.focus(input);

    const toggle = screen.getByRole('button', { name: 'Show password' });

    expect(toggle).not.toHaveAttribute('title');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toContainHTML('svg');
    expect(toggle).not.toHaveTextContent(/show/i);
    expect(input).toHaveAttribute('type', 'password');

    fireEvent.mouseDown(toggle);

    expect(input).toHaveAttribute('type', 'text');
    const hideToggle = screen.getByRole('button', { name: 'Hide password' });
    expect(hideToggle).not.toHaveAttribute('title');
    expect(hideToggle).toHaveAttribute('aria-pressed', 'true');
    expect(hideToggle).toContainHTML('svg');
    expect(hideToggle).not.toHaveTextContent(/hide/i);

    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await expect(result).resolves.toBe('');
  });
});
