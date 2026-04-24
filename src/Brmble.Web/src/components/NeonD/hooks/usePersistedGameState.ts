import { useState, useEffect, useRef, useCallback } from 'react';
import { useInterval } from './useInterval';

function isObject(item: unknown): item is Record<string, unknown> {
  return (item !== null && typeof item === 'object' && !Array.isArray(item));
}

function deepMerge<T extends Record<string, unknown>>(target: T, source: T): T {
  const output = { ...target };
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          output[key] = source[key] as T[Extract<keyof T, string>];
        } else {
          output[key] = deepMerge(target[key] as T[Extract<keyof T, string>], source[key] as T[Extract<keyof T, string>]);
        }
      } else {
        output[key] = source[key] as T[Extract<keyof T, string>];
      }
    });
  }
  return output;
}

export function usePersistedGameState<T extends Record<string, unknown>>(
  key: string,
  initialState: T | (() => T)
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {

  const [state, setReactState] = useState<T>(() => {
    const initial = typeof initialState === 'function' ? (initialState as () => T)() : initialState;
    try {
      const item = localStorage.getItem(key);
      if (item) {
        const parsed = JSON.parse(item);
        return deepMerge(initial, parsed);
      }
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
    }
    return initial;
  });

  const stateRef = useRef(state);

  const setState: React.Dispatch<React.SetStateAction<T>> = useCallback((value) => {
    setReactState((prev) => {
      const nextState = typeof value === 'function' ? (value as (prev: T) => T)(prev) : value;
      stateRef.current = nextState;
      return nextState;
    });
  }, []);

  const saveToStorage = useCallback(() => {
    try {
      localStorage.setItem(key, JSON.stringify(stateRef.current));
    } catch (error) {
      console.warn(`Error saving to localStorage key "${key}":`, error);
    }
  }, [key]);

  const clearStorage = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn(`Error clearing localStorage key "${key}":`, error);
    }
  }, [key]);

  useInterval(saveToStorage, 30000);

  useEffect(() => {
    window.addEventListener('beforeunload', saveToStorage);
    return () => window.removeEventListener('beforeunload', saveToStorage);
  }, [saveToStorage]);

  return [state, setState, clearStorage];
}