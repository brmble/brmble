import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { VerticalSplitPane } from './VerticalSplitPane';

function Harness() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  return (
    <>
      <button type="button" onClick={() => setOpen(value => !value)}>
        Toggle top
      </button>
      <VerticalSplitPane
        top={open ? <section aria-label="Upper pane">Paint</section> : null}
        storageKey="vertical-split-test"
        label="Resize paint and channel chat"
      >
        <input
          aria-label="Chat draft"
          value={draft}
          onChange={event => setDraft(event.target.value)}
        />
      </VerticalSplitPane>
    </>
  );
}

describe('VerticalSplitPane', () => {
  it('keeps the lower pane mounted while toggling the upper pane', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const draft = screen.getByLabelText('Chat draft');
    await user.type(draft, 'draft survives');

    await user.click(screen.getByRole('button', { name: 'Toggle top' }));

    expect(await screen.findByLabelText('Upper pane')).toBeInTheDocument();
    expect(screen.getByLabelText('Chat draft')).toBe(draft);
    expect(draft).toHaveValue('draft survives');

    await user.click(screen.getByRole('button', { name: 'Toggle top' }));

    expect(screen.queryByLabelText('Upper pane')).toBeNull();
    expect(screen.getByLabelText('Chat draft')).toBe(draft);
    expect(draft).toHaveValue('draft survives');
  });

  it('supports keyboard resizing and stores the split size', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Toggle top' }));
    const divider = screen.getByRole('separator', { name: 'Resize paint and channel chat' });
    divider.focus();
    await user.keyboard('{ArrowUp}{ArrowDown}');

    expect(divider).toHaveAttribute('aria-orientation', 'horizontal');
    expect(setItem).toHaveBeenCalledWith('vertical-split-test', expect.any(String));
  });
});
