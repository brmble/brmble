import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaintSessionSetupModal } from './PaintSessionSetupModal';

beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn().mockReturnValue('blob:source-preview'),
    revokeObjectURL: vi.fn(),
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

    await user.click(screen.getByLabelText('Bob'));
    await user.upload(screen.getByLabelText('Source image'), new File(['image'], 'source.png', { type: 'image/png' }));
    await user.click(screen.getByRole('button', { name: /start paint/i }));

    expect(paintApi.createSession).toHaveBeenCalledWith({ channelId: 5, participantSessionIds: [2] });
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

    expect(screen.getByAltText('Selected paint source'))
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
    expect(screen.getByText('replacement.webp')).toBeInTheDocument();
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
    expect(URL.revokeObjectURL)
      .toHaveBeenCalledWith('blob:source-preview');

    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('checks the Matrix upload limit before creating a paint session', async () => {
    const user = userEvent.setup();
    const { paintApi, matrixClient, attachSource } = createHarness();
    matrixClient.getMediaConfig.mockResolvedValue({ 'm.upload.size': 1 });
    render(<PaintSessionSetupModal channelId={5} channelRoomId="!channel:server" candidates={[]} hostUserId={7} paintApi={paintApi} matrixClient={matrixClient} onAttachSource={attachSource} />);

    await user.upload(screen.getByLabelText('Source image'), new File(['too large'], 'source.png', { type: 'image/png' }));
    await user.click(screen.getByRole('button', { name: 'Start paint' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('exceeds the Matrix upload limit');
    expect(paintApi.createSession).not.toHaveBeenCalled();
  });

  it('leaves a created session when source setup later fails', async () => {
    const user = userEvent.setup();
    const { paintApi, matrixClient, attachSource } = createHarness();
    matrixClient.uploadContent.mockRejectedValue(new Error('Upload failed'));
    render(<PaintSessionSetupModal channelId={5} channelRoomId="!channel:server" candidates={[]} hostUserId={7} paintApi={paintApi} matrixClient={matrixClient} onAttachSource={attachSource} />);

    await user.upload(screen.getByLabelText('Source image'), new File(['image'], 'source.png', { type: 'image/png' }));
    await user.click(screen.getByRole('button', { name: 'Start paint' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Upload failed');
    expect(paintApi.leave).toHaveBeenCalledWith('session-1');
  });
});
