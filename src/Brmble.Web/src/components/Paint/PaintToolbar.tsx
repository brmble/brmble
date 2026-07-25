import type { PaintTool } from '../../types/paint';
import './PaintToolbar.css';

interface Props { tool: PaintTool; color: string; width: number; onTool: (tool: PaintTool) => void; onColor: (color: string) => void; onWidth: (width: number) => void; }
const colors = [
  { label: 'White', value: '#ffffff' },
  { label: 'Ink', value: '#111827' },
  { label: 'Red', value: '#ef4444' },
  { label: 'Amber', value: '#f59e0b' },
  { label: 'Green', value: '#22c55e' },
  { label: 'Blue', value: '#4ec9ff' },
] as const;

export function PaintToolbar({ tool, color, width, onTool, onColor, onWidth }: Props) {
  return <div className="paint-toolbar" aria-label="Paint tools">
    {(['pen', 'eraser'] as const).map(value => <button key={value} className={tool === value ? 'active' : ''} onClick={() => onTool(value)}>{value === 'pen' ? 'Pen' : 'Eraser'}</button>)}
    <div className="paint-swatches">{colors.map(({ label, value }) => <button key={value} aria-label={`Color ${label}`} className={color === value ? 'active' : ''} style={{ backgroundColor: value }} onClick={() => onColor(value)} />)}</div>
    {[3, 6, 12].map(value => <button key={value} aria-label={`Width ${value}`} className={width === value ? 'active' : ''} onClick={() => onWidth(value)}>{value}px</button>)}
  </div>;
}
