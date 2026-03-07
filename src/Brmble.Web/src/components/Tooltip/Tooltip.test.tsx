import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders children without tooltip initially', () => {
    render(
      <Tooltip content="Help text">
        <button>Hover me</button>
      </Tooltip>
    );
    expect(screen.getByText('Hover me')).toBeInTheDocument();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows tooltip after hover delay', () => {
    render(
      <Tooltip content="Help text" delay={200}>
        <button>Hover me</button>
      </Tooltip>
    );

    fireEvent.mouseEnter(screen.getByText('Hover me'));

    // Tooltip should not appear before the delay
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Help text');
  });

  it('uses default 400ms delay', () => {
    render(
      <Tooltip content="Help text">
        <button>Hover me</button>
      </Tooltip>
    );

    fireEvent.mouseEnter(screen.getByText('Hover me'));

    // Not visible at 399ms
    act(() => { vi.advanceTimersByTime(399); });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    // Visible at 400ms
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Help text');
  });

  it('hides tooltip on mouse leave', () => {
    render(
      <Tooltip content="Help text" delay={0}>
        <button>Hover me</button>
      </Tooltip>
    );

    fireEvent.mouseEnter(screen.getByText('Hover me'));
    act(() => { vi.advanceTimersByTime(0); });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByText('Hover me'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('cancels pending tooltip on mouse leave before delay completes', () => {
    render(
      <Tooltip content="Help text" delay={200}>
        <button>Hover me</button>
      </Tooltip>
    );

    fireEvent.mouseEnter(screen.getByText('Hover me'));

    // Leave before the delay fires
    fireEvent.mouseLeave(screen.getByText('Hover me'));

    // Advance past the delay — tooltip should never appear
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('renders nothing extra when content is empty', () => {
    render(
      <Tooltip content="">
        <button>Hover me</button>
      </Tooltip>
    );
    expect(screen.getByText('Hover me')).toBeInTheDocument();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('preserves existing onClick handler on children', () => {
    const handleClick = vi.fn();
    render(
      <Tooltip content="Help text" delay={0}>
        <button onClick={handleClick}>Click me</button>
      </Tooltip>
    );

    fireEvent.click(screen.getByText('Click me'));
    expect(handleClick).toHaveBeenCalledOnce();
  });

  it('preserves existing onMouseEnter handler on children', () => {
    const handleMouseEnter = vi.fn();
    render(
      <Tooltip content="Help text" delay={0}>
        <button onMouseEnter={handleMouseEnter}>Hover me</button>
      </Tooltip>
    );

    fireEvent.mouseEnter(screen.getByText('Hover me'));
    expect(handleMouseEnter).toHaveBeenCalledOnce();

    // Tooltip should still work alongside the child's handler
    act(() => { vi.advanceTimersByTime(0); });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('preserves existing onMouseLeave handler on children', () => {
    const handleMouseLeave = vi.fn();
    render(
      <Tooltip content="Help text" delay={0}>
        <button onMouseLeave={handleMouseLeave}>Hover me</button>
      </Tooltip>
    );

    fireEvent.mouseEnter(screen.getByText('Hover me'));
    act(() => { vi.advanceTimersByTime(0); });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByText('Hover me'));
    expect(handleMouseLeave).toHaveBeenCalledOnce();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('dismisses tooltip on Escape key', () => {
    render(
      <Tooltip content="Help text" delay={0}>
        <button>Hover me</button>
      </Tooltip>
    );

    fireEvent.mouseEnter(screen.getByText('Hover me'));
    act(() => { vi.advanceTimersByTime(0); });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    // The component listens on document for keydown
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('links trigger and tooltip via aria-describedby', () => {
    render(
      <Tooltip content="Help text" delay={0}>
        <button>Hover me</button>
      </Tooltip>
    );

    // No aria-describedby when tooltip is hidden
    expect(screen.getByText('Hover me')).not.toHaveAttribute('aria-describedby');

    fireEvent.mouseEnter(screen.getByText('Hover me'));
    act(() => { vi.advanceTimersByTime(0); });

    // aria-describedby should match the tooltip's id
    const trigger = screen.getByText('Hover me');
    const tooltip = screen.getByRole('tooltip');
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id);
  });

  it('has role="tooltip" on the tooltip element', () => {
    render(
      <Tooltip content="Help text" delay={0}>
        <button>Hover me</button>
      </Tooltip>
    );

    fireEvent.mouseEnter(screen.getByText('Hover me'));
    act(() => { vi.advanceTimersByTime(0); });

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Help text');
  });
});
