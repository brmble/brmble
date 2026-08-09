import React, { useState, useEffect, useCallback } from 'react';
import { Icon } from '../components/Icon/Icon';
import '../components/Prompt/Prompt.css';

export interface PromptOptions {
  title: string;
  message: React.ReactNode;
  content?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface PromptWithInputOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  placeholder?: string;
  defaultValue?: string;
  isPassword?: boolean;
}

export interface PasswordPromptResult {
  password: string;
  remember: boolean;
}

export interface PasswordPromptOptions extends PromptWithInputOptions {
  rememberLabel?: string;
  rememberDefaultChecked?: boolean;
}

interface UsePromptReturn {
  Prompt: () => React.ReactElement | null;
  PromptWithInput: () => React.ReactElement | null;
}

let globalResolve: ((value: boolean) => void) | null = null;
let globalResolveInput: ((value: string | null) => void) | null = null;
let globalResolvePassword: ((value: PasswordPromptResult | null) => void) | null = null;
let globalOptions: PromptOptions = { title: '', message: '' };
let globalInputOptions: PromptWithInputOptions = { title: '', message: '', placeholder: '', defaultValue: '' };
let globalPasswordOptions: PasswordPromptOptions = { title: '', message: '' };
let globalForceUpdate: (() => void) | null = null;
let globalInputPromptVersion = 0;

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
  if (globalResolvePassword) {
    globalResolvePassword(null);
    globalResolvePassword = null;
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
  if (globalResolvePassword) {
    globalResolvePassword(null);
    globalResolvePassword = null;
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
  if (globalResolvePassword) {
    globalResolvePassword(null);
    globalResolvePassword = null;
  }
  globalInputOptions = options;
  globalInputPromptVersion += 1;
  return new Promise((resolve) => {
    globalResolveInput = resolve;
    globalForceUpdate?.();
  });
}

export function promptPassword(options: PasswordPromptOptions): Promise<PasswordPromptResult | null> {
  if (globalResolve) {
    globalResolve(false);
    globalResolve = null;
  }
  if (globalResolveInput) {
    globalResolveInput(null);
    globalResolveInput = null;
  }
  if (globalResolvePassword) {
    globalResolvePassword(null);
    globalResolvePassword = null;
  }
  globalPasswordOptions = options;
  globalInputPromptVersion += 1;
  return new Promise((resolve) => {
    globalResolvePassword = resolve;
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
          <div className="modal-subtitle">{globalOptions.message}</div>
        </div>
        {globalOptions.content && (
          <div className="prompt-content">{globalOptions.content}</div>
        )}
        <div className="prompt-footer">
          <button
            className="btn btn-secondary"
            onClick={handleCancel}
            autoFocus
          >
            {globalOptions.cancelLabel || 'Cancel'}
          </button>
          <button
            className={`btn ${globalOptions.destructive ? 'btn-danger' : 'btn-primary'}`}
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
  const isPasswordPromptOpen = globalResolvePassword !== null;
  const isOpen = globalResolveInput !== null || isPasswordPromptOpen;
  const promptVersion = globalInputPromptVersion;
  const [inputValue, setInputValue] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberChecked, setRememberChecked] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [toggleFocused, setToggleFocused] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const activeOptions = isPasswordPromptOpen ? globalPasswordOptions : globalInputOptions;
      setInputValue(activeOptions.defaultValue || '');
      setShowPassword(false);
      setRememberChecked(isPasswordPromptOpen && globalPasswordOptions.rememberDefaultChecked === true);
      setInputFocused(false);
      setToggleFocused(false);
    }
  }, [isOpen, isPasswordPromptOpen, promptVersion]);

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
    if (globalResolvePassword) {
      globalResolvePassword({ password: inputValue, remember: rememberChecked });
      globalResolvePassword = null;
      setInputValue('');
      setShowPassword(false);
      setRememberChecked(false);
      setInputFocused(false);
      setToggleFocused(false);
      globalForceUpdate?.();
    } else if (globalResolveInput) {
      globalResolveInput(inputValue);
      globalResolveInput = null;
      setInputValue('');
      setShowPassword(false);
      setRememberChecked(false);
      setInputFocused(false);
      setToggleFocused(false);
      globalForceUpdate?.();
    }
  }, [inputValue, rememberChecked]);

  if (!isOpen) return null;

  const inputOptions = isPasswordPromptOpen ? globalPasswordOptions : globalInputOptions;

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
          <h2 id="prompt-title" className="heading-title modal-title">{inputOptions.title}</h2>
          <p className="modal-subtitle">{inputOptions.message}</p>
        </div>
        <div className="prompt-input-container">
          <input
            type={inputOptions.isPassword && !showPassword ? 'password' : 'text'}
            className="brmble-input"
            placeholder={inputOptions.placeholder}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => {
              setInputFocused(false);
              // Hide the password again when focus leaves the field, unless
              // it moved to the toggle button.
              if (!toggleFocused) setShowPassword(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSubmit();
              }
            }}
            autoFocus
          />
          {/* Reveal toggle only appears while the field or toggle is focused,
              and hides the password again on blur. */}
          {inputOptions.isPassword && (inputFocused || toggleFocused) && (
            <button
              type="button"
              className="password-toggle-btn"
              onMouseDown={(e) => { e.preventDefault(); setShowPassword(value => !value); }}
              onFocus={() => setToggleFocused(true)}
              onBlur={() => { setToggleFocused(false); setShowPassword(false); }}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
            >
              {showPassword ? <Icon name="eye-off" size={18} /> : <Icon name="eye" size={18} />}
            </button>
          )}
        </div>
        {isPasswordPromptOpen && globalPasswordOptions.rememberLabel && (
          <label className="prompt-checkbox-row">
            <input
              type="checkbox"
              checked={rememberChecked}
              onChange={(e) => setRememberChecked(e.target.checked)}
            />
            <span>{globalPasswordOptions.rememberLabel}</span>
          </label>
        )}
        <div className="prompt-footer">
          <button
            className="btn btn-secondary"
            onClick={handleCancel}
          >
            {inputOptions.cancelLabel || 'Cancel'}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
          >
            {inputOptions.confirmLabel || 'Confirm'}
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
