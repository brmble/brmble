import type { PaintTool } from '../../types/paint';
import './PaintToolbar.css';

interface Props { tool: PaintTool; color: string; width: number; onTool: (tool: PaintTool) => void; onColor: (color: string) => void; onWidth: (width: number) => void; }
const colors = ['#161616', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'];
export function PaintToolbar({ tool, color, width, onTool, onColor, onWidth }: Props) {
  return <div className="paint-toolbar" aria-label="Paint tools">
    {(['pen', 'eraser'] as const).map(value => <button key={value} className={tool === value ? 'active' : ''} onClick={() => onTool(value)}>{value === 'pen' ? 'Pen' : 'Eraser'}</button>)}
    <div className="paint-swatches">{colors.map(value => <button key={value} aria-label={`Color ${value}`} className={color === value ? 'active' : ''} style={{ backgroundColor: value }} onClick={() => onColor(value)} />)}</div>
    {[3, 7, 14].map(value => <button key={value} aria-label={`Width ${value}`} className={width === value ? 'active' : ''} onClick={() => onWidth(value)}>{value}px</button>)}
  </div>;
}
