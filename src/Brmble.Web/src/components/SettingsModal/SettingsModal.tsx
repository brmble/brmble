import { useState } from 'react';
import './SettingsModal.css';
import { AudioSettingsTab, type AudioSettings, DEFAULT_SETTINGS as DEFAULT_AUDIO } from './AudioSettingsTab';
import { ShortcutsSettingsTab, type ShortcutsSettings, DEFAULT_SHORTCUTS } from './ShortcutsSettingsTab';
import { MessagesSettingsTab, type MessagesSettings, DEFAULT_MESSAGES } from './MessagesSettingsTab';
import { OverlaySettingsTab, type OverlaySettings, DEFAULT_OVERLAY } from './OverlaySettingsTab';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  username?: string;
}

interface AppSettings {
  audio: AudioSettings;
  shortcuts: ShortcutsSettings;
  messages: MessagesSettings;
  overlay: OverlaySettings;
}

const STORAGE_KEY = 'brmble-settings';

const DEFAULT_SETTINGS: AppSettings = {
  audio: DEFAULT_AUDIO,
  shortcuts: DEFAULT_SHORTCUTS,
  messages: DEFAULT_MESSAGES,
  overlay: DEFAULT_OVERLAY,
};

function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return DEFAULT_SETTINGS;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'audio' | 'shortcuts' | 'messages' | 'overlay'>('audio');
  const [settings, setSettings] = useState<AppSettings>(loadSettings);

  const handleAudioChange = (audio: AudioSettings) => {
    const newSettings = { ...settings, audio };
    setSettings(newSettings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
  };

  const handleShortcutsChange = (shortcuts: ShortcutsSettings) => {
    const newSettings = { ...settings, shortcuts };
    setSettings(newSettings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
  };

  const handleMessagesChange = (messages: MessagesSettings) => {
    const newSettings = { ...settings, messages };
    setSettings(newSettings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
  };

  const handleOverlayChange = (overlay: OverlaySettings) => {
    const newSettings = { ...settings, overlay };
    setSettings(newSettings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
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
        </div>

        <div className="settings-content">
          {activeTab === 'audio' && <AudioSettingsTab settings={settings.audio} onChange={handleAudioChange} />}
          {activeTab === 'shortcuts' && <ShortcutsSettingsTab settings={settings.shortcuts} onChange={handleShortcutsChange} />}
          {activeTab === 'messages' && <MessagesSettingsTab settings={settings.messages} onChange={handleMessagesChange} />}
          {activeTab === 'overlay' && <OverlaySettingsTab settings={settings.overlay} onChange={handleOverlayChange} />}
        </div>

        <div className="settings-footer">
          <button className="settings-btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="settings-btn primary">
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
