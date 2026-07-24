import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaintSessionSetupModal } from './PaintSessionSetupModal';

describe('PaintSessionSetupModal', () => {
  it('creates the session before uploading the source event', async () => {
    const user = userEvent.setup();
    const paintApi = { createSession: vi.fn().mockResolvedValue({ sessionId: 'session-1', matrixRoomId: '!paint:server', channelId: 5 }) };
    const matrixClient = {
      getMediaConfig: vi.fn().mockResolvedValue({ 'm.upload.size': 1024 }),
      joinRoom: vi.fn().mockResolvedValue(undefined),
      uploadContent: vi.fn().mockResolvedValue({ content_uri: 'mxc://server/source' }),
      sendMessage: vi.fn().mockResolvedValue({ event_id: '$source' }),
    };
    const attachSource = vi.fn().mockResolvedValue(undefined);

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

    expect(paintApi.createSession).toHaveBeenCalledWith({ channelId: 5, participantUserIds: [2] });
    expect(matrixClient.joinRoom).toHaveBeenCalledWith('!paint:server');
    expect(matrixClient.sendMessage).toHaveBeenCalledWith('!paint:server', expect.objectContaining({ msgtype: 'm.image' }));
    expect(attachSource).toHaveBeenCalledWith('session-1', '$source');
    expect(matrixClient.sendMessage).toHaveBeenCalledWith('!channel:server', expect.objectContaining({
      body: expect.stringContaining('[brmble-paint]'),
      'com.brmble.paint': expect.objectContaining({ sessionId: 'session-1', hostUserId: 7 }),
    }));
  });
});
