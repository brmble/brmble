import { useState, useEffect, useCallback } from 'react';
import bridge from '../../bridge';
import { type AllBindings, BINDING_LABELS } from './SettingsModal';
import { confirm } from '../../hooks/usePrompt';
import { Select } from '../Select';
import { VadLevelMeter } from '../VadLevelMeter/VadLevelMeter';
import './AudioSettingsTab.css';
import './ShortcutsSettingsTab.css';

export type NoiseSuppressionLevel = 'Off' | 'Low' | 'Moderate' | 'High' | 'VeryHigh';

interface AudioSettingsTabProps {
  settings: AudioSettings;
  noiseSuppression: NoiseSuppressionSettings;
  onChange: (settings: AudioSettings) => void;
  onNoiseSuppressionChange: (settings: NoiseSuppressionSettings) => void;
  allBindings: AllBindings;
  onClearBinding: (bindingId: string) => void;
}

export type TransmissionMode = 'pushToTalk' | 'voiceActivity' | 'continuous' | 'pushToTalkPlus';

export type VadSensitivity = 'low' | 'balanced' | 'high';

export interface AudioSettings {
  inputDevice: string;
  outputDevice: string;
  inputVolume: number;
  outputVolume: number;
  transmissionMode: TransmissionMode;
  pushToTalkKey: string | null;
  opusBitrate: number;
  opusFrameSize: number;
  voiceHoldMs: number;
  captureApi: 'waveIn' | 'wasapi';
  vadSensitivity: VadSensitivity;
}

export interface NoiseSuppressionSettings {
  level: NoiseSuppressionLevel;
}

type AudioDeviceOption = { id: string; name: string };

type AudioDevicesPayload = {
  input?: AudioDeviceOption[];
  output?: AudioDeviceOption[];
};

const DEFAULT_DEVICE_OPTION: AudioDeviceOption = { id: 'default', name: 'Default (System)' };

export const DEFAULT_SETTINGS: AudioSettings = {
  inputDevice: 'default',
  outputDevice: 'default',
  inputVolume: 250,
  outputVolume: 250,
  transmissionMode: 'pushToTalk',
  pushToTalkKey: null,
  opusBitrate: 72000,
  opusFrameSize: 20,
  voiceHoldMs: 200,
  captureApi: 'wasapi',
  vadSensitivity: 'balanced',
};

export const DEFAULT_NOISE_SUPPRESSION: NoiseSuppressionSettings = {
  level: 'High',
};

export function AudioSettingsTab({ settings, noiseSuppression, onChange, onNoiseSuppressionChange, allBindings, onClearBinding }: AudioSettingsTabProps) {
  const [localSettings, setLocalSettings] = useState<AudioSettings>(settings);
  const [recording, setRecording] = useState(false);
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [inputDevices, setInputDevices] = useState<AudioDeviceOption[]>([DEFAULT_DEVICE_OPTION]);
  const [outputDevices, setOutputDevices] = useState<AudioDeviceOption[]>([DEFAULT_DEVICE_OPTION]);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    const fallback = [DEFAULT_DEVICE_OPTION];
    const onAudioDevices = (data: unknown) => {
      const payload = data as AudioDevicesPayload | undefined;
      setInputDevices(payload?.input?.length ? payload.input : fallback);
      setOutputDevices(payload?.output?.length ? payload.output : fallback);
    };

    bridge.on('voice.audioDevices', onAudioDevices);
    bridge.send('voice.getAudioDevices');

    return () => {
      bridge.off('voice.audioDevices', onAudioDevices);
    };
  }, []);

  const handleChange = (key: keyof AudioSettings, value: string | number | TransmissionMode) => {
    const newSettings = { ...localSettings, [key]: value };
    setLocalSettings(newSettings);
    onChange(newSettings);
  };

  const handleCaptureApiChange = (value: 'waveIn' | 'wasapi') => {
    const nextSettings: AudioSettings = {
      ...localSettings,
      captureApi: value,
      inputDevice: value === 'waveIn' ? 'default' : localSettings.inputDevice,
    };
    setLocalSettings(nextSettings);
    onChange(nextSettings);
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
            options={(localSettings.captureApi === 'waveIn' ? [DEFAULT_DEVICE_OPTION] : inputDevices).map((device) => ({ value: device.id, label: device.name }))}
            disabled={localSettings.captureApi === 'waveIn'}
          />
        </div>
        {localSettings.captureApi === 'waveIn' && (
          <p className="settings-hint">
            WaveIn uses the system default microphone only. Switch to WASAPI to choose a specific input device.
          </p>
        )}

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

      </div>

      {/* Output Section */}
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Output</h3>
        <div className="settings-item">
          <label>Output Device</label>
          <Select
            value={localSettings.outputDevice}
            onChange={(v) => handleChange('outputDevice', v)}
            options={outputDevices.map((device) => ({ value: device.id, label: device.name }))}
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
              { value: 'pushToTalkPlus', label: 'PTT+' },
              { value: 'pushToTalk', label: 'Push to Talk' },
              { value: 'voiceActivity', label: 'Voice Activity' },
              { value: 'continuous', label: 'Continuous' },
            ]}
          />
        </div>

        {(localSettings.transmissionMode === 'pushToTalk' || localSettings.transmissionMode === 'pushToTalkPlus') && (
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

        {localSettings.transmissionMode === 'voiceActivity' && (
          <>
            <div className="settings-item">
              <label>
                Sensitivity
                <span className="tooltip-icon" data-tooltip="How strictly background noise is rejected. Higher rejects more noise but needs clearer speech to trigger; lower picks up softer voices.">?</span>
              </label>
              <Select
                value={localSettings.vadSensitivity}
                onChange={(v) => handleChange('vadSensitivity', v as VadSensitivity)}
                options={[
                  { value: 'low',      label: 'Low' },
                  { value: 'balanced', label: 'Balanced (recommended)' },
                  { value: 'high',     label: 'High' },
                ]}
              />
            </div>
            <div className="settings-item">
              <label>Mic level</label>
              <VadLevelMeter />
            </div>
          </>
        )}

        <div className="settings-item">
          <label>
            Noise Suppression
            <span className="tooltip-icon" data-tooltip="How aggressively to suppress background noise. Higher levels remove more noise but can muffle speech. AGC and high-pass filter run regardless of this setting.">?</span>
          </label>
          <Select
            value={noiseSuppression.level}
            onChange={(v) => onNoiseSuppressionChange({ level: v as NoiseSuppressionLevel })}
            options={[
              { value: 'Off', label: 'Off' },
              { value: 'Low', label: 'Low' },
              { value: 'Moderate', label: 'Moderate' },
              { value: 'High', label: 'High (default)' },
              { value: 'VeryHigh', label: 'Very High' },
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
