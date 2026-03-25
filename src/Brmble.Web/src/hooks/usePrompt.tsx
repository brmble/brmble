import React, { useState, useEffect, useCallback, useMemo } from 'react';
import '../components/Prompt/Prompt.css';

export interface PromptOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface PromptWithInputOptions extends PromptOptions {
  placeholder?: string;
  defaultValue?: string;
}

interface UsePromptReturn {
  Prompt: () => React.ReactElement | null;
  PromptWithInput: () => React.ReactElement | null;
}

let globalResolve: ((value: boolean) => void) | null = null;
let globalResolveInput: ((value: string | null) => void) | null = null;
let globalOptions: PromptOptions = { title: '', message: '' };
let globalInputOptions: PromptWithInputOptions = { title: '', message: '', placeholder: '', defaultValue: '' };
// Set by the one component that owns <Prompt /> (App.tsx).
let globalForceUpdate: (() => void) | null = null;

/**
 * Show a confirmation dialog. Safe to call from any component.
 * Requires that <Prompt /> (from usePrompt()) is mounted in the tree.
 */
export function confirm(options: PromptOptions): Promise<boolean> {
  if (globalResolve) {
    globalResolve(false);
    globalResolve = null;
  }
  if (globalResolveInput) {
    globalResolveInput(null);
    globalResolveInput = null;
  }
  globalOptions = options;
  return new Promise((resolve) => {
    globalResolve = resolve;
    globalForceUpdate?.();
  });
}

/**
 * Show a dialog with text input. Safe to call from any component.
 * Returns the entered text or null if cancelled.
 */
export function prompt(options: PromptWithInputOptions): Promise<string | null> {
  if (globalResolve) {
    globalResolve(false);
    globalResolve = null;
  }
  if (globalResolveInput) {
    globalResolveInput(null);
    globalResolveInput = null;
  }
  globalInputOptions = options;
  return new Promise((resolve) => {
    globalResolveInput = resolve;
    globalForceUpdate?.();
  });
}

/**
 * Use in the single root component (App.tsx) that renders <Prompt />.
 * Only call this once in the tree.
 */
export function usePrompt(): UsePromptReturn {
  const [, setTick] = useState(0);
  const [inputValue, setInputValue] = useState('');

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

  const handleInputSubmit = useCallback(() => {
    if (globalResolveInput) {
      globalResolveInput(inputValue || null);
      globalResolveInput = null;
      setInputValue('');
      globalForceUpdate?.();
    }
  }, [inputValue]);

  const handleCancel = useCallback(() => {
    if (globalResolve) {
      globalResolve(false);
      globalResolve = null;
      globalForceUpdate?.();
    }
    if (globalResolveInput) {
      globalResolveInput(null);
      globalResolveInput = null;
      setInputValue('');
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
      }, [isOpen, handleCancel]);

      if (!isOpen) return null;

      return (
        <div className="modal-overlay" onClick={handleCancel}>
          <div
            className="prompt glass-panel animate-slide-up"
            role="dialog"
            aria-modal="true"
            aria-labelledby="prompt-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="prompt-title" className="heading-title modal-title">{globalOptions.title}</h2>
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

  const PromptWithInput = useMemo(() => {
    return function PromptWithInputComponent() {
      const isOpen = globalResolveInput !== null;

      useEffect(() => {
        if (isOpen) {
          setInputValue(globalInputOptions.defaultValue || '');
        }
      }, [isOpen]);

      useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            handleCancel();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            handleInputSubmit();
          }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [isOpen, handleInputSubmit, handleCancel]);

      if (!isOpen) return null;

      return (
        <div className="modal-overlay" onClick={handleCancel}>
          <div
            className="prompt glass-panel animate-slide-up"
            role="dialog"
            aria-modal="true"
            aria-labelledby="prompt-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="prompt-title" className="heading-title modal-title">{globalInputOptions.title}</h2>
              <p className="modal-subtitle">{globalInputOptions.message}</p>
            </div>
            <div className="prompt-input-container">
              <input
                type="text"
                className="brmble-input"
                placeholder={globalInputOptions.placeholder}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                autoFocus
              />
            </div>
            <div className="prompt-footer">
              <button
                className="btn btn-secondary"
                onClick={handleCancel}
              >
                {globalInputOptions.cancelLabel || 'Cancel'}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleInputSubmit}
              >
                {globalInputOptions.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      );
    };
  }, [handleInputSubmit, handleCancel, inputValue]);

  return { Prompt, PromptWithInput };
}
