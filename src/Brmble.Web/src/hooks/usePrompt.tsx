import React, { useState, useEffect, useCallback, useMemo } from 'react';
import '../components/Prompt/Prompt.css';

export interface PromptOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface UsePromptReturn {
  Prompt: () => React.ReactElement | null;
}

let globalResolve: ((value: boolean) => void) | null = null;
let globalOptions: PromptOptions = { title: '', message: '' };
// Set by the one component that owns <Prompt /> (App.tsx).
let globalForceUpdate: (() => void) | null = null;

/**
 * Show a confirmation dialog. Safe to call from any component.
 * Requires that <Prompt /> (from usePrompt()) is mounted in the tree.
 */
export function confirm(options: PromptOptions): Promise<boolean> {
  globalOptions = options;
  return new Promise((resolve) => {
    globalResolve = resolve;
    globalForceUpdate?.();
  });
}

/**
 * Use in the single root component (App.tsx) that renders <Prompt />.
 * Only call this once in the tree.
 */
export function usePrompt(): UsePromptReturn {
  const [, setTick] = useState(0);

  // Register as the global force-update target.
  useEffect(() => {
    globalForceUpdate = () => setTick(t => t + 1);
    return () => {
      globalForceUpdate = null;
    };
  }, []);

  const handleConfirm = useCallback(() => {
    if (globalResolve) {
      globalResolve(true);
      globalResolve = null;
      globalForceUpdate?.();
    }
  }, []);

  const handleCancel = useCallback(() => {
    if (globalResolve) {
      globalResolve(false);
      globalResolve = null;
      globalForceUpdate?.();
    }
  }, []);

  const Prompt = useMemo(() => {
    return function PromptComponent() {
      const isOpen = globalResolve !== null;

      useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            handleCancel();
          }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [isOpen]);

      if (!isOpen) return null;

      return (
        <div className="modal-overlay" onClick={handleCancel}>
          <div className="prompt glass-panel animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="heading-title modal-title">{globalOptions.title}</h2>
              <p className="modal-subtitle">{globalOptions.message}</p>
            </div>
            <div className="prompt-footer">
              <button
                className="btn btn-secondary"
                onClick={handleCancel}
                autoFocus
              >
                {globalOptions.cancelLabel || 'Cancel'}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleConfirm}
              >
                {globalOptions.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      );
    };
  }, [handleConfirm, handleCancel]);

  return { Prompt };
}
