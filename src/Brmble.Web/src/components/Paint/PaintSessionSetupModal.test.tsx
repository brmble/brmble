import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaintSessionSetupModal } from './PaintSessionSetupModal';

const sourceFile = new File([new Uint8Array([1, 2, 3])], 'source.png', { type: 'image/png' });

beforeEach(() => {
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:source'), revokeObjectURL: vi.fn() });
  vi.stubGlobal('Image', class { naturalWidth = 1280; naturalHeight = 720; decode = vi.fn().mockResolvedValue(undefined); });
});

afterEach(() => vi.unstubAllGlobals());

function renderSetup(overrides: Partial<Parameters<typeof PaintSessionSetupModal>[0]> = {}) {
  const createSession = vi.fn().mockResolvedValue({ sessionId: 's1', channelId: 9 });
  const end = vi.fn().mockResolvedValue(undefined);
  const sendMessage = vi.fn().mockResolvedValue({ event_id: '$invite' });
  render(<PaintSessionSetupModal
    channelId={9}
    channelRoomId="!channel:test"
    paintApi={{ createSession, end }}
    matrixClient={{ sendMessage } as never}
    initialSourceFile={sourceFile}
    {...overrides}
  />);
  return { createSession, end, sendMessage };
}

describe('PaintSessionSetupModal', () => {
  it('creates one channel-scoped session with the source and only posts the invitation', async () => {
    const user = userEvent.setup();
    const { createSession, sendMessage } = renderSetup();

    await user.click(screen.getByRole('button', { name: 'Start paint' }));

    await waitFor(() => expect(createSession).toHaveBeenCalledWith({ channelId: 9, source: sourceFile }));
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith('!channel:test', expect.objectContaining({
      msgtype: 'm.text',
      'com.brmble.paint': { version: 2, sessionId: 's1', channelId: 9, status: 'active' },
    }));
  });

  it('does not render participant selection or call Matrix source-upload methods', async () => {
    const user = userEvent.setup();
    const getMediaConfig = vi.fn();
    const joinRoom = vi.fn();
    const uploadContent = vi.fn();
    const { createSession } = renderSetup({ matrixClient: { sendMessage: vi.fn(), getMediaConfig, joinRoom, uploadContent } as never });

    expect(screen.queryByRole('checkbox')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Start paint' }));
    await waitFor(() => expect(createSession).toHaveBeenCalled());
    expect(getMediaConfig).not.toHaveBeenCalled();
    expect(joinRoom).not.toHaveBeenCalled();
    expect(uploadContent).not.toHaveBeenCalled();
  });

  it('ends the temporary session when posting the invitation fails', async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn().mockRejectedValue(new Error('chat unavailable'));
    const { end } = renderSetup({ matrixClient: { sendMessage } as never });

    await user.click(screen.getByRole('button', { name: 'Start paint' }));

    await waitFor(() => expect(end).toHaveBeenCalledWith('s1'));
    expect(screen.getByRole('alert')).toHaveTextContent('chat unavailable');
  });

  it('keeps an explicitly supplied chat image as the temporary source', async () => {
    const user = userEvent.setup();
    const replacement = new File(['replacement'], 'replacement.png', { type: 'image/png' });
    const { createSession } = renderSetup();
    await user.upload(screen.getByLabelText('Source image'), replacement);
    await user.click(screen.getByRole('button', { name: 'Start paint' }));

    await waitFor(() => expect(createSession).toHaveBeenCalledWith({ channelId: 9, source: replacement }));
  });

  it('keeps the dialog usable when no source has been selected', async () => {
    const user = userEvent.setup();
    const { createSession } = renderSetup({ initialSourceFile: null });
    await user.click(screen.getByRole('button', { name: 'Start paint' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a source image.');
    expect(createSession).not.toHaveBeenCalled();
  });

  it('does not close while creating a session', async () => {
    const user = userEvent.setup();
    let resolveCreate!: (created: { sessionId: string; channelId: number }) => void;
    const createSession = vi.fn(() => new Promise<{ sessionId: string; channelId: number }>((resolve) => {
      resolveCreate = resolve;
    }));
    const end = vi.fn().mockResolvedValue(undefined);
    const sendMessage = vi.fn().mockResolvedValue({ event_id: '$invite' });
    const onClose = vi.fn();
    const onComplete = vi.fn();
    render(<PaintSessionSetupModal
      channelId={9}
      channelRoomId="!channel:test"
      paintApi={{ createSession, end }}
      matrixClient={{ sendMessage } as never}
      initialSourceFile={sourceFile}
      onClose={onClose}
      onComplete={onComplete}
    />);

    await user.click(screen.getByRole('button', { name: 'Start paint' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('paint-setup-overlay'));

    expect(onClose).not.toHaveBeenCalled();

    resolveCreate({ sessionId: 's1', channelId: 9 });
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('s1'));
  });

  it('accepts a pasted image without exposing participant controls', async () => {
    const pasted = new File(['pixels'], 'image.png', { type: 'image/png' });
    renderSetup({ initialSourceFile: null });
    fireEvent.paste(screen.getByRole('dialog'), { clipboardData: { items: [{ type: 'image/png', getAsFile: () => pasted }] } });
    await waitFor(() => expect(screen.getByText('Pasted screenshot.png')).toBeInTheDocument());
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
