import { useState } from 'react';
import './CloseDialog.css';

interface CloseDialogProps {
  isOpen: boolean;
  onMinimize: (dontAskAgain: boolean) => void;
  onQuit: (dontAskAgain: boolean) => void;
}

export function CloseDialog({ isOpen, onMinimize, onQuit }: CloseDialogProps) {
  const [dontAskAgain, setDontAskAgain] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="close-dialog-overlay">
      <div className="close-dialog-card">
        <h2 className="close-dialog-title">Leaving so soon?</h2>
        <p className="close-dialog-subtitle">Choose what happens when you close the window.</p>

        <div className="close-dialog-buttons">
          <button
            className="close-dialog-btn minimize"
            onClick={() => onMinimize(dontAskAgain)}
          >
            Minimize to tray
          </button>
          <button
            className="close-dialog-btn quit"
            onClick={() => onQuit(dontAskAgain)}
          >
            Quit
          </button>
        </div>

        <label className="close-dialog-checkbox-row">
          <input
            type="checkbox"
            checked={dontAskAgain}
            onChange={e => setDontAskAgain(e.target.checked)}
          />
          <span className="close-dialog-checkbox-label">Don't ask again</span>
        </label>
      </div>
    </div>
  );
}
