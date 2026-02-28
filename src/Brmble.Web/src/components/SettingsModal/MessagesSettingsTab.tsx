import { useState, useEffect } from 'react';
import './MessagesSettingsTab.css';

interface MessagesSettingsTabProps {
  settings: MessagesSettings;
  onChange: (settings: MessagesSettings) => void;
}

export interface MessagesSettings {
  ttsEnabled: boolean;
  ttsVolume: number;
  ttsVoice: string;
  notificationsEnabled: boolean;
}

export const DEFAULT_MESSAGES: MessagesSettings = {
  ttsEnabled: false,
  ttsVolume: 100,
  ttsVoice: '',
  notificationsEnabled: true,
};

export function MessagesSettingsTab({ settings, onChange }: MessagesSettingsTabProps) {
  const [localSettings, setLocalSettings] = useState<MessagesSettings>({ ...DEFAULT_MESSAGES, ...settings });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    setLocalSettings({ ...DEFAULT_MESSAGES, ...settings });
  }, [settings]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }

    const synth = window.speechSynthesis;
    const loadVoices = () => {
      const availableVoices = synth.getVoices();
      setVoices(availableVoices);
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
            <select
              value={localSettings.ttsVoice}
              onChange={(e) => handleChange('ttsVoice', e.target.value)}
              className="settings-select"
            >
              <option value="">Default</option>
              {voices.map((voice) => (
                <option key={voice.name} value={voice.name}>
                  {voice.name}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      <div className="settings-item settings-toggle">
        <label>Message Notifications</label>
        <label className="brmble-toggle">
          <input
            type="checkbox"
            checked={localSettings.notificationsEnabled}
            onChange={(e) => handleChange('notificationsEnabled', e.target.checked)}
          />
          <span className="brmble-toggle-slider"></span>
        </label>
      </div>
    </div>
  );
}
