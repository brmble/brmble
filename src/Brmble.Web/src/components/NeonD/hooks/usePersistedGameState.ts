import { useState, useEffect, useRef, useCallback } from 'react';
import { useInterval } from './useInterval';

function isObject(item: unknown): item is Record<string, unknown> {
  return (item !== null && typeof item === 'object' && !Array.isArray(item));
}

const DANGEROUS_PROPERTIES = new Set(['__proto__', 'constructor', 'prototype']);

function mergeValue(target: unknown, source: unknown): unknown {
  if (Array.isArray(target) && Array.isArray(source)) {
    const maxLength = Math.max(target.length, source.length);
    return Array.from({ length: maxLength }, (_, i) => {
      const targetVal = target[i];
      const sourceVal = source[i];
      if (sourceVal === undefined) return targetVal;
      if (targetVal === undefined) return sourceVal;
      if (isObject(targetVal) && isObject(sourceVal)) {
        return deepMerge(targetVal, sourceVal);
      }
      return sourceVal;
    });
  }
  if (isObject(target) && isObject(source)) {
    return deepMerge(target, source);
  }
  return source !== undefined ? source : target;
}

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const output = { ...target } as Record<string, unknown>;
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (DANGEROUS_PROPERTIES.has(key)) return;
      const sourceVal = (source as Record<string, unknown>)[key];
      const targetVal = (target as Record<string, unknown>)[key];
      output[key] = mergeValue(targetVal, sourceVal);
    });
  }
  return output as T;
}

export function usePersistedGameState<T extends object>(
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
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveToStorage();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      saveToStorage();
      window.removeEventListener('beforeunload', saveToStorage);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [saveToStorage]);

  return [state, setState, clearStorage];
}
