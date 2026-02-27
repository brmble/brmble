import { useState, useEffect, useMemo } from 'react';
import './SettingsModal.css';
import bridge from '../../bridge';
import { AudioSettingsTab, type AudioSettings, type SpeechEnhancementSettings, DEFAULT_SETTINGS as DEFAULT_AUDIO, DEFAULT_SPEECH_ENHANCEMENT } from './AudioSettingsTab';
import { ShortcutsSettingsTab, type ShortcutsSettings, DEFAULT_SHORTCUTS } from './ShortcutsSettingsTab';
import { MessagesSettingsTab, type MessagesSettings, DEFAULT_MESSAGES } from './MessagesSettingsTab';
import { InterfaceSettingsTab } from './InterfaceSettingsTab';
import { type AppearanceSettings, type OverlaySettings, DEFAULT_APPEARANCE, DEFAULT_OVERLAY } from './InterfaceSettingsTypes';
import { IdentitySettingsTab } from './IdentitySettingsTab';
import { ConnectionSettingsTab, type ConnectionSettings } from './ConnectionSettingsTab';
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
};

const SETTINGS_STORAGE_KEY = 'brmble-settings';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  username?: string;
  certFingerprint?: string;
}

interface AppSettings {
  audio: AudioSettings;
  shortcuts: ShortcutsSettings;
  messages: MessagesSettings;
  appearance: AppearanceSettings;
  overlay: OverlaySettings;
  speechEnhancement: SpeechEnhancementSettings;
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
  speechEnhancement: DEFAULT_SPEECH_ENHANCEMENT,
  reconnectEnabled: true,
  autoConnectEnabled: false,
  autoConnectServerId: null,
};

export function SettingsModal(props: SettingsModalProps) {
  const { isOpen, onClose } = props;
  const [activeTab, setActiveTab] = useState<'audio' | 'shortcuts' | 'messages' | 'appearance' | 'connection' | 'identity'>('audio');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const { servers } = useServerlist();

  // Flat map of ALL key bindings across all tabs for cross-tab conflict detection
  const allBindings: AllBindings = useMemo(() => ({
    pushToTalkKey: settings.audio.pushToTalkKey,
    toggleLeaveVoiceKey: settings.shortcuts.toggleLeaveVoiceKey,
    toggleMuteDeafenKey: settings.shortcuts.toggleMuteDeafenKey,
    toggleMuteKey: settings.shortcuts.toggleMuteKey,
    toggleDMScreenKey: settings.shortcuts.toggleDMScreenKey,
  }), [settings.audio.pushToTalkKey, settings.shortcuts]);

  useEffect(() => {
    const handleCurrent = (data: unknown) => {
      const d = data as { settings?: AppSettings } | undefined;
      if (d?.settings) {
        setSettings({ ...DEFAULT_SETTINGS, ...d.settings });
        if (d.settings.appearance?.theme) {
          document.documentElement.setAttribute('data-theme', d.settings.appearance.theme);
        }
      }
    };

    bridge.on('settings.current', handleCurrent);
    bridge.send('settings.get');

    return () => {
      bridge.off('settings.current', handleCurrent);
    };
  }, []);

  const handleAudioChange = (audio: AudioSettings) => {
    setSettings(prev => {
      const newSettings = { ...prev, audio };

      bridge.send('settings.set', { settings: newSettings });

      // Notify backend of transmission mode change (only when relevant fields change)
      if (audio.transmissionMode !== prev.audio.transmissionMode ||
          audio.pushToTalkKey !== prev.audio.pushToTalkKey) {
        bridge.send('voice.setTransmissionMode', {
          mode: audio.transmissionMode,
          key: audio.transmissionMode === 'pushToTalk' ? audio.pushToTalkKey : null,
        });
      }
      
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
        bridge.send('voice.setTransmissionMode', {
          mode: prev.audio.transmissionMode,
          key: null,
        });
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
    const newSettings = { ...settings, messages };
    setSettings(newSettings);
    bridge.send('settings.set', { settings: newSettings });
  };

  const handleAppearanceChange = (appearance: AppearanceSettings) => {
    const newSettings = { ...settings, appearance };
    setSettings(newSettings);
    bridge.send('settings.set', { settings: newSettings });
    document.documentElement.setAttribute('data-theme', appearance.theme);
  };

  const handleOverlayChange = (overlay: OverlaySettings) => {
    const newSettings = { ...settings, overlay };
    setSettings(newSettings);
    bridge.send('settings.set', { settings: newSettings });
  };

  const handleSpeechEnhancementChange = (speechEnhancement: SpeechEnhancementSettings) => {
    const newSettings = { ...settings, speechEnhancement };
    setSettings(newSettings);
    bridge.send('settings.set', { settings: newSettings });
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
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-modal glass-panel" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>

        <div className="modal-header">
          <h2 className="modal-title">Settings</h2>
          <p className="modal-subtitle">Configure your preferences</p>
        </div>

        <div className="settings-tabs">
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
          <button
            className={`settings-tab ${activeTab === 'identity' ? 'active' : ''}`}
            onClick={() => setActiveTab('identity')}
          >
            Identity
          </button>
        </div>

        <div className="settings-content">
          {activeTab === 'audio' && <AudioSettingsTab settings={settings.audio} onChange={handleAudioChange} speechEnhancement={settings.speechEnhancement} onSpeechEnhancementChange={handleSpeechEnhancementChange} allBindings={allBindings} onClearBinding={handleClearBinding} />}
          {activeTab === 'shortcuts' && <ShortcutsSettingsTab settings={settings.shortcuts} onChange={handleShortcutsChange} allBindings={allBindings} onClearBinding={handleClearBinding} />}
          {activeTab === 'messages' && <MessagesSettingsTab settings={settings.messages} onChange={handleMessagesChange} />}
          {activeTab === 'appearance' && (
            <InterfaceSettingsTab 
              appearanceSettings={settings.appearance || DEFAULT_APPEARANCE} 
              overlaySettings={settings.overlay || DEFAULT_OVERLAY}
              onAppearanceChange={handleAppearanceChange} 
              onOverlayChange={handleOverlayChange}
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
          {activeTab === 'identity' && (
            <IdentitySettingsTab
              fingerprint={props.certFingerprint ?? ''}
              connectedUsername={props.username ?? ''}
            />
          )}
        </div>

        <div className="settings-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
