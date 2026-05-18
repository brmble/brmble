import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { prompt, usePrompt } from './usePrompt';

function PromptHarness() {
  const { PromptWithInput } = usePrompt();

  return <PromptWithInput />;
}

describe('usePrompt input prompts', () => {
  it('renders password prompts without native title tooltips', async () => {
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

    const toggle = await screen.findByRole('button', { name: 'Show password' });

    expect(toggle).not.toHaveAttribute('title');
    expect(screen.getByPlaceholderText('Password')).toHaveAttribute('type', 'password');

    fireEvent.click(toggle);

    expect(screen.getByPlaceholderText('Password')).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).not.toHaveAttribute('title');

    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await expect(result).resolves.toBe('');
  });
});
