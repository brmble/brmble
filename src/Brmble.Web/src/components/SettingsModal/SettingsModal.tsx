import { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import './SettingsModal.css';
import bridge from '../../bridge';
import { applyTheme } from '../../themes/theme-loader';
import { AudioSettingsTab, type AudioSettings, type NoiseSuppressionSettings, DEFAULT_SETTINGS as DEFAULT_AUDIO, DEFAULT_NOISE_SUPPRESSION } from './AudioSettingsTab';
import { ShortcutsSettingsTab, type ShortcutsSettings, DEFAULT_SHORTCUTS } from './ShortcutsSettingsTab';
import { MessagesSettingsTab, type MessagesSettings, DEFAULT_MESSAGES } from './MessagesSettingsTab';
import { InterfaceSettingsTab } from './InterfaceSettingsTab';
import { type AppearanceSettings, type OverlaySettings, type BrmblegotchiSettings, type CompanionSelection, DEFAULT_APPEARANCE, DEFAULT_OVERLAY, DEFAULT_BRMBLEGOTCHI, normalizeOverlaySettings } from './InterfaceSettingsTypes';
import { ConnectionSettingsTab, type ConnectionSettings } from './ConnectionSettingsTab';
import { ProfileSettingsTab } from './ProfileSettingsTab';
import { AdminSettingsTab } from './AdminSettingsTab';
import { ScreenShareSettingsTab } from './ScreenShareSettingsTab';
import { useServerlist } from '../../hooks/useServerlist';
import { usePermissions, Permission } from '../../hooks/usePermissions';

/** A flat map of every key binding in the app: bindingId → bound key code (or null). */
export type AllBindings = Record<string, string | null>;

/** Human-readable labels for every binding ID. */
export const BINDING_LABELS: Record<string, string> = {
  pushToTalkKey: 'Push to Talk',
  toggleLeaveVoiceKey: 'Toggle Leave Voice',
  toggleMuteDeafenKey: 'Toggle Mute & Deafen',
  toggleMuteKey: 'Toggle Mute',
  toggleDMScreenKey: 'Toggle Direct Messages Screen',
  toggleScreenShareKey: 'Toggle Screen Share',
  toggleGameKey: 'Toggle Game Panel',
};

const SETTINGS_STORAGE_KEY = 'brmble-settings';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  username?: string;
  connected?: boolean;
  currentUser?: {
    name: string;
    matrixUserId?: string;
    avatarUrl?: string;
  };
  onUploadAvatar?: (blob: Blob, contentType: string) => void;
  onRemoveAvatar?: () => void;
  initialTab?: 'profile' | 'audio' | 'shortcuts' | 'messages' | 'appearance' | 'connection' | 'admin';
  brmblegotchiEnabled?: boolean;
  setBrmblegotchiEnabled?: (enabled: boolean) => void;
  onLiveCompanionChange?: (nextCompanion: CompanionSelection, previousCompanion: CompanionSelection) => void;
}

export interface ScreenShareSettings {
  captureAudio: boolean;
  resolution: '720p' | '1080p' | '1440p' | '4k';
  fps: 15 | 30 | 60;
  systemAudio: boolean;
  viewerMode: 'in-app' | 'new-window';
}

export const DEFAULT_SCREEN_SHARE: ScreenShareSettings = {
  captureAudio: false,
  resolution: '1080p',
  fps: 30,
  systemAudio: false,
  viewerMode: 'in-app',
};

interface AppSettings {
  audio: AudioSettings;
  shortcuts: ShortcutsSettings;
  messages: MessagesSettings;
  appearance: AppearanceSettings;
  overlay: OverlaySettings;
  brmblegotchi: BrmblegotchiSettings;
  noiseSuppression: NoiseSuppressionSettings;
  screenShare: ScreenShareSettings;
  reconnectEnabled: boolean;
  rememberLastChannel: boolean;
  autoConnectEnabled: boolean;
  autoConnectServerId: string | null;
}

const DEFAULT_SETTINGS: AppSettings = {
  audio: DEFAULT_AUDIO,
  shortcuts: DEFAULT_SHORTCUTS,
  messages: DEFAULT_MESSAGES,
  appearance: DEFAULT_APPEARANCE,
  overlay: DEFAULT_OVERLAY,
  brmblegotchi: DEFAULT_BRMBLEGOTCHI,
  noiseSuppression: DEFAULT_NOISE_SUPPRESSION,
  screenShare: DEFAULT_SCREEN_SHARE,
  reconnectEnabled: true,
  rememberLastChannel: true,
  autoConnectEnabled: false,
  autoConnectServerId: null,
};

const VALID_NS_LEVELS = ['Off', 'Low', 'Moderate', 'High', 'VeryHigh'] as const;

export function SettingsModal(props: SettingsModalProps) {
  const { isOpen, onClose, initialTab } = props;
  const [activeTab, setActiveTab] = useState<'profile' | 'audio' | 'shortcuts' | 'messages' | 'appearance' | 'connection' | 'admin' | 'screenShare'>(initialTab ?? 'profile');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const { servers } = useServerlist();
  const { hasPermission } = usePermissions();
  const hasAdminPermission = hasPermission(0, Permission.Ban) || hasPermission(0, Permission.Kick);

  const tabsRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!isOpen) return;

    const updateModalWidth = () => {
      if (!tabsRef.current || !modalRef.current) return;
      const tabsWidth = tabsRef.current.scrollWidth;
      const modalWidth = Math.min(Math.max(tabsWidth, 600), window.innerWidth * 0.9);
      modalRef.current.style.width = `${modalWidth}px`;
    };

    updateModalWidth();
    window.addEventListener('resize', updateModalWidth);

    return () => {
      window.removeEventListener('resize', updateModalWidth);
    };
  }, [isOpen, hasAdminPermission]);

  useEffect(() => {
    if (!isOpen) return;
    const effectiveTab = (initialTab === 'admin' && !hasAdminPermission) ? 'profile' : (initialTab ?? 'profile');
    setActiveTab(effectiveTab);
  }, [isOpen, initialTab, hasAdminPermission]);

  // Resolve registration name for the currently connected server
  const connectedRegisteredName = (() => {
    if (!props.connected) return undefined;
    try {
      const stored = localStorage.getItem('brmble-server');
      if (!stored) return undefined;
      const savedServer = JSON.parse(stored) as { id?: string };
      if (!savedServer.id) return undefined;
      const match = servers.find(s => s.id === savedServer.id);
      return match?.registered ? match.registeredName : undefined;
    } catch { return undefined; }
  })();

  // Close on Escape key (skip if a key-binding button is recording)
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.key-binding-btn.recording')) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Flat map of ALL key bindings across all tabs for cross-tab conflict detection
  const allBindings: AllBindings = useMemo(() => ({
    pushToTalkKey: settings.audio.pushToTalkKey,
    toggleLeaveVoiceKey: settings.shortcuts.toggleLeaveVoiceKey,
    toggleMuteDeafenKey: settings.shortcuts.toggleMuteDeafenKey,
    toggleMuteKey: settings.shortcuts.toggleMuteKey,
    toggleDMScreenKey: settings.shortcuts.toggleDMScreenKey,
    toggleScreenShareKey: settings.shortcuts.toggleScreenShareKey,
    toggleGameKey: settings.shortcuts.toggleGameKey,
  }), [settings.audio.pushToTalkKey, settings.shortcuts]);

  useEffect(() => {
    let bridgeModule: { default: typeof import('../../bridge').default } | null = null;

    const handleCurrent = (data: unknown) => {
      const d = data as { settings?: AppSettings } | undefined;
      if (d?.settings) {
        setSettings(prev => {
          const normalizedNs = { ...DEFAULT_NOISE_SUPPRESSION, ...d.settings!.noiseSuppression };
          if (!VALID_NS_LEVELS.includes(normalizedNs.level as typeof VALID_NS_LEVELS[number])) {
            normalizedNs.level = DEFAULT_NOISE_SUPPRESSION.level;
          }
          const mergedSettings = {
            ...DEFAULT_SETTINGS,
            ...d.settings!,
            audio: { ...DEFAULT_SETTINGS.audio, ...(d.settings!.audio ?? {}) },
            overlay: normalizeOverlaySettings(d.settings!.overlay ?? {}),
            brmblegotchi: d.settings!.brmblegotchi ?? prev.brmblegotchi ?? DEFAULT_BRMBLEGOTCHI,
            screenShare: d.settings!.screenShare ?? prev.screenShare ?? DEFAULT_SCREEN_SHARE,
            noiseSuppression: normalizedNs,
          };
          if (d.settings!.appearance?.theme) {
            applyTheme(d.settings!.appearance.theme);
          }

          // Push the persisted NS level to the bridge so the client
          // honours the saved choice without waiting for a manual change.
          bridge.send('voice.setNoiseSuppression', { level: normalizedNs.level });

          return mergedSettings;
        });
      }
    };

    import('../../bridge').then(module => {
      bridgeModule = module;
      module.default.on('settings.current', handleCurrent);
      module.default.on('settings.updated', handleCurrent);
      module.default.send('settings.get');
    });

    return () => {
      if (bridgeModule) {
        bridgeModule.default.off('settings.current', handleCurrent);
        bridgeModule.default.off('settings.updated', handleCurrent);
      }
    };
  }, []);

  // Reset autoConnectServerId when the selected server is deleted (#264)
  useEffect(() => {
    setSettings(prev => {
      if (
        !prev.autoConnectServerId ||
        servers.some(s => s.id === prev.autoConnectServerId)
      ) {
        return prev;
      }

      const newSettings = { ...prev, autoConnectServerId: null };
      bridge.send('settings.set', { settings: newSettings });
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
      return newSettings;
    });
  }, [servers]);

  // Keep brmblegotchi setting in sync with localStorage
  useEffect(() => {
    if (!isOpen) return;
    const checkBrmblegotchi = () => {
      try {
        const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          const newBrmblegotchi = parsed.brmblegotchi ?? DEFAULT_BRMBLEGOTCHI;
          setSettings(prev => {
            if (prev.brmblegotchi.enabled !== newBrmblegotchi.enabled) {
              return { ...prev, brmblegotchi: newBrmblegotchi };
            }
            return prev;
          });
        }
      } catch {}
    };
    checkBrmblegotchi();
    const interval = setInterval(checkBrmblegotchi, 500);
    return () => clearInterval(interval);
  }, [isOpen]);

  const handleAudioChange = (audio: AudioSettings) => {
    setSettings(prev => {
      const newSettings = { ...prev, audio };

      bridge.send('settings.set', { settings: newSettings });
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));

      // No need to send voice.setTransmissionMode here — settings.set triggers
      // ApplySettings on the backend which already calls SetTransmissionMode.
      // Sending both caused a double-call race that crashed WASAPI capture when
      // the user's recorded PTT key was still physically held down.

      return newSettings;
    });
  };

  const handleShortcutsChange = (shortcuts: ShortcutsSettings) => {
    setSettings(prev => {
      const newSettings = { ...prev, shortcuts };
      bridge.send('settings.set', { settings: newSettings });
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));

      // Notify backend of each shortcut change
      const actions: { action: string; key: string | null }[] = [
        { action: 'toggleMute', key: shortcuts.toggleMuteKey },
        { action: 'toggleMuteDeafen', key: shortcuts.toggleMuteDeafenKey },
        { action: 'toggleLeaveVoice', key: shortcuts.toggleLeaveVoiceKey },
        { action: 'toggleDmScreen', key: shortcuts.toggleDMScreenKey },
        { action: 'toggleScreenShare', key: shortcuts.toggleScreenShareKey },
      ];

      for (const { action, key } of actions) {
        const prevKey = (prev.shortcuts as unknown as Record<string, string | null>)[action + 'Key'];
        if (key !== prevKey) {
          bridge.send('voice.setShortcut', { action, key });
        }
      }
      
      return newSettings;
    });
  };

  /** Clear any binding by its ID — used for cross-tab conflict resolution */
  const handleClearBinding = (bindingId: string) => {
    setSettings(prev => {
      let newSettings = { ...prev };
      if (bindingId === 'pushToTalkKey') {
        newSettings = { ...newSettings, audio: { ...prev.audio, pushToTalkKey: null } };
        // No need to send voice.setTransmissionMode — settings.set triggers
        // ApplySettings which already calls SetTransmissionMode.
      } else if (bindingId in prev.shortcuts) {
        newSettings = {
          ...newSettings,
          shortcuts: { ...prev.shortcuts, [bindingId]: null },
        };
        // Map binding IDs to backend action names (handles casing differences)
        const BINDING_TO_ACTION: Record<string, string> = {
          toggleMuteKey: 'toggleMute',
          toggleMuteDeafenKey: 'toggleMuteDeafen',
          toggleLeaveVoiceKey: 'toggleLeaveVoice',
          toggleDMScreenKey: 'toggleDmScreen',
          toggleScreenShareKey: 'toggleScreenShare',
        };
        const action = BINDING_TO_ACTION[bindingId] ?? bindingId.replace('Key', '');
        bridge.send('voice.setShortcut', { action, key: null });
      }
      bridge.send('settings.set', { settings: newSettings });
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
      return newSettings;
    });
  };

  const handleMessagesChange = (messages: MessagesSettings) => {
    setSettings(prev => {
      const newSettings = { ...prev, messages };
      bridge.send('settings.set', { settings: newSettings });
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
      return newSettings;
    });
  };

  const handleAppearanceChange = (appearance: AppearanceSettings) => {
    const newSettings = { ...settings, appearance };
    setSettings(newSettings);
    bridge.send('settings.set', { settings: newSettings });
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
    applyTheme(appearance.theme);
  };

  const handleOverlayChange = (overlay: OverlaySettings) => {
    const previousCompanion = settings.overlay.myCompanion;
    const newSettings = { ...settings, overlay };
    setSettings(newSettings);
    bridge.send('settings.set', { settings: newSettings });
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
    if (overlay.myCompanion !== previousCompanion) {
      props.onLiveCompanionChange?.(overlay.myCompanion, previousCompanion);
    }
  };

  const handleBrmblegotchiChange = (brmblegotchi: BrmblegotchiSettings) => {
    const newSettings = { ...settings, brmblegotchi };
    setSettings(newSettings);
    if (props.setBrmblegotchiEnabled) {
      props.setBrmblegotchiEnabled(!!brmblegotchi.enabled);
    }
  };

  const handleNoiseSuppressionChange = (noiseSuppression: NoiseSuppressionSettings) => {
    const newSettings = { ...settings, noiseSuppression };
    setSettings(newSettings);
    bridge.send('settings.set', { settings: newSettings });
    bridge.send('voice.setNoiseSuppression', { level: noiseSuppression.level });
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
  };

  const handleScreenShareChange = (screenShare: ScreenShareSettings) => {
    const newSettings = { ...settings, screenShare };
    setSettings(newSettings);
    bridge.send('settings.set', { settings: newSettings });
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
  };

  const handleConnectionChange = (connection: ConnectionSettings) => {
    const newSettings = {
      ...settings,
      reconnectEnabled: connection.reconnectEnabled,
      rememberLastChannel: connection.rememberLastChannel,
      autoConnectEnabled: connection.autoConnectEnabled,
      autoConnectServerId: connection.autoConnectServerId,
    };
    setSettings(newSettings);
    bridge.send('settings.set', { settings: newSettings });
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={modalRef} className="settings-modal glass-panel animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="heading-title modal-title">Settings</h2>
          <p className="modal-subtitle">Configure your preferences</p>
        </div>

        <div ref={tabsRef} className="settings-tabs">
          <button
            className={`settings-tab ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            Profile
          </button>
          <button 
            className={`settings-tab ${activeTab === 'audio' ? 'active' : ''}`}
            onClick={() => setActiveTab('audio')}
          >
            Audio
          </button>
          <button 
            className={`settings-tab ${activeTab === 'shortcuts' ? 'active' : ''}`}
            onClick={() => setActiveTab('shortcuts')}
          >
            Shortcuts
          </button>
          <button 
            className={`settings-tab ${activeTab === 'messages' ? 'active' : ''}`}
            onClick={() => setActiveTab('messages')}
          >
            Notifications
          </button>
          <button 
            className={`settings-tab ${activeTab === 'appearance' ? 'active' : ''}`}
            onClick={() => setActiveTab('appearance')}
          >
            Interface
          </button>
          <button
            className={`settings-tab ${activeTab === 'connection' ? 'active' : ''}`}
            onClick={() => setActiveTab('connection')}
          >
            Connection
          </button>
          <button 
            className={`settings-tab ${activeTab === 'screenShare' ? 'active' : ''}`}
            onClick={() => setActiveTab('screenShare')}
          >
            Screen Share
          </button>
          {hasAdminPermission && (
            <button
              className={`settings-tab ${activeTab === 'admin' ? 'active' : ''}`}
              onClick={() => setActiveTab('admin')}
            >
              Admin
            </button>
          )}

        </div>

        <div className="settings-content">
          {activeTab === 'profile' && (
            <ProfileSettingsTab
              currentUser={props.currentUser ?? { name: props.username ?? 'Unknown' }}
              onUploadAvatar={props.onUploadAvatar ?? (() => {})}
              onRemoveAvatar={props.onRemoveAvatar ?? (() => {})}
              connected={props.connected ?? false}
              registeredName={connectedRegisteredName}
            />
          )}
          {activeTab === 'audio' && <AudioSettingsTab settings={settings.audio} onChange={handleAudioChange} noiseSuppression={settings.noiseSuppression} onNoiseSuppressionChange={handleNoiseSuppressionChange} allBindings={allBindings} onClearBinding={handleClearBinding} />}
          {activeTab === 'shortcuts' && <ShortcutsSettingsTab settings={settings.shortcuts} onChange={handleShortcutsChange} allBindings={allBindings} onClearBinding={handleClearBinding} />}
          {activeTab === 'messages' && <MessagesSettingsTab settings={settings.messages} onChange={handleMessagesChange} />}
          {activeTab === 'appearance' && (
      <InterfaceSettingsTab
        appearanceSettings={settings.appearance}
        overlaySettings={settings.overlay}
        brmblegotchiSettings={settings.brmblegotchi}
        brmblegotchiEnabled={props.brmblegotchiEnabled}
        setBrmblegotchiEnabled={props.setBrmblegotchiEnabled}
        onAppearanceChange={handleAppearanceChange}
        onOverlayChange={handleOverlayChange}
        onBrmblegotchiChange={handleBrmblegotchiChange}
      />
          )}
          {activeTab === 'connection' && (
            <ConnectionSettingsTab
              settings={{
                reconnectEnabled: settings.reconnectEnabled,
                rememberLastChannel: settings.rememberLastChannel,
                autoConnectEnabled: settings.autoConnectEnabled,
                autoConnectServerId: settings.autoConnectServerId,
              }}
              onChange={handleConnectionChange}
              servers={servers.map(s => ({ id: s.id, label: s.label }))}
            />
          )}
          {activeTab === 'screenShare' && (
            <ScreenShareSettingsTab
              settings={settings.screenShare}
              onChange={handleScreenShareChange}
            />
          )}
          {activeTab === 'admin' && hasAdminPermission && <AdminSettingsTab />}

        </div>

        <div className="settings-footer">
          <button className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
