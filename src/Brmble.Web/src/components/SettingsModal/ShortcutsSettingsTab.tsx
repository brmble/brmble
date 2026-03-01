import { useState, useEffect, useCallback } from 'react';
import bridge from '../../bridge';
import { type AllBindings, BINDING_LABELS } from './SettingsModal';
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
}

export const DEFAULT_SHORTCUTS: ShortcutsSettings = {
  toggleMuteKey: null,
  toggleMuteDeafenKey: null,
  toggleLeaveVoiceKey: null,
  toggleDMScreenKey: null,
};

interface ConflictState {
  key: string;
  /** The binding ID that already owns this key (may be in another tab) */
  conflictBindingId: string;
  /** The binding ID we're trying to set */
  targetKey: keyof ShortcutsSettings;
}

export function ShortcutsSettingsTab({ settings, onChange, allBindings, onClearBinding }: ShortcutsSettingsTabProps) {
  const [recordingKey, setRecordingKey] = useState<keyof ShortcutsSettings | null>(null);
  const [localSettings, setLocalSettings] = useState<ShortcutsSettings>(settings);
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleInput = useCallback((key: string) => {
    if (!recordingKey) return;

    // Check for conflicts across ALL bindings (including other tabs like Audio)
    const conflictEntry = Object.entries(allBindings).find(
      ([id, v]) => id !== recordingKey && v === key
    );

    if (conflictEntry) {
      const [conflictBindingId] = conflictEntry;
      setConflict({ key, conflictBindingId, targetKey: recordingKey });
    } else {
      setLocalSettings((prev) => {
        const newSettings = { ...prev, [recordingKey]: key };
        onChange(newSettings);
        return newSettings;
      });
      setRecordingKey(null);
    }
  }, [recordingKey, allBindings, onChange]);

  const handleConflictConfirm = useCallback(() => {
    if (!conflict) return;
    const isLocalConflict = conflict.conflictBindingId in localSettings;
    if (isLocalConflict) {
      // Conflict is within this tab — unbind old, bind new
      setLocalSettings((prev) => {
        const newSettings = { ...prev, [conflict.conflictBindingId]: null, [conflict.targetKey]: conflict.key };
        onChange(newSettings);
        return newSettings;
      });
    } else {
      // Conflict is in another tab — delegate to parent to clear the binding
      // (handles bridge messages, settings persistence, etc.)
      onClearBinding(conflict.conflictBindingId);
      setLocalSettings((prev) => {
        const newSettings = { ...prev, [conflict.targetKey]: conflict.key };
        onChange(newSettings);
        return newSettings;
      });
    }
    setConflict(null);
    setRecordingKey(null);
  }, [conflict, localSettings, onChange, onClearBinding]);

  const handleConflictCancel = useCallback(() => {
    setConflict(null);
    setRecordingKey(null);
  }, []);

  useEffect(() => {
    // Only listen when recording AND not showing the conflict dialog
    if (recordingKey && !conflict) {
      // Temporarily unregister Win32 hotkeys so key events reach JS
      bridge.send('voice.suspendHotkeys');

      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        handleInput(e.code);
      };
      const onMouse = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('button, a, input, select, label, .settings-modal')) {
          setRecordingKey(null);
          return;
        }
        e.preventDefault();
        const mouseButtonMap: Record<number, string> = {
          0: 'MouseLeft', 1: 'MouseMiddle', 2: 'MouseRight',
          3: 'XButton1', 4: 'XButton2',
        };
        const key = mouseButtonMap[e.button];
        if (key) handleInput(key);
      };
      window.addEventListener('keydown', onKey);
      window.addEventListener('mousedown', onMouse);
      return () => {
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('mousedown', onMouse);
        // Re-register Win32 hotkeys
        bridge.send('voice.resumeHotkeys');
      };
    }
  }, [recordingKey, conflict, handleInput]);

  return (
    <div className="shortcuts-settings-tab">
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Voice</h3>
        <div className="settings-item">
          <label>Toggle Leave Voice</label>
          <button
            className={`btn btn-secondary key-binding-btn ${recordingKey === 'toggleLeaveVoiceKey' ? 'recording' : ''}`}
            onClick={() => setRecordingKey(recordingKey === 'toggleLeaveVoiceKey' ? null : 'toggleLeaveVoiceKey')}
          >
            {recordingKey === 'toggleLeaveVoiceKey' ? 'Press any key...' : (localSettings.toggleLeaveVoiceKey || 'Not bound')}
          </button>
        </div>

        <div className="settings-item">
          <label>Toggle Mute & Deafen</label>
          <button
            className={`btn btn-secondary key-binding-btn ${recordingKey === 'toggleMuteDeafenKey' ? 'recording' : ''}`}
            onClick={() => setRecordingKey(recordingKey === 'toggleMuteDeafenKey' ? null : 'toggleMuteDeafenKey')}
          >
            {recordingKey === 'toggleMuteDeafenKey' ? 'Press any key...' : (localSettings.toggleMuteDeafenKey || 'Not bound')}
          </button>
        </div>

        <div className="settings-item">
          <label>Toggle Mute</label>
          <button
            className={`btn btn-secondary key-binding-btn ${recordingKey === 'toggleMuteKey' ? 'recording' : ''}`}
            onClick={() => setRecordingKey(recordingKey === 'toggleMuteKey' ? null : 'toggleMuteKey')}
          >
            {recordingKey === 'toggleMuteKey' ? 'Press any key...' : (localSettings.toggleMuteKey || 'Not bound')}
          </button>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Navigation</h3>
        <div className="settings-item">
          <label>Toggle Direct Messages Screen</label>
          <button
            className={`btn btn-secondary key-binding-btn ${recordingKey === 'toggleDMScreenKey' ? 'recording' : ''}`}
            onClick={() => setRecordingKey(recordingKey === 'toggleDMScreenKey' ? null : 'toggleDMScreenKey')}
          >
            {recordingKey === 'toggleDMScreenKey' ? 'Press any key...' : (localSettings.toggleDMScreenKey || 'Not bound')}
          </button>
        </div>
      </div>

      {conflict && (
        <div className="shortcut-conflict-overlay">
          <div className="shortcut-conflict-card" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
            <h3 id="conflict-title" className="heading-title shortcut-conflict-title">Key already in use</h3>
            <p className="shortcut-conflict-message">
              This key is already bound to <strong>{BINDING_LABELS[conflict.conflictBindingId] ?? conflict.conflictBindingId}</strong>.
              Rebind it to <strong>{BINDING_LABELS[conflict.targetKey] ?? conflict.targetKey}</strong>?
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
      
      <p className="settings-hint">
        Click a button and press a key to set a shortcut.
      </p>
    </div>
  );
}
