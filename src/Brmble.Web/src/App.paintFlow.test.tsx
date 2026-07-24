import { useState } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import bridge from './bridge';
import { paintApi } from './api/paint';
import { PaintSessionSetupModal } from './components/Paint/PaintSessionSetupModal';
import { PaintSessionView } from './components/Paint/PaintSessionView';
import type { PaintSessionSnapshot } from './types/paint';

const paint = vi.hoisted(() => ({
  createSession: vi.fn(), attachSource: vi.fn(), getSnapshot: vi.fn(),
}));

vi.mock('./bridge', () => {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  return { default: {
    on: vi.fn((event: string, handler: (data: unknown) => void) => (handlers.get(event) ?? handlers.set(event, new Set()).get(event)!).add(handler)),
    off: vi.fn((event: string, handler: (data: unknown) => void) => handlers.get(event)?.delete(handler)),
    __emit: (event: string, data: unknown) => handlers.get(event)?.forEach(handler => handler(data)),
    __reset: () => handlers.clear(),
  } };
});

vi.mock('./api/paint', () => ({ paintApi: paint }));

vi.mock('./components/Paint/PaintEditor', () => ({
  PaintEditor: ({ snapshot, previews, onSave }: { snapshot: PaintSessionSnapshot; previews: unknown[]; onSave: (blob: Blob) => Promise<void> }) => <section>
    <output data-testid="stroke-count">{snapshot.strokes.length}</output>
    <output data-testid="preview-count">{previews.length}</output>
    <button onClick={() => void onSave(new Blob(['png'], { type: 'image/png' }))}>Save to chat</button>
  </section>,
}));

const initial: PaintSessionSnapshot = {
  sessionId: 'session-1', channelId: 5, hostUserId: 7, matrixRoomId: '!paint:test', sourceEventId: '$source', status: 'active', expiresAt: '',
  source: { matrixRoomId: '!paint:test', sourceEventId: '$source', mxcUrl: 'mxc://test/source', mimeType: 'image/png', width: 1, height: 1, sizeBytes: 1 },
  participants: [], strokes: [], generation: 0, revision: 1,
};

function PaintFlowApp({ matrixClient }: { matrixClient: any }) {
  const [setup, setSetup] = useState(false); const [sessionId, setSessionId] = useState<string | null>(null);
  return <><header><button onClick={() => setSetup(true)}>Start paint</button></header>
    {setup && <PaintSessionSetupModal channelId={5} channelRoomId="!channel:test" candidates={[{ userId: 2, name: 'Bob' }]} hostUserId={7} paintApi={paintApi as any} matrixClient={matrixClient} onAttachSource={paint.attachSource} onComplete={id => { setSessionId(id); setSetup(false); }} />}
    {sessionId && <PaintSessionView sessionId={sessionId} currentUserId={7} matrixClient={matrixClient} channelRoomMap={{ '5': '!channel:test' }} onClose={() => setSessionId(null)} />}
  </>;
}

describe('collaborative paint app flow', () => {
  beforeEach(() => { vi.clearAllMocks(); (bridge as any).__reset(); });

  it('opens setup, attaches after creation, applies events, refreshes gaps, and saves only the committed canvas', async () => {
    const user = userEvent.setup();
    const matrixClient = { getMediaConfig: vi.fn().mockResolvedValue({}), joinRoom: vi.fn(), uploadContent: vi.fn().mockResolvedValue({ content_uri: 'mxc://test/image' }), sendMessage: vi.fn().mockResolvedValue({ event_id: '$source' }) };
    paint.createSession.mockResolvedValue({ sessionId: 'session-1', matrixRoomId: '!paint:test', channelId: 5 });
    paint.attachSource.mockResolvedValue(undefined);
    paint.getSnapshot.mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, revision: 4, strokes: [{ id: 'stroke-1', correlationId: 'c', authorUserId: 7, authorMatrixUserId: '@host:test', sequence: 1, generation: 0, tool: 'pen', color: '#EF4444', width: 6, points: [{ x: .1, y: .2 }], active: true }] });
    render(<PaintFlowApp matrixClient={matrixClient} />);

    await user.click(screen.getByRole('button', { name: 'Start paint' }));
    await user.click(screen.getByLabelText('Bob'));
    await user.upload(screen.getByLabelText('Source image'), new File(['source'], 'source.png', { type: 'image/png' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Start collaborative paint' })).getByRole('button', { name: 'Start paint' }));
    await waitFor(() => expect(paint.attachSource).toHaveBeenCalledWith('session-1', '$source'));
    expect(paint.createSession.mock.invocationCallOrder[0]).toBeLessThan(paint.attachSource.mock.invocationCallOrder[0]);

    await act(async () => {
      (bridge as any).__emit('paint.previewUpdated', { sessionId: 'session-1', generation: 0, authorUserId: 2, authorMatrixUserId: '@bob:test', input: { correlationId: 'preview', generation: 0, tool: 'pen', color: '#000000', width: 2, points: [{ x: 0, y: 0 }] } });
      (bridge as any).__emit('paint.strokeCommitted', { sessionId: 'session-1', revision: 2, generation: 0, stroke: { id: 'stroke-1', correlationId: 'commit', authorUserId: 7, authorMatrixUserId: '@host:test', sequence: 1, generation: 0, tool: 'pen', color: '#EF4444', width: 6, points: [{ x: .1, y: .2 }], active: true } });
    });
    await waitFor(() => expect(screen.getByTestId('stroke-count')).toHaveTextContent('1'));
    expect(screen.getByTestId('preview-count')).toHaveTextContent('1');

    await act(async () => { (bridge as any).__emit('paint.strokeUndone', { sessionId: 'session-1', revision: 4, generation: 0, undoneStrokeId: 'stroke-1' }); });
    await waitFor(() => expect(paint.getSnapshot).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'Save to chat' }));
    expect(matrixClient.sendMessage).toHaveBeenLastCalledWith('!channel:test', expect.objectContaining({ msgtype: 'm.image', body: 'collaborative-paint.png' }));
    const savedMessage = matrixClient.sendMessage.mock.calls.at(-1)?.[1];
    expect(savedMessage).toBeDefined();
    expect(savedMessage).not.toHaveProperty('previews');
  });
});
