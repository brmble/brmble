import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { confirm, prompt, usePrompt } from './usePrompt';

function PromptHarness() {
  const { Prompt, PromptWithInput } = usePrompt();

  return (
    <>
      <Prompt />
      <PromptWithInput />
    </>
  );
}

describe('usePrompt confirmations', () => {
  it('renders rich content and a danger confirmation action', async () => {
    const user = userEvent.setup();
    render(<PromptHarness />);

    let decision!: Promise<boolean>;
    await act(async () => {
      decision = confirm({
        title: 'Remove custom companion?',
        message: 'This removes the sprite for everyone on this server.',
        content: <img alt="Orbit preview" src="blob:orbit" />,
        confirmLabel: 'Remove',
        destructive: true,
      });
    });

    expect(screen.getByRole('img', { name: 'Orbit preview' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveClass('btn-danger');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(decision).resolves.toBe(false);
  });
});

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
