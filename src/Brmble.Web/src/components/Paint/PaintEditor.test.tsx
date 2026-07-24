import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PaintEditor } from './PaintEditor';
import type { PaintSessionSnapshot } from '../../types/paint';

const activeSnapshot: PaintSessionSnapshot = {
  sessionId: 'session-1', channelId: 5, hostUserId: 1, matrixRoomId: '!paint:server', sourceEventId: '$source', status: 'active', expiresAt: '',
  source: { matrixRoomId: '!paint:server', sourceEventId: '$source', mxcUrl: 'mxc://server/source', mimeType: 'image/png', width: 100, height: 100, sizeBytes: 1 },
  participants: [], strokes: [], generation: 0, revision: 0,
};

describe('PaintEditor', () => {
  it('commits one normalized stroke for a pointer action', () => {
    const paintApi = { commitStroke: vi.fn(), sendPreview: vi.fn(), undo: vi.fn(), clear: vi.fn(), end: vi.fn() };
    render(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={activeSnapshot} currentUserId={1} />);

    const canvas = screen.getByTestId('paint-annotation-canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 60, clientY: 60, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 100, clientY: 100, pointerId: 1 });

    expect(paintApi.commitStroke).toHaveBeenCalledTimes(1);
    expect(paintApi.commitStroke).toHaveBeenCalledWith('session-1', expect.objectContaining({ generation: 0, tool: 'pen', points: expect.arrayContaining([expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })]) }));
  });

  it('hides host-only actions from participants', () => {
    render(<PaintEditor sessionId="session-1" paintApi={{ commitStroke: vi.fn(), sendPreview: vi.fn(), undo: vi.fn(), clear: vi.fn(), end: vi.fn() }} snapshot={activeSnapshot} currentUserId={2} />);

    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /save to chat/i })).toBeNull();
  });
});
