import React, { useState, useEffect, useCallback } from 'react';
import { Icon } from '../components/Icon/Icon';
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
  isPassword?: boolean;
}

interface UsePromptReturn {
  Prompt: () => React.ReactElement | null;
  PromptWithInput: () => React.ReactElement | null;
}

let globalResolve: ((value: boolean) => void) | null = null;
let globalResolveInput: ((value: string | null) => void) | null = null;
let globalOptions: PromptOptions = { title: '', message: '' };
let globalInputOptions: PromptWithInputOptions = { title: '', message: '', placeholder: '', defaultValue: '' };
let globalForceUpdate: (() => void) | null = null;

function handleConfirm() {
  if (globalResolve) {
    globalResolve(true);
    globalResolve = null;
    globalForceUpdate?.();
  }
}

function handleCancel() {
  if (globalResolve) {
    globalResolve(false);
    globalResolve = null;
    globalForceUpdate?.();
  }
  if (globalResolveInput) {
    globalResolveInput(null);
    globalResolveInput = null;
    globalForceUpdate?.();
  }
}

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

// Stable top-level component — identity never changes across renders,
// so React won't see a different hook count when useMemo deps change.
function PromptComponent() {
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
}

// Stable top-level component for input prompts.
function PromptWithInputComponent() {
  const isOpen = globalResolveInput !== null;
  const [inputValue, setInputValue] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setInputValue(globalInputOptions.defaultValue || '');
      setShowPassword(false);
    }
  }, [isOpen]);

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

  const handleSubmit = useCallback(() => {
    if (globalResolveInput) {
      globalResolveInput(inputValue);
      globalResolveInput = null;
      setInputValue('');
      globalForceUpdate?.();
    }
  }, [inputValue]);

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
        <div 
          className="prompt-input-container"
          onBlur={(e) => {
            // Reset password visibility when focus leaves the container
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setShowPassword(false);
            }
          }}
        >
          <input
            type={globalInputOptions.isPassword && !showPassword ? 'password' : 'text'}
            className="brmble-input"
            placeholder={globalInputOptions.placeholder}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSubmit();
              }
            }}
            autoFocus
          />
          {globalInputOptions.isPassword && (
            <button
              type="button"
              className="password-toggle-btn"
              onMouseDown={(e) => { e.preventDefault(); setShowPassword(value => !value); }}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
            >
              {showPassword ? <Icon name="eye-off" size={18} /> : <Icon name="eye" size={18} />}
            </button>
          )}
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
            onClick={handleSubmit}
          >
            {globalInputOptions.confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function usePrompt(): UsePromptReturn {
  const [, setTick] = useState(0);

  useEffect(() => {
    globalForceUpdate = () => setTick(t => t + 1);
    return () => {
      globalForceUpdate = null;
    };
  }, []);

  // Return the stable top-level components.
  // Their identity is constant (module-level functions), so React never
  // sees a hook-count mismatch when the parent re-renders.
  return { Prompt: PromptComponent, PromptWithInput: PromptWithInputComponent };
}
