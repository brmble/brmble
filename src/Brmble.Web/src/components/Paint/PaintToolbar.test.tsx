import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PaintToolbar } from './PaintToolbar';

describe('PaintToolbar', () => {
  it('uses the fixed paint palette and documented widths', () => {
    const onColor = vi.fn();
    const onWidth = vi.fn();

    render(
      <PaintToolbar
        tool="pen"
        color="#111827"
        width={6}
        onTool={vi.fn()}
        onColor={onColor}
        onWidth={onWidth}
      />,
    );

    expect(screen.getByRole('button', { name: 'Width 3' })).toHaveTextContent('3px');
    expect(screen.getByRole('button', { name: 'Width 6' })).toHaveTextContent('6px');
    expect(screen.getByRole('button', { name: 'Width 12' })).toHaveTextContent('12px');

    fireEvent.click(screen.getByRole('button', { name: 'Color White' }));
    fireEvent.click(screen.getByRole('button', { name: 'Color Blue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Width 12' }));

    expect(onColor).toHaveBeenNthCalledWith(1, '#ffffff');
    expect(onColor).toHaveBeenNthCalledWith(2, '#4ec9ff');
    expect(onWidth).toHaveBeenCalledWith(12);
  });

  it('renders each swatch with its fixed drawing color', () => {
    render(
      <PaintToolbar
        tool="pen"
        color="#111827"
        width={6}
        onTool={vi.fn()}
        onColor={vi.fn()}
        onWidth={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Color White' }))
      .toHaveStyle({ '--paint-swatch-color': '#ffffff' });
    expect(screen.getByRole('button', { name: 'Color Blue' }))
      .toHaveStyle({ '--paint-swatch-color': '#4ec9ff' });
  });

  it('selects the Line tool', () => {
    const onTool = vi.fn();

    render(
      <PaintToolbar
        tool="pen"
        color="#111827"
        width={6}
        onTool={onTool}
        onColor={vi.fn()}
        onWidth={vi.fn()}
      />,
    );

    const lineButton = screen.getByRole('button', { name: 'Line' });
    expect(lineButton).toHaveAttribute('type', 'button');
    fireEvent.click(lineButton);

    expect(onTool).toHaveBeenCalledWith('line');
  });
});
