export const PAINT_COLORS = [
  { id: 'white', label: 'White', value: '#ffffff' },
  { id: 'ink', label: 'Ink', value: '#111827' },
  { id: 'red', label: 'Red', value: '#ef4444' },
  { id: 'amber', label: 'Amber', value: '#f59e0b' },
  { id: 'green', label: 'Green', value: '#22c55e' },
  { id: 'blue', label: 'Blue', value: '#4ec9ff' },
] as const;

export const DEFAULT_PAINT_COLOR = PAINT_COLORS[1].value;
