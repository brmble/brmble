import { useState, useEffect, useCallback } from 'react';
import bridge from '../../bridge';
import { type AllBindings, BINDING_LABELS } from './SettingsModal';
import { confirm } from '../../hooks/usePrompt';
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
  jitterBuffer: number;
  outputDelay: number;
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
  jitterBuffer: 10,
  outputDelay: 50,
};

export const DEFAULT_SPEECH_ENHANCEMENT: SpeechEnhancementSettings = {
  enabled: false,
  model: 'dns3',
};

export function AudioSettingsTab({ settings, speechEnhancement, onChange, onSpeechEnhancementChange, allBindings, onClearBinding }: AudioSettingsTabProps) {
  const [localSettings, setLocalSettings] = useState<AudioSettings>(settings);
  const [recording, setRecording] = useState(false);
  const [isPromptOpen, setIsPromptOpen] = useState(false);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleChange = (key: keyof AudioSettings, value: string | number | TransmissionMode) => {
    const newSettings = { ...localSettings, [key]: value };
    setLocalSettings(newSettings);
    onChange(newSettings);
  };

  const handleInput = useCallback(async (key: string) => {
    if (!recording) return;

    // Check for conflicts across ALL bindings (including Shortcuts tab)
    const conflictEntry = Object.entries(allBindings).find(
      ([id, v]) => id !== 'pushToTalkKey' && v === key
    );

    if (conflictEntry) {
      const [conflictBindingId] = conflictEntry;
      setIsPromptOpen(true);
      const confirmed = await confirm({
        title: 'Key already in use',
        message: `This key is already bound to "${BINDING_LABELS[conflictBindingId] || conflictBindingId}". Rebind it to Push to Talk?`,
        confirmLabel: 'Rebind',
        cancelLabel: 'Cancel'
      });
      setIsPromptOpen(false);
      
      if (!confirmed) {
        setRecording(false);
        return;
      }
      
      // Clear conflicting binding first
      onClearBinding(conflictBindingId);
    }
    
    // Apply new binding
    handleChange('pushToTalkKey', key);
    setRecording(false);
  }, [recording, allBindings, handleChange, onClearBinding]);

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
    if (recording && !isPromptOpen) {
      bridge.send('voice.suspendHotkeys');
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('mousedown', handleMouseDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('mousedown', handleMouseDown);
        bridge.send('voice.resumeHotkeys');
      };
    }
  }, [recording, isPromptOpen, handleKeyDown, handleMouseDown]);

  return (
    <div className="audio-settings-tab">

      {/* Input Section */}
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Input</h3>
        <div className="settings-item">
          <label>Input Device</label>
          <div className="select-wrapper">
            <select
              className="brmble-input"
              value={localSettings.inputDevice}
              onChange={(e) => handleChange('inputDevice', e.target.value)}
            >
              <option value="default">Default</option>
            </select>
          </div>
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
      </div>

      {/* Output Section */}
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Output</h3>
        <div className="settings-item">
          <label>Output Device</label>
          <div className="select-wrapper">
            <select
              className="brmble-input"
              value={localSettings.outputDevice}
              onChange={(e) => handleChange('outputDevice', e.target.value)}
            >
              <option value="default">Default</option>
            </select>
          </div>
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

        <div className="settings-item settings-slider">
          <label>Jitter Buffer: {localSettings.jitterBuffer}ms</label>
          <span className="settings-hint">Lower reduces latency</span>
          <input
            type="range"
            min="10"
            max="60"
            value={localSettings.jitterBuffer}
            onChange={(e) => handleChange('jitterBuffer', parseInt(e.target.value, 10))}
          />
        </div>

        <div className="settings-item settings-slider">
          <label>Output Delay: {localSettings.outputDelay}ms</label>
          <span className="settings-hint">Lower reduces latency</span>
          <input
            type="range"
            min="10"
            max="100"
            value={localSettings.outputDelay}
            onChange={(e) => handleChange('outputDelay', parseInt(e.target.value, 10))}
          />
        </div>
      </div>

      {/* Transmission Section */}
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Transmission</h3>
        <div className="settings-item">
          <label>Transmission Mode</label>
          <div className="select-wrapper">
            <select
              className="brmble-input"
              value={localSettings.transmissionMode}
              onChange={(e) => handleChange('transmissionMode', e.target.value as TransmissionMode)}
            >
              <option value="pushToTalk">Push to Talk</option>
              <option value="voiceActivity">Voice Activity</option>
              <option value="continuous">Continuous</option>
            </select>
          </div>
        </div>

        {localSettings.transmissionMode === 'pushToTalk' && (
          <div className="settings-item">
            <label>Push to Talk Key</label>
            <button
              className={`btn btn-secondary key-binding-btn ${recording ? 'recording' : ''}`}
              onClick={() => setRecording(!recording)}
            >
              {recording ? 'Press any key...' : (localSettings.pushToTalkKey || 'Not bound')}
            </button>
          </div>
        )}

        <div className="settings-item settings-toggle">
          <label>
            Speech Enhancement
            <span className="settings-hint-inline"> — AI noise reduction (GTCRN)</span>
          </label>
          <label className="brmble-toggle">
            <input
              type="checkbox"
              checked={speechEnhancement.enabled}
              onChange={() => onSpeechEnhancementChange({ ...speechEnhancement, enabled: !speechEnhancement.enabled })}
            />
            <span className="brmble-toggle-slider"></span>
          </label>
        </div>
      </div>
    </div>
  );
}
