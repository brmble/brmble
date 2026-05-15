import { useState, useEffect, useRef, useMemo } from 'react';
import { Select } from '../Select';
import './MessagesSettingsTab.css';

interface MessagesSettingsTabProps {
  settings: MessagesSettings;
  onChange: (settings: MessagesSettings) => void;
}

export interface MessagesSettings {
  ttsEnabled: boolean;
  ttsVolume: number;
  ttsVoice: string;
  notificationsDisabled: boolean;
  notificationRemoteScreenShare: boolean;
  notificationScreenShareStatus: boolean;
  notificationIdleWarning: boolean;
  notificationMovedChannel: boolean;
}

export const DEFAULT_MESSAGES: MessagesSettings = {
  ttsEnabled: false,
  ttsVolume: 100,
  ttsVoice: '',
  notificationsDisabled: false,
  notificationRemoteScreenShare: true,
  notificationScreenShareStatus: true,
  notificationIdleWarning: true,
  notificationMovedChannel: true,
};

type IncomingMessagesSettings = Partial<MessagesSettings> & { notificationsEnabled?: boolean };

function normalizeMessagesSettings(settings: IncomingMessagesSettings): MessagesSettings {
  const normalized = { ...DEFAULT_MESSAGES, ...settings };
  if (settings.notificationsDisabled !== true && settings.notificationsEnabled === false) {
    normalized.notificationsDisabled = true;
  }
  return normalized;
}

export function MessagesSettingsTab({ settings, onChange }: MessagesSettingsTabProps) {
  const [localSettings, setLocalSettings] = useState<MessagesSettings>(() => normalizeMessagesSettings(settings));
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const voiceSignatureRef = useRef('');

  useEffect(() => {
    setLocalSettings(normalizeMessagesSettings(settings));
  }, [settings]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }

    const synth = window.speechSynthesis;
    const loadVoices = () => {
      const availableVoices = synth.getVoices();
      const signature = [...availableVoices]
        .sort((a, b) => a.voiceURI.localeCompare(b.voiceURI))
        .map(v => `${v.voiceURI}|${v.name}|${v.lang}|${v.default ? 1 : 0}`)
        .join('||');
      if (signature !== voiceSignatureRef.current) {
        voiceSignatureRef.current = signature;
        setVoices(availableVoices);
      }
    };
    loadVoices();

    if (typeof synth.addEventListener === 'function') {
      synth.addEventListener('voiceschanged', loadVoices);
      return () => {
        synth.removeEventListener('voiceschanged', loadVoices);
      };
    }

    const previousHandler = synth.onvoiceschanged;
    synth.onvoiceschanged = loadVoices;

    return () => {
      if (synth.onvoiceschanged === loadVoices) {
        synth.onvoiceschanged = previousHandler || null;
      }
    };
  }, []);

  useEffect(() => {
    if (localSettings.ttsEnabled && !localSettings.ttsVoice && voices.length > 0) {
      const ziraVoice = voices.find(v => v.name.includes('Zira'));
      if (ziraVoice) {
        const newSettings = { ...localSettings, ttsVoice: ziraVoice.name };
        setLocalSettings(newSettings);
        onChange(newSettings);
      }
    }
  }, [voices, localSettings.ttsEnabled, localSettings.ttsVoice]);

  const ttsVoiceOptions = useMemo(
    () => [
      { value: '', label: 'Default' },
      ...voices.map(voice => ({ value: voice.name, label: voice.name })),
    ],
    [voices]
  );

  const handleChange = (key: keyof MessagesSettings, value: boolean | number | string) => {
    let newSettings = { ...localSettings, [key]: value };
    if (key === 'ttsEnabled' && value === true && !localSettings.ttsVoice) {
      const ziraVoice = voices.find(v => v.name.includes('Zira'));
      if (ziraVoice) {
        newSettings = { ...newSettings, ttsVoice: ziraVoice.name };
      }
    }
    setLocalSettings(newSettings);
    onChange(newSettings);
  };

  return (
    <div className="messages-settings-tab">

      {/* Text-to-Speech Section */}
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Text-to-Speech</h3>
        <div className="settings-item settings-toggle">
          <label>Text-to-Speech</label>
          <label className="brmble-toggle">
            <input
              type="checkbox"
              checked={localSettings.ttsEnabled}
              onChange={(e) => handleChange('ttsEnabled', e.target.checked)}
            />
            <span className="brmble-toggle-slider"></span>
          </label>
        </div>

        {localSettings.ttsEnabled && (
          <>
            <div className="settings-item settings-slider">
              <label>TTS Volume: {localSettings.ttsVolume}%</label>
              <input
                type="range"
                min="0"
                max="100"
                value={localSettings.ttsVolume}
                onChange={(e) => handleChange('ttsVolume', parseInt(e.target.value))}
              />
            </div>

            <div className="settings-item">
              <label>TTS Voice</label>
              <Select
                value={localSettings.ttsVoice}
                onChange={(v) => handleChange('ttsVoice', v)}
                options={ttsVoiceOptions}
              />
            </div>
          </>
        )}
      </div>

      {/* Notifications Section */}
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Notifications</h3>
        <div className="settings-item settings-toggle">
          <label htmlFor="notifications-disabled">Disable optional notifications</label>
          <label className="brmble-toggle">
            <input
              id="notifications-disabled"
              type="checkbox"
              checked={localSettings.notificationsDisabled}
              onChange={(e) => handleChange('notificationsDisabled', e.target.checked)}
            />
            <span className="brmble-toggle-slider"></span>
          </label>
        </div>
        <p>Hide optional pop-up notifications. Critical warnings and one-time account or update notices may still appear.</p>
        <div className="settings-item settings-toggle">
          <label htmlFor="notification-remote-screen-share">Screen share invitations</label>
          <label className="brmble-toggle">
            <input
              id="notification-remote-screen-share"
              type="checkbox"
              checked={!localSettings.notificationsDisabled && localSettings.notificationRemoteScreenShare}
              disabled={localSettings.notificationsDisabled}
              onChange={(e) => handleChange('notificationRemoteScreenShare', e.target.checked)}
            />
            <span className="brmble-toggle-slider"></span>
          </label>
        </div>
        <div className="settings-item settings-toggle">
          <label htmlFor="notification-screen-share-status">Screen share status</label>
          <label className="brmble-toggle">
            <input
              id="notification-screen-share-status"
              type="checkbox"
              checked={!localSettings.notificationsDisabled && localSettings.notificationScreenShareStatus}
              disabled={localSettings.notificationsDisabled}
              onChange={(e) => handleChange('notificationScreenShareStatus', e.target.checked)}
            />
            <span className="brmble-toggle-slider"></span>
          </label>
        </div>
        <div className="settings-item settings-toggle">
          <label htmlFor="notification-idle-warning">Idle reminders</label>
          <label className="brmble-toggle">
            <input
              id="notification-idle-warning"
              type="checkbox"
              checked={!localSettings.notificationsDisabled && localSettings.notificationIdleWarning}
              disabled={localSettings.notificationsDisabled}
              onChange={(e) => handleChange('notificationIdleWarning', e.target.checked)}
            />
            <span className="brmble-toggle-slider"></span>
          </label>
        </div>
        <div className="settings-item settings-toggle">
          <label htmlFor="notification-moved-channel">Channel move notices</label>
          <label className="brmble-toggle">
            <input
              id="notification-moved-channel"
              type="checkbox"
              checked={!localSettings.notificationsDisabled && localSettings.notificationMovedChannel}
              disabled={localSettings.notificationsDisabled}
              onChange={(e) => handleChange('notificationMovedChannel', e.target.checked)}
            />
            <span className="brmble-toggle-slider"></span>
          </label>
        </div>
      </div>

    </div>
  );
}
