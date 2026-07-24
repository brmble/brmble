import type { PaintTool } from '../../types/paint';
import './PaintToolbar.css';

interface Props { tool: PaintTool; color: string; width: number; onTool: (tool: PaintTool) => void; onColor: (color: string) => void; onWidth: (width: number) => void; }
const colors = [
  { label: 'Ink', className: 'paint-swatch-ink', token: '--text-primary' },
  { label: 'Red', className: 'paint-swatch-danger', token: '--accent-danger' },
  { label: 'Yellow', className: 'paint-swatch-warning', token: '--accent-warning' },
  { label: 'Green', className: 'paint-swatch-success', token: '--accent-success' },
  { label: 'Blue', className: 'paint-swatch-info', token: '--accent-info' },
  { label: 'Accent', className: 'paint-swatch-primary', token: '--accent-primary' },
];

export function getPaintColor(token: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
}

export function PaintToolbar({ tool, color, width, onTool, onColor, onWidth }: Props) {
  return <div className="paint-toolbar" aria-label="Paint tools">
    {(['pen', 'eraser'] as const).map(value => <button key={value} className={tool === value ? 'active' : ''} onClick={() => onTool(value)}>{value === 'pen' ? 'Pen' : 'Eraser'}</button>)}
    <div className="paint-swatches">{colors.map(({ label, className, token }) => <button key={token} aria-label={`Color ${label}`} className={`${className} ${color === getPaintColor(token) ? 'active' : ''}`} onClick={() => onColor(getPaintColor(token))} />)}</div>
    {[3, 7, 14].map(value => <button key={value} aria-label={`Width ${value}`} className={width === value ? 'active' : ''} onClick={() => onWidth(value)}>{value}px</button>)}
  </div>;
}
