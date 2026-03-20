import { useState, useEffect, useMemo } from 'react';
import './SettingsModal.css';
import bridge from '../../bridge';
import { applyTheme } from '../../themes/theme-loader';
import { AudioSettingsTab, type AudioSettings, type SpeechDenoiseSettings, DEFAULT_SETTINGS as DEFAULT_AUDIO, DEFAULT_SPEECH_DENOISE } from './AudioSettingsTab';
import { ShortcutsSettingsTab, type ShortcutsSettings, DEFAULT_SHORTCUTS } from './ShortcutsSettingsTab';
import { MessagesSettingsTab, type MessagesSettings, DEFAULT_MESSAGES } from './MessagesSettingsTab';
import { InterfaceSettingsTab } from './InterfaceSettingsTab';
import { type AppearanceSettings, type OverlaySettings, type BrmblegotchiSettings, DEFAULT_APPEARANCE, DEFAULT_OVERLAY, DEFAULT_BRMBLEGOTCHI } from './InterfaceSettingsTypes';
import { ConnectionSettingsTab, type ConnectionSettings } from './ConnectionSettingsTab';
import { ProfileSettingsTab } from './ProfileSettingsTab';
import { useServerlist } from '../../hooks/useServerlist';

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
  certFingerprint?: string;
  connected?: boolean;
  currentUser?: {
    name: string;
    matrixUserId?: string;
    avatarUrl?: string;
  };
  onUploadAvatar?: (blob: Blob, contentType: string) => void;
  onRemoveAvatar?: () => void;
}

interface AppSettings {
  audio: AudioSettings;
  shortcuts: ShortcutsSettings;
  messages: MessagesSettings;
  appearance: AppearanceSettings;
  overlay: OverlaySettings;
  brmblegotchi: BrmblegotchiSettings;
  speechDenoise: SpeechDenoiseSettings;
  reconnectEnabled: boolean;
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
  speechDenoise: DEFAULT_SPEECH_DENOISE,
  reconnectEnabled: true,
  autoConnectEnabled: false,
  autoConnectServerId: null,
};

export function SettingsModal(props: SettingsModalProps) {
  const { isOpen, onClose } = props;
  const [activeTab, setActiveTab] = useState<'profile' | 'audio' | 'shortcuts' | 'messages' | 'appearance' | 'connection'>('profile');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const { servers } = useServerlist();

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
    const handleCurrent = (data: unknown) => {
      const d = data as { settings?: AppSettings } | undefined;
      if (d?.settings) {
        // Normalize speechDenoise mode to valid values
        const normalizedDenoise = { ...DEFAULT_SPEECH_DENOISE, ...d.settings.speechDenoise };
        const validModes = ['disabled', 'rnnoise', 'gtcrn'];
        if (!validModes.includes(normalizedDenoise.mode)) {
          normalizedDenoise.mode = 'rnnoise';
        }
        setSettings({ ...DEFAULT_SETTINGS, ...d.settings, speechDenoise: normalizedDenoise });
        if (d.settings.appearance?.theme) {
          applyTheme(d.settings.appearance.theme);
        }
      }
    };

    bridge.on('settings.current', handleCurrent);
    bridge.send('settings.get');

    return () => {
      bridge.off('settings.current', handleCurrent);
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
          setSettings(prev => ({
            ...prev,
            brmblegotchi: parsed.brmblegotchi ?? DEFAULT_BRMBLEGOTCHI,
          }));
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
    const newSettings = { ...settings, overlay };
    setSettings(newSettings);
    bridge.send('settings.set', { settings: newSettings });
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
  };

  const handleBrmblegotchiChange = (brmblegotchi: BrmblegotchiSettings) => {
    const newSettings = { ...settings, brmblegotchi };
    setSettings(newSettings);
    bridge.send('settings.set', { settings: newSettings });
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
  };

  const handleSpeechDenoiseChange = (speechDenoise: SpeechDenoiseSettings) => {
    const newSettings = { ...settings, speechDenoise };
    setSettings(newSettings);
    bridge.send('settings.set', { settings: newSettings });
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
  };

  const handleConnectionChange = (connection: ConnectionSettings) => {
    const newSettings = {
      ...settings,
      reconnectEnabled: connection.reconnectEnabled,
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
      <div className="settings-modal glass-panel animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="heading-title modal-title">Settings</h2>
          <p className="modal-subtitle">Configure your preferences</p>
        </div>

        <div className="settings-tabs">
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
            Messages
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

        </div>

        <div className="settings-content">
          {activeTab === 'profile' && (
            <ProfileSettingsTab
              currentUser={props.currentUser ?? { name: props.username ?? 'Unknown' }}
              onUploadAvatar={props.onUploadAvatar ?? (() => {})}
              onRemoveAvatar={props.onRemoveAvatar ?? (() => {})}
              fingerprint={props.certFingerprint ?? ''}
              connectedUsername={props.username ?? ''}
              connected={props.connected ?? false}
            />
          )}
          {activeTab === 'audio' && <AudioSettingsTab settings={settings.audio} onChange={handleAudioChange} speechDenoise={settings.speechDenoise} onSpeechDenoiseChange={handleSpeechDenoiseChange} allBindings={allBindings} onClearBinding={handleClearBinding} />}
          {activeTab === 'shortcuts' && <ShortcutsSettingsTab settings={settings.shortcuts} onChange={handleShortcutsChange} allBindings={allBindings} onClearBinding={handleClearBinding} />}
          {activeTab === 'messages' && <MessagesSettingsTab settings={settings.messages} onChange={handleMessagesChange} />}
          {activeTab === 'appearance' && (
            <InterfaceSettingsTab 
              appearanceSettings={settings.appearance || DEFAULT_APPEARANCE} 
              overlaySettings={settings.overlay || DEFAULT_OVERLAY}
              brmblegotchiSettings={settings.brmblegotchi || DEFAULT_BRMBLEGOTCHI}
              onAppearanceChange={handleAppearanceChange} 
              onOverlayChange={handleOverlayChange}
              onBrmblegotchiChange={handleBrmblegotchiChange}
            />
          )}
          {activeTab === 'connection' && (
            <ConnectionSettingsTab
              settings={{
                reconnectEnabled: settings.reconnectEnabled,
                autoConnectEnabled: settings.autoConnectEnabled,
                autoConnectServerId: settings.autoConnectServerId,
              }}
              onChange={handleConnectionChange}
              servers={servers.map(s => ({ id: s.id, label: s.label }))}
            />
          )}

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
