import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Select } from './Select';

// jsdom doesn't implement scrollIntoView
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Charlie' },
];

describe('Select', () => {
  it('renders the selected option label', () => {
    render(<Select value="b" onChange={() => {}} options={options} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Beta');
  });

  it('renders placeholder when no option matches value', () => {
    render(<Select value="" onChange={() => {}} options={options} placeholder="Pick one" />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Pick one');
  });

  it('opens dropdown on click', () => {
    render(<Select value="a" onChange={() => {}} options={options} />);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('does not open when disabled', () => {
    render(<Select value="a" onChange={() => {}} options={options} disabled />);
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('does not open when options is empty', () => {
    render(<Select value="" onChange={() => {}} options={[]} placeholder="None" />);
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('calls onChange and closes on option click', () => {
    const onChange = vi.fn();
    render(<Select value="a" onChange={onChange} options={options} />);

    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByText('Charlie'));

    expect(onChange).toHaveBeenCalledWith('c');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes on Escape key', () => {
    render(<Select value="a" onChange={() => {}} options={options} />);
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes on click outside', () => {
    render(<Select value="a" onChange={() => {}} options={options} />);
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes on Tab key', () => {
    render(<Select value="a" onChange={() => {}} options={options} />);
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  describe('keyboard navigation', () => {
    it('navigates with ArrowDown and ArrowUp', () => {
      const onChange = vi.fn();
      render(<Select value="a" onChange={onChange} options={options} />);
      fireEvent.click(screen.getByRole('combobox'));
      const opts = screen.getAllByRole('option');

      // Initially highlights the selected option (index 0 = Alpha)
      expect(opts[0]).toHaveClass('brmble-select-option--highlighted');

      // ArrowDown moves to Beta
      fireEvent.keyDown(document, { key: 'ArrowDown' });
      expect(opts[1]).toHaveClass('brmble-select-option--highlighted');

      // ArrowDown moves to Charlie
      fireEvent.keyDown(document, { key: 'ArrowDown' });
      expect(opts[2]).toHaveClass('brmble-select-option--highlighted');

      // ArrowDown wraps to Alpha
      fireEvent.keyDown(document, { key: 'ArrowDown' });
      expect(opts[0]).toHaveClass('brmble-select-option--highlighted');

      // ArrowUp wraps to Charlie
      fireEvent.keyDown(document, { key: 'ArrowUp' });
      expect(opts[2]).toHaveClass('brmble-select-option--highlighted');
    });

    it('navigates with Home and End', () => {
      render(<Select value="b" onChange={() => {}} options={options} />);
      fireEvent.click(screen.getByRole('combobox'));
      const opts = screen.getAllByRole('option');

      // Starts on Beta (index 1)
      expect(opts[1]).toHaveClass('brmble-select-option--highlighted');

      // Home jumps to first
      fireEvent.keyDown(document, { key: 'Home' });
      expect(opts[0]).toHaveClass('brmble-select-option--highlighted');

      // End jumps to last
      fireEvent.keyDown(document, { key: 'End' });
      expect(opts[2]).toHaveClass('brmble-select-option--highlighted');
    });

    it('selects with Enter', () => {
      const onChange = vi.fn();
      render(<Select value="a" onChange={onChange} options={options} />);
      fireEvent.click(screen.getByRole('combobox'));

      fireEvent.keyDown(document, { key: 'ArrowDown' }); // Beta
      fireEvent.keyDown(document, { key: 'Enter' });

      expect(onChange).toHaveBeenCalledWith('b');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('selects with Space', () => {
      const onChange = vi.fn();
      render(<Select value="a" onChange={onChange} options={options} />);
      fireEvent.click(screen.getByRole('combobox'));

      fireEvent.keyDown(document, { key: 'ArrowDown' }); // Beta
      fireEvent.keyDown(document, { key: ' ' });

      expect(onChange).toHaveBeenCalledWith('b');
    });

    it('supports type-ahead to jump to matching option', () => {
      render(<Select value="a" onChange={() => {}} options={options} />);
      fireEvent.click(screen.getByRole('combobox'));

      fireEvent.keyDown(document, { key: 'c' });
      expect(screen.getByText('Charlie').closest('[role="option"]')).toHaveClass('brmble-select-option--highlighted');

      fireEvent.keyDown(document, { key: 'b' });
      expect(screen.getByText('Beta').closest('[role="option"]')).toHaveClass('brmble-select-option--highlighted');
    });

    it('opens with ArrowDown on closed trigger', () => {
      render(<Select value="a" onChange={() => {}} options={options} />);
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
  });

  describe('ARIA attributes', () => {
    it('sets aria-expanded correctly', () => {
      render(<Select value="a" onChange={() => {}} options={options} />);
      const trigger = screen.getByRole('combobox');

      expect(trigger).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
    });

    it('marks selected option with aria-selected', () => {
      render(<Select value="b" onChange={() => {}} options={options} />);
      fireEvent.click(screen.getByRole('combobox'));

      const opts = screen.getAllByRole('option');
      expect(opts[0]).toHaveAttribute('aria-selected', 'false'); // Alpha
      expect(opts[1]).toHaveAttribute('aria-selected', 'true');  // Beta
      expect(opts[2]).toHaveAttribute('aria-selected', 'false'); // Charlie
    });

    it('sets aria-activedescendant on trigger when open', () => {
      render(<Select value="a" onChange={() => {}} options={options} />);
      const trigger = screen.getByRole('combobox');

      expect(trigger).not.toHaveAttribute('aria-activedescendant');

      fireEvent.click(trigger);
      // Should point to the highlighted option's id
      const highlighted = screen.getAllByRole('option')[0];
      expect(trigger).toHaveAttribute('aria-activedescendant', highlighted.id);
    });
  });

  it('highlights option on mouse enter', () => {
    render(<Select value="a" onChange={() => {}} options={options} />);
    fireEvent.click(screen.getByRole('combobox'));

    const charlieOption = screen.getByText('Charlie').closest('[role="option"]')!;
    fireEvent.mouseEnter(charlieOption);
    expect(charlieOption).toHaveClass('brmble-select-option--highlighted');
  });

  it('toggles open/close on repeated trigger clicks', () => {
    render(<Select value="a" onChange={() => {}} options={options} />);
    const trigger = screen.getByRole('combobox');

    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
