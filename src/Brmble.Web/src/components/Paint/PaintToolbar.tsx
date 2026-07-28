import type { CSSProperties } from 'react';
import type { PaintTool } from '../../types/paint';
import { PAINT_COLORS } from '../../utils/paintPalette';
import './PaintToolbar.css';

interface Props { tool: PaintTool; color: string; width: number; onTool: (tool: PaintTool) => void; onColor: (color: string) => void; onWidth: (width: number) => void; }

export function PaintToolbar({ tool, color, width, onTool, onColor, onWidth }: Props) {
  return <div className="paint-toolbar" aria-label="Paint tools">
    {(['pen', 'eraser'] as const).map(value => <button key={value} type="button" className={tool === value ? 'active' : ''} onClick={() => onTool(value)}>{value === 'pen' ? 'Pen' : 'Eraser'}</button>)}
    <div className="paint-swatches">{PAINT_COLORS.map(({ label, value }) => <button key={value} type="button" aria-label={`Color ${label}`} className={['paint-swatch', color === value ? 'active' : ''].filter(Boolean).join(' ')} style={{ '--paint-swatch-color': value } as CSSProperties} onClick={() => onColor(value)} />)}</div>
    {[3, 6, 12].map(value => <button key={value} type="button" aria-label={`Width ${value}`} className={width === value ? 'active' : ''} onClick={() => onWidth(value)}>{value}px</button>)}
  </div>;
}
