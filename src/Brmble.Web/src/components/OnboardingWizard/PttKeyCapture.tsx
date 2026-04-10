import { useState, useEffect, useCallback } from 'react';
import bridge from '../../bridge';

interface PttKeyCaptureProps {
  value: string | null;
  onChange: (key: string | null) => void;
}

export function PttKeyCapture({ value, onChange }: PttKeyCaptureProps) {
  const [recording, setRecording] = useState(false);

  const handleInput = useCallback((key: string) => {
    onChange(key);
    setRecording(false);
  }, [onChange]);

  useEffect(() => {
    if (!recording) return;

    bridge.send('voice.suspendHotkeys');

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      handleInput(e.code);
    };
    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      const map: Record<number, string> = {
        0: 'MouseLeft', 1: 'MouseMiddle', 2: 'MouseRight',
        3: 'XButton1', 4: 'XButton2',
      };
      const key = map[e.button];
      if (key) handleInput(key);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onMouseDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onMouseDown);
      bridge.send('voice.resumeHotkeys');
    };
  }, [recording, handleInput]);

  return (
    <button
      type="button"
      className={`btn btn-secondary key-binding-btn${recording ? ' recording' : ''}`}
      onClick={() => setRecording(r => !r)}
    >
      {recording ? 'Press any key…' : (value ?? 'Not bound')}
    </button>
  );
}
