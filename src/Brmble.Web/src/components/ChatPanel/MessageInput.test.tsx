import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageInput } from './MessageInput';

afterEach(() => {
  vi.useRealTimers();
});

describe('MessageInput typing callbacks', () => {
  it('emits start typing when the draft becomes non-empty', () => {
    const onTypingChange = vi.fn();
    render(<MessageInput onSend={vi.fn()} onTypingChange={onTypingChange} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'h' } });

    expect(onTypingChange).toHaveBeenCalledWith(true);
  });

  it('emits stop typing when the draft is cleared after typing', () => {
    const onTypingChange = vi.fn();
    render(<MessageInput onSend={vi.fn()} onTypingChange={onTypingChange} />);

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.change(input, { target: { value: '' } });

    expect(onTypingChange).toHaveBeenNthCalledWith(1, true);
    expect(onTypingChange).toHaveBeenNthCalledWith(2, false);
  });

  it('emits stop typing when send succeeds', () => {
    const onTypingChange = vi.fn();
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} onTypingChange={onTypingChange} />);

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('hello', undefined);
    expect(onTypingChange).toHaveBeenLastCalledWith(false);
  });

  it('does not emit stop typing when the parent rerenders while the draft is still non-empty', () => {
    const onSend = vi.fn();
    const firstTypingChange = vi.fn();
    const secondTypingChange = vi.fn();
    const { rerender } = render(<MessageInput onSend={onSend} onTypingChange={firstTypingChange} />);

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'hello' } });

    rerender(<MessageInput onSend={onSend} onTypingChange={secondTypingChange} />);

    expect(firstTypingChange).toHaveBeenCalledTimes(1);
    expect(firstTypingChange).toHaveBeenCalledWith(true);
    expect(firstTypingChange).not.toHaveBeenCalledWith(false);
    expect(secondTypingChange).not.toHaveBeenCalled();
  });

  it('emits stop typing after 10 seconds of draft inactivity', () => {
    vi.useFakeTimers();

    const onTypingChange = vi.fn();
    render(<MessageInput onSend={vi.fn()} onTypingChange={onTypingChange} />);

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'hello' } });
    vi.advanceTimersByTime(9_000);

    expect(onTypingChange).toHaveBeenCalledTimes(1);
    expect(onTypingChange).toHaveBeenLastCalledWith(true);

    vi.advanceTimersByTime(1_000);

    expect(onTypingChange).toHaveBeenCalledTimes(2);
    expect(onTypingChange).toHaveBeenLastCalledWith(false);
  });

  it('resets the 10-second idle timer when typing continues', () => {
    vi.useFakeTimers();

    const onTypingChange = vi.fn();
    render(<MessageInput onSend={vi.fn()} onTypingChange={onTypingChange} />);

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'he' } });
    vi.advanceTimersByTime(9_000);
    fireEvent.change(input, { target: { value: 'hello' } });
    vi.advanceTimersByTime(9_000);

    expect(onTypingChange).toHaveBeenCalledTimes(1);
    expect(onTypingChange).toHaveBeenLastCalledWith(true);

    vi.advanceTimersByTime(1_000);

    expect(onTypingChange).toHaveBeenCalledTimes(2);
    expect(onTypingChange).toHaveBeenLastCalledWith(false);
  });
});
