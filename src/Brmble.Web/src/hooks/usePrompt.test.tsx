import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { confirm, prompt, promptPassword, usePrompt } from './usePrompt';
import type { PasswordPromptResult } from './usePrompt';

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

  it('cancels a pending password prompt before opening a confirmation', async () => {
    render(<PromptHarness />);

    let passwordResult!: Promise<PasswordPromptResult | null>;
    await act(async () => {
      passwordResult = promptPassword({
        title: 'Channel Password',
        message: 'Enter the password.',
      });
    });

    let confirmationResult!: Promise<boolean>;
    await act(async () => {
      confirmationResult = confirm({
        title: 'Continue?',
        message: 'Confirm the next action.',
      });
    });

    let settledPasswordResult: PasswordPromptResult | null | 'pending' = 'pending';
    void passwordResult.then(result => {
      settledPasswordResult = result;
    });
    await act(async () => Promise.resolve());

    try {
      expect(settledPasswordResult).toBeNull();
      expect(screen.getByRole('heading', { name: 'Continue?' })).toBeInTheDocument();
    } finally {
      fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]);
      await expect(confirmationResult).resolves.toBe(false);
    }
  });
});

describe('usePrompt input prompts', () => {
  it('prefills a password prompt from its active options', async () => {
    render(<PromptHarness />);

    await act(async () => {
      void promptPassword({
        title: 'Channel Password',
        message: 'Enter the password.',
        placeholder: 'Password',
        defaultValue: 'saved-password',
      });
    });

    expect(screen.getByPlaceholderText('Password')).toHaveValue('saved-password');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('reinitializes input and remember state when a password prompt replaces another', async () => {
    render(<PromptHarness />);

    let firstResult!: Promise<PasswordPromptResult | null>;
    await act(async () => {
      firstResult = promptPassword({
        title: 'First Channel',
        message: 'Enter the first password.',
        placeholder: 'Password',
        defaultValue: 'first-password',
        rememberLabel: 'Remember password',
        rememberDefaultChecked: true,
      });
    });

    await act(async () => {
      void promptPassword({
        title: 'Second Channel',
        message: 'Enter the second password.',
        placeholder: 'Password',
        defaultValue: 'second-password',
        rememberLabel: 'Remember password',
        rememberDefaultChecked: false,
      });
    });

    await expect(firstResult).resolves.toBeNull();
    expect(screen.getByPlaceholderText('Password')).toHaveValue('second-password');
    expect(screen.getByRole('checkbox', { name: 'Remember password' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('returns the password and remember choice', async () => {
    const user = userEvent.setup();
    render(<PromptHarness />);

    let result!: Promise<PasswordPromptResult | null>;
    await act(async () => {
      result = promptPassword({
        title: 'Channel Password',
        message: 'Enter the password.',
        placeholder: 'Password',
        confirmLabel: 'Join channel',
        rememberLabel: 'Remember this password',
        rememberDefaultChecked: true,
        isPassword: true,
      });
    });

    const input = screen.getByPlaceholderText('Password');
    const remember = screen.getByRole('checkbox', { name: 'Remember this password' });
    expect(remember).toBeChecked();
    await user.clear(input);
    await user.type(input, 'secret-token');
    await user.click(remember);
    await user.click(screen.getByRole('button', { name: 'Join channel' }));

    await expect(result).resolves.toEqual({ password: 'secret-token', remember: false });
  });

  it('returns null when the password prompt is canceled', async () => {
    render(<PromptHarness />);

    let result!: Promise<PasswordPromptResult | null>;
    await act(async () => {
      result = promptPassword({
        title: 'Channel Password',
        message: 'Enter the password.',
        rememberLabel: 'Remember this password',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(result).resolves.toBeNull();
  });

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
