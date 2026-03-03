import React, { useState, useCallback, useMemo } from 'react';

export interface PromptOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface UsePromptReturn {
  Prompt: () => React.ReactElement | null;
  confirm: (options: PromptOptions) => Promise<boolean>;
  isOpen: boolean;
}

let globalResolve: ((value: boolean) => void) | null = null;
let globalOptions: PromptOptions = { title: '', message: '' };
let forceUpdate: () => void = () => {};

export function usePrompt(): UsePromptReturn {
  const [, setTick] = useState(0);
  
  forceUpdate = useCallback(() => {
    setTick(t => t + 1);
  }, []);
  
  const confirm = useCallback(async (options: PromptOptions): Promise<boolean> => {
    globalOptions = options;
    forceUpdate();
    
    return new Promise((resolve) => {
      globalResolve = resolve;
    });
  }, []);
  
  const handleConfirm = useCallback(() => {
    if (globalResolve) {
      globalResolve(true);
      globalResolve = null;
      forceUpdate();
    }
  }, []);
  
  const handleCancel = useCallback(() => {
    if (globalResolve) {
      globalResolve(false);
      globalResolve = null;
      forceUpdate();
    }
  }, []);
  
  const Prompt = useMemo(() => {
    return function PromptComponent() {
      const isOpen = globalResolve !== null;
      
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
  
  return { Prompt, confirm, isOpen: globalResolve !== null };
}
