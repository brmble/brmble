import { useState, useEffect, useCallback, useRef } from 'react';
import bridge from '../../bridge';
import { type AllBindings, BINDING_LABELS } from './SettingsModal';
import { confirm } from '../../hooks/usePrompt';
import './ShortcutsSettingsTab.css';

interface ShortcutsSettingsTabProps {
  settings: ShortcutsSettings;
  onChange: (settings: ShortcutsSettings) => void;
  allBindings: AllBindings;
  onClearBinding: (bindingId: string) => void;
}

export interface ShortcutsSettings {
  toggleMuteKey: string | null;
  toggleMuteDeafenKey: string | null;
  toggleLeaveVoiceKey: string | null;
  toggleDMScreenKey: string | null;
  toggleScreenShareKey: string | null;
  toggleGameKey: string | null;
}

export const DEFAULT_SHORTCUTS: ShortcutsSettings = {
  toggleMuteKey: null,
  toggleMuteDeafenKey: null,
  toggleLeaveVoiceKey: null,
  toggleDMScreenKey: null,
  toggleScreenShareKey: null,
  toggleGameKey: null,
};

export function ShortcutsSettingsTab({ settings, onChange, allBindings, onClearBinding }: ShortcutsSettingsTabProps) {
  const [recordingKey, setRecordingKey] = useState<keyof ShortcutsSettings | null>(null);
  const [localSettings, setLocalSettings] = useState<ShortcutsSettings>(settings);
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const capturedInputRef = useRef<string | null>(null);
  const hotkeysSuspendedRef = useRef(false);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const clearBinding = (bindingId: keyof ShortcutsSettings) => {
    setLocalSettings((prev) => ({ ...prev, [bindingId]: null }));
    onClearBinding(bindingId);
  };

  const keyButtonClass = (bindingId: keyof ShortcutsSettings) => (
    `btn ${localSettings[bindingId] && recordingKey !== bindingId ? 'btn-primary' : 'btn-secondary'} key-binding-btn ${recordingKey === bindingId ? 'recording' : ''}`
  );

  const handleInput = useCallback(async (key: string) => {
    if (!recordingKey) return;

    // Check for conflicts across ALL bindings (including other tabs like Audio)
    const conflictEntry = Object.entries(allBindings).find(
      ([id, v]) => id !== recordingKey && v === key
    );

    if (conflictEntry) {
      const [conflictBindingId] = conflictEntry;
      setIsPromptOpen(true);
      const confirmed = await confirm({
        title: 'Key already in use',
        message: `This key is already bound to "${BINDING_LABELS[conflictBindingId] || conflictBindingId}". Rebind it?`,
        confirmLabel: 'Rebind',
        cancelLabel: 'Cancel'
      });
      setIsPromptOpen(false);
      
      if (!confirmed) {
        capturedInputRef.current = null;
        setRecordingKey(null);
        return;
      }
      
      // Clear conflicting binding (delegates to parent for bridge messages + persistence)
      onClearBinding(conflictBindingId);

      // Also clear it in localSettings so onChange doesn't re-introduce the stale value
      setLocalSettings((prev) => {
        const newSettings = {
          ...prev,
          [conflictBindingId]: null,
          [recordingKey]: key,
        } as ShortcutsSettings;
        onChange(newSettings);
        return newSettings;
      });
      capturedInputRef.current = null;
      setRecordingKey(null);
      return;
    }
    
    // Apply new binding
    setLocalSettings((prev) => {
      const newSettings = { ...prev, [recordingKey]: key };
      onChange(newSettings);
      return newSettings;
    });
    capturedInputRef.current = key;
  }, [recordingKey, allBindings, onChange, onClearBinding]);

  useEffect(() => {
    if (recordingKey && !isPromptOpen) {
      // Temporarily unregister Win32 hotkeys so key events reach JS
      if (!hotkeysSuspendedRef.current) {
        bridge.send('voice.suspendHotkeys');
        hotkeysSuspendedRef.current = true;
      }

      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (capturedInputRef.current) return;
        handleInput(e.code);
      };
      const onMouse = (e: MouseEvent) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (capturedInputRef.current) return;
        const target = e.target as HTMLElement;
        if (target.closest('button, a, input, select, label, .settings-modal, .prompt')) {
          setRecordingKey(null);
          return;
        }
        const mouseButtonMap: Record<number, string> = {
          0: 'MouseLeft', 1: 'MouseMiddle', 2: 'MouseRight',
          3: 'XButton1', 4: 'XButton2',
        };
        const key = mouseButtonMap[e.button];
        if (key) handleInput(key);
      };
      const finishRecording = () => {
        if (!capturedInputRef.current) return;
        capturedInputRef.current = null;
        setRecordingKey(null);
      };
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('mousedown', onMouse, true);
      window.addEventListener('keyup', finishRecording, true);
      window.addEventListener('mouseup', finishRecording, true);
      return () => {
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('mousedown', onMouse, true);
        window.removeEventListener('keyup', finishRecording, true);
        window.removeEventListener('mouseup', finishRecording, true);
        if (hotkeysSuspendedRef.current) {
          bridge.send('voice.resumeHotkeys');
          hotkeysSuspendedRef.current = false;
        }
        capturedInputRef.current = null;
      };
    }
  }, [recordingKey, isPromptOpen, handleInput]);

  return (
    <div className="shortcuts-settings-tab">
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Voice</h3>
        <div className="settings-item">
          <label>Toggle Leave Voice</label>
          <div className="key-binding-actions">
            {localSettings.toggleLeaveVoiceKey && <button className="btn btn-secondary key-binding-clear-btn" aria-label="Clear Toggle Leave Voice binding" onClick={() => clearBinding('toggleLeaveVoiceKey')}>Clear</button>}
            <button
              className={keyButtonClass('toggleLeaveVoiceKey')}
              onClick={() => setRecordingKey(recordingKey === 'toggleLeaveVoiceKey' ? null : 'toggleLeaveVoiceKey')}
            >
              {recordingKey === 'toggleLeaveVoiceKey' ? 'Press any key...' : (localSettings.toggleLeaveVoiceKey || 'Not bound')}
            </button>
          </div>
        </div>

        <div className="settings-item">
          <label>Toggle Mute & Deafen</label>
          <div className="key-binding-actions">
            {localSettings.toggleMuteDeafenKey && <button className="btn btn-secondary key-binding-clear-btn" aria-label="Clear Toggle Mute & Deafen binding" onClick={() => clearBinding('toggleMuteDeafenKey')}>Clear</button>}
            <button
              className={keyButtonClass('toggleMuteDeafenKey')}
              onClick={() => setRecordingKey(recordingKey === 'toggleMuteDeafenKey' ? null : 'toggleMuteDeafenKey')}
            >
              {recordingKey === 'toggleMuteDeafenKey' ? 'Press any key...' : (localSettings.toggleMuteDeafenKey || 'Not bound')}
            </button>
          </div>
        </div>

        <div className="settings-item">
          <label>Toggle Mute</label>
          <div className="key-binding-actions">
            {localSettings.toggleMuteKey && <button className="btn btn-secondary key-binding-clear-btn" aria-label="Clear Toggle Mute binding" onClick={() => clearBinding('toggleMuteKey')}>Clear</button>}
            <button
              className={keyButtonClass('toggleMuteKey')}
              onClick={() => setRecordingKey(recordingKey === 'toggleMuteKey' ? null : 'toggleMuteKey')}
            >
              {recordingKey === 'toggleMuteKey' ? 'Press any key...' : (localSettings.toggleMuteKey || 'Not bound')}
            </button>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Navigation</h3>
        <div className="settings-item">
          <label>Toggle Direct Messages Screen</label>
          <div className="key-binding-actions">
            {localSettings.toggleDMScreenKey && <button className="btn btn-secondary key-binding-clear-btn" aria-label="Clear Toggle Direct Messages Screen binding" onClick={() => clearBinding('toggleDMScreenKey')}>Clear</button>}
            <button
              className={keyButtonClass('toggleDMScreenKey')}
              onClick={() => setRecordingKey(recordingKey === 'toggleDMScreenKey' ? null : 'toggleDMScreenKey')}
            >
              {recordingKey === 'toggleDMScreenKey' ? 'Press any key...' : (localSettings.toggleDMScreenKey || 'Not bound')}
            </button>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Screen Sharing</h3>
        <div className="settings-item">
          <label>Toggle Screen Share</label>
          <div className="key-binding-actions">
            {localSettings.toggleScreenShareKey && <button className="btn btn-secondary key-binding-clear-btn" aria-label="Clear Toggle Screen Share binding" onClick={() => clearBinding('toggleScreenShareKey')}>Clear</button>}
            <button
              className={keyButtonClass('toggleScreenShareKey')}
              onClick={() => setRecordingKey(recordingKey === 'toggleScreenShareKey' ? null : 'toggleScreenShareKey')}
            >
              {recordingKey === 'toggleScreenShareKey' ? 'Press any key...' : (localSettings.toggleScreenShareKey || 'Not bound')}
            </button>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Game</h3>
        <div className="settings-item">
          <label>Toggle Game Panel</label>
          <div className="key-binding-actions">
            {localSettings.toggleGameKey && <button className="btn btn-secondary key-binding-clear-btn" aria-label="Clear Toggle Game Panel binding" onClick={() => clearBinding('toggleGameKey')}>Clear</button>}
            <button
              className={keyButtonClass('toggleGameKey')}
              onClick={() => setRecordingKey(recordingKey === 'toggleGameKey' ? null : 'toggleGameKey')}
            >
              {recordingKey === 'toggleGameKey' ? 'Press any key...' : (localSettings.toggleGameKey || 'Not bound')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
