import { useState, useEffect } from 'react';
import './SettingsModal.css';
import bridge from '../../bridge';
import { AudioSettingsTab, type AudioSettings, type SpeechEnhancementSettings, DEFAULT_SETTINGS as DEFAULT_AUDIO, DEFAULT_SPEECH_ENHANCEMENT } from './AudioSettingsTab';
import { ShortcutsSettingsTab, type ShortcutsSettings, DEFAULT_SHORTCUTS } from './ShortcutsSettingsTab';
import { MessagesSettingsTab, type MessagesSettings, DEFAULT_MESSAGES } from './MessagesSettingsTab';
import { OverlaySettingsTab, type OverlaySettings, DEFAULT_OVERLAY } from './OverlaySettingsTab';
import { IdentitySettingsTab } from './IdentitySettingsTab';

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
  overlay: OverlaySettings;
  speechEnhancement: SpeechEnhancementSettings;
}

const DEFAULT_SETTINGS: AppSettings = {
  audio: DEFAULT_AUDIO,
  shortcuts: DEFAULT_SHORTCUTS,
  messages: DEFAULT_MESSAGES,
  overlay: DEFAULT_OVERLAY,
  speechEnhancement: DEFAULT_SPEECH_ENHANCEMENT,
};

export function SettingsModal(props: SettingsModalProps) {
  const { isOpen, onClose } = props;
  const [activeTab, setActiveTab] = useState<'audio' | 'shortcuts' | 'messages' | 'overlay' | 'identity'>('audio');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    const handleCurrent = (data: unknown) => {
      const d = data as { settings?: AppSettings } | undefined;
      if (d?.settings) {
        setSettings({ ...DEFAULT_SETTINGS, ...d.settings });
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
        { action: 'toggleDeafen', key: shortcuts.toggleDeafenKey },
        { action: 'toggleMuteDeafen', key: shortcuts.toggleMuteDeafenKey },
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

  const handleMessagesChange = (messages: MessagesSettings) => {
    const newSettings = { ...settings, messages };
    setSettings(newSettings);
    bridge.send('settings.set', { settings: newSettings });
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

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
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
            className={`settings-tab ${activeTab === 'overlay' ? 'active' : ''}`}
            onClick={() => setActiveTab('overlay')}
          >
            Overlay
          </button>
          <button
            className={`settings-tab ${activeTab === 'identity' ? 'active' : ''}`}
            onClick={() => setActiveTab('identity')}
          >
            Identity
          </button>
        </div>

        <div className="settings-content">
          {activeTab === 'audio' && <AudioSettingsTab settings={settings.audio} onChange={handleAudioChange} speechEnhancement={settings.speechEnhancement} onSpeechEnhancementChange={handleSpeechEnhancementChange} />}
          {activeTab === 'shortcuts' && <ShortcutsSettingsTab settings={settings.shortcuts} onChange={handleShortcutsChange} />}
          {activeTab === 'messages' && <MessagesSettingsTab settings={settings.messages} onChange={handleMessagesChange} />}
          {activeTab === 'overlay' && <OverlaySettingsTab settings={settings.overlay} onChange={handleOverlayChange} />}
          {activeTab === 'identity' && (
            <IdentitySettingsTab
              fingerprint={props.certFingerprint ?? ''}
              connectedUsername={props.username ?? ''}
            />
          )}
        </div>

        <div className="settings-footer">
          <button className="settings-btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="settings-btn primary" onClick={onClose}>
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
