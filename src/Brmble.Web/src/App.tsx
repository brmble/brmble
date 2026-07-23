import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, useReducer } from 'react';
import bridge from './bridge';
import type { ConnectionStatus, ChatMessage, NativeBrmbleServiceStatus, ServiceStatus, ServiceStatusMap } from './types';
import { prepareImageForMumble, type PreparedMumbleImage } from './utils/imageUpload';
import { useMatrixClient } from './hooks/useMatrixClient';
import type { MatrixCredentials } from './hooks/useMatrixClient';
import { useScreenShare } from './hooks/useScreenShare';
import type { LocalShareStopReason, ShareInfo, WatchedShareEndReason } from './hooks/useScreenShare';
import { useLeaveVoiceCooldown } from './hooks/useLeaveVoiceCooldown';
import { useNotificationQueue } from './hooks/useNotificationQueue';
import { useBrmbleIdle } from './hooks/useBrmbleIdle';
import { useIdleStatus } from './hooks/useIdleStatus';
import { useIdleActions } from './hooks/useIdleActions';
import { useUnreadTracker, resetMarkersCache } from './hooks/useUnreadTracker';
import { useServiceStatus } from './hooks/useServiceStatus';
import { useServerHealth } from './hooks/useServerHealth';
import { useCompanionOverlayPublisher } from './hooks/useCompanionOverlayPublisher';

import { ErrorBoundary } from './components/ErrorBoundary';
import { Header } from './components/Header/Header';
import { BrmbleLogo } from './components/Header/BrmbleLogo';
import { Sidebar } from './components/Sidebar/Sidebar';
import { ChatPanel } from './components/ChatPanel/ChatPanel';
import { ConnectModal } from './components/ConnectModal/ConnectModal';
import { ServerList } from './components/ServerList/ServerList';
import { ConnectionState } from './components/ConnectionState/ConnectionState';
import type { ServerEntry } from './hooks/useServerlist';
import { SettingsModal, DEFAULT_SCREEN_SHARE, type ScreenShareSettings } from './components/SettingsModal/SettingsModal';
import { AvatarEditorModal } from './components/AvatarEditorModal/AvatarEditorModal';
import { CloseDialog } from './components/CloseDialog/CloseDialog';
import { OnboardingWizard } from './components/OnboardingWizard/OnboardingWizard';
import { Version } from './components/Version/Version';
import { ZoomIndicator } from './components/ZoomIndicator/ZoomIndicator';
import { useChatStore, addMessageToStore, clearChatStorage, purgeEphemeralMessages } from './hooks/useChatStore';
import { parseMessageMedia } from './utils/parseMessageMedia';
import { linkifyForMumble } from './utils/linkifyForMumble';
import { useDMStore } from './hooks/useDMStore';
import { DMContactList } from './components/DMContactList/DMContactList';
import { usePrompt, confirm, prompt } from './hooks/usePrompt';
import { NeonDGame } from './components/NeonD/NeonDGame';
import { DeathrollModal } from './components/Games/DeathrollModal';
import { RpsModal } from './components/Games/RpsModal';
import { useGameState } from './components/Games/useGameState';
import { ProfileProvider } from './contexts/ProfileContext';
import { UpdateNotification } from './components/UpdateNotification/UpdateNotification';
import { WindowResizeHandles } from './components/WindowResizeHandles/WindowResizeHandles';
import { BrokenCertNotification } from './components/BrokenCertNotification/BrokenCertNotification';
import { Notification } from './components/Notification/Notification';
import { RequestChannelModal } from './components/ChannelRequests/RequestChannelModal';
import type { NotificationStatus } from './components/Notification/Notification';
import { DEFAULT_OVERLAY, normalizeOverlaySettings, type OverlaySettings } from './components/SettingsModal/InterfaceSettingsTypes';
import type { CompanionOverlaySnapshot } from './components/CompanionOverlay/overlayTypes';
import type { CompanionId } from './components/CompanionOverlay/overlayTypes';
import {
  appendOverlayEvent,
  createChannelMessageOverlayEvent,
  createMembershipOverlayEvent,
  createServerMembershipOverlayEvent,
  createOverlaySnapshot,
  pruneOverlaySnapshot,
  resolveFullCompanionDisplay,
  setSpeakerActivity,
  updateFullCompanionContext,
} from './components/CompanionOverlay/overlayModel';
import { migrateLocalStorage } from './utils/migrateLocalStorage';
import { mapBrmbleServiceStatus } from './utils/brmbleServiceStatus';
import { areMatrixCredentialsEqual } from './utils/matrixCredentials';
import { getSavedChannelPassword } from './utils/channelPasswords';
import { getOrderedChannels } from './utils/channelOrder';
import { formatBroadcastSummary } from './utils/formatBroadcastSummary';
import { gameDisplayName } from './utils/games';
import { createWorkspaceState, workspaceReducer } from './workspace/workspaceState';
import './App.css';

export interface ScreenShareEndedNotification {
  status: NotificationStatus;
  title: string;
  detail: string;
}

export interface QueuedScreenShareEndedNotification extends ScreenShareEndedNotification {
  id: string;
}

interface WatchedShareEndedNotification {
  id: string;
  status: NotificationStatus;
  title: string;
  detail: string;
}

export type OptionalNotificationCategory =
  | 'notificationRemoteScreenShare'
  | 'notificationScreenShareStatus'
  | 'notificationIdleWarning'
  | 'notificationMovedChannel';

export interface OptionalNotificationSettings {
  notificationsDisabled?: boolean;
  notificationRemoteScreenShare?: boolean;
  notificationScreenShareStatus?: boolean;
  notificationIdleWarning?: boolean;
  notificationMovedChannel?: boolean;
}

type IncomingOptionalNotificationSettings = OptionalNotificationSettings & {
  notificationsEnabled?: boolean;
};

export const DEFAULT_OPTIONAL_NOTIFICATION_SETTINGS: Required<OptionalNotificationSettings> = {
  notificationsDisabled: false,
  notificationRemoteScreenShare: true,
  notificationScreenShareStatus: true,
  notificationIdleWarning: true,
  notificationMovedChannel: true,
};

export function normalizeOptionalNotificationSettings(settings?: IncomingOptionalNotificationSettings | null): Required<OptionalNotificationSettings> {
  const { notificationsEnabled, ...currentSettings } = settings ?? {};
  const normalized = {
    ...DEFAULT_OPTIONAL_NOTIFICATION_SETTINGS,
    ...currentSettings,
  };

  if (typeof currentSettings.notificationsDisabled !== 'boolean' && notificationsEnabled === false) {
    normalized.notificationsDisabled = true;
  }

  return normalized;
}

export function shouldShowOptionalNotification(
  settings: IncomingOptionalNotificationSettings | null | undefined,
  category: OptionalNotificationCategory,
): boolean {
  const normalized = normalizeOptionalNotificationSettings(settings);
  return !normalized.notificationsDisabled && normalized[category];
}

export interface MovedChannelNotificationInput {
  actorName?: string;
  previousChannelName?: string;
  channelName: string;
  movedToRoot?: boolean;
  wasSharing: boolean;
}

export function getScreenShareEndedNotification(reason: LocalShareStopReason): ScreenShareEndedNotification | null {
  switch (reason) {
    case 'manual':
      return null;
    case 'moved-channel':
      return null;
    case 'source-closed':
      return {
        status: 'info',
        title: 'Share ended',
        detail: 'Your screen share ended because the shared window or program was closed.',
      };
    case 'interrupted':
      return {
        status: 'info',
        title: 'Share ended',
        detail: 'Your screen share ended because of an unexpected technical issue.',
      };
    case 'error':
      return {
        status: 'error',
        title: 'Screen share failed',
        detail: 'Brmble could not keep your screen share running because of a technical issue.',
      };
    case 'blocked-capture':
      return {
        status: 'error',
        title: 'Screen share failed',
        detail: 'Brmble could not start or keep your screen share running. Windows may have blocked sharing that app or window.',
      };
    default: {
      const exhaustiveReason: never = reason;
      return exhaustiveReason;
    }
  }
}

export function getMovedChannelNotification(input: MovedChannelNotificationInput): ScreenShareEndedNotification {
  if (input.movedToRoot) {
    const actor = input.actorName || 'Someone';
    const route = input.previousChannelName
      ? `${actor} moved you out of ${input.previousChannelName}`
      : input.actorName
        ? `${input.actorName} moved you out of voice`
        : 'You were moved out of voice';

    return {
      status: 'info',
      title: 'Moved out of voice',
      detail: `${route}.${input.wasSharing ? ' Screen sharing was stopped.' : ''}`,
    };
  }

  const route = input.previousChannelName
    ? `${input.actorName || 'Someone'} moved you from ${input.previousChannelName} to ${input.channelName}`
    : input.actorName
      ? `${input.actorName} moved you to ${input.channelName}`
      : `You were moved to ${input.channelName}`;

  return {
    status: 'info',
    title: `Moved to ${input.channelName}`,
    detail: `${route}.${input.wasSharing ? ' Screen sharing was stopped.' : ''}`,
  };
}

export function createQueuedScreenShareEndedNotification(
  reason: LocalShareStopReason,
  sequence: number,
): QueuedScreenShareEndedNotification | null {
  const notification = getScreenShareEndedNotification(reason);
  if (!notification) {
    return null;
  }

  return {
    id: `screen-share-ended-${sequence}`,
    ...notification,
  };
}

export function createOptionalQueuedScreenShareEndedNotification(
  reason: LocalShareStopReason,
  sequence: number,
  settings: OptionalNotificationSettings | null | undefined,
): QueuedScreenShareEndedNotification | null {
  if (!shouldShowOptionalNotification(settings, 'notificationScreenShareStatus')) {
    return null;
  }

  return createQueuedScreenShareEndedNotification(reason, sequence);
}

export function createWatchedShareEndedNotification(
  share: ShareInfo,
  reason: WatchedShareEndReason,
  sequence: number,
): WatchedShareEndedNotification {
  return {
    id: `watched-share-ended-${sequence}`,
    status: 'info',
    title: reason === 'unexpected' ? 'Share ended unexpectedly' : 'Share ended',
    detail: `${share.userName || 'Someone'}'s share ended${reason === 'unexpected' ? ' because the screen-share connection was interrupted.' : '.'}`,
  };
}

export function createOptionalWatchedShareEndedNotification(
  share: ShareInfo,
  reason: WatchedShareEndReason,
  sequence: number,
  settings: OptionalNotificationSettings | null | undefined,
): WatchedShareEndedNotification | null {
  if (!shouldShowOptionalNotification(settings, 'notificationScreenShareStatus')) {
    return null;
  }

  return createWatchedShareEndedNotification(share, reason, sequence);
}

export function WatchedShareEndedNotifications({
  notifications,
  notifQueue,
  onRemove,
}: {
  notifications: WatchedShareEndedNotification[];
  notifQueue: { isVisible: (id: string) => boolean; unregister: (id: string) => void };
  onRemove: (id: string) => void;
}) {
  return notifications.map(notification => (
    notifQueue.isVisible(notification.id) ? (
      <Notification
        key={notification.id}
        status={notification.status}
        position="top-right"
        visible={true}
        title={notification.title}
        detail={notification.detail}
        onDismiss={() => {
          notifQueue.unregister(notification.id);
          onRemove(notification.id);
        }}
        onExited={() => {
          notifQueue.unregister(notification.id);
          onRemove(notification.id);
        }}
      />
    ) : null
  ));
}

export function replaceScreenShareEndedNotification(
  current: QueuedScreenShareEndedNotification | null,
  reason: LocalShareStopReason,
  sequence: number,
  notifQueue: { unregister: (id: string) => void },
): QueuedScreenShareEndedNotification | null {
  if (current) {
    notifQueue.unregister(current.id);
  }

  return createQueuedScreenShareEndedNotification(reason, sequence);
}

export function replaceOptionalScreenShareEndedNotification(
  current: QueuedScreenShareEndedNotification | null,
  reason: LocalShareStopReason,
  sequence: number,
  settings: OptionalNotificationSettings | null | undefined,
  notifQueue: { unregister: (id: string) => void },
): QueuedScreenShareEndedNotification | null {
  if (current) {
    notifQueue.unregister(current.id);
  }

  return createOptionalQueuedScreenShareEndedNotification(reason, sequence, settings);
}

export function shouldTreatMoveAsSharingRelated(options: {
  isSharing: boolean;
  isLocalShareStartPending: boolean;
  sharingChannelId: string | undefined;
  currentShareEndedNotification: QueuedScreenShareEndedNotification | null;
}) {
  return options.isSharing
    || options.isLocalShareStartPending
    || options.sharingChannelId !== undefined
    || options.currentShareEndedNotification !== null;
}

export function getServerRemovalNotification(input: { reason: 'kicked' | 'banned'; actorName?: string; message?: string }): ScreenShareEndedNotification {
  const actorName = input.actorName || 'the server';
  const action = input.reason === 'banned' ? 'banned' : 'kicked';
  return {
    status: input.reason === 'banned' ? 'error' : 'warning',
    title: input.reason === 'banned' ? 'Banned from server' : 'Kicked from server',
    detail: `${actorName} ${action} you from the server.${input.message ? ` Reason: ${input.message}` : ''}`,
  };
}

interface ToggleLocalScreenShareOptions {
  isSharing: boolean;
  selfLeftVoice: boolean;
  voiceChannelId?: number;
  liveKitState?: ServiceStatus['state'];
  startSharing: (roomName: string) => Promise<boolean>;
  stopSharing: () => Promise<void>;
  markLocalShareTeardownIntent?: (reason: LocalShareStopReason) => void;
  setSharingChannelId: (channelId: string | undefined) => void;
  onSharingChannelIdChanged?: (channelId: string | undefined) => void;
}

interface PendingJoinAttempt {
  channelId: number;
  channelName: string;
  passwordRetrySent: boolean;
}

function isPasswordProtectedDenialReason(data: unknown): boolean {
  const d = data as { message?: string; reason?: string } | undefined;
  const text = `${d?.message ?? ''} ${d?.reason ?? ''}`.toLowerCase();
  return text.includes('password') && text.includes('token');
}

function isPasswordProtectedJoinError(data: unknown, channel?: Channel): boolean {
  return isStructuredEnterDenied(data)
    && (channel?.hasPasswordRestriction === true || isPasswordProtectedDenialReason(data));
}

interface NextLiveKitStatusOptions {
  isSharing: boolean;
  watchingShareCount: number;
  screenShareError: string | null;
  isLocalShareStartPending: boolean;
  isViewerConnectPending: boolean;
}

interface LocalShareStartPendingTeardownOptions {
  isLocalShareStartPending: boolean;
  selfLeftVoice: boolean;
  voiceChannelId?: number;
}

export function getNextLiveKitStatusUpdate({
  isSharing,
  watchingShareCount,
  screenShareError,
  isLocalShareStartPending,
  isViewerConnectPending,
}: NextLiveKitStatusOptions): Partial<ServiceStatus> | null {
  if (isSharing || watchingShareCount > 0) {
    return { state: 'connected', error: undefined };
  }

  if (isLocalShareStartPending || isViewerConnectPending) {
    return null;
  }

  if (!screenShareError) {
    return null;
  }

  return null;
}

async function stopSharingForIntentionalDisconnect(options: {
  isSharing: boolean;
  stopSharing: () => Promise<void>;
  markLocalShareTeardownIntent?: (reason: LocalShareStopReason) => void;
}) {
  if (!options.isSharing) {
    return;
  }

  options.markLocalShareTeardownIntent?.('manual');
  await options.stopSharing();
}

export async function runIntentionalDisconnect(options: {
  isSharing: boolean;
  stopSharing: () => Promise<void>;
  markLocalShareTeardownIntent?: (reason: LocalShareStopReason) => void;
  disconnect: () => void;
  afterDisconnect?: () => void;
}) {
  await stopSharingForIntentionalDisconnect({
    isSharing: options.isSharing,
    stopSharing: options.stopSharing,
    markLocalShareTeardownIntent: options.markLocalShareTeardownIntent,
  });
  options.disconnect();
  options.afterDisconnect?.();
}

export function shouldClearLocalShareStartPending({
  isLocalShareStartPending,
  selfLeftVoice,
  voiceChannelId,
}: LocalShareStartPendingTeardownOptions): boolean {
  return isLocalShareStartPending && (selfLeftVoice || voiceChannelId == null || voiceChannelId === 0);
}

export function canWatchShareFromChannel(currentChannelId: string | undefined, shareRoomName: string): boolean {
  if (!currentChannelId || currentChannelId === 'server-root') return false;
  return shareRoomName === `channel-${currentChannelId}`;
}

export async function toggleLocalScreenShare({
  isSharing,
  selfLeftVoice,
  voiceChannelId,
  liveKitState,
  startSharing,
  stopSharing,
  setSharingChannelId,
  onSharingChannelIdChanged,
}: ToggleLocalScreenShareOptions) {
  if (isSharing) {
    await stopSharing();
    setSharingChannelId(undefined);
    onSharingChannelIdChanged?.(undefined);
    return;
  }

  if (selfLeftVoice || voiceChannelId == null || voiceChannelId === 0) {
    return;
  }

  if (liveKitState === 'connecting') {
    return;
  }

  try {
    const started = await startSharing(`channel-${voiceChannelId}`);
    if (!started) {
      return;
    }
    const nextSharingChannelId = String(voiceChannelId);
    setSharingChannelId(nextSharingChannelId);
    onSharingChannelIdChanged?.(nextSharingChannelId);
  } catch {
    // startSharing sets error state internally; App effects handle status updates.
  }
}

const SETTINGS_STORAGE_KEY = 'brmble-settings';
const INITIAL_SERVER_JOIN_OVERLAY_SUPPRESS_MS = 3_000;

const DEFAULT_TTS_VOICE = 'Zira';

export function shouldPublishServerJoinOverlayEvent(input: {
  systemType: string | undefined;
  actorName: string;
  selfName?: string;
  connectedAtMs: number | null;
  nowMs: number;
}): boolean {
  if (input.systemType !== 'userJoined') {
    return true;
  }

  if (input.actorName === input.selfName) {
    return false;
  }

  if (input.connectedAtMs === null) {
    return true;
  }

  return input.nowMs - input.connectedAtMs >= INITIAL_SERVER_JOIN_OVERLAY_SUPPRESS_MS;
}

export function getMumbleImageDeliveryState(result: PreparedMumbleImage): 'too-large' | undefined {
  return result.kind === 'too-large' ? 'too-large' : undefined;
}

export interface ImageSendRoutingDecision {
  shouldSendToMumble: boolean;
  shouldSendToMatrix: boolean;
  markNonMatrixAsError: boolean;
}

export function getImageSendRoutingDecision(options: {
  isMatrixChannel: boolean;
  mumblePreparationFailed: boolean;
  mumbleResult: PreparedMumbleImage | null;
}): ImageSendRoutingDecision {
  return {
    shouldSendToMumble: options.mumbleResult?.kind === 'sendable',
    shouldSendToMatrix: options.isMatrixChannel,
    markNonMatrixAsError: !options.isMatrixChannel
      && (options.mumblePreparationFailed || options.mumbleResult?.kind === 'too-large'),
  };
}

function getDefaultVoice(voices: SpeechSynthesisVoice[]) {
  return voices.find(v => v.name.includes(DEFAULT_TTS_VOICE)) || voices[0] || null;
}

function speakText(text: string) {
  const doSpeak = (voices: SpeechSynthesisVoice[]) => {
    try {
      if (!window.speechSynthesis) {
        return;
      }
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (stored) {
        const settings = JSON.parse(stored);
        if (settings.messages?.ttsEnabled) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.volume = (settings.messages.ttsVolume ?? 100) / 100;
          utterance.rate = 1.0;
          let voiceSelected = false;
          if (voices.length > 0) {
            const selectedVoiceName = settings.messages.ttsVoice;
            if (selectedVoiceName) {
              const selectedVoice = voices.find(v => v.name === selectedVoiceName);
              if (selectedVoice) {
                utterance.voice = selectedVoice;
                voiceSelected = true;
              }
            }
            if (!voiceSelected) {
              const defaultVoice = getDefaultVoice(voices);
              if (defaultVoice) {
                utterance.voice = defaultVoice;
              }
            }
          }
          window.speechSynthesis.speak(utterance);
        }
      }
    } catch (e) {
      console.warn('TTS error:', e);
    }
  };

  const voices = window.speechSynthesis?.getVoices() ?? [];
  if (voices.length > 0) {
    doSpeak(voices);
  } else {
    const onVoicesChanged = () => {
      window.speechSynthesis?.removeEventListener('voiceschanged', onVoicesChanged);
      doSpeak(window.speechSynthesis?.getVoices() ?? []);
    };
    window.speechSynthesis?.addEventListener('voiceschanged', onVoicesChanged);
  }
}

interface SavedServer {
  id?: string;
  label?: string;
  apiUrl?: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  registered?: boolean;
  registeredName?: string;
  defaultProfileId?: string;
}

interface Channel {
  id: number;
  name: string;
  parent?: number;
  description?: string;
  position?: number;
  isEnterRestricted?: boolean;
  canEnter?: boolean;
  hasPasswordRestriction?: boolean;
  canOpenChat?: boolean;
  canSendChat?: boolean;
}

interface User {
  session: number;
  name: string;
  channelId?: number;
  muted?: boolean;
  deafened?: boolean;
  self?: boolean;
  comment?: string;
  matrixUserId?: string;
  avatarUrl?: string;
  certHash?: string;
  companionId?: CompanionId;
  isBrmbleClient?: boolean;
}

interface BrmbleDMUser {
  matrixUserId: string;
  displayName: string;
}

interface ChannelChatAccessState {
  canRead: boolean;
  canSend: boolean;
}

type ChannelChatAccessMap = Record<string, ChannelChatAccessState>;

const MUMBLE_PERMISSION_ENTER = 4;

export function mergeChannelChatAccess(channels: Channel[], access: ChannelChatAccessMap): Channel[] {
  let changed = false;
  const merged = channels.map(channel => {
    const state = access[String(channel.id)];
    if (!state) return channel;
    if (channel.canOpenChat === state.canRead && channel.canSendChat === state.canSend) return channel;
    changed = true;
    return {
      ...channel,
      canOpenChat: state.canRead,
      canSendChat: state.canSend,
    };
  });
  return changed ? merged : channels;
}

export function getResolvedChannelChatAccess(channelIds: number[]): ChannelChatAccessMap {
  return Object.fromEntries(channelIds.map(id => [String(id), { canRead: true, canSend: true }]));
}

export function getChannelChatAccessRequestIds(channels: Channel[]): number[] {
  return [...new Set(channels.map(channel => channel.id).filter(id => id > 0))];
}

export function getChannelChatAccessRequestKey(channels: Channel[]): string {
  return getChannelChatAccessRequestIds(channels).join(',');
}

export function canOpenChannelChat(channelId: string | undefined, channels: Channel[]): boolean {
  if (!channelId) return false;
  if (channelId === 'server-root') return true;
  const channel = channels.find(c => String(c.id) === channelId);
  return channel?.canOpenChat !== false;
}

export function canSendToChannelChat(channelId: string | undefined, channels: Channel[]): boolean {
  if (!channelId) return false;
  if (channelId === 'server-root') return true;
  const channel = channels.find(c => String(c.id) === channelId);
  return channel?.canSendChat !== false;
}

export function shouldAllowChannelChatSend(
  channelId: string | undefined,
  channels: Channel[],
  statuses: ServiceStatusMap,
  brmbleServiceBootstrapPhase: BrmbleServiceBootstrapPhase,
): boolean {
  return canSendToChannelChat(channelId, channels)
    || isTemporaryChannelChatActive(channelId, statuses, brmbleServiceBootstrapPhase);
}

export function getPermittedMatrixChannelId(channelId: string | undefined, channels: Channel[]): string | null {
  if (!channelId || channelId === 'server-root') return null;
  const channel = channels.find(c => String(c.id) === channelId);
  return channel?.canOpenChat === true ? channelId : null;
}

export function getChannelSelectionOutcome(
  channelId: number,
  channels: Channel[],
  appMode: 'channels' | 'dm',
) {
  const channel = channels.find(c => c.id === channelId);
  if (!channel) return undefined;
  const canOpenChat = canOpenChannelChat(String(channelId), channels);
  return {
    channelId: String(channelId),
    channelName: channel.name,
    canOpenChat,
    shouldExitDmMode: appMode === 'dm',
    shouldClearDmSelection: true,
  };
}

export function isStructuredEnterDenied(data: unknown): boolean {
  const d = data as { type?: string; permission?: number } | undefined;
  return d?.type === 'permissionDenied' && d.permission === MUMBLE_PERMISSION_ENTER;
}

export function getChannelAccessDeniedMessage(channel: Pick<Channel, 'hasPasswordRestriction'> | undefined): string {
  return channel?.hasPasswordRestriction
    ? 'Incorrect password or no access.'
    : 'You do not have access to that channel.';
}

export type JoinAccessAction = 'join' | 'promptPassword' | 'deny';

export function getJoinAccessAction(channel: Pick<Channel, 'canEnter' | 'hasPasswordRestriction'>): JoinAccessAction {
  if (channel.canEnter === true) return 'join';
  if (channel.hasPasswordRestriction) return 'promptPassword';
  return channel.canEnter === false ? 'deny' : 'join';
}

export function isMatrixChannelChatActive(
  channelId: string | undefined,
  credentials: MatrixCredentials | null,
  statuses: ServiceStatusMap,
  selfUser: User | undefined,
  channels: Channel[] = [],
): boolean {
  if (!channelId || channelId === 'server-root') return false;
  if (!getPermittedMatrixChannelId(channelId, channels)) return false;
  if (statuses.server.state !== 'connected' || statuses.chat.state !== 'connected') return false;
  if (!selfUser?.isBrmbleClient) return false;
  return credentials?.roomMap[channelId] !== undefined;
}

export const BRMBLE_SERVICE_WARNING_ID = 'brmble-service-disconnected';

export const BRMBLE_SERVICE_TEMPORARY_CHAT_NOTICE =
  'Brmble services are currently unavailable. You can keep talking in voice chat, but new chat messages are temporary and will not be saved.';

export const BRMBLE_SERVICE_CONNECTING_CHAT_NOTICE =
  'Brmble services are still connecting. Voice chat is available; channel chat may be limited until services are ready.';

export const BRMBLE_SERVICE_DISCONNECTED_NOTIFICATION = {
  id: BRMBLE_SERVICE_WARNING_ID,
  status: 'warning' as const,
  title: 'Brmble services disconnected',
  detail: 'Voice chat is still online. Brmble features are unavailable, and chat messages sent now are temporary and will not be saved.',
};

export function isBrmbleServiceOutageActive(statuses: ServiceStatusMap): boolean {
  return statuses.voice.state === 'connected'
    && (statuses.server.state !== 'connected' || statuses.chat.state !== 'connected');
}

export type BrmbleServiceBootstrapPhase = 'idle' | 'bootstrap' | 'ready' | 'degraded';

export const BRMBLE_SERVICE_BOOTSTRAP_GRACE_MS = 15000;

export function getBrmbleServiceBootstrapPhase(
  statuses: ServiceStatusMap,
  bootstrapTimedOut: boolean,
  brmbleServicesConnectedOnce: boolean,
): BrmbleServiceBootstrapPhase {
  if (statuses.voice.state !== 'connected') return 'idle';
  if (statuses.server.state === 'connected' && statuses.chat.state === 'connected') return 'ready';
  if (brmbleServicesConnectedOnce || bootstrapTimedOut) return 'degraded';
  return 'bootstrap';
}

export function isTemporaryChannelChatActive(
  channelId: string | undefined,
  statuses: ServiceStatusMap,
  brmbleServiceBootstrapPhase: BrmbleServiceBootstrapPhase,
): boolean {
  if (!channelId || channelId === 'server-root') return false;
  return brmbleServiceBootstrapPhase === 'degraded' && isBrmbleServiceOutageActive(statuses);
}

export function getBrmbleServiceChatNotice(
  channelId: string | undefined,
  statuses: ServiceStatusMap,
  brmbleServiceBootstrapPhase: BrmbleServiceBootstrapPhase,
): string | undefined {
  if (!channelId || channelId === 'server-root') return undefined;
  if (!isBrmbleServiceOutageActive(statuses)) return undefined;
  if (brmbleServiceBootstrapPhase === 'bootstrap') return BRMBLE_SERVICE_CONNECTING_CHAT_NOTICE;
  if (brmbleServiceBootstrapPhase === 'degraded') return BRMBLE_SERVICE_TEMPORARY_CHAT_NOTICE;
  return undefined;
}

export function shouldShowBrmbleServiceWarningNotification(
  brmbleServiceOutageActive: boolean,
  dismissedForCurrentOutage: boolean,
  brmbleServiceBootstrapPhase: BrmbleServiceBootstrapPhase,
): boolean {
  return brmbleServiceOutageActive
    && brmbleServiceBootstrapPhase === 'degraded'
    && !dismissedForCurrentOutage;
}

interface QueuedMovedChannelNotification extends ScreenShareEndedNotification {
  id: string;
}

interface ServerRemovalNotification extends ScreenShareEndedNotification {
  id: 'server-removal';
}


function App() {
  const [workspace, dispatchWorkspace] = useReducer(workspaceReducer, undefined, createWorkspaceState);
  // --- Notification queue (max 3 visible, priority-based) ---
  const notifQueue = useNotificationQueue();
  // Stable ref to the notification queue so effects that must only run on
  // specific triggers (e.g. channel change) can call queue methods without
  // depending on the queue object's identity, which churns on every
  // register/unregister and would otherwise re-run those effects unexpectedly.
  const notifQueueRef = useRef(notifQueue);
  notifQueueRef.current = notifQueue;

  // --- Brmblegotchi settings state ---
  const [brmblegotchiEnabled, setBrmblegotchiEnabledState] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('brmble-settings');
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed.brmblegotchi?.enabled ?? false;
      }
    } catch { /* ignore */ }
    return false;
  });
  const setBrmblegotchiEnabled = useCallback((enabled: boolean) => {
    setBrmblegotchiEnabledState(enabled);
    try {
      const stored = localStorage.getItem('brmble-settings');
      const parsed = stored ? JSON.parse(stored) : {};
      parsed.brmblegotchi = parsed.brmblegotchi || {};
      parsed.brmblegotchi.enabled = enabled;
      localStorage.setItem('brmble-settings', JSON.stringify(parsed));
    } catch { /* ignore */ }
  }, []);
  // --- end Brmblegotchi settings state ---

  const [overlaySettings, setOverlaySettings] = useState<OverlaySettings>(() => {
    try {
      const stored = localStorage.getItem('brmble-settings');
      if (!stored) return DEFAULT_OVERLAY;
      const parsed = JSON.parse(stored);
      return normalizeOverlaySettings(parsed.overlay ?? {});
    } catch {
      return DEFAULT_OVERLAY;
    }
  });
  const [overlaySnapshot, setOverlaySnapshot] = useState<CompanionOverlaySnapshot>(() =>
    createOverlaySnapshot(null, ''),
  );
  const overlaySettingsRef = useRef(overlaySettings);
  const [optionalNotificationSettings, setOptionalNotificationSettings] = useState<Required<OptionalNotificationSettings>>(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return normalizeOptionalNotificationSettings(parsed.messages);
      }
    } catch { /* ignore */ }
    return DEFAULT_OPTIONAL_NOTIFICATION_SETTINGS;
  });
  const optionalNotificationSettingsRef = useRef(optionalNotificationSettings);
  const applyOptionalNotificationSettings = useCallback((settings?: OptionalNotificationSettings | null) => {
    const normalized = normalizeOptionalNotificationSettings(settings);
    optionalNotificationSettingsRef.current = normalized;
    setOptionalNotificationSettings(normalized);
  }, []);

  // null = status not yet received, false = no cert, true = cert exists
  const [certExists, setCertExists] = useState<boolean | null>(null);
  // Stays true for the entire onboarding flow so the wizard isn't unmounted
  // when certExists flips to true mid-wizard (e.g. after profile activation).
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [certFingerprint, setCertFingerprint] = useState('');
  const [activeProfileName, setActiveProfileName] = useState('');
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([]);
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const { statuses, effectiveStatuses, updateStatus, resetStatuses } = useServiceStatus();
  const connected = connectionStatus === 'connected';
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [serverAddress, setServerAddress] = useState('');
  const [serverLabel, setServerLabel] = useState('');
  
  const [channels, setChannels] = useState<Channel[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [currentChannelId, setCurrentChannelIdRaw] = useState<string | undefined>();
  const [currentChannelName, setCurrentChannelName] = useState<string>('');
  // Snapshot of the read-marker timestamp at the moment a channel/DM is opened,
  // captured *before* markRoomRead moves it forward.
  // This lets the unread divider persist while the user views the channel.
  // The divider is placed above the first message whose timestamp exceeds this value.
  const [channelDividerTs, setChannelDividerTs] = useState<number | null>(null);
  const [dmDividerTs, setDmDividerTs] = useState<number | null>(null);

  // Wrapper: always clear the divider snapshot when the channel changes.
  // This prevents the stale divider from a previous channel being rendered
  // (and scrolled to) during the first render after a channel switch.
  // React batches both setState calls into a single render.
  const setCurrentChannelId = useCallback((id: string | undefined) => {
    setCurrentChannelIdRaw(id);
    setChannelDividerTs(null);
  }, []);
  const [selfMuted, setSelfMuted] = useState(false);
  const [selfDeafened, setSelfDeafened] = useState(false);
  const [selfLeftVoice, setSelfLeftVoice] = useState(false);
  const [selfCanRejoin, setSelfCanRejoin] = useState(false);
  const [selfSession, setSelfSession] = useState<number>(0);
  const gameState = useGameState(selfSession);
  // Ref so long-lived bridge handlers (e.g. voice.disconnected) can reach the
  // latest game actions without being in their dependency arrays.
  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;
  const resolveGamePlayerName = useCallback(
    (userId: number) => usersRef.current.find(u => u.session === userId)?.name ?? `Player ${userId}`,
    [],
  );
  // Forfeiting is recorded as an abandon on the player's permanent stats, so gate
  // it behind a confirmation. This also guards backdrop/X clicks during a live
  // match (onClose is wired to this while a match is live).
  const confirmForfeit = useCallback(async () => {
    const ok = await confirm({
      title: 'Forfeit match?',
      message: 'Forfeiting counts as an abandon on your record. Are you sure?',
      confirmLabel: 'Forfeit',
      cancelLabel: 'Keep playing',
    });
    if (ok) gameState.forfeit();
  }, [gameState.forfeit]);
  useEffect(() => {
    // A duel challenge is time-sensitive (30s window), so give it a sort priority
    // above other `info` notifications while keeping its `info` visual status.
    if (gameState.incomingInvite) notifQueueRef.current.register('game-invite', 'info', 2);
    else notifQueueRef.current.unregister('game-invite');
  }, [gameState.incomingInvite]);
  useEffect(() => {
    // register() is a no-op when the id is already present, so when one outcome
    // replaces a prior one we must unregister first — otherwise the replacement
    // keeps the old _order and can stay hidden behind other info notifications.
    notifQueueRef.current.unregister('game-outcome');
    if (gameState.inviteOutcome) notifQueueRef.current.register('game-outcome', 'info');
  }, [gameState.inviteOutcome]);
  useEffect(() => {
    if (gameState.lastError) notifQueueRef.current.register('game-error', 'error');
    else notifQueueRef.current.unregister('game-error');
  }, [gameState.lastError]);
  useEffect(() => {
    if (gameState.outgoingInvite) notifQueueRef.current.register('game-pending', 'info', 2);
    else notifQueueRef.current.unregister('game-pending');
  }, [gameState.outgoingInvite]);
  // Channels with a live duel — drives the swords badge on channel rows. Sourced
  // from the server's channel-scoped `game.duelState` events (active true/false).
  const [duelChannelIds, setDuelChannelIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    const handleDuelState = (data: unknown) => {
      const d = data as { channelId?: number; active?: boolean };
      if (d.channelId == null) return;
      setDuelChannelIds(prev => {
        const has = prev.has(d.channelId!);
        if (d.active && has) return prev;
        if (!d.active && !has) return prev;
        const next = new Set(prev);
        if (d.active) next.add(d.channelId!);
        else next.delete(d.channelId!);
        return next;
      });
    };
    bridge.on('game.duelState', handleDuelState);
    return () => bridge.off('game.duelState', handleDuelState);
  }, []);
  const [speakingUsers, setSpeakingUsers] = useState<Map<number, boolean>>(new Map());
  const [pendingChannelAction, setPendingChannelAction] = useState<number | 'leave' | null>(null);
  const hasMatrixCredentialsForSessionRef = useRef(false);

  useEffect(() => {
    setOverlaySnapshot((prev) => ({
      ...prev,
      currentChannelId: currentChannelId && currentChannelId !== 'server-root' ? currentChannelId : null,
      currentChannelName: currentChannelName || '',
    }));
  }, [currentChannelId, currentChannelName]);

  useEffect(() => {
    overlaySettingsRef.current = overlaySettings;
  }, [overlaySettings]);

  useEffect(() => {
    optionalNotificationSettingsRef.current = optionalNotificationSettings;
  }, [optionalNotificationSettings]);

  useEffect(() => {
    if (!overlaySettings.overlayEnabled) return;
    // Clear fullCompanion state and prune immediately on enable to prevent flash of stale content
    setOverlaySnapshot((prev) => {
      const now = Date.now();
      return resolveFullCompanionDisplay(pruneOverlaySnapshot({
        ...prev,
        fullCompanion: {
          ...prev.fullCompanion,
          activeDisplay: null,
          chatQueue: [],
          eventQueue: [],
          speakerCandidates: [],
        },
      }, now), now);
    });
    const interval = window.setInterval(() => {
      setOverlaySnapshot((prev) => {
        const now = Date.now();
        return resolveFullCompanionDisplay(pruneOverlaySnapshot(prev, now), now);
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [overlaySettings.overlayEnabled]);

  // Idle / AFK tracking — see docs/research/2026-05-03-idle-status-research.md
  const brmbleIdleSec = useBrmbleIdle();
  const { voiceIdle, systemIdle, isLocked } = useIdleStatus();
  const selfVoiceChannelIdForIdle = users.find(u => u.self)?.channelId;
  const inVoiceChannelForIdle =
    !selfLeftVoice && selfVoiceChannelIdForIdle != null && selfVoiceChannelIdForIdle !== 0;
  const [hotkeyPressedBtn, setHotkeyPressedBtn] = useState<string | null>(null);
  const pendingChannelActionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'profile' | 'audio' | 'shortcuts' | 'messages' | 'appearance' | 'connection'>('profile');
  const [requestChannelOpen, setRequestChannelOpen] = useState(false);
  const [channelRequestRefreshKey, setChannelRequestRefreshKey] = useState(0);
  const [showGame, setShowGame] = useState(false);
  const [showAvatarEditor, setShowAvatarEditor] = useState(false);
  const brmbleServicesConnectedOnceRef = useRef(false);
  const [brmbleServiceBootstrapTimedOut, setBrmbleServiceBootstrapTimedOut] = useState(false);

  // Close avatar editor modal when disconnected — profile is not editable while disconnected
  useEffect(() => {
    if (!connected) setShowAvatarEditor(false);
  }, [connected]);

  useEffect(() => {
    const handleWindowState = (data: unknown) => {
      setIsMaximized((data as { maximized?: boolean }).maximized === true);
    };
    bridge.on('window.stateChanged', handleWindowState);
    return () => bridge.off('window.stateChanged', handleWindowState);
  }, []);

  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasPendingInvite] = useState(false);

  const [matrixCredentials, setMatrixCredentials] = useState<MatrixCredentials | null>(null);
  const [brmbleDMUsers, setBrmbleDMUsers] = useState<BrmbleDMUser[]>([]);
  const matrixOverlayCallbacks = useMemo(() => ({
    onChannelMessage: (channelId: string, message: ChatMessage) => {
      const settings = overlaySettingsRef.current;
      if (!settings.overlayEnabled) return;
      setOverlaySnapshot((prev) => {
        const now = Date.now();
        const next = appendOverlayEvent(
          prev,
          createChannelMessageOverlayEvent({
            actorName: message.sender,
            text: message.content,
            channelId,
            currentChannelId: prev.currentChannelId,
            timestamp: message.timestamp.getTime(),
          }),
          settings,
        );
        return resolveFullCompanionDisplay(next, now);
      });
    },
    onDirectMessage: (_matrixUserId: string, message: ChatMessage) => {
      const settings = overlaySettingsRef.current;
      if (!settings.overlayEnabled) return;
      setOverlaySnapshot((prev) => {
        const now = Date.now();
        const safeName = message.sender?.trim() || 'Unknown user';
        const next = appendOverlayEvent(
          prev,
          {
            id: `evt-${message.id}-dm`,
            kind: 'direct-message',
            actorName: safeName,
            line: `DM from ${safeName}: ${message.content || 'Message unavailable'}`,
            timestamp: message.timestamp.getTime(),
          },
          settings,
        );
        return resolveFullCompanionDisplay(next, now);
      });
    },
    onUserAvatarChanged: (matrixUserId: string, avatarUrl: string | null) => {
      fetchedAvatarIdsRef.current.delete(matrixUserId);
      setUsers(prev => prev.map(u =>
        u.matrixUserId === matrixUserId ? { ...u, avatarUrl: avatarUrl ?? undefined } : u
      ));
    },
  }), []);
  const matrixClient = useMatrixClient(matrixCredentials, matrixOverlayCallbacks);
  useCompanionOverlayPublisher(overlaySettings, overlaySnapshot);
  useServerHealth();

  // Avatar state and management
  const [currentUserAvatarUrl, setCurrentUserAvatarUrl] = useState<string | undefined>();

  // Fetch avatar when matrix client becomes available
  useEffect(() => {
    if (!matrixCredentials?.userId || !matrixClient.client) return;
    matrixClient.fetchAvatarUrl(matrixCredentials.userId).then((url) => {
      if (url) setCurrentUserAvatarUrl(url);
    });
  }, [matrixCredentials?.userId, matrixClient.client, matrixClient.fetchAvatarUrl]);

  // Keep the self user's avatarUrl in the users array in sync with currentUserAvatarUrl
  useEffect(() => {
    if (currentUserAvatarUrl === undefined) return;
    setUsers(prev => {
      const self = prev.find(u => u.self);
      if (!self || self.avatarUrl === currentUserAvatarUrl) return prev;
      return prev.map(u => u.self ? { ...u, avatarUrl: currentUserAvatarUrl } : u);
    });
  }, [currentUserAvatarUrl]);

  // Track which matrixUserIds we've already fetched avatars for to avoid re-fetching.
  // Maps matrixUserId -> number of fetch attempts so far (for retry logic).
  const fetchedAvatarIdsRef = useRef<Map<string, number>>(new Map());
  // Track pending retry timers so they can be cancelled on cleanup
  const avatarRetryTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  // Ref for fetchAvatarForUser so the safety-net useEffect can call it without
  // adding it as a dependency (it's defined later, after the refs section).
  const fetchAvatarForUserRef = useRef<(session: number, matrixUserId: string) => void>(() => {});

  // Safety-net: scan users on every change and trigger avatar fetches for any user
  // that has a matrixUserId but no avatarUrl. The primary fetch path is via bridge
  // event handlers (onVoiceConnected, onVoiceUserJoined, onUserMappingUpdated,
  // onSessionMappingSnapshot), but this catches edge cases they might miss.
  useEffect(() => {
    if (!matrixClient.client) return;

    // Prune stale entries: if a user disconnected and reconnected, their matrixUserId
    // may still be in fetchedAvatarIdsRef from the previous session.
    const currentMatrixIds = new Set(users.filter(u => u.matrixUserId).map(u => u.matrixUserId!));
    for (const id of fetchedAvatarIdsRef.current.keys()) {
      if (!currentMatrixIds.has(id)) {
        fetchedAvatarIdsRef.current.delete(id);
      }
    }

    for (const u of users) {
      if (u.matrixUserId && !u.avatarUrl) {
        fetchAvatarForUserRef.current(u.session, u.matrixUserId);
      }
    }
  }, [users, matrixClient.client]);

  // Clean up avatar retry timers only when the Matrix client or fetch function changes,
  // or when the component unmounts, so that user list updates do not cancel pending retries.
  useEffect(() => {
    return () => {
      for (const timer of avatarRetryTimersRef.current) clearTimeout(timer);
      avatarRetryTimersRef.current.clear();
    };
  }, [matrixClient.client, matrixClient.fetchAvatarUrl]);

  const onUploadAvatar = useCallback(async (blob: Blob, contentType: string) => {
    if (!matrixClient.client) return;
    try {
      const upload = await matrixClient.client.uploadContent(blob, { name: 'avatar.png', type: contentType });
      const mxcUrl = upload.content_uri;
      await matrixClient.client.setAvatarUrl(mxcUrl);
      const httpUrl = matrixClient.client.mxcUrlToHttp(mxcUrl, 128, 128, 'crop');
      setCurrentUserAvatarUrl(httpUrl ?? undefined);
      // Also update the self user in the users list so channel tree / chat show the new avatar
      if (httpUrl) {
        setUsers(prev => prev.map(u => u.self ? { ...u, avatarUrl: httpUrl } : u));
      }
      // Notify backend so Mumble texture sync won't overwrite this avatar
      bridge.send('avatar.setSource', { source: 'brmble' });
    } catch (e) {
      console.error('Failed to upload avatar:', e);
    }
  }, [matrixClient.client]);

  const onRemoveAvatar = useCallback(async () => {
    if (!matrixClient.client) return;
    try {
      await matrixClient.client.setAvatarUrl('');
      setCurrentUserAvatarUrl(undefined);
      // Also clear the self user's avatar in the users list
      setUsers(prev => prev.map(u => u.self ? { ...u, avatarUrl: undefined } : u));
      // Clear avatar source so Mumble textures can take over again
      bridge.send('avatar.setSource', { source: null });
    } catch (e) {
      console.error('Failed to remove avatar:', e);
    }
  }, [matrixClient.client]);

  // Build set of DM room IDs from matrixClient.dmRoomMap
  const dmRoomIds = useMemo(() => {
    const set = new Set<string>();
    if (matrixClient?.dmRoomMap) {
      for (const roomId of matrixClient.dmRoomMap.values()) {
        set.add(roomId);
      }
    }
    return set;
  }, [matrixClient?.dmRoomMap]);

  // Per-panel Matrix room IDs for scoping mention suggestions
  const channelMatrixRoomId = useMemo(() => {
    const matrixChannelId = getPermittedMatrixChannelId(currentChannelId, channels);
    if (matrixChannelId && matrixCredentials?.roomMap?.[matrixChannelId]) {
      return matrixCredentials.roomMap[matrixChannelId];
    }
    return null;
  }, [channels, currentChannelId, matrixCredentials?.roomMap]);

  const channelKey = currentChannelId === 'server-root' ? 'server-root' : currentChannelId ? `channel-${currentChannelId}` : 'no-channel';
  const { messages, addMessage } = useChatStore(channelKey);
  const [optimisticImages, setOptimisticImages] = useState<ChatMessage[]>([]);

  const activeChannelId = currentChannelId && currentChannelId !== 'server-root'
    ? currentChannelId
    : undefined;
  const permittedActiveMatrixChannelId = getPermittedMatrixChannelId(activeChannelId, channels);
  const selectedDmContactIdRef = useRef<string | null>(null);

  const dmStore = useDMStore({
    matrixDmLastMessages: matrixClient.dmLastMessages,
    activeDmMessages: matrixClient.activeDmMessages,
    matrixDmRoomMap: matrixClient.dmRoomMap,
    matrixDmUserDisplayNames: matrixClient.dmUserDisplayNames,
    matrixDmUserAvatarUrls: matrixClient.dmUserAvatarUrls,
    sendMatrixDM: matrixClient.sendDMMessage,
    fetchDMHistory: matrixClient.fetchDMHistory,
    brmbleUsers: brmbleDMUsers,
    isSelectedConversationForeground: () =>
      workspace.foreground.kind === 'dm' &&
      workspace.foreground.contactId === selectedDmContactIdRef.current,
    users,
    username,
    sendMumbleDM: (targetSession: number, text: string) => {
      bridge.send('voice.sendPrivateMessage', { message: linkifyForMumble(text), targetSession });
    },
  });
  selectedDmContactIdRef.current = dmStore.selectedContact?.id ?? null;

  const showDmConversation = workspace.foreground.kind === 'dm';
  const showChannelConversation = !showDmConversation;
  const isDmMode = showDmConversation;
  const messagesPanelExpanded = connected && workspace.messagesPanelExpanded;
  const foregroundDmContactId = workspace.foreground.kind === 'dm'
    ? workspace.foreground.contactId
    : null;
  const foregroundDmContact = foregroundDmContactId
    ? dmStore.contacts.find(contact => contact.id === foregroundDmContactId)
      ?? (dmStore.selectedContact?.id === foregroundDmContactId ? dmStore.selectedContact : null)
    : null;
  const foregroundDmMessages = foregroundDmContact != null && foregroundDmContact.id === dmStore.selectedContact?.id
    ? dmStore.messages
    : [];
  const selectedDmIsMumble = foregroundDmContact?.isEphemeral === true;
  const activeDmMatrixContactId = foregroundDmContactId && !selectedDmIsMumble
    ? foregroundDmContactId
    : null;

  useLayoutEffect(() => {
    matrixClient.setActiveChannel(isDmMode ? null : permittedActiveMatrixChannelId);
  }, [isDmMode, matrixClient.setActiveChannel, permittedActiveMatrixChannelId]);

  useLayoutEffect(() => {
    matrixClient.setActiveDmContact(activeDmMatrixContactId);
  }, [activeDmMatrixContactId, matrixClient.setActiveDmContact]);

  const toggleMessagesPanel = useCallback(() => {
    setShowGame(false);
    dispatchWorkspace({ type: 'TOGGLE_MESSAGES_PANEL' });
  }, []);

  // Determine active Matrix room ID (depends on dmStore.selectedContact)
  const activeMatrixRoomId = useMemo(() => {
    if (isDmMode) {
      return activeDmMatrixContactId && matrixClient?.dmRoomMap
        ? matrixClient.dmRoomMap.get(activeDmMatrixContactId) ?? null
        : null;
    }

    if (permittedActiveMatrixChannelId && matrixCredentials?.roomMap?.[permittedActiveMatrixChannelId]) {
      return matrixCredentials.roomMap[permittedActiveMatrixChannelId];
    }
    return null;
  }, [isDmMode, activeDmMatrixContactId, matrixClient?.dmRoomMap, matrixCredentials?.roomMap, permittedActiveMatrixChannelId]);

  const dmMatrixRoomId = useMemo(() => {
    if (!activeDmMatrixContactId || !matrixClient?.dmRoomMap) return null;
    return matrixClient.dmRoomMap.get(activeDmMatrixContactId) ?? null;
  }, [activeDmMatrixContactId, matrixClient?.dmRoomMap]);

  const unreadTracker = useUnreadTracker(
    matrixClient?.client ?? null,
    dmRoomIds,
    activeMatrixRoomId,
    username || null,
    certFingerprint,
  );

  // DM unread count from Matrix + Mumble ephemeral contacts
  const totalDmUnreadCount = useMemo(() => {
    let total = unreadTracker.totalDmUnreadCount;
    // Add Mumble DM unreads
    for (const contact of dmStore.contacts) {
      if (contact.isEphemeral) {
        total += contact.unreadCount > 0 ? 1 : 0;
      }
    }
    return total;
  }, [unreadTracker.totalDmUnreadCount, dmStore.contacts]);

  // Enrich DM contacts with per-contact unread counts from the unread tracker
  const dmContactsWithUnreads = useMemo(() => {
    if (!matrixClient?.dmRoomMap) return dmStore.contacts;
    return dmStore.contacts.map(contact => {
      if (contact.isEphemeral) return contact; // Mumble contacts track their own unreads
      const roomId = matrixClient.dmRoomMap?.get(contact.id);
      if (!roomId) return contact;
      const unread = unreadTracker.getRoomUnread(roomId);
      if (unread.notificationCount === contact.unreadCount) return contact;
      return { ...contact, unreadCount: unread.notificationCount };
    });
  }, [dmStore.contacts, matrixClient?.dmRoomMap, unreadTracker]);

  const updateBadge = useCallback((unread: number, invite: boolean) => {
    const effectiveUnreadDMs = unread > 0;
    bridge.send('notification.badge', { unreadDMs: effectiveUnreadDMs, pendingInvite: invite });
  }, [bridge]);

  // Refs to avoid re-registering bridge handlers on every state change
  const usersRef = useRef(users);
  usersRef.current = users;
  const isSharingRef = useRef(false);
  const stopSharingRef = useRef<(() => Promise<void>) | null>(null);
  const previousChannelIdRef = useRef<Map<number, number | undefined>>(new Map());
  const channelsRef = useRef(channels);
  channelsRef.current = channels;
  const addMessageRef = useRef(addMessage);
  addMessageRef.current = addMessage;
  const currentChannelIdRef = useRef(currentChannelId);
  currentChannelIdRef.current = currentChannelId;
  const currentChannelNameRef = useRef(currentChannelName);
  currentChannelNameRef.current = currentChannelName;
  const previousConnectionStatusRef = useRef(connectionStatus);
  const previousWorkspaceConnectionStatusRef = useRef(connectionStatus);
  const overlayConnectedAtRef = useRef<number | null>(null);
  const previousCurrentChannelIdRef = useRef(currentChannelId);
  const unreadCountRef = useRef(unreadCount);
  unreadCountRef.current = unreadCount;
  const hasPendingInviteRef = useRef(hasPendingInvite);
  hasPendingInviteRef.current = hasPendingInvite;
  const matrixCredentialsRef = useRef(matrixCredentials);
  matrixCredentialsRef.current = matrixCredentials;
  const serverAddressRef = useRef(serverAddress);
  serverAddressRef.current = serverAddress;
  const dmStoreRef = useRef(dmStore);
  dmStoreRef.current = dmStore;
  const connectionStatusRef = useRef(connectionStatus);
  connectionStatusRef.current = connectionStatus;
  const statusesRef = useRef(statuses);
  statusesRef.current = statuses;
  const liveKitStateRef = useRef(statuses.livekit.state);
  liveKitStateRef.current = statuses.livekit.state;
  const effectiveLiveKitStateRef = useRef(effectiveStatuses.livekit.state);
  effectiveLiveKitStateRef.current = effectiveStatuses.livekit.state;
  const fetchAvatarUrlRef = useRef(matrixClient.fetchAvatarUrl);
  fetchAvatarUrlRef.current = matrixClient.fetchAvatarUrl;
  const matrixClientRef = useRef(matrixClient.client);
  matrixClientRef.current = matrixClient.client;
  const handleToggleScreenShareRef = useRef<(() => void) | null>(null);
  const disconnectViewerRef = useRef<(() => Promise<void>) | null>(null);
  const handleScreenShareServiceUnavailableRef = useRef<(() => Promise<void>) | null>(null);
  const requestActiveShareDiscoveryRef = useRef<((channelId: string | undefined) => void) | null>(null);
  const previousScreenShareServiceConnectedRef = useRef(false);
  const pendingCompanionRef = useRef<{ requestId: number; next: CompanionId; previous: CompanionId } | null>(null);
  const companionRequestIdRef = useRef(0);

  const stopSharesForVoiceExit = useCallback(async () => {
    await disconnectViewerRef.current?.();
    if (isSharingRef.current) {
      await stopSharingRef.current?.();
    }
    setSharingChannelId(undefined);
    setScreenShareNotification(null);
    notifQueue.unregister('screen-share');
  }, [notifQueue]);

  const {
    autoLeftAt,
    preLeaveStartedAt,
    preLeaveCancelledAt,
    dismissNotification: dismissAutoLeftNotification,
    dismissPreLeaveCancelled,
  } = useIdleActions({
    brmbleIdleSec,
    systemIdleSec: systemIdle,
    isLocked,
    inVoiceChannel: inVoiceChannelForIdle,
    onBeforeAutoLeave: stopSharesForVoiceExit,
  });

  // Register the auto-leave-voice notification in the notification queue when fired.
  // notifQueue intentionally omitted from deps: the queue API is memoized and
  // register is idempotent, so this effect should only track the autoLeftAt edge.
  useEffect(() => {
    if (autoLeftAt !== null) {
      notifQueue.register('idle-auto-leave', 'info');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLeftAt]);

  // Register the pre-leave notification only when the timestamp changes.
  // notifQueue intentionally omitted from deps: the object identity changes on
  // every render, but `register` is idempotent and we only care about the
  // preLeaveStartedAt edge.
  const shouldShowIdlePreLeaveNotification = shouldShowOptionalNotification(optionalNotificationSettings, 'notificationIdleWarning');
  useEffect(() => {
    if (preLeaveStartedAt !== null && shouldShowIdlePreLeaveNotification) {
      notifQueue.register('idle-pre-leave', 'info');
    } else {
      notifQueue.unregister('idle-pre-leave');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preLeaveStartedAt, shouldShowIdlePreLeaveNotification]);

  // Replace the pre-leave notification with the cancellation notification only when fired.
  // notifQueue intentionally omitted from deps: the object identity changes on
  // every render, but these operations are idempotent and we only care about
  // the preLeaveCancelledAt edge.
  useEffect(() => {
    if (preLeaveCancelledAt !== null) {
      notifQueue.unregister('idle-pre-leave');
      if (shouldShowIdlePreLeaveNotification) {
        notifQueue.register('idle-pre-leave-cancelled', 'info');
      } else {
        notifQueue.unregister('idle-pre-leave-cancelled');
      }
    } else {
      notifQueue.unregister('idle-pre-leave-cancelled');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preLeaveCancelledAt, shouldShowIdlePreLeaveNotification]);

  // Fetch avatar for a specific user by matrixUserId and session, updating user state.
  // Uses refs so it can be called from both bridge event handlers (which capture initial
  // closures) and the useEffect safety-net below.  Handles deduping, bounded retries with
  // backoff, and clearing the dedupe entry after max attempts so later events can retry.
  const fetchAvatarForUser = useCallback((session: number, matrixUserId: string) => {
    if (!matrixClientRef.current) return;
    // Skip if already fetched or in-flight
    if (fetchedAvatarIdsRef.current.has(matrixUserId)) return;
    // Check if user already has an avatar
    const user = usersRef.current.find(u => u.session === session);
    if (user?.avatarUrl) return;

    const maxAttempts = 3;

    const attemptFetch = (attempt: number) => {
      fetchedAvatarIdsRef.current.set(matrixUserId, attempt + 1);
      fetchAvatarUrlRef.current(matrixUserId).then((url) => {
        if (url) {
          setUsers(prev => prev.map(u =>
            u.session === session ? { ...u, avatarUrl: url } : u
          ));
          return;
        }
        // Avatar not available yet — schedule retry (e.g. Mumble texture still uploading)
        if (attempt + 1 >= maxAttempts) {
          // Clear dedupe entry so a future bridge event (e.g. mapping update) can retry
          fetchedAvatarIdsRef.current.delete(matrixUserId);
          return;
        }
        const timer = setTimeout(() => {
          avatarRetryTimersRef.current.delete(timer);
          fetchedAvatarIdsRef.current.delete(matrixUserId);
          // Re-check: user may have disconnected or gotten an avatar since
          const current = usersRef.current.find(u => u.session === session);
          if (!current || current.avatarUrl || !current.matrixUserId) return;
          attemptFetch(attempt + 1);
        }, 2000 * (attempt + 1)); // 2s, 4s backoff
        avatarRetryTimersRef.current.add(timer);
      });
    };

    attemptFetch(0);
  }, []);
  fetchAvatarForUserRef.current = fetchAvatarForUser;

  // Tracks whether the user ever saw the 'connected' UI (ChatPanel rendered).
  // Set to true via useEffect (fires after render commit), so transient
  // connecting→connected→disconnected batches won't set it.
  // Reset to false when starting a new connection attempt.
  const userSawConnectedRef = useRef(false);
  useEffect(() => {
    if (connectionStatus === 'connected') {
      userSawConnectedRef.current = true;
    }
  }, [connectionStatus]);

  const clearPendingAction = useCallback(() => {
    if (pendingChannelActionTimeoutRef.current) {
      clearTimeout(pendingChannelActionTimeoutRef.current);
      pendingChannelActionTimeoutRef.current = null;
    }
    setPendingChannelAction(null);
  }, []);

  const pendingJoinAttemptRef = useRef<PendingJoinAttempt | null>(null);

  const clearPendingJoinAttempt = useCallback(() => {
    pendingJoinAttemptRef.current = null;
  }, []);

  const startPendingAction = useCallback((action: number | 'leave') => {
    if (pendingChannelAction === action) {
      return;
    }
    if (pendingChannelActionTimeoutRef.current) {
      clearTimeout(pendingChannelActionTimeoutRef.current);
    }
    setPendingChannelAction(action);
    pendingChannelActionTimeoutRef.current = setTimeout(() => {
      setPendingChannelAction(null);
    }, 5000);
  }, [pendingChannelAction]);

  const sendJoinChannel = useCallback((channelId: number, password?: string) => {
    if (password && password.length > 0) {
      bridge.send('voice.joinChannel', { channelId, password });
      return;
    }

    bridge.send('voice.joinChannel', { channelId });
  }, []);

  const saveChannelPasswordAndReconnect = useCallback((channelId: number, channelName: string, password: string) => {
    const normalized = password.trim();
    if (!normalized) {
      return;
    }

    bridge.send('voice.saveChannelPassword', { channelId, channelName, password: normalized });
    bridge.send('voice.reconnect', { channelId });
  }, []);

  // Handle Push-to-Talk key detection via JavaScript when app is focused
  // Keys naturally pass through to other apps when window loses focus
  useEffect(() => {
    let pttKey: string | null = null;
    let pttPressed = false;

    const updatePttKeyFromSettings = (settings: any) => {
      const newMode = settings?.audio?.transmissionMode;
      const newKey: string | null =
        (newMode === 'pushToTalk' || newMode === 'pushToTalkPlus') ? (settings?.audio?.pushToTalkKey ?? null) : null;

      if (
        pttPressed &&
        (
          (newMode !== 'pushToTalk' && newMode !== 'pushToTalkPlus') ||
          !newKey ||
          newKey !== pttKey
        )
      ) {
        pttPressed = false;
        bridge.send('voice.pttKey', { pressed: false });
      }

      pttKey = newKey;
    };

    // Listen for settings updates via bridge
    const handleSettingsCurrent = (data: unknown) => {
      const d = data as { settings?: any } | undefined;
      if (d?.settings) {
        updatePttKeyFromSettings(d.settings);
        setOverlaySettings(normalizeOverlaySettings(d.settings.overlay ?? {}));
        applyOptionalNotificationSettings(d.settings.messages);
      }
    };

    bridge.on('settings.current', handleSettingsCurrent);
    bridge.on('settings.updated', handleSettingsCurrent);

    // Also listen to storage changes as fallback (for other tabs)
    const handleStorage = () => {
      try {
        const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (stored) {
          const settings = JSON.parse(stored);
          updatePttKeyFromSettings(settings);
          setOverlaySettings(normalizeOverlaySettings(settings.overlay ?? {}));
          applyOptionalNotificationSettings(settings.messages);
        }
      } catch {}
    };
    window.addEventListener('storage', handleStorage);

    // Initial check
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      try {
        const settings = JSON.parse(stored);
        updatePttKeyFromSettings(settings);
        applyOptionalNotificationSettings(settings.messages);
      } catch {}
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.defaultPrevented) return;
      if (e.repeat) return;
      
      // Handle PTT
      if (pttKey) {
        const pressedKey = e.code;
        if (pressedKey === pttKey && !pttPressed) {
          e.preventDefault();
          pttPressed = true;
          bridge.send('voice.pttKey', { pressed: true });
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!pttKey) return;
      const pressedKey = e.code;
      if (pressedKey === pttKey && pttPressed) {
        pttPressed = false;
        bridge.send('voice.pttKey', { pressed: false });
      }
    };

    // Force-release on focus loss: if the user is holding PTT when the window
    // loses focus, the matching keyup may never reach us. Reset local state
    // and tell native immediately, so the next physical press starts a clean
    // cycle (defense-in-depth for #538).
    const handleBlur = () => {
      if (pttPressed) {
        pttPressed = false;
        bridge.send('voice.pttKey', { pressed: false });
      }
    };

    // Native side can force-release us too (e.g. ReleaseAllHeld fires on
    // channel join). Without this, local pttPressed stays true and the next
    // keydown is suppressed by the "if (!pttPressed)" guard.
    const handleNativePttForceRelease = (data: unknown) => {
      const d = data as { pressed?: boolean; forced?: boolean } | undefined;
      if (d?.forced && d.pressed === false) {
        pttPressed = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('blur', handleBlur);
    bridge.on('voice.pttKey', handleNativePttForceRelease);

    return () => {
      bridge.off('settings.current', handleSettingsCurrent);
      bridge.off('settings.updated', handleSettingsCurrent);
      bridge.off('voice.pttKey', handleNativePttForceRelease);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // Register all bridge handlers once on mount
  useEffect(() => {
    const onBrmbleServiceStatus = (data: unknown) => {
      const status = data as NativeBrmbleServiceStatus;
      const mapped = mapBrmbleServiceStatus(status);
      if (!mapped) return;
      updateStatus(mapped.service, mapped.update);
      if ((status.service === 'session' || status.service === 'screenshare') && mapped.update.state !== 'connected') {
        void handleScreenShareServiceUnavailableRef.current?.();
      }
      if (status.service === 'screenshare') {
        const nowConnected = status.state === 'connected';
        const wasConnected = previousScreenShareServiceConnectedRef.current;
        previousScreenShareServiceConnectedRef.current = nowConnected;
        // Only run discovery when the screenshare service *transitions* into
        // connected. Discovery success itself emits a "connected" status, so
        // re-triggering on every "connected" message caused an infinite
        // discovery loop that exhausted the server rate limit (HTTP 429).
        if (nowConnected && !wasConnected) {
          requestActiveShareDiscoveryRef.current?.(currentChannelIdRef.current);
        }
      }
    };

    const onVoiceConnected = ((data: unknown) => {
      clearPendingJoinAttempt();
      setConnectionStatus('connected');
      updateStatus('voice', { state: 'connected', error: undefined });
      setBrmbleServiceBootstrapTimedOut(false);
      overlayConnectedAtRef.current = Date.now();
      notifQueue.unregister('server-removal');
      setServerRemovalNotification(null);
      const d = data as { username?: string; channelId?: number; channels?: Channel[]; users?: User[] } | undefined;

      // Use actual channel from server instead of assuming root.
      // Registered Mumble users may be placed in their last channel.
      const initialChannelId = d?.channelId ?? 0;
      if (initialChannelId === 0) {
        setCurrentChannelId('server-root');
        setCurrentChannelName('');
      } else {
        setCurrentChannelId(String(initialChannelId));
        const channelName = d?.channels?.find(ch => ch.id === initialChannelId)?.name;
        setCurrentChannelName(channelName || '');
      }
      
      if (d?.username) {
        setUsername(d.username);
      }
      if (d?.channels) {
        setChannels(getOrderedChannels(d.channels));
      }
      if (d?.users) {
        setUsers(d.users);
        const selfUser = d.users.find(u => u.self);
        if (selfUser) {
          setSelfMuted(selfUser.muted || false);
          setSelfDeafened(selfUser.deafened || false);
          setSelfSession(selfUser.session);
          if (selfUser.companionId && selfUser.companionId !== overlaySettingsRef.current.myCompanion) {
            const requestId = ++companionRequestIdRef.current;
            pendingCompanionRef.current = {
              requestId,
              next: overlaySettingsRef.current.myCompanion,
              previous: selfUser.companionId,
            };
            bridge.send('voice.setCompanion', { companionId: overlaySettingsRef.current.myCompanion, requestId });
          }
        }
        // Fetch avatars for users already present at connect time
        for (const u of d.users) {
          if (u.matrixUserId && !u.self && !u.avatarUrl) {
            fetchAvatarForUser(u.session, u.matrixUserId);
          }
        }
      }

      // Persist Mumble registration status to the saved server entry.
      // Password is intentionally omitted here (not stored in localStorage);
      // the backend preserves the existing password when an update omits it.
      const reg = data as { registered?: boolean; registeredName?: string } | undefined;
      if (reg?.registered) {
        try {
          const stored = localStorage.getItem('brmble-server');
          if (stored) {
            const savedServer = JSON.parse(stored) as SavedServer;
            if (savedServer.id) {
              const updated = { ...savedServer, registered: true, registeredName: reg.registeredName };
              bridge.send('servers.update', updated);
              localStorage.setItem('brmble-server', JSON.stringify(updated));
            }
          }
        } catch { /* ignore parse errors */ }
      } else {
        // Clear stale registration when server reports not-registered
        try {
          const stored = localStorage.getItem('brmble-server');
          if (stored) {
            const savedServer = JSON.parse(stored) as SavedServer;
            if (savedServer.id && savedServer.registered) {
              const updated = { ...savedServer, registered: false, registeredName: undefined };
              bridge.send('servers.update', updated);
              localStorage.setItem('brmble-server', JSON.stringify(updated));
            }
          }
        } catch { /* ignore parse errors */ }
      }
    });

    const onVoiceDisconnected = (data: unknown) => {
      clearPendingAction();
      clearPendingJoinAttempt();
      purgeEphemeralMessages('server-root');
      const d = data as { reconnectAvailable?: boolean; reason?: 'kicked' | 'banned' | string; actorName?: string; message?: string } | null;

      if (d?.reason === 'kicked' || d?.reason === 'banned') {
        const notification = {
          id: 'server-removal' as const,
          ...getServerRemovalNotification({
            reason: d.reason,
            actorName: d.actorName,
            message: d.message,
          }),
        };
        setServerRemovalNotification(notification);
      }

      if (d?.reconnectAvailable && userSawConnectedRef.current) {
        // User was connected and saw the UI, then lost connection
        setConnectionStatus('disconnected');
        updateStatus('voice', { state: 'disconnected' });
      } else if (!userSawConnectedRef.current && connectionStatusRef.current !== 'idle') {
        // User never saw the connected UI — initial connect failed
        setConnectionStatus('failed');
        setServerAddress('');
        setServerLabel('');
        updateStatus('voice', { state: 'disconnected', label: undefined });
      } else {
        // Normal intentional disconnect — go back to server list
        setConnectionStatus('idle');
        setServerAddress('');
        setServerLabel('');
        updateStatus('voice', { state: 'disconnected', label: undefined });
      }
      setChannels([]);
      setUsers([]);
      setCurrentChannelId(undefined);
      setCurrentChannelName('');
      setSelfMuted(false);
      setSelfDeafened(false);
      setSelfLeftVoice(false);
      setSelfCanRejoin(false);
      setSelfSession(0);
      setSpeakingUsers(new Map());
      // Clear any in-flight game state (pending invite notification, active match,
      // errors) so a dropped/kicked connection doesn't leave a stale challenge that
      // would produce a spurious "Not connected" error when Accept can no longer
      // reach the server. The server tears the match down on its side.
      gameStateRef.current.reset();
      setDuelChannelIds(new Set());
      hasMatrixCredentialsForSessionRef.current = false;
      setMatrixCredentials(null);
      setBrmbleDMUsers([]);
      setCurrentUserAvatarUrl(undefined);
      fetchedAvatarIdsRef.current.clear();
      disconnectViewerRef.current?.();
      setSharingChannelId(undefined);
      setScreenShareNotification(null);
      notifQueue.unregister('screen-share');
      // Reset divider timestamps so stale snapshots from the previous session
      // don't persist across disconnect/reconnect cycles.
      setChannelDividerTs(null);
      setDmDividerTs(null);
      updateStatus('livekit', { state: 'idle', error: undefined });
      updateStatus('server', { state: 'idle', error: undefined });
      setBrmbleServiceBootstrapTimedOut(false);
    };

    const onServerCredentials = (data: unknown) => {
      setConnectionError(null);
      const wrapped = data as { matrix?: MatrixCredentials; userMappings?: Record<string, string> } | undefined;
      const d = wrapped?.matrix;
      if (d?.homeserverUrl && d.accessToken && d.userId && d.roomMap) {
        const directoryUsers = Object.entries(wrapped?.userMappings ?? {})
          .map(([displayName, matrixUserId]) => ({ displayName, matrixUserId }))
          .filter(user => user.matrixUserId !== d.userId)
          .sort((left, right) => left.displayName.localeCompare(right.displayName));
        setBrmbleDMUsers(directoryUsers);
        if (!hasMatrixCredentialsForSessionRef.current) {
          clearChatStorage();
          hasMatrixCredentialsForSessionRef.current = true;
        }
        setMatrixCredentials(prev => {
          return areMatrixCredentialsEqual(prev, d) ? prev : d;
        });
      }
    };

    const onVoiceAuthError = (data: unknown) => {
      const d = data as { error?: string; message?: string; name?: string } | undefined;
      if (d?.error === 'name_taken') {
        setConnectionError(`Username "${d.name || ''}" is already taken. Please choose a different name.`);
      } else {
        setConnectionError(d?.message || 'Authentication failed.');
      }
    };

    const onVoiceError = ((data: unknown) => {
      clearPendingAction();
      const pendingJoinAttempt = pendingJoinAttemptRef.current;
      const pendingChannel = pendingJoinAttempt
        ? channelsRef.current.find(channel => channel.id === pendingJoinAttempt.channelId)
        : undefined;
      if (pendingJoinAttempt && isPasswordProtectedJoinError(data, pendingChannel)) {
        if (pendingChannel && pendingChannel.hasPasswordRestriction !== true) {
          setChannels(prev => prev.map(channel => channel.id === pendingChannel.id
            ? { ...channel, hasPasswordRestriction: true }
            : channel));
        }

        if (!pendingJoinAttempt.passwordRetrySent) {
          pendingJoinAttemptRef.current = {
            ...pendingJoinAttempt,
            passwordRetrySent: true,
          };

          void (async () => {
            const savedPassword = await getSavedChannelPassword(pendingJoinAttempt.channelId);
            const password = await prompt({
              title: 'Channel Password',
              message: `Enter the password for ${pendingJoinAttempt.channelName}. Save the password and reconnect to authenticate it.`,
              placeholder: 'Password',
              defaultValue: savedPassword,
              confirmLabel: 'Save & reconnect',
              cancelLabel: 'Cancel',
              isPassword: true,
            });

            if (!password) {
              clearPendingJoinAttempt();
              return;
            }

            clearPendingJoinAttempt();
            saveChannelPasswordAndReconnect(pendingJoinAttempt.channelId, pendingJoinAttempt.channelName, password);
          })();
          return;
        }
      }

      // Clear pending join attempt for any error that isn't eligible for password retry
      if (pendingJoinAttempt) {
        clearPendingJoinAttempt();
      }

      if (isStructuredEnterDenied(data)) {
        const d = data as { channelId?: number };
        const deniedChannel = d.channelId != null
          ? channelsRef.current.find(channel => channel.id === d.channelId)
          : pendingJoinAttempt
            ? channelsRef.current.find(channel => channel.id === pendingJoinAttempt.channelId)
            : undefined;
        addMessageToStore('server-root', 'Server', getChannelAccessDeniedMessage(deniedChannel), 'system');
        clearPendingJoinAttempt();
        return;
      }

      const d = data as { message?: string } | undefined;
      const errorMsg = d?.message || 'Unknown error';
      console.error('Voice error:', errorMsg);
      updateStatus('voice', { error: errorMsg });
    });

    const onVoiceMessage = ((data: unknown) => {
      const d = data as {
        message: string;
        senderSession?: number;
        channelIds?: number[];
        treeIds?: number[];
        sessions?: number[];
        certHash?: string;
      } | undefined;
      if (!d?.message) return;

      const selfUser = usersRef.current.find(u => u.self);
      if (selfUser && d.senderSession === selfUser.session) return;
      if (d.senderSession === undefined) return;

      const senderUser = usersRef.current.find(u => u.session === d.senderSession);
      const senderName = senderUser?.name || 'Unknown';

      const isPrivateMessage = d.sessions && d.sessions.length > 0 &&
        (!d.channelIds || d.channelIds.length === 0);

      // Channel messages: use Mumble path while Brmble/Matrix is not fully restored.
      if (!isPrivateMessage) {
        const targetChannelIds = d.channelIds && d.channelIds.length > 0
          ? d.channelIds
          : d.treeIds;
        if (targetChannelIds && targetChannelIds.length > 0) {
          const channelId = String(targetChannelIds[0]);
          const selfUser = usersRef.current.find(u => u.self);
          const matrixActive = isMatrixChannelChatActive(
            channelId,
            matrixCredentialsRef.current,
            statusesRef.current,
            selfUser,
            channelsRef.current,
          );
          if (!matrixActive) {
            const storeKey = `channel-${channelId}`;
        const messageMedia = parseMessageMedia(d.message);
            if (currentChannelIdRef.current === channelId) {
              addMessageRef.current(senderName, messageMedia.text, undefined, undefined, messageMedia.media.length > 0 ? messageMedia.media : undefined);
            } else {
              addMessageToStore(storeKey, senderName, messageMedia.text, undefined, undefined, messageMedia.media.length > 0 ? messageMedia.media : undefined);
            }
          }
        }
        return;
      }

      // Private Mumble message → route to DM store
      if (d.certHash) {
        // Mumble clients send HTML — strip tags and decode entities for plain-text display
        const { text } = parseMessageMedia(d.message);
        const plainText = text.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
        dmStoreRef.current.receiveMumbleDM(d.certHash, d.senderSession!, senderName, plainText || d.message);
      }
    });

    const onVoiceSystem = ((data: unknown) => {
      const d = data as { message: string; systemType?: string; html?: boolean } | undefined;
      if (d?.message) {
        const currentKey = currentChannelIdRef.current;
        if (currentKey === 'server-root') {
          addMessageRef.current('Server', d.message, 'system', d.html, undefined, d.systemType);
        } else {
          addMessageToStore('server-root', 'Server', d.message, 'system', d.html, undefined, d.systemType);
        }

        const overlaySettings = overlaySettingsRef.current;
        if (overlaySettings.overlayEnabled && overlaySettings.showJoinLeaveEvents) {
          const systemType = d.systemType;
          if (systemType === 'userJoined' || systemType === 'userLeft') {
            const suffix = systemType === 'userJoined'
              ? ' connected to the server'
              : ' disconnected from the server';
            const actor = d.message.endsWith(suffix)
              ? d.message.slice(0, -suffix.length).trim()
              : '';
            const selfUser = usersRef.current.find(u => u.self);
            const now = Date.now();
            if (actor && shouldPublishServerJoinOverlayEvent({
              systemType,
              actorName: actor,
              selfName: selfUser?.name,
              connectedAtMs: overlayConnectedAtRef.current,
              nowMs: now,
            })) {
              setOverlaySnapshot((prev) => {
                const next = appendOverlayEvent(
                  prev,
                  createServerMembershipOverlayEvent({
                    kind: systemType === 'userJoined' ? 'user-joined' : 'user-left',
                    actorName: actor,
                    line: d.message,
                    timestamp: now,
                  }),
                  overlaySettings,
                );
                return resolveFullCompanionDisplay(next, now);
              });
            }
          }
        }
      }
    });

    // Ephemeral Deathroll spectator feed. Live-only inline system messages for
    // everyone in the match's channel; never persisted (systemType 'game' is in
    // EPHEMERAL_TYPES, so it is purged from localStorage and never sent to Matrix).
    const onGameFeed = ((data: unknown) => {
      const d = data as { channelId?: number; text?: string; gameType?: string } | undefined;
      if (d?.channelId === undefined || !d.text) return;
      const channelId = String(d.channelId);
      const gameType = d.gameType || undefined;
      const sender = gameDisplayName(gameType);
      if (currentChannelIdRef.current === channelId) {
        addMessageRef.current(sender, d.text, 'system', undefined, undefined, 'game', gameType);
      } else {
        addMessageToStore(`channel-${channelId}`, sender, d.text, 'system', undefined, undefined, 'game', gameType);
      }
    });

    const onVoiceUserJoined = ((data: unknown) => {
      const d = data as { session: number; name: string; channelId?: number; muted?: boolean; deafened?: boolean; self?: boolean; comment?: string; matrixUserId?: string; certHash?: string; companionId?: CompanionId; isBrmbleClient?: boolean } | undefined;
      if (d?.session && d.channelId !== undefined) {
        const previousChannelId = previousChannelIdRef.current.get(d.session);
        const knownUser = usersRef.current.find(u => u.session === d.session);
        const lastKnownChannelId = previousChannelId ?? knownUser?.channelId;
        const selfUser = usersRef.current.find(u => u.self);
        const selfChannelId = selfUser?.channelId;
        const enteredSelfChannel = !d.self
          && selfChannelId !== undefined
          && d.channelId === selfChannelId
          && lastKnownChannelId !== selfChannelId;
        
        setUsers(prev => {
          const existing = prev.find(u => u.session === d.session);
          if (existing) {
            const updatedChannelId = d.channelId !== undefined ? d.channelId : existing.channelId;
            // Preserve certHash and matrixUserId — don't let falsy updates overwrite valid values
            const certHash = d.certHash || existing.certHash;
            const matrixUserId = d.matrixUserId || existing.matrixUserId;
            const isBrmbleClient = d.isBrmbleClient !== undefined ? d.isBrmbleClient : existing.isBrmbleClient;
            return prev.map(u => u.session === d.session ? { ...u, ...d, channelId: updatedChannelId, certHash, matrixUserId, isBrmbleClient } : u);
          }
          return [...prev, d];
        });

        // Fetch avatar for newly joined user if they have a matrixUserId
        if (d.matrixUserId && !d.self) {
          fetchAvatarForUser(d.session, d.matrixUserId);
        }

        if (enteredSelfChannel) {
          speakText(`${d.name} joined`);
        }
        
        previousChannelIdRef.current.set(d.session, d.channelId);

        const overlaySettings = overlaySettingsRef.current;
        if (overlaySettings.overlayEnabled) {
          if (enteredSelfChannel) {
            setOverlaySnapshot((prev) => {
              const now = Date.now();
              const next = appendOverlayEvent(
                prev,
                createMembershipOverlayEvent({
                  kind: 'user-joined',
                  actorName: d.name,
                  currentChannelId: prev.currentChannelId,
                  eventChannelId: String(d.channelId),
                  timestamp: now,
                }),
                overlaySettings,
              );
              return resolveFullCompanionDisplay(next, now);
            });
          } else if (knownUser && knownUser.muted !== undefined && d.muted !== undefined && knownUser.muted !== d.muted) {
            const inSameChannel = !d.self && selfChannelId !== undefined && (d.channelId ?? knownUser.channelId) === selfChannelId;
            if (inSameChannel) {
              setOverlaySnapshot((prev) => {
                const now = Date.now();
                const next = appendOverlayEvent(
                  prev,
                  createMembershipOverlayEvent({
                    kind: d.muted ? 'user-muted' : 'user-unmuted',
                    actorName: d.name,
                    currentChannelId: prev.currentChannelId,
                    eventChannelId: String(d.channelId ?? knownUser.channelId),
                    timestamp: now,
                  }),
                  overlaySettings,
                );
                return resolveFullCompanionDisplay(next, now);
              });
            }
          }
        }

        // Update Mumble DM contact session on reconnect
        if (d.certHash && !d.self) {
          dmStoreRef.current.updateMumbleSession(d.certHash, d.session, d.name);
        }

      }
    });

    const onVoiceChannelJoined = ((data: unknown) => {
      const d = data as Channel | undefined;
      if (d?.id !== undefined) {
        setChannels(prev => {
          const next = prev.some(channel => channel.id === d.id)
            ? prev.map(channel => channel.id === d.id ? { ...channel, ...d } : channel)
            : [...prev, d];

          return getOrderedChannels(next);
        });
      }
    });

    const onVoiceChannelRemoved = ((data: unknown) => {
      const d = data as { id: number } | undefined;
      if (d?.id !== undefined) {
        setChannels(prev => prev.filter(c => c.id !== d.id));
      }
    });

  const onVoiceChannelChanged = ((data: unknown) => {
      clearPendingAction();
      clearPendingJoinAttempt();
      const d = data as { channelId: number; name?: string; previousChannelId?: number; actorName?: string; reason?: 'moved' | 'unknown' } | undefined;
      if (d?.channelId !== undefined && d?.channelId !== null) {
        const computedWasSharing = shouldTreatMoveAsSharingRelated({
          isSharing: isSharingRef.current || wasLocalShareRecentlyActiveRef.current,
          isLocalShareStartPending: isLocalShareStartPendingRef.current,
          sharingChannelId: sharingChannelIdRef.current,
          currentShareEndedNotification: screenShareEndedNotificationRef.current,
        });
        const wasSharing = (d.reason === 'moved' && ignoreNextMovedSharingRef.current) ? false : computedWasSharing;
        if (d.reason === 'moved' && ignoreNextMovedSharingRef.current) {
          ignoreNextMovedSharingRef.current = false;
        }
        if (d.reason === 'moved') {
          if (movedChannelNotificationRef.current) {
            notifQueue.unregister(movedChannelNotificationRef.current.id);
            movedChannelNotificationRef.current = null;
          }

          if (wasSharing) {
            markLocalShareTeardownIntent('moved-channel');
            void stopSharingRef.current?.();
          }
          if (screenShareEndedNotificationRef.current) {
            notifQueue.unregister(screenShareEndedNotificationRef.current.id);
            screenShareEndedNotificationRef.current = null;
            setScreenShareEndedNotification(null);
          }

          if (shouldShowOptionalNotification(optionalNotificationSettingsRef.current, 'notificationMovedChannel')) {
            const channelName = d.name
              || channelsRef.current.find(c => c.id === d.channelId)?.name
              || (d.channelId === 0 ? (serverLabel || 'Server') : `Channel ${d.channelId}`);
            const previousChannelName = d.previousChannelId !== undefined
              ? channelsRef.current.find(c => c.id === d.previousChannelId)?.name
                || (currentChannelIdRef.current === String(d.previousChannelId) ? currentChannelNameRef.current : undefined)
              : undefined;
            const notification = {
              id: `channel-moved-${nextMovedChannelNotificationIdRef.current++}`,
              ...getMovedChannelNotification({
                actorName: d.actorName,
                previousChannelName,
                channelName,
                movedToRoot: d.channelId === 0,
                wasSharing,
              }),
            };
            movedChannelNotificationRef.current = notification;
            setMovedChannelNotification(notification);
          } else {
            setMovedChannelNotification(null);
          }
          sharingChannelIdRef.current = undefined;
          setSharingChannelId(undefined);
          wasLocalShareRecentlyActiveRef.current = false;
        }

        if (d.channelId === 0) {
          setCurrentChannelId('server-root');
          setCurrentChannelName('');
        } else {
          setCurrentChannelId(String(d.channelId));
          if (d.name) {
            setCurrentChannelName(d.name);
          } else {
            const channel = channelsRef.current.find(c => c.id === d.channelId);
            setCurrentChannelName(channel?.name || '');
          }
        }
      }
    });

    const onVoiceUserLeft = ((data: unknown) => {
      const d = data as { session: number; name?: string; channelId?: number; certHash?: string } | undefined;
      if (d?.session) {
        const selfUser = usersRef.current.find(u => u.self);
        const leavingUser = usersRef.current.find(u => u.session === d.session);
        const userName = d.name || leavingUser?.name;
        const channelId = d.channelId !== undefined ? d.channelId : leavingUser?.channelId;

        if (
          userName &&
          selfUser &&
          d.session !== selfUser.session &&
          selfUser.channelId !== undefined &&
          channelId === selfUser.channelId
        ) {
          speakText(`${userName} left`);
        }

        // Update Mumble DM contact session to null (offline)
        const certHash = d.certHash || leavingUser?.certHash;
        if (certHash) {
          dmStoreRef.current.updateMumbleSession(certHash, null);
        }

        const overlaySettings = overlaySettingsRef.current;
        if (overlaySettings.overlayEnabled && userName && channelId !== undefined) {
          const eventChannelId = String(channelId);
          setOverlaySnapshot((prev) => {
            const now = Date.now();
            const next = appendOverlayEvent(
              prev,
              createMembershipOverlayEvent({
                kind: 'user-left',
                actorName: userName,
                currentChannelId: prev.currentChannelId,
                eventChannelId,
                timestamp: now,
              }),
              overlaySettings,
            );
            return resolveFullCompanionDisplay(next, now);
          });
        }

        setUsers(prev => prev.filter(u => u.session !== d.session));
      }
    });

    const onSelfMuteChanged = ((data: unknown) => {
      const d = data as { muted: boolean } | undefined;
      if (d?.muted !== undefined) {
        setSelfMuted(d.muted);
      }
    });

    const onSelfDeafChanged = ((data: unknown) => {
      const d = data as { deafened: boolean } | undefined;
      if (d?.deafened !== undefined) {
        setSelfDeafened(d.deafened);
      }
    });

    const onLeftVoiceChanged = ((data: unknown) => {
      clearPendingAction();
      const d = data as { leftVoice: boolean } | undefined;
      if (d?.leftVoice !== undefined) {
        setSelfLeftVoice(d.leftVoice);
        if (d.leftVoice) {
          void stopSharesForVoiceExit();
          handleSelectServer();
        }
      }
    });

    const onCanRejoinChanged = ((data: unknown) => {
      const d = data as { canRejoin: boolean } | undefined;
      if (d?.canRejoin !== undefined) {
        setSelfCanRejoin(d.canRejoin);
      }
    });

    const onVoiceUserSpeaking = ((data: unknown) => {
      const d = data as { session: number } | undefined;
      if (d?.session !== undefined) {
        setSpeakingUsers(prev => {
          const next = new Map(prev);
          next.set(d.session, true);
          return next;
        });

        const overlaySettings = overlaySettingsRef.current;
        if (overlaySettings.overlayEnabled && overlaySettings.showActiveSpeakers) {
          const user = usersRef.current.find((entry) => entry.session === d.session);
          if (user?.channelId !== undefined) {
            const speakerChannelId = user.channelId;
            setOverlaySnapshot((prev) => {
              if (prev.currentChannelId !== String(speakerChannelId)) {
                return prev;
              }

              const now = Date.now();
              const next = setSpeakerActivity(
                prev,
                { session: d.session, name: user.name, channelId: speakerChannelId },
                true,
                now,
              );
              return resolveFullCompanionDisplay(next, now);
            });
          }
        }
      }
    });

    const onVoiceUserSilent = ((data: unknown) => {
      const d = data as { session: number } | undefined;
      if (d?.session !== undefined) {
        setSpeakingUsers(prev => {
          const next = new Map(prev);
          next.delete(d.session);
          return next;
        });

        const overlaySettings = overlaySettingsRef.current;
        if (overlaySettings.overlayEnabled && overlaySettings.showActiveSpeakers) {
          const user = usersRef.current.find((entry) => entry.session === d.session);
          if (user?.channelId !== undefined) {
            const speakerChannelId = user.channelId;
            setOverlaySnapshot((prev) => {
              const now = Date.now();
              const next = setSpeakerActivity(
                prev,
                { session: d.session, name: user.name, channelId: speakerChannelId },
                false,
                now,
              );
              return resolveFullCompanionDisplay(next, now);
            });
          }
        }
      }
    });

    const onVoiceModeration = ((data: unknown) => {
      const d = data as { kind?: 'user-kicked' | 'user-banned'; name?: string; channelId?: number } | undefined;
      const overlaySettings = overlaySettingsRef.current;
      if (d?.kind && d.name && d.channelId !== undefined && overlaySettings.overlayEnabled) {
        const kind = d.kind;
        const userName = d.name;
        const eventChannelId = String(d.channelId);
        setOverlaySnapshot((prev) => {
          const now = Date.now();
          const next = appendOverlayEvent(
            prev,
            createMembershipOverlayEvent({
              kind,
              actorName: userName,
              currentChannelId: prev.currentChannelId,
              eventChannelId,
              timestamp: now,
            }),
            overlaySettings,
          );
          return resolveFullCompanionDisplay(next, now);
        });
      }
    });

    const onVoiceUserCommentChanged = ((data: unknown) => {
      const d = data as { session: number; comment?: string } | undefined;
      if (d?.session !== undefined) {
        setUsers(prev => prev.map(u =>
          u.session === d.session ? { ...u, comment: d.comment } : u
        ));
      }
    });

    // Map shortcut action names to UserPanel button names
    const ACTION_TO_BTN: Record<string, string> = {
      toggleMute: 'mute',
      toggleMuteDeafen: 'deaf',
      toggleLeaveVoice: 'leave',
      toggleDmScreen: 'dm',
      toggleScreenShare: 'screen',
    };

    const onShortcutPressed = (data: unknown) => {
      const d = data as { action: string } | undefined;
      if (d?.action) {
        const btn = ACTION_TO_BTN[d.action];
        if (btn) setHotkeyPressedBtn(btn);
      }
    };

    const onShortcutReleased = (data: unknown) => {
      const d = data as { action: string } | undefined;
      if (d?.action) {
        const btn = ACTION_TO_BTN[d.action];
        if (btn) setHotkeyPressedBtn(prev => prev === btn ? null : prev);
      }
    };

    const onToggleDmScreen = () => {
      if (connectionStatusRef.current === 'connected') {
        toggleMessagesPanel();
      }
    };

    const onToggleScreenShare = () => {
      handleToggleScreenShareRef.current?.();
    };

    const onToggleGame = () => {
      setShowGame(prev => !prev);
    };

    const onShowCloseDialog = () => {
      setShowCloseDialog(true);
    };

    const onCertStatus = (data: unknown) => {
      const d = data as { exists: boolean; fingerprint?: string } | undefined;
      if (d?.exists) {
        setCertExists(true);
        const fp = d.fingerprint ?? '';
        if (fp) migrateLocalStorage(fp);
        setCertFingerprint(fp);
      } else {
        setCertExists(false);
        setShowOnboarding(true);
      }
    };
    const onCertGenerated = (data: unknown) => {
      const d = data as { fingerprint?: string } | undefined;
      setCertExists(true);
      const fp = d?.fingerprint ?? '';
      if (fp) migrateLocalStorage(fp);
      setCertFingerprint(fp);
    };
    const onCertImported = (data: unknown) => {
      const d = data as { fingerprint?: string } | undefined;
      setCertExists(true);
      const fp = d?.fingerprint ?? '';
      if (fp) migrateLocalStorage(fp);
      setCertFingerprint(fp);
    };

    const onProfilesActiveChanged = (data: unknown) => {
      const d = data as { id: string | null; name: string | null; fingerprint: string | null };
      resetMarkersCache();
      if (d.id) {
        setCertExists(true);
        const fp = d.fingerprint ?? '';
        if (fp) migrateLocalStorage(fp);
        setCertFingerprint(fp);
        setActiveProfileName(d.name ?? '');
      } else {
        setCertExists(false);
        setCertFingerprint('');
        setActiveProfileName('');
        setShowSettings(false);
      }
    };

    const onProfilesList = (data: unknown) => {
      const d = data as { profiles: Array<{ id: string; name: string }>; activeProfileId: string | null; brokenProfiles?: Array<{ id: string; name: string }> };
      setProfiles(d.profiles ?? []);
      if (d.activeProfileId) {
        const active = d.profiles.find(p => p.id === d.activeProfileId);
        if (active) setActiveProfileName(active.name);
      }
      const brokenProfiles = d.brokenProfiles ?? [];
      if (brokenProfiles.length > 0) {
        const brokenIds = new Set(brokenProfiles.map(p => p.id));
        const hasHealthyFallback = (d.profiles ?? []).some(p => !brokenIds.has(p.id));
        setBrokenCertInfo({
          brokenProfiles,
          hasHealthyFallback,
        });
      } else {
        setBrokenCertInfo(null);
      }
    };

    const onAutoConnect = (data: unknown) => {
      const server = data as { id: string; label: string; apiUrl?: string; host?: string; port?: number; defaultProfileId?: string } | undefined;
      if (server) {
        setServerLabel(server.label || `${server.host}:${server.port}`);

        // Apply per-server profile override on auto-connect
        let effectiveName = activeProfileName;
        if (server.defaultProfileId) {
          const overrideProfile = profiles.find(p => p.id === server.defaultProfileId);
          if (overrideProfile) effectiveName = overrideProfile.name;
          bridge.send('profiles.setActive', { id: server.defaultProfileId });
        }

        handleConnect({
          id: server.id,
          label: server.label,
          apiUrl: server.apiUrl,
          host: server.host || '',
          port: server.port || 0,
          username: effectiveName || 'Brmble User',
          password: '',
          defaultProfileId: server.defaultProfileId,
        });
      }
    };

    const onVoiceReconnecting = () => {
      setConnectionStatus('reconnecting');
      updateStatus('voice', { state: 'connecting' });
    };
    const onVoiceReconnectFailed = (data?: unknown) => {
      clearPendingAction();
      setConnectionStatus('failed');
      const d = data as { reason?: string } | undefined;
      updateStatus('voice', { state: 'disconnected', error: d?.reason || 'Reconnect failed' });
      setServerAddress('');
      setServerLabel('');
      setChannels([]);
      setUsers([]);
      setCurrentChannelId(undefined);
      setCurrentChannelName('');
      setSelfMuted(false);
      setSelfDeafened(false);
      setSelfLeftVoice(false);
      setSelfCanRejoin(false);
      setSelfSession(0);
      setSpeakingUsers(new Map());
      setCurrentUserAvatarUrl(undefined);
    };

    const onUserMappingUpdated = (data: unknown) => {
      const d = data as { sessionId: number; matrixUserId?: string; companionId?: CompanionId; certHash?: string; isBrmbleClient?: boolean; action: string } | undefined;
      if (d?.sessionId !== undefined) {
        setUsers(prev => prev.map(u =>
          u.session === d.sessionId
            ? {
              ...u,
              matrixUserId: d.action === 'added' ? d.matrixUserId : undefined,
              companionId: d.action === 'added' ? d.companionId : u.companionId,
              certHash: d.action === 'added' ? (d.certHash ?? u.certHash) : u.certHash,
              isBrmbleClient: d.action === 'added' ? d.isBrmbleClient : undefined,
            }
            : u
        ));
        // Fetch avatar for the newly mapped user if they don't have one yet
        if (d.action === 'added' && d.matrixUserId) {
          fetchAvatarForUser(d.sessionId, d.matrixUserId);
        }
      }
    };

    const onSessionMappingSnapshot = (data: unknown) => {
      const d = data as { mappings: Record<string, { matrixUserId: string; mumbleName: string; companionId?: CompanionId; certHash?: string; isBrmbleClient?: boolean }> } | undefined;
      if (d?.mappings && typeof d.mappings === 'object') {
        setUsers(prev => {
          const mappingMap = new Map<number, { matrixUserId: string; companionId?: CompanionId; certHash?: string; isBrmbleClient?: boolean }>();
          for (const [sid, entry] of Object.entries(d.mappings)) {
            mappingMap.set(Number(sid), { matrixUserId: entry.matrixUserId, companionId: entry.companionId, certHash: entry.certHash, isBrmbleClient: entry.isBrmbleClient });
          }
          return prev.map(u => {
            const m = mappingMap.get(u.session);
            return m ? { ...u, matrixUserId: m.matrixUserId, companionId: m.companionId ?? u.companionId, certHash: m.certHash ?? u.certHash, isBrmbleClient: m.isBrmbleClient } : u;
          });
        });
        // Fetch avatars for users that gained a matrixUserId
        for (const [sid, entry] of Object.entries(d.mappings)) {
          fetchAvatarForUser(Number(sid), entry.matrixUserId);
        }
      }
    };

    const onVoiceCompanionChanged = (data: unknown) => {
      const d = data as { session?: number; companionId?: CompanionId } | undefined;
      if (d?.session === undefined || !d.companionId) return;
      setUsers(prev => prev.map(u => u.session === d.session ? { ...u, companionId: d.companionId } : u));
    };

    const onVoiceSetCompanionResponse = (data: unknown) => {
      const d = data as { success?: boolean; companionId?: CompanionId; error?: string; requestId?: number } | undefined;
      const pending = pendingCompanionRef.current;
      if (!pending) {
        return;
      }
      
      // Verify response matches the pending request
      if (d?.requestId !== undefined && d.requestId !== pending.requestId) {
        // Out-of-order response - ignore it
        return;
      }
      
      if (d?.success) {
        pendingCompanionRef.current = null;
        return;
      }
      pendingCompanionRef.current = null;
      setConnectionError(d?.error ?? 'Failed to sync companion');
      notifQueue.register('companion-sync-error', 'error');
    };

    const onBrmbleClientActivated = (data: unknown) => {
      const d = data as { sessionId: number } | undefined;
      if (d?.sessionId !== undefined) {
        setUsers(prev => prev.map(u =>
          u.session === d.sessionId ? { ...u, isBrmbleClient: true } : u
        ));
      }
    };

    const onBrmbleClientDeactivated = (data: unknown) => {
      const d = data as { sessionId: number } | undefined;
      if (d?.sessionId !== undefined) {
        setUsers(prev => prev.map(u =>
          u.session === d.sessionId ? { ...u, isBrmbleClient: false } : u
        ));
      }
    };

    const onRegistrationStatus = (data: unknown) => {
      const d = data as { serverId?: string; registered?: boolean; registeredName?: string } | undefined;
      if (!d?.registered || !d.serverId) return;
      // Password is intentionally omitted (not in localStorage);
      // the backend preserves the existing password when an update omits it.
      try {
        const stored = localStorage.getItem('brmble-server');
        if (stored) {
          const savedServer = JSON.parse(stored) as SavedServer;
          if (savedServer.id === d.serverId) {
            const updated = { ...savedServer, registered: true, registeredName: d.registeredName };
            bridge.send('servers.update', updated);
            localStorage.setItem('brmble-server', JSON.stringify(updated));
          }
        }
      } catch { /* ignore parse errors */ }
    };

    const onChatChannelAccess = (data: unknown) => {
      const payload = data as { body?: string; channels?: ChannelChatAccessMap } | undefined;
      let channelsAccess = payload?.channels;
      if (!channelsAccess && payload?.body) {
        try {
          channelsAccess = (JSON.parse(payload.body) as { channels?: ChannelChatAccessMap }).channels;
        } catch {
          channelsAccess = undefined;
        }
      }
      if (!channelsAccess) return;
      setChannels(prev => mergeChannelChatAccess(prev, channelsAccess));
    };

    const onChatChannelAccessError = () => {
      setChannels(prev => mergeChannelChatAccess(prev, getResolvedChannelChatAccess(getChannelChatAccessRequestIds(prev))));
    };

    const onAdminChannelUpdateError = (data: unknown) => {
      const payload = data as { statusCode?: number; body?: string; error?: string } | undefined;
      if (payload?.statusCode === 403) {
        setAdminChannelUpdateError({
          title: 'Channel position was not saved',
          detail: 'You need Write permission on that channel. Check the channel ACL if inheritance is disabled.',
        });
      } else {
        const code = payload?.statusCode ?? payload?.error ?? 'unknown';
        setAdminChannelUpdateError({
          title: 'Channel update failed',
          detail: `Request failed (${code}). Please try again.`,
        });
      }
      notifQueue.register('admin-channel-update-error', 'warning');
    };

    bridge.on('brmble.serviceStatus', onBrmbleServiceStatus);
    bridge.on('admin.channelUpdateError', onAdminChannelUpdateError);
    bridge.on('voice.connected', onVoiceConnected);
    bridge.on('voice.disconnected', onVoiceDisconnected);
    bridge.on('voice.error', onVoiceError);
    bridge.on('voice.message', onVoiceMessage);
    bridge.on('voice.system', onVoiceSystem);
    bridge.on('game.feed', onGameFeed);
    bridge.on('voice.userJoined', onVoiceUserJoined);
    bridge.on('voice.channelJoined', onVoiceChannelJoined);
    bridge.on('voice.channelRemoved', onVoiceChannelRemoved);
    bridge.on('voice.userLeft', onVoiceUserLeft);
    bridge.on('voice.channelChanged', onVoiceChannelChanged);
    bridge.on('voice.selfMuteChanged', onSelfMuteChanged);
    bridge.on('voice.selfDeafChanged', onSelfDeafChanged);
    bridge.on('voice.leftVoiceChanged', onLeftVoiceChanged);
    bridge.on('voice.canRejoinChanged', onCanRejoinChanged);
    bridge.on('voice.userSpeaking', onVoiceUserSpeaking);
    bridge.on('voice.userSilent', onVoiceUserSilent);
    bridge.on('voice.moderation', onVoiceModeration);
    bridge.on('voice.userCommentChanged', onVoiceUserCommentChanged);
    bridge.on('voice.shortcutPressed', onShortcutPressed);
    bridge.on('voice.shortcutReleased', onShortcutReleased);
    bridge.on('voice.toggleDmScreen', onToggleDmScreen);
    bridge.on('voice.toggleScreenShare', onToggleScreenShare);
    bridge.on('game.toggle', onToggleGame);
    bridge.on('window.showCloseDialog', onShowCloseDialog);
    bridge.on('cert.status', onCertStatus);
    bridge.on('cert.generated', onCertGenerated);
    bridge.on('cert.imported', onCertImported);
    bridge.on('profiles.activeChanged', onProfilesActiveChanged);
    bridge.on('profiles.list', onProfilesList);
    const onProfilesRecovered = (data: unknown) => {
      const d = data as { id: string };
      setBrokenCertInfo(prev => {
        if (!prev) return null;
        const remaining = prev.brokenProfiles.filter(p => p.id !== d.id);
        if (remaining.length === 0) return null;
        const brokenIds = new Set(remaining.map(p => p.id));
        const hasHealthyFallback = profilesRef.current.some(p => !brokenIds.has(p.id));
        return { ...prev, brokenProfiles: remaining, hasHealthyFallback };
      });
    };
    bridge.on('profiles.recovered', onProfilesRecovered);
    const onProfilesRemoved = (data: unknown) => {
      const d = data as { id: string };
      const updatedProfiles = profilesRef.current.filter(p => p.id !== d.id);
      setProfiles(updatedProfiles);
      setBrokenCertInfo(prev => {
        if (!prev) return null;
        const remaining = prev.brokenProfiles.filter(p => p.id !== d.id);
        if (remaining.length === 0) return null;
        const brokenIds = new Set(remaining.map(p => p.id));
        const hasHealthyFallback = updatedProfiles.some(p => !brokenIds.has(p.id));
        return { ...prev, brokenProfiles: remaining, hasHealthyFallback };
      });
    };
    bridge.on('profiles.removed', onProfilesRemoved);
    bridge.on('voice.autoConnect', onAutoConnect);
    bridge.on('voice.reconnecting', onVoiceReconnecting);
    bridge.on('voice.reconnectFailed', onVoiceReconnectFailed);
    bridge.on('server.credentials', onServerCredentials);
    bridge.on('voice.authError', onVoiceAuthError);
    bridge.on('voice.userMappingUpdated', onUserMappingUpdated);
    bridge.on('voice.sessionMappingSnapshot', onSessionMappingSnapshot);
    bridge.on('voice.companionChanged', onVoiceCompanionChanged);
    bridge.on('voice.setCompanionResponse', onVoiceSetCompanionResponse);
    bridge.on('voice.brmbleClientActivated', onBrmbleClientActivated);
    bridge.on('voice.brmbleClientDeactivated', onBrmbleClientDeactivated);
    bridge.on('voice.registrationStatus', onRegistrationStatus);
    bridge.on('chat.channelAccess', onChatChannelAccess);
    bridge.on('chat.channelAccessError', onChatChannelAccessError);
    const onVoiceLoss = (data: unknown) => {
      const payload = data as { loss?: number } | null;
      const loss = typeof payload?.loss === 'number' ? payload.loss : undefined;
      updateStatus('voice', { loss });
    };
    bridge.on('voice.loss', onVoiceLoss);

    const onUpdateAvailable = (data: unknown) => {
      setUpdateInfo(data as { version: string });
      setUpdateProgress(null);
    };
    const onUpdateProgress = (data: unknown) => setUpdateProgress((data as { progress: number }).progress);
    bridge.on('app.updateAvailable', onUpdateAvailable);
    bridge.on('app.updateProgress', onUpdateProgress);

    return () => {
      bridge.off('app.updateAvailable', onUpdateAvailable);
      bridge.off('app.updateProgress', onUpdateProgress);
      bridge.off('brmble.serviceStatus', onBrmbleServiceStatus);
      bridge.off('admin.channelUpdateError', onAdminChannelUpdateError);
      bridge.off('voice.connected', onVoiceConnected);
      bridge.off('voice.disconnected', onVoiceDisconnected);
      bridge.off('voice.error', onVoiceError);
      bridge.off('voice.message', onVoiceMessage);
      bridge.off('voice.system', onVoiceSystem);
      bridge.off('game.feed', onGameFeed);
      bridge.off('voice.userJoined', onVoiceUserJoined);
      bridge.off('voice.channelJoined', onVoiceChannelJoined);
      bridge.off('voice.channelRemoved', onVoiceChannelRemoved);
      bridge.off('voice.userLeft', onVoiceUserLeft);
      bridge.off('voice.channelChanged', onVoiceChannelChanged);
      bridge.off('voice.selfMuteChanged', onSelfMuteChanged);
      bridge.off('voice.selfDeafChanged', onSelfDeafChanged);
      bridge.off('voice.leftVoiceChanged', onLeftVoiceChanged);
      bridge.off('voice.canRejoinChanged', onCanRejoinChanged);
      bridge.off('voice.userSpeaking', onVoiceUserSpeaking);
      bridge.off('voice.userSilent', onVoiceUserSilent);
      bridge.off('voice.moderation', onVoiceModeration);
      bridge.off('voice.userCommentChanged', onVoiceUserCommentChanged);
      bridge.off('voice.loss', onVoiceLoss);
      bridge.off('voice.shortcutPressed', onShortcutPressed);
      bridge.off('voice.shortcutReleased', onShortcutReleased);
      bridge.off('voice.toggleDmScreen', onToggleDmScreen);
      bridge.off('voice.toggleScreenShare', onToggleScreenShare);
      bridge.off('game.toggle', onToggleGame);
      bridge.off('window.showCloseDialog', onShowCloseDialog);
      bridge.off('cert.status', onCertStatus);
      bridge.off('cert.generated', onCertGenerated);
      bridge.off('cert.imported', onCertImported);
      bridge.off('profiles.activeChanged', onProfilesActiveChanged);
      bridge.off('profiles.list', onProfilesList);
      bridge.off('profiles.recovered', onProfilesRecovered);
      bridge.off('profiles.removed', onProfilesRemoved);
      bridge.off('voice.autoConnect', onAutoConnect);
      bridge.off('voice.reconnecting', onVoiceReconnecting);
      bridge.off('voice.reconnectFailed', onVoiceReconnectFailed);
      bridge.off('server.credentials', onServerCredentials);
      bridge.off('voice.authError', onVoiceAuthError);
      bridge.off('voice.userMappingUpdated', onUserMappingUpdated);
      bridge.off('voice.sessionMappingSnapshot', onSessionMappingSnapshot);
      bridge.off('voice.companionChanged', onVoiceCompanionChanged);
      bridge.off('voice.setCompanionResponse', onVoiceSetCompanionResponse);
      bridge.off('voice.brmbleClientActivated', onBrmbleClientActivated);
      bridge.off('voice.brmbleClientDeactivated', onBrmbleClientDeactivated);
      bridge.off('voice.registrationStatus', onRegistrationStatus);
      bridge.off('chat.channelAccess', onChatChannelAccess);
      bridge.off('chat.channelAccessError', onChatChannelAccessError);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bridge.send('cert.requestStatus');
    bridge.send('profiles.list');
  }, []);

  const channelChatAccessRequestIds = useMemo(() => getChannelChatAccessRequestIds(channels), [channels]);
  const channelChatAccessRequestKey = channelChatAccessRequestIds.join(',');

  useEffect(() => {
    if (statuses.server.state !== 'connected' || !matrixCredentials?.roomMap) return;
    if (!channelChatAccessRequestKey) return;
    bridge.send('chat.getChannelAccess', { channelIds: channelChatAccessRequestKey.split(',').map(Number) });
  }, [channelChatAccessRequestKey, matrixCredentials?.roomMap, statuses.server.state]);

  useEffect(() => {
    if (permittedActiveMatrixChannelId && matrixCredentials) {
      matrixClient.fetchHistory(permittedActiveMatrixChannelId).catch(console.error);
    }
  }, [permittedActiveMatrixChannelId, matrixCredentials]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (pendingChannelActionTimeoutRef.current) {
        clearTimeout(pendingChannelActionTimeoutRef.current);
      }
    };
  }, []);

const handleConnect = (serverData: SavedServer) => {
    // Don't store password in localStorage - use secure storage instead
    const { password, ...safeServerData } = serverData;
    localStorage.setItem('brmble-server', JSON.stringify(safeServerData));
    setServerAddress(`${serverData.host}:${serverData.port}`);
    setConnectionStatus('connecting');
    userSawConnectedRef.current = false;
    brmbleServicesConnectedOnceRef.current = false;
    setBrmbleServiceBootstrapTimedOut(false);
    bridge.send('voice.connect', serverData);
    updateStatus('voice', { state: 'connecting', error: undefined, label: `${serverData.host}:${serverData.port}` });
    
    // Send transmission mode from settings
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (stored) {
        const settings = JSON.parse(stored);
        if (settings.audio?.transmissionMode) {
          bridge.send('voice.setTransmissionMode', {
            mode: settings.audio.transmissionMode,
            key: (settings.audio.transmissionMode === 'pushToTalk' || settings.audio.transmissionMode === 'pushToTalkPlus') ? settings.audio.pushToTalkKey : null,
          });
        }
      }
    } catch (e) {
      console.error('Failed to send transmission mode:', e);
    }
  };

  const handleServerConnect = (server: ServerEntry) => {
    setServerLabel(server.label || `${server.host}:${server.port}`);

    // Resolve the effective profile name synchronously before switching profiles.
    // If the server has a defaultProfileId override, look it up in the profiles list
    // rather than using activeProfileName (which would be stale until the async
    // profiles.activeChanged event arrives).
    let effectiveProfileName = activeProfileName;
    if (server.defaultProfileId) {
      const overrideProfile = profiles.find(p => p.id === server.defaultProfileId);
      if (overrideProfile) effectiveProfileName = overrideProfile.name;
      bridge.send('profiles.setActive', { id: server.defaultProfileId });
    }

    handleConnect({
      id: server.id,
      label: server.label,
      apiUrl: server.apiUrl,
      host: server.host,
      port: server.port,
      username: (!server.defaultProfileId && server.registered ? server.registeredName : null) || effectiveProfileName || 'Brmble User',
      password: server.password || '',
      registered: server.registered,
      registeredName: server.registeredName,
      defaultProfileId: server.defaultProfileId,
    });
  };

  const handleJoinChannel = async (channelId: number) => {
    const selfVoiceChannelId = users.find(u => u.self)?.channelId;
    if (selfVoiceChannelId === channelId) {
      return;
    }
    const channel = channels.find(c => c.id === channelId);
    if (!channel) {
      return;
    }

    const joinAction = getJoinAccessAction(channel);
    if (joinAction === 'deny') {
      addMessageToStore('server-root', 'Server', getChannelAccessDeniedMessage(channel), 'system');
      return;
    }

    if (joinAction === 'promptPassword') {
      const savedPassword = await getSavedChannelPassword(channelId);
      const enteredPassword = await prompt({
        title: 'Channel Password',
        message: `Enter the password for ${channel.name}. Save the password and reconnect to authenticate it.`,
        placeholder: 'Password',
        defaultValue: savedPassword,
        confirmLabel: 'Save & reconnect',
        cancelLabel: 'Cancel',
        isPassword: true,
      });

      if (!enteredPassword) {
        return;
      }

      saveChannelPasswordAndReconnect(channelId, channel.name, enteredPassword);
      return;
    }

    if (isSharing && sharingChannelId && String(channelId) !== sharingChannelId) {
      const shouldMove = await confirm({
        title: 'Screen share active',
        message: 'Moving to another channel will end your screen share. Move and stop sharing?',
        confirmLabel: 'Move',
        cancelLabel: 'Stay Here',
      });
      if (!shouldMove) {
        return;
      }
      await stopSharing();
      setSharingChannelId(undefined);
    }

    startPendingAction(channelId);
    pendingJoinAttemptRef.current = {
      channelId,
      channelName: channel.name,
      passwordRetrySent: false,
    };
    sendJoinChannel(channelId);
  };

  const handleSelectChannel = (channelId: number) => {
    const selection = getChannelSelectionOutcome(channelId, channels, isDmMode ? 'dm' : 'channels');
    if (selection) {
      setCurrentChannelId(selection.channelId);
      setCurrentChannelName(selection.channelName);
      setUnreadCount(0);
      setShowGame(false);

      dispatchWorkspace({ type: 'SELECT_CHANNEL' });

      if (!selection.canOpenChat) return;
    }
  };

  const handleSelectServer = () => {
    setCurrentChannelId('server-root');
    setCurrentChannelName(serverLabel || 'Server');
    dispatchWorkspace({ type: 'SELECT_CHANNEL' });
  };

  const handleSendMessage = async (content: string, image?: File) => {
    if (!username || (!content && !image)) return;

    const channelId = currentChannelId;
    if (!channelId) return;
    if (!shouldAllowChannelChatSend(channelId, channelsRef.current, statusesRef.current, brmbleServiceBootstrapPhase)) {
      return;
    }

      const selfUser = usersRef.current.find(u => u.self);
      const isMatrixChannel = isMatrixChannelChatActive(channelId, matrixCredentials, statuses, selfUser, channels);

    // Send text content (existing behavior)
    if (content) {
      if (!isMatrixChannel) {
        addMessage(username, content);
      }

      const mumbleHtml = linkifyForMumble(content);
      if (channelId === 'server-root') {
        bridge.send('voice.sendMessage', { message: mumbleHtml, channelId: 0 });
      } else {
        bridge.send('voice.sendMessage', { message: mumbleHtml, channelId: Number(channelId) });
        if (isMatrixChannel) {
          matrixClient.sendMessage(channelId, content).catch(console.error);
        }
      }
    }

    // Send image
    if (image) {
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const objectUrl = URL.createObjectURL(image);

      const optimisticMsg: ChatMessage = {
        id: tempId,
        channelId,
        sender: username,
        content: '',
        timestamp: new Date(),
        pending: true,
        media: [{
          type: image.type === 'image/gif' ? 'gif' : 'image',
          url: objectUrl,
          mimetype: image.type,
          size: image.size,
        }],
      };

      setOptimisticImages(prev => [...prev, optimisticMsg]);

      let mumbleResult: PreparedMumbleImage | null = null;
      let mumblePreparationFailed = false;
      try {
        mumbleResult = await prepareImageForMumble(image);
      } catch (err) {
        console.error('Mumble image send failed:', err);
        mumblePreparationFailed = true;
      }

      const mumbleDelivery = mumbleResult ? getMumbleImageDeliveryState(mumbleResult) : undefined;
      const routing = getImageSendRoutingDecision({
        isMatrixChannel,
        mumblePreparationFailed,
        mumbleResult,
      });

      if (routing.shouldSendToMumble && mumbleResult?.kind === 'sendable') {
        if (channelId === 'server-root') {
          bridge.send('voice.sendMessage', { message: mumbleResult.payload, channelId: 0 });
        } else {
          bridge.send('voice.sendMessage', { message: mumbleResult.payload, channelId: Number(channelId) });
        }
      }

      if (mumbleDelivery) {
        setOptimisticImages(prev => prev.map(m =>
          m.id === tempId ? { ...m, mumbleDelivery } : m
        ));
      }

      if (routing.shouldSendToMatrix) {
        matrixClient.uploadContent(image)
          .then(mxcUrl => matrixClient.sendImageMessage(channelId, image, mxcUrl, mumbleDelivery))
          .then(() => {
            setOptimisticImages(prev => prev.filter(m => m.id !== tempId));
            URL.revokeObjectURL(objectUrl);
          })
          .catch(err => {
            console.error('Matrix image upload failed:', err);
            setOptimisticImages(prev => prev.map(m =>
              m.id === tempId ? { ...m, pending: false, error: true } : m
            ));
          });
      } else if (routing.markNonMatrixAsError) {
        setOptimisticImages(prev => prev.map(m =>
          m.id === tempId ? { ...m, pending: false, error: true } : m
        ));
      } else {
        setOptimisticImages(prev => prev.map(m =>
          m.id === tempId ? { ...m, pending: false } : m
        ));
      }
    }

    setUnreadCount(0);
  };

  const handleDismissMessage = (messageId: string) => {
    setOptimisticImages(prev => {
      const msg = prev.find(m => m.id === messageId);
      if (msg?.media) {
        for (const item of msg.media) {
          if (item.url.startsWith('blob:')) URL.revokeObjectURL(item.url);
        }
      }
      return prev.filter(m => m.id !== messageId);
    });
  };

  const handleToggleChannelReaction = useCallback(async (
    chatPanelChannelId: string,
    messageId: string,
    emoji: string,
    isCurrentlyReacted: boolean,
  ) => {
    if (!chatPanelChannelId || chatPanelChannelId === 'server-root') return;
    if (isCurrentlyReacted) {
      await matrixClient.removeReaction(chatPanelChannelId, messageId, emoji);
    } else {
      await matrixClient.sendReaction(chatPanelChannelId, messageId, emoji);
    }
  }, [matrixClient]);

  const handleToggleDmReaction = useCallback(async (
    _chatPanelChannelId: string,
    messageId: string,
    emoji: string,
    isCurrentlyReacted: boolean,
  ) => {
    const selectedContactId = dmStore.selectedContact?.id;
    if (!selectedContactId) return;
    if (isCurrentlyReacted) {
      await matrixClient.removeReaction(selectedContactId, messageId, emoji);
    } else {
      await matrixClient.sendReaction(selectedContactId, messageId, emoji);
    }
  }, [dmStore.selectedContact?.id, matrixClient]);

  const handleDisconnect = async () => {
    await runIntentionalDisconnect({
      isSharing,
      stopSharing,
      markLocalShareTeardownIntent,
      disconnect: () => bridge.send('voice.disconnect'),
    });
  };

  const handleCancelReconnect = () => {
    bridge.send('voice.cancelReconnect');
  };

  const handleReconnect = () => {
    const stored = localStorage.getItem('brmble-server');
    if (stored) {
      try {
        const serverData = JSON.parse(stored) as SavedServer;
        handleConnect(serverData);
      } catch {
        setConnectionStatus('idle');
      }
    } else {
      setConnectionStatus('idle');
    }
  };

  const handleBackToServerList = async () => {
    await runIntentionalDisconnect({
      isSharing,
      stopSharing,
      markLocalShareTeardownIntent,
      disconnect: () => bridge.send('voice.disconnect'),
      afterDisconnect: () => {
        clearPendingAction();
        userSawConnectedRef.current = false;
        setConnectionStatus('idle');
        resetStatuses();
        setServerLabel('');
        setServerAddress('');
        setUsername('');
        setChannels([]);
        setUsers([]);
        setCurrentChannelId(undefined);
        setCurrentChannelName('');
        setSelfMuted(false);
        setSelfDeafened(false);
        setSelfLeftVoice(false);
        setSelfCanRejoin(false);
        setSelfSession(0);
      setSpeakingUsers(new Map());
      // Clear any in-flight game state (pending invite, active match, errors) so a
      // disconnect doesn't leave a stale challenge notification or produce spurious
      // errors when actions can no longer reach the server. The server tears the
      // match down on its side, so this is purely a local UI reset.
      gameStateRef.current.reset();
      setDuelChannelIds(new Set());
        hasMatrixCredentialsForSessionRef.current = false;
        setMatrixCredentials(null);
        setBrmbleDMUsers([]);
        setSharingChannelId(undefined);
      },
    });
  };

  const handleToggleMute = () => {
    if (muteOnCooldown) return;
    triggerMuteCooldown();
    bridge.send('voice.toggleMute', {});
  };

  const handleToggleDeaf = () => {
    if (deafOnCooldown) return;
    triggerDeafCooldown();
    bridge.send('voice.toggleDeaf', {});
  };

  const handleLeaveVoice = async () => {
    if (leaveVoiceOnCooldown) return;

    triggerLeaveVoiceCooldown();

    if (isSharing) {
      const shouldLeave = await confirm({
        title: 'Screen share active',
        message: 'Leaving voice will end your screen share. Leave voice and stop sharing?',
        confirmLabel: 'Leave',
        cancelLabel: 'Stay Here',
      });
      if (!shouldLeave) {
        return;
      }
      await stopSharing();
      setSharingChannelId(undefined);
    }
    startPendingAction('leave');
    bridge.send('voice.leaveVoice', {});
  };

  const handleCloseMinimize = useCallback((dontAskAgain: boolean) => {
    setShowCloseDialog(false);
    if (dontAskAgain) {
      bridge.send('window.setClosePreference', { action: 'minimize' });
    }
    bridge.send('window.minimize');
  }, []);

  const handleCloseQuit = useCallback((dontAskAgain: boolean) => {
    setShowCloseDialog(false);
    if (dontAskAgain) {
      bridge.send('window.setClosePreference', { action: 'quit' });
    }
    bridge.send('window.quit');
  }, []);

  // Push DM badge state to native side whenever unread count changes
  useEffect(() => {
    updateBadge(totalDmUnreadCount, hasPendingInvite);
  }, [totalDmUnreadCount, hasPendingInvite, updateBadge]);

  // Push current theme to native side for themed tray/taskbar icons
  useEffect(() => {
    const sendTheme = () => {
      const theme = document.documentElement.getAttribute('data-theme');
      if (theme) {
        bridge.send('notification.theme', { theme });
      }
    };

    // Send current theme on mount
    sendTheme();

    // Watch for theme changes (applyTheme sets data-theme attribute)
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'data-theme') {
          sendTheme();
          break;
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => observer.disconnect();
  }, []);

  const handleStartDMFromContextMenu = useCallback((sessionIdStr: string, userName: string) => {
    const user = users.find(u => String(u.session) === sessionIdStr);

    // Route based on whether the user is on a Brmble client
    if (user?.isBrmbleClient && user.matrixUserId) {
      // Brmble client → Matrix DM (persistent)
      dmStore.startDM(user.matrixUserId, userName, user.avatarUrl);
      dispatchWorkspace({ type: 'SELECT_DM', contactId: user.matrixUserId });
    } else if (user?.certHash) {
      // Mumble client (even if Brmble-registered) → Mumble DM (ephemeral)
      // Check for existing ephemeral contact first
      const existingMumbleContact = dmStore.contacts.find(c => c.isEphemeral && c.mumbleCertHash === user.certHash);
      if (existingMumbleContact) {
        dmStore.selectContact(existingMumbleContact.id);
        dispatchWorkspace({ type: 'SELECT_DM', contactId: existingMumbleContact.id });
      } else {
        dmStore.startMumbleDM(user.certHash, user.session, userName);
        dispatchWorkspace({ type: 'SELECT_DM', contactId: user.certHash });
      }
    } else {
      console.warn('[DM] Cannot start DM: user has no certHash');
    }
  }, [users, dmStore]);

  const handleChatMessageContextMenu = useCallback((_x: number, _y: number, sender: string, senderMatrixUserId?: string) => {
    // Look up user by matrixUserId first, then by name
    let user = users.find(u => u.matrixUserId === senderMatrixUserId);
    if (!user && sender) {
      user = users.find(u => u.name === sender);
    }
    
    if (user) {
      if (user.isBrmbleClient && user.matrixUserId) {
        dmStore.startDM(user.matrixUserId, sender, user.avatarUrl);
        dispatchWorkspace({ type: 'SELECT_DM', contactId: user.matrixUserId });
      } else if (user.certHash) {
        const existingMumbleContact = dmStore.contacts.find(c => c.isEphemeral && c.mumbleCertHash === user!.certHash);
        if (existingMumbleContact) {
          dmStore.selectContact(existingMumbleContact.id);
          dispatchWorkspace({ type: 'SELECT_DM', contactId: existingMumbleContact.id });
        } else {
          dmStore.startMumbleDM(user.certHash, user.session, sender);
          dispatchWorkspace({ type: 'SELECT_DM', contactId: user.certHash });
        }
      } else {
        console.warn('[DM] Cannot start DM: user has no certHash');
      }
    } else {
      // Fallback: try starting DM by matrixUserId directly for users not in the users list
      if (senderMatrixUserId) {
        dmStore.startDM(senderMatrixUserId, sender, undefined);
        dispatchWorkspace({ type: 'SELECT_DM', contactId: senderMatrixUserId });
      } else {
        console.warn('[DM] Cannot start DM: user not found');
      }
    }
  }, [users, dmStore]);

  const handleCopyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyNotification({ message: 'Copied to clipboard' });
      notifQueue.register('copy', 'success');
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      setCopyNotification({ message: 'Failed to copy to clipboard' });
      notifQueue.register('copy', 'error');
    }
  }, [notifQueue]);

  const selfUserForChat = users.find(u => u.self);
  const isMatrixActive = activeChannelId
    ? isMatrixChannelChatActive(activeChannelId, matrixCredentials, statuses, selfUserForChat, channels)
    : false;
  const brmbleServiceOutageActive = isBrmbleServiceOutageActive(statuses);
  const brmbleServiceBootstrapPhase = getBrmbleServiceBootstrapPhase(
    statuses,
    brmbleServiceBootstrapTimedOut,
    brmbleServicesConnectedOnceRef.current,
  );
  const brmbleServiceChatNotice = getBrmbleServiceChatNotice(activeChannelId, statuses, brmbleServiceBootstrapPhase);
  const canOpenActiveChannelChat = canOpenChannelChat(activeChannelId, channels);
  const canSendActiveChannelChat = canSendToChannelChat(activeChannelId, channels)
    || isTemporaryChannelChatActive(activeChannelId, statuses, brmbleServiceBootstrapPhase);
  const channelChatAccessNotice = activeChannelId && activeChannelId !== 'server-root' && !canOpenActiveChannelChat
    ? 'You do not have access to this channel chat.'
    : activeChannelId && activeChannelId !== 'server-root' && !canSendActiveChannelChat
      ? 'You can read this channel chat, but cannot send messages.'
      : undefined;
  const matrixMessages = activeChannelId
    ? matrixClient.activeMessages
    : undefined;

  const channelChatMessages = useMemo(
    () => {
      if (!canOpenActiveChannelChat) return [];
      // When Matrix is active, channel history comes from Matrix. Ephemeral
      // game-feed lines live only in the local chat store (systemType 'game',
      // never persisted), so merge them in explicitly — otherwise they are
      // written but never rendered. Sort the merged result chronologically so the
      // game lines interleave with Matrix messages instead of being clustered at
      // the bottom (ChatPanel/groupMessages assumes chronological input, and
      // out-of-order messages misplace date separators and the unread divider).
      const base = isMatrixActive
        ? [...(matrixMessages ?? []), ...messages.filter(m => m.systemType === 'game')]
            .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
        : messages;
      return [
        ...base,
        ...optimisticImages.filter(m => m.channelId === currentChannelId),
      ];
    },
    [canOpenActiveChannelChat, isMatrixActive, matrixMessages, messages, optimisticImages, currentChannelId],
  );

  const { Prompt, PromptWithInput } = usePrompt();

  const [screenShareSettings, setScreenShareSettings] = useState<ScreenShareSettings>(DEFAULT_SCREEN_SHARE);

  useEffect(() => {
    const applyScreenShareSettings = (value: unknown) => {
      if (!value || typeof value !== 'object') return;

      const payload = value as Record<string, unknown>;
      const settingsPayload =
        payload.settings && typeof payload.settings === 'object'
          ? payload.settings as Record<string, unknown>
          : null;

      const candidate =
        settingsPayload
          ? settingsPayload.screenShare
          : payload.screenShare && typeof payload.screenShare === 'object'
            ? payload.screenShare
            : payload;

      if (!candidate || typeof candidate !== 'object') return;

      setScreenShareSettings((current) => ({
        ...current,
        ...DEFAULT_SCREEN_SHARE,
        ...(candidate as Partial<ScreenShareSettings>),
      }));
    };

    const loadSettings = () => {
      try {
        const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (stored) {
          applyScreenShareSettings(JSON.parse(stored));
        }
      } catch {}
    };

    type BridgeSettingsApi = {
      on?: (event: string, listener: (settings: unknown) => void) => void;
      off?: (event: string, listener: (settings: unknown) => void) => void;
      emit?: (event: string) => void;
    };

    const bridgeApi = bridge as unknown as BridgeSettingsApi;
    const handleBridgeSettings = (settings: unknown) => {
      applyScreenShareSettings(settings);
    };

    loadSettings();

    bridgeApi.on?.('settings.current', handleBridgeSettings);
    bridgeApi.on?.('settings.updated', handleBridgeSettings);
    bridgeApi.emit?.('settings.current');

    const handleStorage = () => loadSettings();
    window.addEventListener('storage', handleStorage);
    window.addEventListener('brmble-settings-updated', handleStorage);

    return () => {
      bridgeApi.off?.('settings.current', handleBridgeSettings);
      bridgeApi.off?.('settings.updated', handleBridgeSettings);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('brmble-settings-updated', handleStorage);
    };
  }, []);

  const [sharingChannelId, setSharingChannelId] = useState<string | undefined>();
  const sharingChannelIdRef = useRef<string | undefined>(undefined);
  const wasLocalShareRecentlyActiveRef = useRef(false);
  const ignoreNextMovedSharingRef = useRef(false);
  const [isLocalShareStartPending, setIsLocalShareStartPending] = useState(false);
  const isLocalShareStartPendingRef = useRef(false);
  const [screenShareNotification, setScreenShareNotification] = useState<{
    userName: string; roomName: string; userId?: number; matrixUserId?: string;
  } | null>(null);
  const [screenShareEndedNotification, setScreenShareEndedNotification] = useState<QueuedScreenShareEndedNotification | null>(null);
  const [watchedShareEndedNotifications, setWatchedShareEndedNotifications] = useState<WatchedShareEndedNotification[]>([]);
  const [movedChannelNotification, setMovedChannelNotification] = useState<QueuedMovedChannelNotification | null>(null);
  const [serverRemovalNotification, setServerRemovalNotification] = useState<ServerRemovalNotification | null>(null);
  const [brmbleServiceWarningNotification, setBrmbleServiceWarningNotification] = useState<typeof BRMBLE_SERVICE_DISCONNECTED_NOTIFICATION | null>(null);
  const [adminChannelUpdateError, setAdminChannelUpdateError] = useState<{ title: string; detail: string } | null>(null);
  const brmbleServiceWarningDismissedForOutageRef = useRef(false);
  const nextScreenShareEndedNotificationIdRef = useRef(0);
  const nextWatchedShareEndedNotificationIdRef = useRef(0);
  const nextMovedChannelNotificationIdRef = useRef(0);
  const nextActiveShareDiscoveryRequestIdRef = useRef(0);
  const screenShareEndedNotificationRef = useRef<QueuedScreenShareEndedNotification | null>(null);
  const movedChannelNotificationRef = useRef<QueuedMovedChannelNotification | null>(null);
  const [copyNotification, setCopyNotification] = useState<{ message: string } | null>(null);
  const [updateInfo, setUpdateInfo] = useState<{ version: string } | null>(null);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [brokenCertInfo, setBrokenCertInfo] = useState<{
    brokenProfiles: Array<{ id: string; name: string }>;
    hasHealthyFallback: boolean;
  } | null>(null);

  // Server import notifications (from onboarding wizard) — one per server
  interface ServerImportNotification { id: string; label: string; visible: boolean; }
  const [serverImportNotifications, setServerImportNotifications] = useState<ServerImportNotification[]>([]);
  const nextServerImportNotificationIdRef = useRef(0);

  const handleLocalScreenShareEnded = useCallback((reason: LocalShareStopReason) => {
    setSharingChannelId(undefined);
    sharingChannelIdRef.current = undefined;
    isSharingRef.current = false;
    setIsLocalShareStartPending(false);
    isLocalShareStartPendingRef.current = false;
    if (reason === 'manual') {
      wasLocalShareRecentlyActiveRef.current = false;
      ignoreNextMovedSharingRef.current = true;
    } else {
      wasLocalShareRecentlyActiveRef.current = true;
    }

    const notification = replaceOptionalScreenShareEndedNotification(
      screenShareEndedNotificationRef.current,
      reason,
      nextScreenShareEndedNotificationIdRef.current++,
      optionalNotificationSettingsRef.current,
      notifQueue,
    );
    screenShareEndedNotificationRef.current = notification;
    setScreenShareEndedNotification(notification);
  }, [notifQueue]);

  const handleWatchedShareEnded = useCallback((share: ShareInfo, reason: WatchedShareEndReason) => {
    const notification = createOptionalWatchedShareEndedNotification(
      share,
      reason,
      nextWatchedShareEndedNotificationIdRef.current++,
      optionalNotificationSettingsRef.current,
    );
    if (!notification) {
      return;
    }

    setWatchedShareEndedNotifications(prev => [...prev, notification]);
  }, []);

  const { isSharing, startSharing, stopSharing, markLocalShareTeardownIntent, error: screenShareError, activeShare, activeShares, watchingShares, pendingViewerShares, remoteWatchCount, focusedShare, setFocusedShare, setDiscoveryTarget, remoteVideoEls, roomQuality, shareQualities, viewerQualities, setViewerQuality, disconnectViewer, connectAsViewer, isViewerConnectPending, handleScreenShareServiceUnavailable } = useScreenShare(() => {
    setSharingChannelId(undefined);
    sharingChannelIdRef.current = undefined;
  }, screenShareSettings, handleLocalScreenShareEnded, handleWatchedShareEnded);
  isSharingRef.current = isSharing;
  stopSharingRef.current = stopSharing;
  disconnectViewerRef.current = disconnectViewer;
  handleScreenShareServiceUnavailableRef.current = handleScreenShareServiceUnavailable;

  const hasPendingViewerShares = pendingViewerShares.length > 0;
  const screenShareViewerProps = {
    watchingShares,
    focusedShare,
    remoteVideoEls,
    roomQuality,
    shareQualities,
    viewerQualities,
    onFocusShare: setFocusedShare,
    onCloseShare: (share: ShareInfo) => disconnectViewer(share.userId),
    onViewerQualityChange: setViewerQuality,
    screenShareViewerMode: screenShareSettings.viewerMode,
  };

  useEffect(() => {
    dispatchWorkspace({ type: 'REMOTE_WATCH_COUNT_CHANGED', count: remoteWatchCount });
  }, [remoteWatchCount]);

  const handleLiveCompanionChange = useCallback((nextCompanion: CompanionId, previousCompanion: CompanionId) => {
    const selfUser = usersRef.current.find(user => user.self);
    const liveBrmbleSession = !!selfUser?.isBrmbleClient && connectionStatusRef.current === 'connected';
    if (!liveBrmbleSession) {
      return;
    }

    const requestId = ++companionRequestIdRef.current;
    pendingCompanionRef.current = { requestId, next: nextCompanion, previous: previousCompanion };
    bridge.send('voice.setCompanion', { companionId: nextCompanion, requestId });
  }, []);

  useEffect(() => {
    const localUser = users.find((user) => user.self);
    const companionsByUser = users.reduce<CompanionOverlaySnapshot['fullCompanion']['companionsByUser']>((acc, user) => {
      if (user.session === undefined) return acc;
      acc[user.session] = {
        session: user.session,
        name: user.name || 'Unknown user',
        companionId: user.self ? overlaySettings.myCompanion : user.companionId,
        isProxy: false,
      };
      return acc;
    }, {});
    const liveUserSessions = Array.from(new Set([
      ...(isSharing && localUser?.session !== undefined ? [localUser.session] : []),
      ...activeShares.map((share) => share.sessionId).filter((session): session is number => session !== undefined),
    ]));

    setOverlaySnapshot((prev) => updateFullCompanionContext(prev, {
      localUser: {
        session: localUser?.session ?? selfSession ?? 0,
        name: localUser?.name || username || 'You',
        companionId: overlaySettings.myCompanion,
      },
      companionsByUser,
      localMuted: selfMuted,
      liveUserSessions,
    }));
  }, [activeShares, isSharing, overlaySettings.myCompanion, selfMuted, selfSession, username, users]);

  const handleServersImported = useCallback((labels: string[]) => {
    const notifications = labels.map((label) => ({ id: `srv-${nextServerImportNotificationIdRef.current++}`, label, visible: true }));
    setServerImportNotifications(notifications);
    notifications.forEach(notification => notifQueue.register(notification.id, 'info'));
  }, [notifQueue]);

  // Register/unregister update notification with queue
  useEffect(() => {
    if (updateInfo) notifQueue.register('update', 'info');
    else notifQueue.unregister('update');
  }, [updateInfo, notifQueue]);

  // Register/unregister broken cert notifications with queue
  const prevBrokenIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentIds = new Set<string>();
    if (brokenCertInfo) {
      brokenCertInfo.brokenProfiles.forEach(bp => {
        currentIds.add(`cert-${bp.id}`);
        notifQueue.register(`cert-${bp.id}`, 'warning');
      });
    }
    // Unregister any that were previously registered but are now gone
    for (const id of prevBrokenIdsRef.current) {
      if (!currentIds.has(id)) {
        notifQueue.unregister(id);
      }
    }
    prevBrokenIdsRef.current = currentIds;
  }, [brokenCertInfo, notifQueue]);

  useEffect(() => {
    if (screenShareEndedNotification) {
      notifQueue.register(screenShareEndedNotification.id, screenShareEndedNotification.status);
    } else {
      // Existing queued share-ended notifications are explicitly unregistered
      // from dismissal/exit handlers so a replacement event gets fresh metadata.
    }
  }, [screenShareEndedNotification, notifQueue]);

  useEffect(() => {
    for (const notification of watchedShareEndedNotifications) {
      notifQueue.register(notification.id, notification.status);
    }
  }, [watchedShareEndedNotifications, notifQueue]);

  useEffect(() => {
    if (movedChannelNotification) {
      notifQueue.register(movedChannelNotification.id, movedChannelNotification.status);
    }
  }, [movedChannelNotification, notifQueue]);

  useEffect(() => {
    if (!shouldShowOptionalNotification(optionalNotificationSettings, 'notificationRemoteScreenShare')) {
      setScreenShareNotification(null);
      notifQueue.unregister('screen-share');
    }

    if (!shouldShowOptionalNotification(optionalNotificationSettings, 'notificationScreenShareStatus')) {
      if (screenShareEndedNotificationRef.current) {
        notifQueue.unregister(screenShareEndedNotificationRef.current.id);
        screenShareEndedNotificationRef.current = null;
        setScreenShareEndedNotification(null);
      }

      setWatchedShareEndedNotifications((prev) => {
        if (prev.length === 0) {
          return prev;
        }

        for (const notification of prev) {
          notifQueue.unregister(notification.id);
        }
        return [];
      });
    }

    if (!shouldShowOptionalNotification(optionalNotificationSettings, 'notificationIdleWarning')) {
      notifQueue.unregister('idle-pre-leave');
      notifQueue.unregister('idle-pre-leave-cancelled');
    }

    if (!shouldShowOptionalNotification(optionalNotificationSettings, 'notificationMovedChannel')) {
      if (movedChannelNotificationRef.current) {
        notifQueue.unregister(movedChannelNotificationRef.current.id);
        movedChannelNotificationRef.current = null;
      }
      setMovedChannelNotification(null);
    }
  }, [optionalNotificationSettings, notifQueue]);

  useEffect(() => {
    if (serverRemovalNotification) {
      notifQueue.register(serverRemovalNotification.id, serverRemovalNotification.status);
    }
  }, [serverRemovalNotification, notifQueue]);

  useEffect(() => {
    if (statuses.server.state === 'connected' && statuses.chat.state === 'connected') {
      brmbleServicesConnectedOnceRef.current = true;
    }
  }, [statuses.server.state, statuses.chat.state]);

  useEffect(() => {
    if (brmbleServiceBootstrapPhase !== 'bootstrap') {
      if (brmbleServiceBootstrapPhase === 'idle' || brmbleServiceBootstrapPhase === 'ready') {
        setBrmbleServiceBootstrapTimedOut(false);
      }
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setBrmbleServiceBootstrapTimedOut(true);
    }, BRMBLE_SERVICE_BOOTSTRAP_GRACE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [brmbleServiceBootstrapPhase]);

  useEffect(() => {
    if (shouldShowBrmbleServiceWarningNotification(
      brmbleServiceOutageActive,
      brmbleServiceWarningDismissedForOutageRef.current,
      brmbleServiceBootstrapPhase,
    )) {
      setBrmbleServiceWarningNotification(BRMBLE_SERVICE_DISCONNECTED_NOTIFICATION);
      notifQueue.register(BRMBLE_SERVICE_WARNING_ID, 'warning');
      return;
    }

    if (!brmbleServiceOutageActive || brmbleServiceBootstrapPhase !== 'degraded') {
      brmbleServiceWarningDismissedForOutageRef.current = false;
      if (statuses.voice.state !== 'connected') {
        brmbleServicesConnectedOnceRef.current = false;
        setBrmbleServiceBootstrapTimedOut(false);
      }
      setBrmbleServiceWarningNotification(null);
      notifQueue.unregister(BRMBLE_SERVICE_WARNING_ID);
    }
  }, [brmbleServiceOutageActive, brmbleServiceBootstrapPhase, notifQueue, statuses.voice.state]);

  const { isOnCooldown: leaveVoiceOnCooldown, trigger: triggerLeaveVoiceCooldown } = useLeaveVoiceCooldown(1000);
  const { isOnCooldown: muteOnCooldown, trigger: triggerMuteCooldown } = useLeaveVoiceCooldown(1000);
  const { isOnCooldown: deafOnCooldown, trigger: triggerDeafCooldown } = useLeaveVoiceCooldown(1000);


  const handleApplyUpdate = useCallback(() => {
    bridge.send('app.applyUpdate', {});
  }, []);

  const handleDismissUpdate = useCallback(() => {
    setUpdateInfo(null);
    setUpdateProgress(null);
    bridge.send('app.dismissUpdate');
  }, []);

  const handleBrokenCertImport = useCallback((profileId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pfx,.p12';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        bridge.send('profiles.recover', { id: profileId, data: base64 });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, []);

  const handleBrokenCertOpenSettings = useCallback(() => {
    setShowSettings(true);
    setSettingsTab('profile');
  }, []);

  const handleBrokenCertDismiss = useCallback((profileId: string) => {
    setBrokenCertInfo(prev => {
      if (!prev) return null;
      const remaining = prev.brokenProfiles.filter(p => p.id !== profileId);
      return remaining.length > 0 ? { ...prev, brokenProfiles: remaining } : null;
    });
  }, []);

  const channelUnreads = useMemo(() => {
    if (!matrixCredentials?.roomMap) return new Map<string, { notificationCount: number; highlightCount: number }>();
    const map = new Map<string, { notificationCount: number; highlightCount: number }>();
    for (const [channelId, roomId] of Object.entries(matrixCredentials.roomMap)) {
      if (!canOpenChannelChat(channelId, channels)) continue;
      const unread = unreadTracker.getRoomUnread(roomId);
      if (unread.notificationCount > 0) {
        map.set(channelId, {
          notificationCount: unread.notificationCount,
          highlightCount: unread.highlightCount,
        });
      }
    }
    return map;
  }, [channels, matrixCredentials?.roomMap, unreadTracker.roomUnreads]);

  useEffect(() => {
    if (screenShareError) {
      console.error('Screen share error:', screenShareError);
      updateStatus('livekit', { state: 'disconnected', error: screenShareError });
    }
  }, [screenShareError, updateStatus]);

  // Track screenshare connection state for service status indicator
  useEffect(() => {
    const nextStatus = getNextLiveKitStatusUpdate({
      isSharing,
      watchingShareCount: watchingShares.length,
      screenShareError,
      isLocalShareStartPending,
      isViewerConnectPending: isViewerConnectPending || hasPendingViewerShares,
    });

    if (nextStatus) {
      updateStatus('livekit', nextStatus);
    }
  }, [isSharing, watchingShares.length, screenShareError, isLocalShareStartPending, isViewerConnectPending, hasPendingViewerShares, updateStatus]);

  const selfVoiceChannelId = users.find(u => u.self)?.channelId;
  const canScreenShare = connected && !selfLeftVoice && (selfVoiceChannelId ?? 0) !== 0;

  useEffect(() => {
    const connectedState = connected ? 'connected' : 'notConnected';
    const leftVoiceState = selfLeftVoice ? 'leftVoice' : 'inVoice';
    const channelState = selfVoiceChannelId == null ? 'noSelfChannel' : `channel-${selfVoiceChannelId}`;
    const canState = canScreenShare ? 'canShare' : 'cannotShare';

    try {
      bridge.send(`livekit.debug.uiGate.${connectedState}.${leftVoiceState}.${channelState}.${canState}`, {});
    } catch {
      // Diagnostics must never affect UI state.
    }
  }, [canScreenShare, connected, selfLeftVoice, selfVoiceChannelId]);

  useEffect(() => {
    if (shouldClearLocalShareStartPending({
      isLocalShareStartPending,
      selfLeftVoice,
      voiceChannelId: selfVoiceChannelId,
    })) {
      isLocalShareStartPendingRef.current = false;
      setIsLocalShareStartPending(false);
    }
  }, [isLocalShareStartPending, selfLeftVoice, selfVoiceChannelId]);

  // Show notification when someone starts sharing in the user's voice channel
  useEffect(() => {
    const onRemoteShareStarted = (data: unknown) => {
      const d = data as { roomName: string; userName: string; userId?: number; matrixUserId?: string; sessionId?: number };
      const selfUser = usersRef.current.find(u => u.self);
      const voiceChannelId = selfUser?.channelId;
      // Only show notification for other users' shares in our channel.
      // Prefer the session id to identify self; when the server payload omits
      // it, fall back to matching the Matrix identity so the broadcaster does
      // not get a notification for their own share (the event is broadcast to
      // everyone in the room, including the sharer).
      const selfMatrixUserId = selfUser?.matrixUserId ?? matrixCredentialsRef.current?.userId;
      const isSelfShare = (d.sessionId != null && selfUser?.session != null)
        ? d.sessionId === selfUser.session
        : (selfMatrixUserId != null && d.matrixUserId != null && d.matrixUserId === selfMatrixUserId);
      if (
        voiceChannelId != null &&
        d.roomName === `channel-${voiceChannelId}` &&
        !isSelfShare &&
        shouldShowOptionalNotification(optionalNotificationSettingsRef.current, 'notificationRemoteScreenShare')
      ) {
        setScreenShareNotification({ userName: d.userName, roomName: d.roomName, userId: d.userId, matrixUserId: d.matrixUserId });
        notifQueue.register('screen-share', 'info');
      }
    };

    const onRemoteShareStopped = () => {
      setScreenShareNotification(null);
      notifQueue.unregister('screen-share');
    };

    bridge.on('livekit.screenShareStarted', onRemoteShareStarted);
    bridge.on('livekit.screenShareStopped', onRemoteShareStopped);
    return () => {
      bridge.off('livekit.screenShareStarted', onRemoteShareStarted);
      bridge.off('livekit.screenShareStopped', onRemoteShareStopped);
    };
  }, [notifQueue]);

  const requestActiveShareDiscovery = useCallback((channelId: string | undefined) => {
    if (!channelId) {
      setDiscoveryTarget(null);
      return;
    }

    const requestId = ++nextActiveShareDiscoveryRequestIdRef.current;

    if (channelId === 'server-root') {
      setDiscoveryTarget({ scope: 'all', requestId });
      bridge.send('livekit.checkActiveShare', { scope: 'all', requestId });
      return;
    }

    setDiscoveryTarget({ roomName: `channel-${channelId}`, requestId });
    bridge.send('livekit.checkActiveShare', { roomName: `channel-${channelId}`, requestId });
  }, [setDiscoveryTarget]);

  requestActiveShareDiscoveryRef.current = requestActiveShareDiscovery;

  // Check for active screen shares when switching channels.
  // Depends ONLY on currentChannelId: the other collaborators (notifQueue and
  // requestActiveShareDiscovery) are accessed via refs so their
  // identity churn — notably notifQueue changing on every register/unregister —
  // does not re-run this effect and wipe a freshly shown screen-share
  // notification.
  useEffect(() => {
    setScreenShareNotification(null);
    notifQueueRef.current.unregister('screen-share');
    requestActiveShareDiscoveryRef.current?.(currentChannelId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChannelId]);

  useEffect(() => {
    const previousConnectionStatus = previousWorkspaceConnectionStatusRef.current;
    previousWorkspaceConnectionStatusRef.current = connectionStatus;

    if (connectionStatus === 'connected' && previousConnectionStatus !== 'connected') {
      dispatchWorkspace({ type: 'CONNECTION_WORKSPACE_READY' });
    }
  }, [connectionStatus]);

  useEffect(() => {
    const previousConnectionStatus = previousConnectionStatusRef.current;
    previousConnectionStatusRef.current = connectionStatus;

    if (connectionStatus !== 'connected' || previousConnectionStatus === 'connected') {
      return;
    }

    if (previousCurrentChannelIdRef.current !== currentChannelIdRef.current) {
      return;
    }

    requestActiveShareDiscovery(currentChannelIdRef.current);
  }, [connectionStatus, requestActiveShareDiscovery]);

  useEffect(() => {
    previousCurrentChannelIdRef.current = currentChannelId;
  }, [currentChannelId]);

  const handleToggleScreenShare = useCallback(async () => {
    const selfUser = usersRef.current.find(u => u.self);
    const canUseScreenshare = effectiveLiveKitStateRef.current === 'connected';
    const shouldStartSharing = !isSharing && canUseScreenshare && !selfLeftVoice && selfUser?.channelId != null && selfUser.channelId !== 0;
    const sharingState = isSharing ? 'sharing' : 'notSharing';
    const leftVoiceState = selfLeftVoice ? 'leftVoice' : 'inVoice';
    const channelState = selfUser?.channelId == null ? 'noSelfChannel' : `channel-${selfUser.channelId}`;
    const actionState = shouldStartSharing ? 'canStart' : 'blocked';

    try {
      bridge.send(`livekit.debug.toggleScreenShare.${sharingState}.${leftVoiceState}.${channelState}.${actionState}`, {});
    } catch {
      // Diagnostics must never affect the screen-share action.
    }

    if (shouldStartSharing) {
      setIsLocalShareStartPending(true);
      isLocalShareStartPendingRef.current = true;
      updateStatus('livekit', { state: 'connecting', error: undefined });
    }

    if (!isSharing && !canUseScreenshare) {
      return;
    }

    await toggleLocalScreenShare({
      isSharing,
      selfLeftVoice,
      voiceChannelId: selfUser?.channelId,
      liveKitState: liveKitStateRef.current,
      startSharing,
      stopSharing,
      setSharingChannelId,
      onSharingChannelIdChanged: (channelId) => {
        sharingChannelIdRef.current = channelId;
        wasLocalShareRecentlyActiveRef.current = channelId !== undefined;
        if (channelId !== undefined) {
          ignoreNextMovedSharingRef.current = false;
        }
      },
    });

    if (shouldStartSharing) {
      setIsLocalShareStartPending(false);
      isLocalShareStartPendingRef.current = false;
    }
  }, [isSharing, startSharing, stopSharing, selfLeftVoice, updateStatus]);
  handleToggleScreenShareRef.current = handleToggleScreenShare;

  const handleWatchScreenShare = useCallback((roomName: string, userId?: number, matrixUserId?: string) => {
    if (userId == null) {
      return;
    }

    const share = activeShares.find(s => s.userId === userId && s.roomName === roomName)
      ?? activeShares.find(s => s.userId === userId)
      ?? null;
    const actualRoomName = share?.roomName ?? roomName;

    if (!canWatchShareFromChannel(currentChannelId, actualRoomName)) {
      return;
    }

    updateStatus('livekit', { state: 'connecting', error: undefined });
    void Promise.resolve(connectAsViewer(actualRoomName, userId, matrixUserId ?? share?.matrixUserId)).catch(err => {
      updateStatus('livekit', { state: 'disconnected', error: err instanceof Error ? err.message : 'Failed to connect as viewer' });
    });
  }, [activeShares, connectAsViewer, currentChannelId, updateStatus]);

  // Track which channel/DM was last opened so we only snapshot + mark-read on actual switches.
  const prevChannelIdRef = useRef<string | undefined>(undefined);
  const prevDMUserIdRef = useRef<string | null>(null);

  // Snapshot the read marker ONCE when the user switches to a channel, then mark the room
  // as read. The divider stays at the snapshotted position until the user switches away.
  // We depend on roomUnreads so that on reconnect (when sync populates data after
  // the channel was already selected) we get a second chance to snapshot.
  useEffect(() => {
    const channelChanged = permittedActiveMatrixChannelId !== prevChannelIdRef.current;
    if (channelChanged) {
      prevChannelIdRef.current = permittedActiveMatrixChannelId ?? undefined;
    }

    if (!permittedActiveMatrixChannelId) {
      if (channelChanged) setChannelDividerTs(null);
      return;
    }
    const roomId = matrixCredentials?.roomMap?.[permittedActiveMatrixChannelId];
    if (!roomId || !matrixClient?.client) {
      if (channelChanged) setChannelDividerTs(null);
      return;
    }

    const { notificationCount } = unreadTracker.getRoomUnread(roomId);
    const markerTs = unreadTracker.getMarkerTimestamp(roomId);
    const hasUnread = markerTs != null && notificationCount > 0;

    if (channelChanged) {
      // Snapshot the divider timestamp before marking read
      setChannelDividerTs(hasUnread ? markerTs : null);

      // Mark the room as read
      const room = matrixClient.client.getRoom(roomId);
      const timeline = room?.getLiveTimeline()?.getEvents();
      if (timeline && timeline.length > 0) {
        const lastEventId = timeline[timeline.length - 1].getId();
        if (lastEventId) {
          unreadTracker.markRoomRead(roomId, lastEventId);
        }
      }
    } else if (hasUnread) {
      // Same channel, but roomUnreads updated (e.g. sync just completed on reconnect).
      // Backfill the divider only if we haven't set one yet.
      setChannelDividerTs(prev => {
        if (prev !== null) return prev; // keep existing snapshot
        // Also mark read now that we have data
        const room = matrixClient.client!.getRoom(roomId);
        const timeline = room?.getLiveTimeline()?.getEvents();
        if (timeline && timeline.length > 0) {
          const lastEventId = timeline[timeline.length - 1].getId();
          if (lastEventId) {
            unreadTracker.markRoomRead(roomId, lastEventId);
          }
        }
        return markerTs;
      });
    }
  }, [permittedActiveMatrixChannelId, matrixCredentials?.roomMap, matrixClient, unreadTracker]);

  // Same pattern for DM switches
  useEffect(() => {
    const selectedId = activeDmMatrixContactId;
    const dmChanged = selectedId !== prevDMUserIdRef.current;
    if (dmChanged) {
      prevDMUserIdRef.current = selectedId;
    }

    if (!selectedId || !foregroundDmContact) {
      if (dmChanged) setDmDividerTs(null);
      return;
    }
    // Only Matrix contacts have room IDs for unread tracking
    if (!matrixClient?.dmRoomMap || !matrixClient?.client) {
      if (dmChanged) setDmDividerTs(null);
      return;
    }
    const roomId = matrixClient.dmRoomMap.get(selectedId);
    if (!roomId) {
      if (dmChanged) setDmDividerTs(null);
      return;
    }

    const { notificationCount } = unreadTracker.getRoomUnread(roomId);
    const markerTs = unreadTracker.getMarkerTimestamp(roomId);
    const hasUnread = markerTs != null && notificationCount > 0;

    if (dmChanged) {
      setDmDividerTs(hasUnread ? markerTs : null);

      const room = matrixClient.client.getRoom(roomId);
      const timeline = room?.getLiveTimeline()?.getEvents();
      if (timeline && timeline.length > 0) {
        const lastEventId = timeline[timeline.length - 1].getId();
        if (lastEventId) {
          unreadTracker.markRoomRead(roomId, lastEventId);
        }
      }
    } else if (hasUnread) {
      setDmDividerTs(prev => {
        if (prev !== null) return prev;
        const room = matrixClient.client!.getRoom(roomId);
        const timeline = room?.getLiveTimeline()?.getEvents();
        if (timeline && timeline.length > 0) {
          const lastEventId = timeline[timeline.length - 1].getId();
          if (lastEventId) {
            unreadTracker.markRoomRead(roomId, lastEventId);
          }
        }
        return markerTs;
      });
    }
  }, [activeDmMatrixContactId, foregroundDmContact, unreadTracker.roomUnreads, matrixClient.client, unreadTracker, matrixClient?.dmRoomMap]);

  return (
    <div className={`app${showOnboarding ? ' app--onboarding' : ''}`}>
      <WindowResizeHandles />
      <ProfileProvider value={certFingerprint}>
      <ErrorBoundary label="Header">
      <Header
        username={username}
        onToggleDM={connected ? toggleMessagesPanel : undefined}
        dmActive={messagesPanelExpanded}
        unreadDMCount={totalDmUnreadCount}
        onOpenSettings={() => { setSettingsTab('profile'); setShowSettings(true); }}
        onOpenAudioSettings={() => { setSettingsTab('audio'); setShowSettings(true); }}
        onAvatarClick={connected ? () => setShowAvatarEditor(true) : undefined}
        avatarUrl={currentUserAvatarUrl}
        matrixUserId={matrixCredentials?.userId}
        muted={selfMuted}
        deafened={selfDeafened}
        leftVoice={selfLeftVoice}
        canRejoin={selfCanRejoin}
        onToggleMute={connected ? handleToggleMute : undefined}
        onToggleDeaf={connected ? handleToggleDeaf : undefined}
        onLeaveVoice={connected ? handleLeaveVoice : undefined}
        screenSharing={isSharing}
        screenShareError={screenShareError}
        onToggleScreenShare={connected ? handleToggleScreenShare : undefined}
        canScreenShare={canScreenShare}
        speaking={speakingUsers.has(selfSession) || false}
        pendingChannelAction={pendingChannelAction}
        hotkeyPressedBtn={hotkeyPressedBtn}
        leaveVoiceOnCooldown={leaveVoiceOnCooldown}
        muteOnCooldown={muteOnCooldown}
        deafOnCooldown={deafOnCooldown}
        onToggleGame={() => setShowGame(prev => !prev)}
        isMaximized={isMaximized}
      />
      </ErrorBoundary>
      
      <div className={`app-body ${messagesPanelExpanded ? '' : 'app-body--messages-collapsed'}`}>
        <ErrorBoundary label="Sidebar">
        <Sidebar
          channels={channels}
          users={users}
          currentChannelId={currentChannelId && currentChannelId !== 'server-root' ? Number(currentChannelId) : undefined}
          onJoinChannel={handleJoinChannel}
          onSelectChannel={handleSelectChannel}
          onSelectServer={handleSelectServer}
          isServerChatActive={currentChannelId === 'server-root'}
          serverLabel={serverLabel}
          serverAddress={serverAddress}
          username={username}
          onDisconnect={handleDisconnect}
          onStartDM={handleStartDMFromContextMenu}
          onChallengeDeathroll={(session) => gameState.invite(session)}
          onChallengeRps={(session, bestOf) => gameState.invite(session, 'rps', { bestOf })}
          duelChannelIds={duelChannelIds}
          speakingUsers={speakingUsers}
          voiceIdle={voiceIdle}
          connectionStatus={connectionStatus}
          onCancelReconnect={handleCancelReconnect}
          pendingChannelAction={pendingChannelAction}
          channelUnreads={channelUnreads}
          sharingChannelId={sharingChannelId ? Number(sharingChannelId) : (activeShares.length > 0 ? Number(activeShares[0].roomName.replace('channel-', '')) : undefined)}
          sharingUserSession={isSharing ? selfSession : activeShare?.sessionId}
          activeShares={activeShares}
          watchingShares={watchingShares}
          isLiveKitRoomConnected={isSharing || watchingShares.length > 0}
          screenShareQuality={roomQuality}
          isSharing={isSharing}
          broadcastSummary={isSharing ? formatBroadcastSummary(screenShareSettings.resolution, screenShareSettings.fps) : undefined}
          shareQualities={shareQualities}
          remoteVideoEls={remoteVideoEls}
          onWatchScreenShare={handleWatchScreenShare}
          onStopWatching={(userId) => disconnectViewer(userId)}
          onEditAvatar={connected ? () => setShowAvatarEditor(true) : undefined}
          onRequestChannel={() => setRequestChannelOpen(true)}
        />
        </ErrorBoundary>
        
        <main className={`main-content workspace-conversation ${messagesPanelExpanded ? 'workspace-conversation--with-panel' : ''}`}>
          {connectionStatus === 'idle' ? (
            certExists === true ? (
              <ServerList onConnect={handleServerConnect} connectDisabled={brokenCertInfo != null && !brokenCertInfo.hasHealthyFallback} connectionError={connectionError} onClearError={() => setConnectionError(null)} activeProfileName={activeProfileName} />
            ) : (
              <div className="connection-state">
                <div className="connection-state-content">
                  <div className="connection-state-logo">
                    <BrmbleLogo size={192} heartbeat />
                  </div>
                  <p className="connection-state-subtext">Checking client certificate…</p>
                </div>
              </div>
            )
          ) : connectionStatus === 'connected' ? (
            showGame ? (
              <NeonDGame onClose={() => setShowGame(false)} />
            ) : (
              <div className={`content-slider ${showDmConversation ? 'dm-active' : ''}`}>
                <div className="content-slide" aria-hidden={!showChannelConversation} inert={!showChannelConversation}>
                  <ErrorBoundary label="ChatPanel:Channel">
                   <ChatPanel
                    channelId={currentChannelId || undefined}
                    channelName={currentChannelId === 'server-root' ? (serverLabel || 'Server') : currentChannelName}
                    messages={channelChatMessages}
                    currentUsername={username}
                    onSendMessage={handleSendMessage}
                    onDismissMessage={handleDismissMessage}
                    matrixClient={matrixClient.client}
                    matrixRoomId={channelMatrixRoomId}
                    readMarkerTs={channelDividerTs}
                    {...(showChannelConversation ? screenShareViewerProps : {})}
                    users={users}
                    disabled={!canSendActiveChannelChat}
                    topNotice={channelChatAccessNotice ?? brmbleServiceChatNotice}
                    onMessageContextMenu={handleChatMessageContextMenu}
                    onCopyToClipboard={handleCopyToClipboard}
                    currentUserMatrixId={matrixCredentials?.userId}
                    onToggleReaction={handleToggleChannelReaction}
                     typingIndicatorText={isDmMode ? undefined : matrixClient.activeTypingText}
                     typingTargetId={activeChannelId ?? undefined}
                     onTypingStart={matrixClient.startTyping}
                     onTypingStop={matrixClient.stopTyping}
                  />
                  </ErrorBoundary>
                </div>
                <div className="content-slide" aria-hidden={!showDmConversation} inert={!showDmConversation}>
                  <ErrorBoundary label="ChatPanel:DM">
                   <ChatPanel
                    channelId={foregroundDmContact ? `dm-${foregroundDmContact.id}` : undefined}
                    channelName={foregroundDmContact?.displayName ?? ''}
                    messages={foregroundDmMessages}
                    currentUsername={username}
                    onSendMessage={dmStore.sendMessage}
                    isDM={true}
                    matrixClient={foregroundDmContact && !selectedDmIsMumble ? matrixClient.client : null}
                    matrixRoomId={foregroundDmContact && !selectedDmIsMumble ? dmMatrixRoomId : null}
                    readMarkerTs={foregroundDmContact && !selectedDmIsMumble ? dmDividerTs : null}
                    {...(showDmConversation ? screenShareViewerProps : {})}
                    users={users}
                    disabled={foregroundDmContact?.isEphemeral === true && foregroundDmContact.mumbleSessionId == null}
                    topNotice={selectedDmIsMumble ? 'This is a Mumble direct message. Chat history will be lost when you disconnect.' : undefined}
                    onMessageContextMenu={handleChatMessageContextMenu}
                    onCopyToClipboard={handleCopyToClipboard}
                    currentUserMatrixId={foregroundDmContact && !selectedDmIsMumble ? matrixCredentials?.userId : undefined}
                    onToggleReaction={foregroundDmContact && !selectedDmIsMumble ? handleToggleDmReaction : undefined}
                    typingIndicatorText={foregroundDmContact && !selectedDmIsMumble && isDmMode ? matrixClient.activeTypingText : undefined}
                    typingTargetId={foregroundDmContact && !selectedDmIsMumble ? (activeDmMatrixContactId ?? undefined) : undefined}
                    onTypingStart={foregroundDmContact && !selectedDmIsMumble ? matrixClient.startTyping : undefined}
                    onTypingStop={foregroundDmContact && !selectedDmIsMumble ? matrixClient.stopTyping : undefined}
                  />
                  </ErrorBoundary>
                </div>
              </div>
            )
          ) : (
            <ConnectionState
              connectionStatus={connectionStatus}
              serverLabel={serverLabel}
              errorMessage={statuses.voice.error}
              onCancel={connectionStatus === 'connecting' || connectionStatus === 'reconnecting' ? handleCancelReconnect : undefined}
              onReconnect={connectionStatus === 'disconnected' ? handleReconnect : undefined}
              onBackToServerList={handleBackToServerList}
            />
          )}
        </main>

        {connected && (
          <DMContactList
            contacts={dmContactsWithUnreads}
            selectedUserId={dmStore.selectedContact?.id ?? null}
            onSelectContact={(id: string) => {
              dmStore.selectContact(id);
              dispatchWorkspace({ type: 'SELECT_DM', contactId: id });
            }}
            onCloseConversation={(id: string) => {
              dmStore.closeDM(id);
              if (dmStore.selectedContact?.id === id) {
                dispatchWorkspace({ type: 'SELECTED_DM_INVALIDATED' });
              }
            }}
            onToggleVisibility={toggleMessagesPanel}
            visible={messagesPanelExpanded}
          />
        )}
      </div>

      {showOnboarding && (
        <OnboardingWizard onComplete={(fp) => {
          setShowOnboarding(false);
          setCertExists(true);
          setCertFingerprint(fp);
          // Re-read brmblegotchi setting — the wizard writes to localStorage
          try {
            const stored = localStorage.getItem('brmble-settings');
            if (stored) {
              const parsed = JSON.parse(stored);
              setBrmblegotchiEnabledState(parsed.brmblegotchi?.enabled ?? false);
            }
          } catch { /* ignore */ }
        }} onServersImported={handleServersImported} isMaximized={isMaximized} />
      )}

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        initialTab={settingsTab}
        username={username}
        connected={connected}
        currentUser={{ name: username || 'Unknown', matrixUserId: matrixCredentials?.userId, avatarUrl: currentUserAvatarUrl }}
        onUploadAvatar={onUploadAvatar}
        onRemoveAvatar={onRemoveAvatar}
        brmblegotchiEnabled={brmblegotchiEnabled}
        setBrmblegotchiEnabled={setBrmblegotchiEnabled}
        onLiveCompanionChange={handleLiveCompanionChange}
        liveUsers={users}
        channels={channels}
        onChannelsChange={setChannels}
        channelRequestRefreshKey={channelRequestRefreshKey}
      />

      <RequestChannelModal
        isOpen={requestChannelOpen}
        onClose={() => setRequestChannelOpen(false)}
        onCreated={() => {
          setRequestChannelOpen(false);
          setChannelRequestRefreshKey(key => key + 1);
        }}
      />

      <ConnectModal
        isOpen={showConnectModal}
        onClose={() => setShowConnectModal(false)}
        onConnect={handleConnect}
      />

      <AvatarEditorModal
        isOpen={showAvatarEditor}
        onClose={() => setShowAvatarEditor(false)}
        currentUser={{
          name: username ?? 'Unknown',
          matrixUserId: matrixCredentials?.userId,
          avatarUrl: currentUserAvatarUrl,
        }}
        comment={users.find(u => u.self)?.comment}
        onSetComment={(comment) => bridge.send('voice.setComment', { comment })}
        onUploadAvatar={onUploadAvatar}
        onRemoveAvatar={onRemoveAvatar}
      />

      <CloseDialog
        isOpen={showCloseDialog}
        onMinimize={handleCloseMinimize}
        onQuit={handleCloseQuit}
      />

      {(gameState.activeMatch || gameState.ended) && (
        (gameState.activeMatch?.gameType ?? gameState.ended?.gameType) === 'rps' ? (
          <RpsModal
            key={`rps-${gameState.activeMatch?.matchId ?? gameState.ended?.matchId ?? 'none'}`}
            view={gameState.view}
            ended={gameState.ended}
            myUserId={selfSession}
            turnDeadline={gameState.turnDeadline}
            turnWindowMs={gameState.turnWindowMs}
            penalty={gameState.penalty}
            resolveName={resolveGamePlayerName}
            onPick={(pick) => gameState.sendAction({ pick })}
            onForfeit={confirmForfeit}
            onClose={gameState.ended ? gameState.dismissEnded : confirmForfeit}
          />
        ) : (
          <DeathrollModal
            view={gameState.view}
            ended={gameState.ended}
            myUserId={selfSession}
            turnDeadline={gameState.turnDeadline}
            turnWindowMs={gameState.turnWindowMs}
            penalty={gameState.penalty}
            resolveName={resolveGamePlayerName}
            onRoll={gameState.roll}
            onForfeit={confirmForfeit}
            onClose={gameState.ended ? gameState.dismissEnded : confirmForfeit}
          />
        )
      )}

      <div className="notification-stack">
        {gameState.incomingInvite && notifQueue.isVisible('game-invite') && (
          <Notification
            status="info"
            position="top-right"
            duration={null}
            countdownMs={gameState.incomingInvite.inviteMs ?? 30000}
            visible={!!gameState.incomingInvite}
            title={`${gameDisplayName(gameState.incomingInvite.gameType)} challenge`}
            detail={`${resolveGamePlayerName(gameState.incomingInvite.from)} challenged you to ${gameDisplayName(gameState.incomingInvite.gameType)}.`}
            actions={
              <button
                className="btn btn-sm btn-primary"
                onClick={() => gameState.acceptInvite()}
                disabled={gameState.accepting}
              >
                Accept
              </button>
            }
            onDismiss={() => gameState.declineInvite()}
            onExited={() => notifQueue.unregister('game-invite')}
          />
        )}
        {gameState.outgoingInvite && notifQueue.isVisible('game-pending') && (
          <Notification
            status="info"
            position="top-right"
            duration={null}
            countdownMs={gameState.outgoingInvite.inviteMs ?? 30000}
            visible={!!gameState.outgoingInvite}
            title={gameState.outgoingInvite.canceling ? 'Canceling challenge' : 'Waiting for opponent'}
            detail={gameState.outgoingInvite.canceling
              ? `Canceling your ${gameDisplayName(gameState.outgoingInvite.gameType)} challenge to ${resolveGamePlayerName(gameState.outgoingInvite.targetSession)}\u2026`
              : `${resolveGamePlayerName(gameState.outgoingInvite.targetSession)} was challenged to ${gameDisplayName(gameState.outgoingInvite.gameType)}.`}
            actions={
              <button
                className="btn btn-sm btn-danger"
                onClick={() => gameState.cancelInvite()}
                disabled={gameState.outgoingInvite.canceling}
              >
                Cancel
              </button>
            }
            onDismiss={() => gameState.cancelInvite()}
            onExited={() => notifQueue.unregister('game-pending')}
          />
        )}
        {gameState.inviteOutcome && notifQueue.isVisible('game-outcome') && (() => {
          const o = gameState.inviteOutcome;
          const name = o.targetSession != null ? resolveGamePlayerName(o.targetSession) : 'The player';
          const copy = o.kind === 'declined'
            ? { title: 'Challenge declined', detail: `${name} declined your challenge.` }
            : o.kind === 'expired'
              ? { title: 'No response', detail: `${name} didn't respond to your challenge.` }
              : { title: 'Challenge blocked', detail: `${name} isn't accepting challenges.` };
          return (
            <Notification
              status="info"
              position="top-right"
              visible={!!gameState.inviteOutcome}
              title={copy.title}
              detail={copy.detail}
              onDismiss={() => gameState.clearInviteOutcome()}
              onExited={() => notifQueue.unregister('game-outcome')}
            />
          );
        })()}
        {gameState.lastError && notifQueue.isVisible('game-error') && (
          <Notification
            status="error"
            position="top-right"
            visible={!!gameState.lastError}
            title="Game error"
            detail={gameState.lastError}
            onDismiss={() => gameState.clearError()}
            onExited={() => notifQueue.unregister('game-error')}
          />
        )}
        {updateInfo && notifQueue.isVisible('update') && (
          <UpdateNotification
            version={updateInfo.version}
            onUpdate={handleApplyUpdate}
            onDismiss={() => { handleDismissUpdate(); notifQueue.unregister('update'); }}
            progress={updateProgress}
          />
        )}
        {brokenCertInfo && brokenCertInfo.brokenProfiles.map(bp => (
          notifQueue.isVisible(`cert-${bp.id}`) ? (
            <BrokenCertNotification
              key={bp.id}
              profile={bp}
              onImport={handleBrokenCertImport}
              onOpenSettings={handleBrokenCertOpenSettings}
              onDismiss={() => { handleBrokenCertDismiss(bp.id); notifQueue.unregister(`cert-${bp.id}`); }}
            />
          ) : null
        ))}
        {serverImportNotifications.map(notification => (
          notifQueue.isVisible(notification.id) ? (
            <Notification
              key={notification.id}
              status="info"
              position="top-right"
              visible={notification.visible}
              duration={5000}
              title="Server imported"
              detail={notification.label}
              onDismiss={() => {
                setServerImportNotifications(prev => prev.map(t => t.id === notification.id ? { ...t, visible: false } : t));
              }}
              onExited={() => {
                setServerImportNotifications(prev => prev.filter(t => t.id !== notification.id));
                notifQueue.unregister(notification.id);
              }}
            />
          ) : null
        ))}
        {screenShareNotification && notifQueue.isVisible('screen-share') && (
          <Notification
            status="info"
            position="top-right"
            visible={!!screenShareNotification}
            duration={8000}
            title={`${screenShareNotification.userName} started sharing their screen`}
            actions={
              <button
                className="btn btn-sm btn-primary"
                onClick={() => {
                  handleWatchScreenShare(screenShareNotification.roomName, screenShareNotification.userId, screenShareNotification.matrixUserId);
                  setScreenShareNotification(null);
                  notifQueue.unregister('screen-share');
                }}
              >
                Watch
              </button>
            }
            onDismiss={() => {
              setScreenShareNotification(null);
            }}
            onExited={() => {
              notifQueue.unregister('screen-share');
            }}
          />
        )}
        {screenShareEndedNotification && notifQueue.isVisible(screenShareEndedNotification.id) && (
          <Notification
            key={screenShareEndedNotification.id}
            status={screenShareEndedNotification.status}
            position="top-right"
            visible={!!screenShareEndedNotification}
            title={screenShareEndedNotification.title}
            detail={screenShareEndedNotification.detail}
            onDismiss={() => {
              notifQueue.unregister(screenShareEndedNotification.id);
              screenShareEndedNotificationRef.current = null;
              setScreenShareEndedNotification(null);
            }}
            onExited={() => {
              notifQueue.unregister(screenShareEndedNotification.id);
              if (screenShareEndedNotificationRef.current?.id === screenShareEndedNotification.id) {
                screenShareEndedNotificationRef.current = null;
              }
            }}
          />
        )}
        <WatchedShareEndedNotifications
          notifications={watchedShareEndedNotifications}
          notifQueue={notifQueue}
          onRemove={(id) => setWatchedShareEndedNotifications(prev => prev.filter(notification => notification.id !== id))}
        />
        {movedChannelNotification && shouldShowOptionalNotification(optionalNotificationSettings, 'notificationMovedChannel') && notifQueue.isVisible(movedChannelNotification.id) && (
          <Notification
            key={movedChannelNotification.id}
            status={movedChannelNotification.status}
            position="top-right"
            visible={!!movedChannelNotification}
            title={movedChannelNotification.title}
            detail={movedChannelNotification.detail}
            onDismiss={() => {
              notifQueue.unregister(movedChannelNotification.id);
              movedChannelNotificationRef.current = null;
              setMovedChannelNotification(null);
            }}
            onExited={() => {
              notifQueue.unregister(movedChannelNotification.id);
              if (movedChannelNotificationRef.current?.id === movedChannelNotification.id) {
                movedChannelNotificationRef.current = null;
              }
            }}
          />
        )}
        {serverRemovalNotification && notifQueue.isVisible(serverRemovalNotification.id) && (
          <Notification
            status={serverRemovalNotification.status}
            position="top-right"
            visible={!!serverRemovalNotification}
            title={serverRemovalNotification.title}
            detail={serverRemovalNotification.detail}
            onDismiss={() => {
              notifQueue.unregister(serverRemovalNotification.id);
              setServerRemovalNotification(null);
            }}
            onExited={() => {
              notifQueue.unregister(serverRemovalNotification.id);
            }}
          />
        )}
        {adminChannelUpdateError && notifQueue.isVisible('admin-channel-update-error') && (
          <Notification
            key={adminChannelUpdateError.title}
            status="warning"
            position="top-right"
            visible={true}
            title={adminChannelUpdateError.title}
            detail={adminChannelUpdateError.detail}
            onDismiss={() => {
              notifQueue.unregister('admin-channel-update-error');
              setAdminChannelUpdateError(null);
            }}
            onExited={() => {
              notifQueue.unregister('admin-channel-update-error');
            }}
          />
        )}
        {brmbleServiceWarningNotification && notifQueue.isVisible(brmbleServiceWarningNotification.id) && (
          <Notification
            status={brmbleServiceWarningNotification.status}
            position="top-right"
            visible={!!brmbleServiceWarningNotification}
            title={brmbleServiceWarningNotification.title}
            detail={brmbleServiceWarningNotification.detail}
            onDismiss={() => {
              brmbleServiceWarningDismissedForOutageRef.current = true;
              notifQueue.unregister(brmbleServiceWarningNotification.id);
              setBrmbleServiceWarningNotification(null);
            }}
            onExited={() => {
              notifQueue.unregister(brmbleServiceWarningNotification.id);
            }}
          />
        )}
        {copyNotification && notifQueue.isVisible('copy') && (
          <Notification
            status={copyNotification.message.includes('Failed') ? 'error' : 'success'}
            position="top-right"
            visible={!!copyNotification}
            duration={2000}
            title={copyNotification.message}
            onDismiss={() => {
              setCopyNotification(null);
            }}
            onExited={() => {
              notifQueue.unregister('copy');
            }}
          />
        )}
        {preLeaveStartedAt !== null && shouldShowIdlePreLeaveNotification && notifQueue.isVisible('idle-pre-leave') && (
          <Notification
            status="info"
            position="top-right"
            visible={preLeaveStartedAt !== null}
            duration={60000}
            title="Still there?"
            detail="You'll leave voice soon due to inactivity."
            onDismiss={() => {
              notifQueue.unregister('idle-pre-leave');
            }}
            onExited={() => {
              notifQueue.unregister('idle-pre-leave');
            }}
          />
        )}
        {preLeaveCancelledAt !== null && shouldShowIdlePreLeaveNotification && notifQueue.isVisible('idle-pre-leave-cancelled') && (
          <Notification
            status="info"
            position="top-right"
            visible={preLeaveCancelledAt !== null}
            duration={5000}
            title="Welcome back"
            detail="Auto leave cancelled."
            onDismiss={() => {
              notifQueue.unregister('idle-pre-leave-cancelled');
              dismissPreLeaveCancelled();
            }}
            onExited={() => {
              notifQueue.unregister('idle-pre-leave-cancelled');
            }}
          />
        )}
        {autoLeftAt !== null && notifQueue.isVisible('idle-auto-leave') && (
          <Notification
            status="info"
            position="top-right"
            visible={autoLeftAt !== null}
            duration={6000}
            title="Out of voice"
            detail="You were moved out of voice after inactivity. Screen sharing and watched streams were stopped."
            onDismiss={() => {
              notifQueue.unregister('idle-auto-leave');
              dismissAutoLeftNotification();
            }}
            onExited={() => {
              notifQueue.unregister('idle-auto-leave');
            }}
          />
        )}
      </div>



      <ZoomIndicator />
      <Version />
      <Prompt />
      <PromptWithInput />
      </ProfileProvider>
    </div>
  );
}

export default App;
