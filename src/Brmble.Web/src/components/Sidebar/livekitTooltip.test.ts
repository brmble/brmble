import { describe, expect, it } from 'vitest';
import { buildLiveKitTooltip } from './livekitTooltip';
import type { LiveKitTooltipInput } from './livekitTooltip';
import type { ShareInfo } from '../../hooks/useScreenShare';
import type { ScreenShareQuality } from '../../utils/screenShareQuality';

const NAME = 'Screenshare';

const makeShare = (overrides: Partial<ShareInfo> = {}): ShareInfo => ({
  roomName: 'channel-0',
  userName: 'Alice',
  userId: 42,
  matrixUserId: '@alice:example.com',
  sessionId: 2,
  ...overrides,
});

/** Minimal fake video element exposing only the dimensions the helper reads. */
const fakeVideo = (videoWidth: number, videoHeight: number): HTMLVideoElement =>
  ({ videoWidth, videoHeight } as HTMLVideoElement);

const base = (overrides: Partial<LiveKitTooltipInput> = {}): LiveKitTooltipInput => ({
  name: NAME,
  connected: true,
  isLiveKitRoomConnected: false,
  screenShareQuality: 'unknown',
  isSharing: false,
  broadcastSummary: undefined,
  watchingShares: [],
  shareQualities: new Map<number, ScreenShareQuality>(),
  remoteVideoEls: new Map<number, HTMLVideoElement>(),
  ...overrides,
});

describe('buildLiveKitTooltip', () => {
  it('returns Available when connected with no active room', () => {
    expect(buildLiveKitTooltip(base())).toBe(`${NAME}: Available`);
  });

  it('returns Reconnecting when in a room and quality is reconnecting', () => {
    expect(
      buildLiveKitTooltip(base({ isLiveKitRoomConnected: true, screenShareQuality: 'reconnecting' })),
    ).toBe(`${NAME}: Reconnecting`);
  });

  it('returns null when not connected (lets dotTooltip fall through)', () => {
    expect(buildLiveKitTooltip(base({ connected: false }))).toBeNull();
  });

  it('shows the aggregate quality line when in a room', () => {
    expect(
      buildLiveKitTooltip(base({ isLiveKitRoomConnected: true, screenShareQuality: 'good' })),
    ).toBe(`${NAME}: Connected - good`);
  });

  it('omits the quality suffix on the first line when quality is unknown but a share is active', () => {
    expect(
      buildLiveKitTooltip(
        base({
          isLiveKitRoomConnected: true,
          screenShareQuality: 'unknown',
          isSharing: true,
          broadcastSummary: '1080p 30fps',
        }),
      ),
    ).toBe(`${NAME}: Connected\nBroadcasting: 1080p 30fps`);
  });

  it('adds a Broadcasting line when sharing', () => {
    expect(
      buildLiveKitTooltip(
        base({
          isLiveKitRoomConnected: true,
          screenShareQuality: 'good',
          isSharing: true,
          broadcastSummary: '1440p 60fps',
        }),
      ),
    ).toBe(`${NAME}: Connected - good\nBroadcasting: 1440p 60fps`);
  });

  it('does not add a Broadcasting line when sharing but summary is missing', () => {
    expect(
      buildLiveKitTooltip(
        base({ isLiveKitRoomConnected: true, screenShareQuality: 'good', isSharing: true }),
      ),
    ).toBe(`${NAME}: Connected - good`);
  });

  it('adds a singular Watching line plus a per-share line with resolution and quality', () => {
    const share = makeShare({ userId: 42, userName: 'Alice' });
    expect(
      buildLiveKitTooltip(
        base({
          isLiveKitRoomConnected: true,
          screenShareQuality: 'good',
          watchingShares: [share],
          shareQualities: new Map([[42, 'good']]),
          remoteVideoEls: new Map([[42, fakeVideo(1920, 1080)]]),
        }),
      ),
    ).toBe(`${NAME}: Connected - good\nWatching 1 share\nAlice: 1920×1080 (good)`);
  });

  it('pluralizes the Watching line for two shares', () => {
    const a = makeShare({ userId: 42, userName: 'Alice' });
    const b = makeShare({ userId: 7, userName: 'Bob' });
    expect(
      buildLiveKitTooltip(
        base({
          isLiveKitRoomConnected: true,
          screenShareQuality: 'fair',
          watchingShares: [a, b],
          shareQualities: new Map([
            [42, 'good'],
            [7, 'poor'],
          ]),
          remoteVideoEls: new Map([
            [42, fakeVideo(1920, 1080)],
            [7, fakeVideo(1280, 720)],
          ]),
        }),
      ),
    ).toBe(
      `${NAME}: Connected - fair\nWatching 2 shares\nAlice: 1920×1080 (good)\nBob: 1280×720 (poor)`,
    );
  });

  it('shows Broadcasting and Watching together', () => {
    const share = makeShare({ userId: 42, userName: 'Alice' });
    expect(
      buildLiveKitTooltip(
        base({
          isLiveKitRoomConnected: true,
          screenShareQuality: 'good',
          isSharing: true,
          broadcastSummary: '1080p 30fps',
          watchingShares: [share],
          shareQualities: new Map([[42, 'good']]),
          remoteVideoEls: new Map([[42, fakeVideo(1920, 1080)]]),
        }),
      ),
    ).toBe(
      `${NAME}: Connected - good\nBroadcasting: 1080p 30fps\nWatching 1 share\nAlice: 1920×1080 (good)`,
    );
  });

  it('omits the resolution when the video element has no dimensions', () => {
    const share = makeShare({ userId: 42, userName: 'Alice' });
    expect(
      buildLiveKitTooltip(
        base({
          isLiveKitRoomConnected: true,
          screenShareQuality: 'good',
          watchingShares: [share],
          shareQualities: new Map([[42, 'good']]),
          remoteVideoEls: new Map([[42, fakeVideo(0, 0)]]),
        }),
      ),
    ).toBe(`${NAME}: Connected - good\nWatching 1 share\nAlice (good)`);
  });

  it('omits the resolution when there is no video element at all', () => {
    const share = makeShare({ userId: 42, userName: 'Alice' });
    expect(
      buildLiveKitTooltip(
        base({
          isLiveKitRoomConnected: true,
          screenShareQuality: 'good',
          watchingShares: [share],
          shareQualities: new Map([[42, 'fair']]),
          remoteVideoEls: new Map(),
        }),
      ),
    ).toBe(`${NAME}: Connected - good\nWatching 1 share\nAlice (fair)`);
  });

  it('omits the quality suffix when the per-share quality is unknown', () => {
    const share = makeShare({ userId: 42, userName: 'Alice' });
    expect(
      buildLiveKitTooltip(
        base({
          isLiveKitRoomConnected: true,
          screenShareQuality: 'good',
          watchingShares: [share],
          shareQualities: new Map([[42, 'unknown']]),
          remoteVideoEls: new Map([[42, fakeVideo(1920, 1080)]]),
        }),
      ),
    ).toBe(`${NAME}: Connected - good\nWatching 1 share\nAlice: 1920×1080`);
  });

  it('omits the quality suffix when the per-share quality is missing entirely', () => {
    const share = makeShare({ userId: 42, userName: 'Alice' });
    expect(
      buildLiveKitTooltip(
        base({
          isLiveKitRoomConnected: true,
          screenShareQuality: 'good',
          watchingShares: [share],
          shareQualities: new Map(),
          remoteVideoEls: new Map([[42, fakeVideo(1920, 1080)]]),
        }),
      ),
    ).toBe(`${NAME}: Connected - good\nWatching 1 share\nAlice: 1920×1080`);
  });

  it('falls back to matrixUserId then userId when the userName is empty', () => {
    const named = makeShare({ userId: 42, userName: '   ' });
    const noMatrix = makeShare({ userId: 7, userName: '', matrixUserId: undefined });
    expect(
      buildLiveKitTooltip(
        base({
          isLiveKitRoomConnected: true,
          screenShareQuality: 'good',
          watchingShares: [named, noMatrix],
          shareQualities: new Map(),
          remoteVideoEls: new Map(),
        }),
      ),
    ).toBe(
      `${NAME}: Connected - good\nWatching 2 shares\n@alice:example.com\n7`,
    );
  });
});
