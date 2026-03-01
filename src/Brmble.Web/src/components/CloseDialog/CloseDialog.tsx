import { useState, useEffect } from 'react';
import './CloseDialog.css';

interface CloseDialogProps {
  isOpen: boolean;
  onMinimize: (dontAskAgain: boolean) => void;
  onQuit: (dontAskAgain: boolean) => void;
}

export function CloseDialog({ isOpen, onMinimize, onQuit }: CloseDialogProps) {
  const [dontAskAgain, setDontAskAgain] = useState(false);

  // Fix 4: Escape key handler — treat Escape as safe "Minimize" action
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onMinimize(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onMinimize]);

  // Focus trap
  useEffect(() => {
    if (!isOpen) return;
    const card = document.querySelector<HTMLElement>('.close-dialog-card');
    if (!card) return;
    const focusable = card.querySelectorAll<HTMLElement>(
      'button, input[type="checkbox"], [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    const handleTrap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleTrap);
    return () => window.removeEventListener('keydown', handleTrap);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="close-dialog-overlay">
      {/* Fix 2: ARIA dialog semantics */}
      <div
        className="close-dialog-card glass-panel animate-slide-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-dialog-title"
      >
        {/* Fix 2: id on heading to satisfy aria-labelledby */}
        <h2 id="close-dialog-title" className="heading-title close-dialog-title">Leaving so soon?</h2>
        <p className="close-dialog-subtitle">Choose what happens when you close the window.</p>

        <div className="close-dialog-buttons">
          {/* Fix 3: autoFocus so keyboard lands inside the dialog */}
          <button
            className="btn btn-primary"
            onClick={() => onMinimize(dontAskAgain)}
            autoFocus
          >
            Minimize to tray
          </button>
          <button
            className="btn btn-danger"
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
