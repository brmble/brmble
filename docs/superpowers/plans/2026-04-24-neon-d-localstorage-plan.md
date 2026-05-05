# Neon D LocalStorage Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save the Neon D GameState to localStorage periodically and on browser close to prevent progress loss, using a custom generic persistence hook.

**Architecture:** A standalone custom hook `usePersistedGameState` will encapsulate reading from and writing to `localStorage`, handling error catching, soft-versioning via deep merging with `INITIAL_GAME_STATE`, 30s polling, and `beforeunload` cleanup. The hook exposes a `[state, setState, clearState]` API to be swapped into `useGameEngine.ts`.

**Tech Stack:** React (Hooks), TypeScript, LocalStorage API.

---

### Task 1: Create `usePersistedGameState` Hook

**Files:**
- Create: `src/Brmble.Web/src/components/NeonD/hooks/usePersistedGameState.ts`
- Create: `src/Brmble.Web/src/components/NeonD/hooks/__tests__/usePersistedGameState.test.ts`

- [ ] **Step 1: Write the failing tests**
Create the test file to verify initial state loading, deep merging old data, interval saving, beforeunload listener, and the clear function.

```typescript
// src/Brmble.Web/src/components/NeonD/hooks/__tests__/usePersistedGameState.test.ts
import { renderHook, act } from '@testing-library/react';
import { usePersistedGameState } from '../usePersistedGameState';

beforeEach(() => {
  localStorage.clear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('usePersistedGameState', () => {
  const initial = { a: 1, nested: { b: 2, c: 3 } };

  it('loads initial state when local storage is empty', () => {
    const { result } = renderHook(() => usePersistedGameState('test_key', initial));
    expect(result.current[0]).toEqual(initial);
  });

  it('deep merges stored state with initial state (soft versioning)', () => {
    localStorage.setItem('test_key', JSON.stringify({ a: 10, nested: { b: 20 } })); // 'c' is missing
    const { result } = renderHook(() => usePersistedGameState('test_key', initial));
    expect(result.current[0]).toEqual({ a: 10, nested: { b: 20, c: 3 } });
  });

  it('falls back to initial state if JSON parsing fails', () => {
    localStorage.setItem('test_key', 'invalid json');
    const { result } = renderHook(() => usePersistedGameState('test_key', initial));
    expect(result.current[0]).toEqual(initial);
  });

  it('saves to localStorage after 30 seconds interval', () => {
    const { result } = renderHook(() => usePersistedGameState('test_key', initial));
    act(() => {
      result.current[1]({ a: 99, nested: { b: 2, c: 3 } });
    });
    act(() => {
      jest.advanceTimersByTime(30000);
    });
    expect(JSON.parse(localStorage.getItem('test_key') || '{}')).toEqual({ a: 99, nested: { b: 2, c: 3 } });
  });

  it('saves to localStorage on beforeunload', () => {
    const { result } = renderHook(() => usePersistedGameState('test_key', initial));
    act(() => {
      result.current[1]({ a: 55, nested: { b: 2, c: 3 } });
    });
    window.dispatchEvent(new Event('beforeunload'));
    expect(JSON.parse(localStorage.getItem('test_key') || '{}')).toEqual({ a: 55, nested: { b: 2, c: 3 } });
  });

  it('clears localStorage and resets when clear function is called', () => {
    localStorage.setItem('test_key', JSON.stringify({ a: 99, nested: { b: 99, c: 99 } }));
    const { result } = renderHook(() => usePersistedGameState('test_key', initial));
    act(() => {
      result.current[2](); // call clear
    });
    expect(localStorage.getItem('test_key')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/Brmble.Web && npm run test -- src/components/NeonD/hooks/__tests__/usePersistedGameState.test.ts`
Expected: FAIL with "Cannot find module" since the hook is not created yet.

- [ ] **Step 3: Write minimal implementation**
Create `usePersistedGameState.ts`. We include a simple deepMerge utility.

```typescript
// src/Brmble.Web/src/components/NeonD/hooks/usePersistedGameState.ts
import { useState, useEffect, useRef, useCallback } from 'react';
import { useInterval } from './useInterval';

// Simple deep merge helper
function isObject(item: any) {
  return (item && typeof item === 'object' && !Array.isArray(item));
}

function deepMerge(target: any, source: any) {
  let output = Object.assign({}, target);
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target))
          Object.assign(output, { [key]: source[key] });
        else
          output[key] = deepMerge(target[key], source[key]);
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  return output;
}

export function usePersistedGameState<T extends Record<string, any>>(
  key: string, 
  initialState: T | (() => T)
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  
  const [state, setReactState] = useState<T>(() => {
    const initial = typeof initialState === 'function' ? (initialState as () => T)() : initialState;
    try {
      const item = localStorage.getItem(key);
      if (item) {
        const parsed = JSON.parse(item);
        // Deep merge to retain nested fields from initial state
        return deepMerge(initial, parsed);
      }
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
    }
    return initial;
  });

  const stateRef = useRef(state);

  // Custom setter to update ref directly (avoids useEffect on every render)
  const setState: React.Dispatch<React.SetStateAction<T>> = useCallback((value) => {
    setReactState((prev) => {
      const nextState = typeof value === 'function' ? (value as Function)(prev) : value;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/Brmble.Web && npm run test -- src/components/NeonD/hooks/__tests__/usePersistedGameState.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/NeonD/hooks/__tests__/usePersistedGameState.test.ts src/Brmble.Web/src/components/NeonD/hooks/usePersistedGameState.ts
git commit -m "feat: add usePersistedGameState hook with deep merge and clear support"
```

### Task 2: Integrate Hook into Game Engine

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts`

- [ ] **Step 1: Replace useState with usePersistedGameState**
Update the imports and swap out the initial state definition.

Update `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts` imports:
```typescript
import { useCallback } from 'react'; // Removed useState
import { usePersistedGameState } from './usePersistedGameState';
```

Replace the state initialization around line 36:
```typescript
  const [state, setState, clearStorage] = usePersistedGameState<GameState>('brmble_neon_d_save', () => {
    const initial = INITIAL_GAME_STATE;
    return {
      ...initial,
      activeDealers: [null, null, null],
      unlockedSlots: 1,
      availableDealers: Array.from({ length: 3 }, () => 
        generateRandomDealer(initial.unlockedProduction, initial.totalEarned)
      )
    };
  });
```

- [ ] **Step 2: Update resetGame to clear storage**

Update the `resetGame` function around line 261 to use the `clearStorage` method.

```typescript
  const resetGame = useCallback(() => {
    clearStorage();
    setState({
      ...INITIAL_GAME_STATE,
      activeDealers: [null, null, null],
      unlockedSlots: 1,
      availableDealers: Array.from({ length: 3 }, () => 
        generateRandomDealer(INITIAL_GAME_STATE.unlockedProduction, INITIAL_GAME_STATE.totalEarned)
      )
    });
  }, [setState, clearStorage]);
```

- [ ] **Step 3: Run existing tests**

Run: `cd src/Brmble.Web && npm run test -- src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`
Expected: PASS (All engine tests should still pass since the interface didn't change).

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts
git commit -m "feat: integrate deep-merged localstorage hook into game engine"
```
