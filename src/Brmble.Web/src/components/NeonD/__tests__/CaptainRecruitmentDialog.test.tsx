import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CaptainRecruitmentDialog } from '../CaptainRecruitmentDialog';

describe('CaptainRecruitmentDialog', () => {
  it('starts with the generated default and confirms a trimmed name', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <CaptainRecruitmentDialog
        defaultName="Captain 2"
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Captain name' });
    expect(input).toHaveValue('Captain 2');

    await user.clear(input);
    await user.type(input, '  Nightshade  ');
    await user.click(screen.getByRole('button', { name: 'Confirm Captain name' }));

    expect(onConfirm).toHaveBeenCalledWith('Nightshade');
  });

  it('disables confirmation for a whitespace-only name', async () => {
    const user = userEvent.setup();

    render(
      <CaptainRecruitmentDialog
        defaultName="Captain 2"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Captain name' });
    await user.clear(input);
    await user.type(input, '   ');

    expect(screen.getByRole('button', { name: 'Confirm Captain name' })).toBeDisabled();
  });

  it('closes without confirming when cancelled or escaped', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <CaptainRecruitmentDialog
        defaultName="Captain 2"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Cancel Captain naming' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('keeps the input selection and focus stable when the parent rerenders', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const firstOnClose = vi.fn();
    const { rerender } = render(
      <CaptainRecruitmentDialog
        defaultName="Captain 2"
        onConfirm={onConfirm}
        onClose={firstOnClose}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Captain name' });
    await user.clear(input);
    await user.type(input, 'Night');

    rerender(
      <CaptainRecruitmentDialog
        defaultName="Captain 2"
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    await user.keyboard('shade');

    expect(input).toHaveValue('Nightshade');
    expect(document.activeElement).toBe(input);
  });
});
