import { useState, useEffect, useCallback } from 'react';
import bridge from '../../bridge';
import { type AllBindings, BINDING_LABELS } from './SettingsModal';
import './AudioSettingsTab.css';
import './ShortcutsSettingsTab.css';

interface AudioSettingsTabProps {
  settings: AudioSettings;
  speechEnhancement: SpeechEnhancementSettings;
  onChange: (settings: AudioSettings) => void;
  onSpeechEnhancementChange: (settings: SpeechEnhancementSettings) => void;
  allBindings: AllBindings;
  onClearBinding: (bindingId: string) => void;
}

export type TransmissionMode = 'pushToTalk' | 'voiceActivity' | 'continuous';

export interface AudioSettings {
  inputDevice: string;
  outputDevice: string;
  inputVolume: number;
  outputVolume: number;
  maxAmplification: number;
  transmissionMode: TransmissionMode;
  pushToTalkKey: string | null;
}

export interface SpeechEnhancementSettings {
  enabled: boolean;
  model: string;
}

export const DEFAULT_SETTINGS: AudioSettings = {
  inputDevice: 'default',
  outputDevice: 'default',
  inputVolume: 250,
  outputVolume: 250,
  maxAmplification: 100,
  transmissionMode: 'pushToTalk',
  pushToTalkKey: null,
};

export const DEFAULT_SPEECH_ENHANCEMENT: SpeechEnhancementSettings = {
  enabled: false,
  model: 'dns3',
};

interface AudioConflictState {
  key: string;
  conflictBindingId: string;
}

export function AudioSettingsTab({ settings, speechEnhancement, onChange, onSpeechEnhancementChange, allBindings, onClearBinding }: AudioSettingsTabProps) {
  const [localSettings, setLocalSettings] = useState<AudioSettings>(settings);
  const [recording, setRecording] = useState(false);
  const [conflict, setConflict] = useState<AudioConflictState | null>(null);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleChange = (key: keyof AudioSettings, value: string | number | TransmissionMode) => {
    const newSettings = { ...localSettings, [key]: value };
    setLocalSettings(newSettings);
    onChange(newSettings);
  };

  const handleInput = useCallback((key: string) => {
    if (!recording) return;

    // Check for conflicts across ALL bindings (including Shortcuts tab)
    const conflictEntry = Object.entries(allBindings).find(
      ([id, v]) => id !== 'pushToTalkKey' && v === key
    );

    if (conflictEntry) {
      const [conflictBindingId] = conflictEntry;
      setConflict({ key, conflictBindingId });
    } else {
      handleChange('pushToTalkKey', key);
      setRecording(false);
    }
  }, [recording, allBindings, handleChange]);

  const handleConflictConfirm = useCallback(() => {
    if (!conflict) return;
    // Delegate to parent to clear the conflicting binding
    // (handles bridge messages, settings persistence, etc.)
    onClearBinding(conflict.conflictBindingId);
    handleChange('pushToTalkKey', conflict.key);
    setConflict(null);
    setRecording(false);
  }, [conflict, handleChange, onClearBinding]);

  const handleConflictCancel = useCallback(() => {
    setConflict(null);
    setRecording(false);
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    e.preventDefault();
    handleInput(e.code);
  }, [handleInput]);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    e.preventDefault();
    const button = e.button;
    const mouseButtonMap: Record<number, string> = {
      0: 'MouseLeft',
      1: 'MouseMiddle', 
      2: 'MouseRight',
      3: 'XButton1',
      4: 'XButton2',
    };
    const key = mouseButtonMap[button];
    if (key) {
      handleInput(key);
    }
  }, [handleInput]);

  useEffect(() => {
    if (recording && !conflict) {
      bridge.send('voice.suspendHotkeys');
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('mousedown', handleMouseDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('mousedown', handleMouseDown);
        bridge.send('voice.resumeHotkeys');
      };
    }
  }, [recording, conflict, handleKeyDown, handleMouseDown]);

  return (
    <div className="audio-settings-tab">
      <div className="settings-item">
        <label>Input Device</label>
        <select
          className="settings-select"
          value={localSettings.inputDevice}
          onChange={(e) => handleChange('inputDevice', e.target.value)}
        >
          <option value="default">Default</option>
        </select>
      </div>

      <div className="settings-item">
        <label>Output Device</label>
        <select
          className="settings-select"
          value={localSettings.outputDevice}
          onChange={(e) => handleChange('outputDevice', e.target.value)}
        >
          <option value="default">Default</option>
        </select>
      </div>

      <div className="settings-item settings-slider">
        <label>Input Volume: {localSettings.inputVolume}%</label>
        <input
          type="range"
          min="0"
          max="250"
          value={localSettings.inputVolume}
          onChange={(e) => handleChange('inputVolume', parseInt(e.target.value, 10))}
        />
      </div>

      <div className="settings-item settings-slider">
        <label>Max Amplification: {localSettings.maxAmplification}%</label>
        <input
          type="range"
          min="100"
          max="400"
          value={localSettings.maxAmplification}
          onChange={(e) => handleChange('maxAmplification', parseInt(e.target.value, 10))}
        />
      </div>

      <div className="settings-item settings-slider">
        <label>Output Volume: {localSettings.outputVolume}%</label>
        <input
          type="range"
          min="0"
          max="250"
          value={localSettings.outputVolume}
          onChange={(e) => handleChange('outputVolume', parseInt(e.target.value, 10))}
        />
      </div>

      <div className="settings-item">
        <label>Transmission Mode</label>
        <select
          className="settings-select"
          value={localSettings.transmissionMode}
          onChange={(e) => handleChange('transmissionMode', e.target.value as TransmissionMode)}
        >
          <option value="pushToTalk">Push to Talk</option>
          <option value="voiceActivity">Voice Activity</option>
          <option value="continuous">Continuous</option>
        </select>
      </div>

      {localSettings.transmissionMode === 'pushToTalk' && (
        <div className="settings-item">
          <label>Push to Talk Key</label>
          <button
            className={`key-binding-btn ${recording ? 'recording' : ''}`}
            onClick={() => setRecording(!recording)}
          >
            {recording ? 'Press any key...' : (localSettings.pushToTalkKey || 'Not bound')}
          </button>
        </div>
      )}

      <div className="settings-section-divider" />

      <div className="settings-item settings-toggle">
        <label>
          Speech Enhancement
          <span className="settings-hint-inline"> — AI noise reduction (GTCRN)</span>
        </label>
        <input
          type="checkbox"
          className="toggle-input"
          checked={speechEnhancement.enabled}
          onChange={() => onSpeechEnhancementChange({ ...speechEnhancement, enabled: !speechEnhancement.enabled })}
        />
      </div>

      {conflict && (
        <div className="shortcut-conflict-overlay">
          <div className="shortcut-conflict-card" role="dialog" aria-modal="true" aria-labelledby="audio-conflict-title">
            <h3 id="audio-conflict-title" className="shortcut-conflict-title">Key already in use</h3>
            <p className="shortcut-conflict-message">
              This key is already bound to <strong>{BINDING_LABELS[conflict.conflictBindingId] ?? conflict.conflictBindingId}</strong>.
              Rebind it to <strong>Push to Talk</strong>?
            </p>
            <div className="shortcut-conflict-buttons">
              <button className="shortcut-conflict-btn confirm" onClick={handleConflictConfirm} autoFocus>
                Rebind
              </button>
              <button className="shortcut-conflict-btn cancel" onClick={handleConflictCancel}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
