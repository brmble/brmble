import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaintSessionSetupModal } from './PaintSessionSetupModal';

beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn().mockReturnValue('blob:source-preview'),
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal('Image', class {
    src = '';
    naturalWidth = 1280;
    naturalHeight = 720;
    decode = vi.fn().mockResolvedValue(undefined);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function createHarness() {
  const paintApi = {
    createSession: vi.fn().mockResolvedValue({
      sessionId: 'session-1',
      matrixRoomId: '!paint:server',
      channelId: 5,
    }),
    leave: vi.fn().mockResolvedValue(undefined),
  };
  const matrixClient = {
    getMediaConfig: vi.fn().mockResolvedValue({
      'm.upload.size': 1024,
    }),
    joinRoom: vi.fn().mockResolvedValue(undefined),
    uploadContent: vi.fn().mockResolvedValue({
      content_uri: 'mxc://server/source',
    }),
    sendMessage: vi.fn().mockResolvedValue({
      event_id: '$source',
    }),
  };
  const attachSource = vi.fn().mockResolvedValue(undefined);
  return { paintApi, matrixClient, attachSource };
}

function pasteClipboardItems(items: Array<{
  type: string;
  getAsFile: () => File | null;
}>) {
  fireEvent.paste(screen.getByRole('dialog', {
    name: 'Start collaborative paint',
  }), {
    clipboardData: { items },
  });
}

describe('PaintSessionSetupModal', () => {
  it('creates the session before uploading the source event', async () => {
    const user = userEvent.setup();
    const { paintApi, matrixClient, attachSource } = createHarness();

    render(<PaintSessionSetupModal
      channelId={5}
      channelRoomId="!channel:server"
      candidates={[{ userId: 2, name: 'Bob' }]}
      hostUserId={7}
      paintApi={paintApi}
      matrixClient={matrixClient}
      onAttachSource={attachSource}
    />);

    await user.upload(screen.getByLabelText('Source image'), new File(['image'], 'source.png', { type: 'image/png' }));
    expect(await screen.findByText('source.png')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /start paint/i }));

    expect(paintApi.createSession).toHaveBeenCalledWith({ channelId: 5, participantSessionIds: [] });
    expect(matrixClient.joinRoom).toHaveBeenCalledWith('!paint:server');
    expect(matrixClient.sendMessage).toHaveBeenCalledWith('!paint:server', expect.objectContaining({ msgtype: 'm.image' }));
    expect(attachSource).toHaveBeenCalledWith('session-1', '$source');
    expect(matrixClient.sendMessage).toHaveBeenCalledWith('!channel:server', expect.objectContaining({
      body: expect.stringContaining('[brmble-paint]'),
      'com.brmble.paint': {
        version: 2,
        sessionId: 'session-1',
        channelId: 5,
        status: 'active',
      },
    }));
    const invitationBody = matrixClient.sendMessage.mock.calls.find(call => call[0] === '!channel:server')?.[1].body;
    expect(invitationBody).not.toContain('hostUserId');
    expect(invitationBody).not.toContain('participantUserIds');
    expect(invitationBody).not.toContain('sourceEventId');
  });

  it('shows a chat image as the preselected source and starts with that file', async () => {
    const user = userEvent.setup();
    const { paintApi, matrixClient, attachSource } = createHarness();
    const initialSourceFile = new File(
      ['chat-image'],
      'shared-board.png',
      { type: 'image/png' },
    );

    render(
      <PaintSessionSetupModal
        channelId={5}
        channelRoomId="!channel:server"
        candidates={[{ userId: 2, name: 'Bob' }]}
        hostUserId={7}
        paintApi={paintApi}
        matrixClient={matrixClient}
        onAttachSource={attachSource}
        initialSourceFile={initialSourceFile}
      />,
    );

    expect(screen.getByAltText(/^Selected paint source:/))
      .toHaveAttribute('src', 'blob:source-preview');
    expect(screen.getByText('shared-board.png')).toBeInTheDocument();

    await user.click(screen.getByRole('button', {
      name: 'Start paint',
    }));

    expect(matrixClient.uploadContent).toHaveBeenCalledWith(
      initialSourceFile,
      { type: 'image/png', name: 'shared-board.png' },
    );
  });

  it('lets the user replace the preselected source before starting', async () => {
    const user = userEvent.setup();
    const { paintApi, matrixClient, attachSource } = createHarness();
    const replacement = new File(
      ['replacement'],
      'replacement.webp',
      { type: 'image/webp' },
    );

    render(
      <PaintSessionSetupModal
        channelId={5}
        channelRoomId="!channel:server"
        candidates={[]}
        hostUserId={7}
        paintApi={paintApi}
        matrixClient={matrixClient}
        onAttachSource={attachSource}
        initialSourceFile={new File(
          ['initial'],
          'initial.png',
          { type: 'image/png' },
        )}
      />,
    );

    await user.upload(
      screen.getByLabelText('Source image'),
      replacement,
    );
    expect(await screen.findByText('replacement.webp')).toBeInTheDocument();
    await user.click(screen.getByRole('button', {
      name: 'Start paint',
    }));

    expect(matrixClient.uploadContent).toHaveBeenCalledWith(
      replacement,
      { type: 'image/webp', name: 'replacement.webp' },
    );
  });

  it('cancels a prefilled dialog without creating a session', async () => {
    const user = userEvent.setup();
    const { paintApi, matrixClient, attachSource } = createHarness();
    const onClose = vi.fn();

    render(
      <PaintSessionSetupModal
        channelId={5}
        channelRoomId="!channel:server"
        candidates={[]}
        hostUserId={7}
        paintApi={paintApi}
        matrixClient={matrixClient}
        onAttachSource={attachSource}
        initialSourceFile={new File(
          ['chat-image'],
          'shared.png',
          { type: 'image/png' },
        )}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(paintApi.createSession).not.toHaveBeenCalled();
    expect(matrixClient.uploadContent).not.toHaveBeenCalled();
  });

  it('focuses the cancel action and closes on Escape or overlay click', async () => {
    const user = userEvent.setup();
    const { paintApi, matrixClient, attachSource } = createHarness();
    const onClose = vi.fn();

    const { rerender } = render(
      <PaintSessionSetupModal channelId={5} channelRoomId="!channel:server" candidates={[]} hostUserId={7} paintApi={paintApi} matrixClient={matrixClient} onAttachSource={attachSource} onClose={onClose} />,
    );

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();

    rerender(<PaintSessionSetupModal channelId={5} channelRoomId="!channel:server" candidates={[]} hostUserId={7} paintApi={paintApi} matrixClient={matrixClient} onAttachSource={attachSource} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('paint-setup-overlay'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('keeps Tab focus within the setup dialog', async () => {
    const user = userEvent.setup();
    const { paintApi, matrixClient, attachSource } = createHarness();
    render(<PaintSessionSetupModal channelId={5} channelRoomId="!channel:server" candidates={[]} hostUserId={7} paintApi={paintApi} matrixClient={matrixClient} onAttachSource={attachSource} />);

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    screen.getByLabelText('Source image').focus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');

    expect(screen.getByRole('button', { name: 'Start paint' })).toHaveFocus();
  });

  it('revokes the selected source preview URL on replacement and unmount', async () => {
    const user = userEvent.setup();
    const { paintApi, matrixClient, attachSource } = createHarness();
    const view = render(
      <PaintSessionSetupModal
        channelId={5}
        channelRoomId="!channel:server"
        candidates={[]}
        hostUserId={7}
        paintApi={paintApi}
        matrixClient={matrixClient}
        onAttachSource={attachSource}
        initialSourceFile={new File(
          ['initial'],
          'initial.png',
          { type: 'image/png' },
        )}
      />,
    );

    await user.upload(
      screen.getByLabelText('Source image'),
      new File(['next'], 'next.png', { type: 'image/png' }),
    );
    expect(await screen.findByText('next.png')).toBeInTheDocument();
    expect(URL.revokeObjectURL)
      .toHaveBeenCalledWith('blob:source-preview');

    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
  });

  it('checks the Matrix upload limit before creating a paint session', async () => {
    const user = userEvent.setup();
    const { paintApi, matrixClient, attachSource } = createHarness();
    matrixClient.getMediaConfig.mockResolvedValue({ 'm.upload.size': 1 });
    render(<PaintSessionSetupModal channelId={5} channelRoomId="!channel:server" candidates={[]} hostUserId={7} paintApi={paintApi} matrixClient={matrixClient} onAttachSource={attachSource} />);

    await user.upload(screen.getByLabelText('Source image'), new File(['too large'], 'source.png', { type: 'image/png' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The selected image is too large to use as a Paint source.',
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(paintApi.createSession).not.toHaveBeenCalled();
  });

  it('leaves a created session when source setup later fails', async () => {
    const user = userEvent.setup();
    const { paintApi, matrixClient, attachSource } = createHarness();
    matrixClient.uploadContent.mockRejectedValue(new Error('Upload failed'));
    render(<PaintSessionSetupModal channelId={5} channelRoomId="!channel:server" candidates={[]} hostUserId={7} paintApi={paintApi} matrixClient={matrixClient} onAttachSource={attachSource} />);

    await user.upload(screen.getByLabelText('Source image'), new File(['image'], 'source.png', { type: 'image/png' }));
    expect(await screen.findByText('source.png')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start paint' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Upload failed');
    expect(paintApi.leave).toHaveBeenCalledWith('session-1');
  });

  it('pastes an image anywhere in the active dialog and starts with it', async () => {
    const user = userEvent.setup();
    const { paintApi, matrixClient, attachSource } = createHarness();
    render(
      <PaintSessionSetupModal
        channelId={5}
        channelRoomId="!channel:server"
        candidates={[{ userId: 2, name: 'Bob' }]}
        hostUserId={7}
        paintApi={paintApi}
        matrixClient={matrixClient}
        onAttachSource={attachSource}
      />,
    );
    screen.getByRole('button', { name: 'Cancel' }).focus();
    const pasted = new File(['clipboard-pixels'], 'image.png', {
      type: 'image/png',
    });

    pasteClipboardItems([{ type: 'image/png', getAsFile: () => pasted }]);

    expect(await screen.findByText('Pasted screenshot.png'))
      .toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Pasted screenshot.png',
    );
    expect(screen.getByAltText(
      'Selected paint source: Pasted screenshot.png',
    )).toHaveAttribute('src', 'blob:source-preview');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(paintApi.createSession).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Start paint' }));

    const uploaded = matrixClient.uploadContent.mock.calls[0][0] as File;
    expect(uploaded.name).toBe('Pasted screenshot.png');
    expect(uploaded.type).toBe('image/png');
    expect(paintApi.createSession).toHaveBeenCalledOnce();
  });

  it('replaces a selected file with a valid paste', async () => {
    const user = userEvent.setup();
    const { paintApi, matrixClient, attachSource } = createHarness();
    render(
      <PaintSessionSetupModal
        channelId={5}
        channelRoomId="!channel:server"
        candidates={[{ userId: 2, name: 'Bob' }]}
        hostUserId={7}
        paintApi={paintApi}
        matrixClient={matrixClient}
        onAttachSource={attachSource}
      />,
    );
    await user.upload(
      screen.getByLabelText('Source image'),
      new File(['first'], 'first.webp', { type: 'image/webp' }),
    );
    await screen.findByText('first.webp');

    pasteClipboardItems([{
      type: 'image/jpeg',
      getAsFile: () => new File(['second'], 'image', { type: 'image/jpeg' }),
    }]);

    expect(await screen.findByText('Pasted screenshot.jpg'))
      .toBeInTheDocument();
    expect(screen.queryByText('first.webp')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Source image')).toHaveValue('');
  });

  it('replaces a pasted image with a valid selected file', async () => {
    const user = userEvent.setup();
    const { paintApi, matrixClient, attachSource } = createHarness();
    render(
      <PaintSessionSetupModal
        channelId={5}
        channelRoomId="!channel:server"
        candidates={[]}
        hostUserId={7}
        paintApi={paintApi}
        matrixClient={matrixClient}
        onAttachSource={attachSource}
      />,
    );
    pasteClipboardItems([{
      type: 'image/png',
      getAsFile: () => new File(['pasted'], 'image.png', { type: 'image/png' }),
    }]);
    await screen.findByText('Pasted screenshot.png');

    await user.upload(
      screen.getByLabelText('Source image'),
      new File(['selected'], 'selected.webp', { type: 'image/webp' }),
    );

    expect(await screen.findByText('selected.webp')).toBeInTheDocument();
    expect(screen.queryByText('Pasted screenshot.png'))
      .not.toBeInTheDocument();
  });

  it('reports non-image clipboard content and preserves the valid source', async () => {
    const { paintApi, matrixClient, attachSource } = createHarness();
    render(
      <PaintSessionSetupModal
        channelId={5}
        channelRoomId="!channel:server"
        candidates={[]}
        hostUserId={7}
        paintApi={paintApi}
        matrixClient={matrixClient}
        onAttachSource={attachSource}
        initialSourceFile={new File(['valid'], 'existing.png', { type: 'image/png' })}
      />,
    );
    screen.getByRole('button', { name: 'Cancel' }).focus();

    pasteClipboardItems([{ type: 'text/plain', getAsFile: () => null }]);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The clipboard does not contain an image.',
    );
    expect(screen.getByText('existing.png')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(paintApi.createSession).not.toHaveBeenCalled();
  });

  it('reports non-image clipboard content without selecting a source', () => {
    const { paintApi, matrixClient, attachSource } = createHarness();
    render(
      <PaintSessionSetupModal
        channelId={5}
        channelRoomId="!channel:server"
        candidates={[]}
        hostUserId={7}
        paintApi={paintApi}
        matrixClient={matrixClient}
        onAttachSource={attachSource}
      />,
    );

    pasteClipboardItems([{ type: 'text/plain', getAsFile: () => null }]);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The clipboard does not contain an image.',
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(paintApi.createSession).not.toHaveBeenCalled();
  });

  it('rejects an unsupported clipboard image without replacing the valid source', async () => {
    const { paintApi, matrixClient, attachSource } = createHarness();
    render(
      <PaintSessionSetupModal
        channelId={5}
        channelRoomId="!channel:server"
        candidates={[]}
        hostUserId={7}
        paintApi={paintApi}
        matrixClient={matrixClient}
        onAttachSource={attachSource}
        initialSourceFile={new File(['valid'], 'existing.png', { type: 'image/png' })}
      />,
    );

    pasteClipboardItems([{
      type: 'image/gif',
      getAsFile: () => new File(['gif'], 'animated.gif', { type: 'image/gif' }),
    }]);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Copy a PNG, JPEG, or WebP image, or choose a file.',
    );
    expect(screen.getByText('existing.png')).toBeInTheDocument();
  });

  it('rejects a pasted image above the Matrix limit before replacing or starting', async () => {
    const { paintApi, matrixClient, attachSource } = createHarness();
    matrixClient.getMediaConfig.mockResolvedValue({ 'm.upload.size': 1 });
    render(
      <PaintSessionSetupModal
        channelId={5}
        channelRoomId="!channel:server"
        candidates={[]}
        hostUserId={7}
        paintApi={paintApi}
        matrixClient={matrixClient}
        onAttachSource={attachSource}
        initialSourceFile={new File(['valid'], 'existing.png', { type: 'image/png' })}
      />,
    );

    pasteClipboardItems([{
      type: 'image/png',
      getAsFile: () => new File(['too-large'], 'large.png', { type: 'image/png' }),
    }]);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The pasted image is too large to use as a Paint source.',
    );
    expect(screen.getByText('existing.png')).toBeInTheDocument();
    expect(paintApi.createSession).not.toHaveBeenCalled();
  });

  it('checks the Matrix limit for a source prepared from chat before creating', async () => {
    const user = userEvent.setup();
    const { paintApi, matrixClient, attachSource } = createHarness();
    matrixClient.getMediaConfig.mockResolvedValue({ 'm.upload.size': 1 });
    render(
      <PaintSessionSetupModal
        channelId={5}
        channelRoomId="!channel:server"
        candidates={[]}
        hostUserId={7}
        paintApi={paintApi}
        matrixClient={matrixClient}
        onAttachSource={attachSource}
        initialSourceFile={new File(['chat-image'], 'shared.png', { type: 'image/png' })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Start paint' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The source image exceeds the Matrix upload limit.',
    );
    expect(paintApi.createSession).not.toHaveBeenCalled();
  });

  it('keeps only the latest result when paste validation completes out of order', async () => {
    const { paintApi, matrixClient, attachSource } = createHarness();
    let resolveFirst!: () => void;
    let decodeCall = 0;
    vi.stubGlobal('Image', class {
      src = '';
      naturalWidth = 1280;
      naturalHeight = 720;
      decode = vi.fn(() => {
        decodeCall += 1;
        return decodeCall === 1
          ? new Promise<void>((resolve) => { resolveFirst = resolve; })
          : Promise.resolve();
      });
    });
    render(
      <PaintSessionSetupModal
        channelId={5}
        channelRoomId="!channel:server"
        candidates={[]}
        hostUserId={7}
        paintApi={paintApi}
        matrixClient={matrixClient}
        onAttachSource={attachSource}
      />,
    );

    pasteClipboardItems([{ type: 'image/png', getAsFile: () => new File(['first'], 'first', { type: 'image/png' }) }]);
    pasteClipboardItems([{ type: 'image/webp', getAsFile: () => new File(['second'], 'second', { type: 'image/webp' }) }]);

    expect(await screen.findByText('Pasted screenshot.webp'))
      .toBeInTheDocument();
    resolveFirst();
    await waitFor(() => {
      expect(screen.queryByText('Pasted screenshot.png'))
        .not.toBeInTheDocument();
    });
    expect(paintApi.createSession).not.toHaveBeenCalled();
  });

  it('ignores paste while the session is being started', async () => {
    const user = userEvent.setup();
    const { paintApi, matrixClient, attachSource } = createHarness();
    let resolveCreate!: (created: {
      sessionId: string;
      matrixRoomId: string;
      channelId: number;
    }) => void;
    paintApi.createSession.mockImplementation(() => new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    render(
      <PaintSessionSetupModal
        channelId={5}
        channelRoomId="!channel:server"
        candidates={[]}
        hostUserId={7}
        paintApi={paintApi}
        matrixClient={matrixClient}
        onAttachSource={attachSource}
        initialSourceFile={new File(['existing'], 'existing.png', { type: 'image/png' })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Start paint' }));
    pasteClipboardItems([{ type: 'image/png', getAsFile: () => new File(['ignored'], 'ignored.png', { type: 'image/png' }) }]);

    expect(screen.getByText('existing.png')).toBeInTheDocument();
    expect(paintApi.createSession).toHaveBeenCalledOnce();
    await act(async () => {
      resolveCreate({ sessionId: 'session-1', matrixRoomId: '!paint:server', channelId: 5 });
    });
  });

  it('disables source file selection while the session is being started', async () => {
    const user = userEvent.setup();
    const { paintApi, matrixClient, attachSource } = createHarness();
    paintApi.createSession.mockImplementation(() => new Promise(() => {}));
    render(
      <PaintSessionSetupModal
        channelId={5}
        channelRoomId="!channel:server"
        candidates={[]}
        hostUserId={7}
        paintApi={paintApi}
        matrixClient={matrixClient}
        onAttachSource={attachSource}
        initialSourceFile={new File(['existing'], 'existing.png', { type: 'image/png' })}
      />,
    );

    const sourceInput = screen.getByLabelText('Source image');
    await user.click(screen.getByRole('button', { name: 'Start paint' }));

    expect(sourceInput).toBeDisabled();
  });

  it('keeps file staging valid when a non-image paste occurs during validation', async () => {
    let resolveMediaConfig!: (config: { 'm.upload.size': number }) => void;
    const { paintApi, matrixClient, attachSource } = createHarness();
    matrixClient.getMediaConfig.mockImplementation(() => new Promise((resolve) => {
      resolveMediaConfig = resolve;
    }));
    render(
      <PaintSessionSetupModal
        channelId={5}
        channelRoomId="!channel:server"
        candidates={[]}
        hostUserId={7}
        paintApi={paintApi}
        matrixClient={matrixClient}
        onAttachSource={attachSource}
      />,
    );

    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText('Source image'),
      new File(['image'], 'selected.png', { type: 'image/png' }),
    );
    pasteClipboardItems([{ type: 'text/plain', getAsFile: () => null }]);

    resolveMediaConfig({ 'm.upload.size': 1024 });

    expect(await screen.findByText('selected.png')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The clipboard does not contain an image.',
    );
  });
});
