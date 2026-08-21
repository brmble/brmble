import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SettingsModal } from './SettingsModal';
import type { CustomCompanionGalleryController } from '../../hooks/useCustomCompanionGallery';

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

const { bridgeMock } = vi.hoisted(() => ({
  bridgeMock: {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

const hasPermissionMock = vi.fn<(channelId: number, permission: number) => boolean>().mockReturnValue(false);

const emptyCustomCompanionGallery: CustomCompanionGalleryController = {
  status: 'empty',
  entries: [],
  redactedEventIds: new Set(),
  error: null,
  requestAtlas: vi.fn(),
  requestThumbnail: vi.fn(),
  releaseAtlas: vi.fn(),
  releaseThumbnail: vi.fn(),
  createCompanion: vi.fn(),
  deleteCompanion: vi.fn(),
};

vi.mock('../../bridge', () => ({
  default: bridgeMock,
}));

vi.mock('../../hooks/useServerlist', () => ({
  useServerlist: () => ({ servers: [] }),
}));

vi.mock('../../hooks/usePermissions', () => ({
  Permission: { Ban: 4, Kick: 2, Write: 1 },
  usePermissions: () => ({ hasPermission: hasPermissionMock }),
}));
vi.mock('./AdminSettingsTab', () => ({
  AdminSettingsTab: ({
    liveUsers,
    customCompanions,
  }: {
    liveUsers: Array<{ session: number; name: string }>;
    customCompanions?: { canModerate: boolean };
  }) => (
    <div data-testid="full-admin-workspace">
      <div data-testid="admin-users-prop">{liveUsers.map(user => user.name).join(',')}</div>
      <div data-testid="admin-custom-companion-prop">{customCompanions?.canModerate ? 'can-moderate' : 'absent'}</div>
    </div>
  ),
}));
vi.mock('./admin/ChannelAccessPanel', () => ({
  ChannelAccessPanel: ({ channel, scoped }: { channel: { name: string }; scoped?: boolean }) => (
    <div data-testid="scoped-channel-access" data-scoped={scoped ? 'true' : 'false'}>{channel.name}</div>
  ),
}));
vi.mock('../ChannelRequests/MyChannelRequests', () => ({
  MyChannelRequests: () => <div data-testid="my-channel-requests" />,
}));

describe('SettingsModal tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermissionMock.mockReturnValue(false);
  });

  it('labels the messages settings tab as Notifications', () => {
    render(<SettingsModal isOpen onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Messages' })).not.toBeInTheDocument();
  });

  it('defaults screen share capture audio on and system audio off', async () => {
    render(<SettingsModal isOpen={true} onClose={vi.fn()} initialTab="screenShare" />);

    const toggles = await screen.findAllByRole('checkbox');

    expect(toggles[0]).toBeChecked();
    expect(toggles[1]).not.toBeChecked();
  });

  it('registers native shortcut changes for every shortcut action', async () => {
    render(<SettingsModal isOpen onClose={vi.fn()} initialTab="shortcuts" />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Not bound' }).at(-1)!);
    fireEvent.keyDown(window, { code: 'KeyG' });

    await waitFor(() => {
      expect(bridgeMock.send).toHaveBeenCalledWith('voice.setShortcut', {
        action: 'toggleGame',
        key: 'KeyG',
      });
    });
  });

  it('shows Admin tab only when the user has admin permissions', () => {
    hasPermissionMock.mockReturnValue(true);
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument();
  });

  it('opens only the requested channel access panel for a channel-scoped ACL manager', () => {
    hasPermissionMock.mockImplementation((channelId: number, permission: number) => (
      channelId === 7 && permission === 1
    ));

    render(
      <SettingsModal
        isOpen
        onClose={vi.fn()}
        initialTab="admin"
        initialAdminChannelId={7}
        channels={[
          { id: 2, name: 'Classes', parent: 0 },
          { id: 7, name: 'Class A', parent: 2 },
        ] as never}
      />,
    );

    expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByTestId('scoped-channel-access')).toHaveTextContent('Class A');
    expect(screen.getByTestId('scoped-channel-access')).toHaveAttribute('data-scoped', 'true');
    expect(screen.queryByTestId('full-admin-workspace')).not.toBeInTheDocument();
  });

  it('passes live voice users into AdminSettingsTab', () => {
    hasPermissionMock.mockReturnValue(true);

    render(
      <SettingsModal
        isOpen
        onClose={vi.fn()}
        initialTab="admin"
        liveUsers={[{ session: 7, name: 'Alice' }]}
      />,
    );

    expect(screen.getByTestId('admin-users-prop')).toHaveTextContent('Alice');
  });

  it('passes only the advertised custom companion moderation capability into AdminSettingsTab', () => {
    hasPermissionMock.mockReturnValue(true);

    const { rerender } = render(
      <SettingsModal
        isOpen
        onClose={vi.fn()}
        initialTab="admin"
        customCompanionGallery={emptyCustomCompanionGallery}
      />,
    );

    expect(screen.getByTestId('admin-custom-companion-prop')).toHaveTextContent('absent');

    rerender(
      <SettingsModal
        isOpen
        onClose={vi.fn()}
        initialTab="admin"
        customCompanions={{ canModerate: true }}
        customCompanionGallery={emptyCustomCompanionGallery}
      />,
    );

    expect(screen.getByTestId('admin-custom-companion-prop')).toHaveTextContent('can-moderate');
  });

  it('normalizes legacy screen share settings from native settings', async () => {
    render(<SettingsModal isOpen onClose={vi.fn()} initialTab="screenShare" />);

    await waitFor(() => {
      expect(bridgeMock.on).toHaveBeenCalledWith('settings.current', expect.any(Function));
    });

    const currentSettingsHandler = bridgeMock.on.mock.calls.find(
      ([event]) => event === 'settings.current',
    )?.[1] as ((data: unknown) => void) | undefined;

    const legacyScreenShareSettings = {
      captureAudio: true,
      resolution: '1080p',
      fps: 30,
      systemAudio: false,
      viewerMode: 'in-app',
    } as unknown;

    act(() => {
      currentSettingsHandler?.({ settings: { screenShare: legacyScreenShareSettings } });
    });

    const captureAudioToggle = screen.getAllByRole('checkbox')[0];
    await waitFor(() => {
      expect(captureAudioToggle).toBeChecked();
    });

    bridgeMock.send.mockClear();
    fireEvent.click(captureAudioToggle);

    await waitFor(() => {
      expect(bridgeMock.send).toHaveBeenCalledWith('settings.set', {
        settings: expect.objectContaining({
          screenShare: expect.objectContaining({
            captureAudio: false,
            preferredCaptureSource: 'window',
          }),
        }),
      });
    });
  });

  it('normalizes stored system audio off when capture audio is off on load', async () => {
    render(<SettingsModal isOpen onClose={vi.fn()} initialTab="screenShare" />);

    await waitFor(() => {
      expect(bridgeMock.on).toHaveBeenCalledWith('settings.current', expect.any(Function));
    });

    const currentSettingsHandler = bridgeMock.on.mock.calls.find(
      ([event]) => event === 'settings.current',
    )?.[1] as ((data: unknown) => void) | undefined;

    // Legacy/divergent combo: capture audio off but system audio still true.
    const divergentScreenShareSettings = {
      captureAudio: false,
      systemAudio: true,
      resolution: '1080p',
      fps: 30,
      viewerMode: 'in-app',
      preferredCaptureSource: 'window',
    } as unknown;

    act(() => {
      currentSettingsHandler?.({ settings: { screenShare: divergentScreenShareSettings } });
    });

    const [captureAudioToggle, systemAudioToggle] = await screen.findAllByRole('checkbox');
    expect(captureAudioToggle).not.toBeChecked();
    expect(systemAudioToggle).not.toBeChecked();

    bridgeMock.send.mockClear();
    // Re-enabling capture audio must NOT resurrect system audio.
    fireEvent.click(captureAudioToggle);

    await waitFor(() => {
      expect(bridgeMock.send).toHaveBeenCalledWith('settings.set', {
        settings: expect.objectContaining({
          screenShare: expect.objectContaining({
            captureAudio: true,
            systemAudio: false,
          }),
        }),
      });
    });
  });

  it('shows channel request history in the profile tab', () => {
    render(<SettingsModal isOpen onClose={vi.fn()} />);

    expect(screen.getByTestId('my-channel-requests')).toBeInTheDocument();
  });

  it('dismisses only the idle upload dialog when Escape is pressed', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <SettingsModal
        isOpen
        onClose={onClose}
        initialTab="appearance"
        customCompanionGallery={emptyCustomCompanionGallery}
        customCompanionMatrixClient={{ uploadContent: vi.fn() }}
      />,
    );

    await user.click(screen.getAllByRole('combobox')[1]);
    await user.click(screen.getByRole('option', { name: 'Full Companion' }));
    await user.click(screen.getAllByRole('button', { name: /Upload custom sprite/ })[0]);
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Upload custom companion' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Built-in' })).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the upload dialog mounted and settings close locked when a pending upload tries to change tabs', async () => {
    let resolveUpload!: (value: { content_uri: string }) => void;
    const uploadContent = vi.fn(() => new Promise<{ content_uri: string }>(resolve => {
      resolveUpload = resolve;
    }));
    const onClose = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(
      <SettingsModal
        isOpen
        onClose={onClose}
        initialTab="appearance"
        customCompanionGallery={emptyCustomCompanionGallery}
        customCompanionMatrixClient={{ uploadContent }}
      />,
    );

    await user.click(screen.getAllByRole('combobox')[1]);
    await user.click(screen.getByRole('option', { name: 'Full Companion' }));
    await user.click(screen.getAllByRole('button', { name: /Upload custom sprite/ })[0]);
    await user.type(screen.getByLabelText('Companion name'), 'Orbit');
    await user.upload(screen.getByLabelText('Sprite sheet'), new File(['sprite'], 'sprite.png', { type: 'image/png' }));
    await user.click(screen.getByRole('button', { name: 'Upload sprite' }));

    rerender(
      <SettingsModal
        isOpen
        onClose={onClose}
        initialTab="audio"
        customCompanionGallery={emptyCustomCompanionGallery}
        customCompanionMatrixClient={{ uploadContent }}
      />,
    );

    const audioTab = screen.getByRole('button', { name: 'Audio' });
    expect(audioTab).toBeDisabled();
    await user.click(audioTab);
    fireEvent.keyDown(audioTab, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByText('Settings').closest('.settings-modal')!.parentElement!);

    expect(screen.getByRole('dialog', { name: 'Upload custom companion' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Built-in' })).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();

    resolveUpload({ content_uri: 'mxc://test/sprite' });
    await waitFor(() => expect(emptyCustomCompanionGallery.createCompanion).toHaveBeenCalledWith('Orbit', 'mxc://test/sprite'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
