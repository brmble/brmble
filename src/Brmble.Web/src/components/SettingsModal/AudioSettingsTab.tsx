import { useState, useEffect, useCallback } from 'react';
import bridge from '../../bridge';
import { type AllBindings, BINDING_LABELS } from './SettingsModal';
import { confirm } from '../../hooks/usePrompt';
import { Select } from '../Select';
import './AudioSettingsTab.css';
import './ShortcutsSettingsTab.css';

interface AudioSettingsTabProps {
  settings: AudioSettings;
  speechDenoise: SpeechDenoiseSettings;
  onChange: (settings: AudioSettings) => void;
  onSpeechDenoiseChange: (settings: SpeechDenoiseSettings) => void;
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
  opusBitrate: number;
  opusFrameSize: number;
  voiceHoldMs: number;
  captureApi: 'waveIn' | 'wasapi';
}

export interface SpeechDenoiseSettings {
  mode: 'rnnoise' | 'gtcrn' | 'disabled';
}

export const DEFAULT_SETTINGS: AudioSettings = {
  inputDevice: 'default',
  outputDevice: 'default',
  inputVolume: 250,
  outputVolume: 250,
  maxAmplification: 100,
  transmissionMode: 'pushToTalk',
  pushToTalkKey: null,
  opusBitrate: 72000,
  opusFrameSize: 20,
  voiceHoldMs: 200,
  captureApi: 'wasapi',
};

export const DEFAULT_SPEECH_DENOISE: SpeechDenoiseSettings = {
  mode: 'rnnoise',
};

export function AudioSettingsTab({ settings, speechDenoise, onChange, onSpeechDenoiseChange, allBindings, onClearBinding }: AudioSettingsTabProps) {
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

  const handleCaptureApiChange = (value: 'waveIn' | 'wasapi') => {
    handleChange('captureApi', value);
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
          <Select
            value={localSettings.inputDevice}
            onChange={(v) => handleChange('inputDevice', v)}
            options={[{ value: 'default', label: 'Default' }]}
          />
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
          <Select
            value={localSettings.outputDevice}
            onChange={(v) => handleChange('outputDevice', v)}
            options={[{ value: 'default', label: 'Default' }]}
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
      </div>

      {/* Transmission Section */}
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Transmission</h3>
        <div className="settings-item">
          <label>Transmission Mode</label>
          <Select
            value={localSettings.transmissionMode}
            onChange={(v) => handleChange('transmissionMode', v as TransmissionMode)}
            options={[
              { value: 'pushToTalk', label: 'Push to Talk' },
              { value: 'voiceActivity', label: 'Voice Activity' },
              { value: 'continuous', label: 'Continuous' },
            ]}
          />
        </div>

        {localSettings.transmissionMode === 'pushToTalk' && (
          <>
            <div className="settings-item">
              <label>Push to Talk Key</label>
              <button
                className={`btn btn-secondary key-binding-btn ${recording ? 'recording' : ''}`}
                onClick={() => setRecording(!recording)}
              >
                {recording ? 'Press any key...' : (localSettings.pushToTalkKey || 'Not bound')}
              </button>
            </div>
            <div className="settings-item settings-slider">
              <label>
                Hold Time: {localSettings.voiceHoldMs}ms{localSettings.voiceHoldMs === 200 ? ' (default)' : ''}
                <span className="tooltip-icon" data-tooltip="How long to keep transmitting after you release Push to Talk. Higher values add a short silence tail to help avoid clipping words during brief pauses or at the end of speech.">?</span>
              </label>
              <input
                type="range"
                min="100"
                max="2000"
                step="10"
                value={localSettings.voiceHoldMs}
                onChange={(e) => handleChange('voiceHoldMs', parseInt(e.target.value, 10))}
              />
            </div>
          </>
        )}

        <div className="settings-item">
          <label>
            Noise Suppression
            <span className="tooltip-icon" data-tooltip="RNNoise: lightweight noise suppression that runs efficiently on the CPU. GTCRN: deep learning-based noise suppression for higher quality (requires more CPU).">?</span>
          </label>
          <Select
            value={speechDenoise.mode}
            onChange={(v) => onSpeechDenoiseChange({ ...speechDenoise, mode: v as SpeechDenoiseSettings['mode'] })}
            options={[
              { value: 'disabled', label: 'Disabled' },
              { value: 'rnnoise', label: 'RNNoise' },
              { value: 'gtcrn', label: 'GTCRN' },
            ]}
          />
        </div>
      </div>

      {/* Encoding Section */}
      {(() => {
        const BITRATES = [24000, 40000, 56000, 72000, 96000, 128000];
        const FRAME_SIZES = [10, 20, 40, 60];

        // Normalize saved values to the nearest allowed entry so that an invalid
        // stored value (e.g. from a hand-edited config or future UI bug) always
        // maps to a real option for both the slider position and the displayed label.
        const nearestOf = (value: number, allowed: number[]) =>
          allowed.reduce((best, v) =>
            Math.abs(v - value) < Math.abs(best - value) ? v : best
          );

        const normBitrate = nearestOf(localSettings.opusBitrate, BITRATES);
        const normFrameSize = nearestOf(localSettings.opusFrameSize, FRAME_SIZES);
        const bitrateIdx = BITRATES.indexOf(normBitrate);
        const frameSizeIdx = FRAME_SIZES.indexOf(normFrameSize);
        return (
          <div className="settings-section">
            <h3 className="heading-section settings-section-title">Encoding</h3>
            <div className="settings-item settings-slider">
              <label>
                Bitrate: {normBitrate / 1000} kbps{normBitrate === 72000 ? ' (default)' : ''}
                <span className="tooltip-icon" data-tooltip="How much data is used per second of voice. Higher = better quality but uses more bandwidth. Lower = smaller data usage, good for slow connections. 72 kbps is recommended for most users.">?</span>
              </label>
              <input
                type="range"
                min="0"
                max={BITRATES.length - 1}
                step="1"
                value={bitrateIdx}
                onChange={(e) => {
                  const idx = Math.min(parseInt(e.target.value, 10), BITRATES.length - 1);
                  handleChange('opusBitrate', BITRATES[idx]);
                }}
              />
            </div>
            <div className="settings-item settings-slider">
              <label>
                Audio per packet: {normFrameSize} ms{normFrameSize === 20 ? ' (default)' : ''}
                <span className="tooltip-icon" data-tooltip="How many milliseconds of audio are bundled into each network packet. Lower = your voice arrives faster (less delay). Higher = fewer packets sent, better for unstable connections. 20 ms is recommended for most users.">?</span>
              </label>
              <input
                type="range"
                min="0"
                max={FRAME_SIZES.length - 1}
                step="1"
                value={frameSizeIdx}
                onChange={(e) => {
                  const idx = Math.min(parseInt(e.target.value, 10), FRAME_SIZES.length - 1);
                  handleChange('opusFrameSize', FRAME_SIZES[idx]);
                }}
              />
            </div>
          </div>
        );
      })()}

      {/* Audio Capture API */}
      <div className="settings-section">
        <div className="settings-section-header">
          <span className="settings-dev-label">DEV</span>
          <span className="settings-section-title">Audio Capture API</span>
        </div>
        <div className="toggle-group">
          <button
            type="button"
            className={`toggle-btn ${localSettings.captureApi === 'waveIn' ? 'active' : ''}`}
            onClick={() => handleCaptureApiChange('waveIn')}
          >
            WaveIn (Legacy)
          </button>
          <button
            type="button"
            className={`toggle-btn ${localSettings.captureApi === 'wasapi' ? 'active' : ''}`}
            onClick={() => handleCaptureApiChange('wasapi')}
          >
            WASAPI
          </button>
        </div>
      </div>

    </div>
  );
}
