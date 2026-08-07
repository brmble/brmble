# Neon-D Save Import/Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add validated JSON save export/import for Neon-D, with confirmation before replacing the current empire.

**Architecture:** Keep the versioned file envelope and parsing rules in a focused save-format utility. Keep state replacement in `useGameEngine`, where the existing initial-state and migration rules are available, and keep browser file APIs plus confirmation in `NeonDGame`. Failed imports never call the state setter.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, browser `Blob`/`URL`/`FileReader` APIs.

## Global Constraints

- Use the file format `{ "format": "brmble-neon-d-save", "version": 1, "state": { } }`.
- Use the filename `brmble-neon-d-save.json`.
- Preserve the existing `brmble_neon_d_save` local-storage key.
- A valid import must be confirmed before replacing current progress.
- Invalid JSON, wrong format, unsupported version, and invalid state data must leave the current state untouched.
- Use the existing `confirm` prompt and established web-client error presentation; do not add a new notification system.
- Follow `docs/UI_GUIDE.md` before modifying the Neon-D UI.
- Production code must be preceded by a failing test and verified with focused tests before broader verification.

## File map

- Create `src/Brmble.Web/src/components/NeonD/saveFormat.ts`: versioned envelope, serialization, parsing, and structural validation.
- Create `src/Brmble.Web/src/components/NeonD/__tests__/saveFormat.test.ts`: pure save-format tests.
- Modify `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts`: expose `importGame(state: GameState)` and normalize imported data with the existing game-state defaults/migrations.
- Modify `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`: verify imported state replacement and persistence-safe normalization.
- Modify `src/Brmble.Web/src/components/NeonD/NeonDGame.tsx`: add export/import controls, file handling, confirmation, and import errors.
- Modify `src/Brmble.Web/src/components/NeonD/NeonD.module.css`: style the two header actions using existing tokens and patterns.
- Modify `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx`: verify UI actions, confirmation, error isolation, and same-file retry behavior.

### Task 1: Add the versioned save-format utility

**Files:**
- Create: `src/Brmble.Web/src/components/NeonD/saveFormat.ts`
- Test: `src/Brmble.Web/src/components/NeonD/__tests__/saveFormat.test.ts`

**Interfaces:**
- Produces `serializeNeonDSave(state: GameState): string`.
- Produces `parseNeonDSave(text: string): GameState` and throws an `Error` with user-safe messages for malformed or incompatible input.
- Uses `NEON_D_SAVE_FORMAT = 'brmble-neon-d-save'` and `NEON_D_SAVE_VERSION = 1`.

- [ ] **Step 1: Write the failing serialization and parsing tests**

Add tests that assert:

```ts
const state = createState({ money: 1234.5 });
const json = serializeNeonDSave(state);
expect(JSON.parse(json)).toEqual({
  format: 'brmble-neon-d-save',
  version: 1,
  state,
});
expect(parseNeonDSave(json)).toEqual(state);
```

Also add separate tests for invalid JSON, a wrong `format`, `version: 2`, missing `state`, a non-object state, and a state with a required numeric field of the wrong type. Assert each throws and does not silently return defaults.

- [ ] **Step 2: Run the focused tests and verify the expected failure**

Run from `src/Brmble.Web`:

```text
npm run test -- src/components/NeonD/__tests__/saveFormat.test.ts
```

Expected: FAIL because `saveFormat.ts` and its exported functions do not exist yet.

- [ ] **Step 3: Implement the minimal format and structural validation**

Implement the envelope constants and `JSON.stringify` serializer. In `parseNeonDSave`, parse `unknown`, require a non-null object, require the exact format string and supported version, require a non-null object state, and validate all required `GameState` fields at the outer level with type guards. Validate nested production/dealer collections enough to reject malformed data rather than trusting arbitrary JSON. Return the validated `GameState` without mutating the parsed object.

- [ ] **Step 4: Run the focused tests and verify they pass**

```text
npm run test -- src/components/NeonD/__tests__/saveFormat.test.ts
```

Expected: PASS with all serialization and rejection cases green.

- [ ] **Step 5: Commit the utility**

```text
git add -- src/Brmble.Web/src/components/NeonD/saveFormat.ts src/Brmble.Web/src/components/NeonD/__tests__/saveFormat.test.ts
git commit -m "feat: add Neon-D save format"
```

### Task 2: Connect validated imports to the game engine

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts`
- Test: `src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts`

**Interfaces:**
- `useGameEngine()` produces `importGame(state: GameState): void`.
- The operation replaces state through the existing `setState`; it does not clear storage or generate new dealers.

- [ ] **Step 1: Write the failing hook test**

Add a test that seeds local storage with a normal state, renders the hook, calls:

```ts
act(() => result.current.importGame(importedState));
```

Assert the current state now has the imported money, unlocked production, and dealer data. Include an imported state missing migration-era optional dealer fields if the current migration logic supports them, and assert those fields receive the same defaults as local-storage restoration.

- [ ] **Step 2: Run the focused hook test and verify it fails**

```text
npm run test -- src/components/NeonD/hooks/__tests__/useGameEngine.test.ts
```

Expected: FAIL because `importGame` is not exposed.

- [ ] **Step 3: Implement state replacement and normalization**

Extract or reuse the existing `normalizeDealerRiskState` and initial-state merge behavior so imported state receives current defaults/migrations. Add `importGame` beside `resetGame`:

```ts
const importGame = useCallback((importedState: GameState) => {
  setState(normalizeImportedGameState(importedState));
}, [setState]);
```

Ensure the imported object is treated as immutable input and that the existing tick/migration effects continue to operate after replacement.

- [ ] **Step 4: Run focused engine tests and the existing Neon-D hook tests**

```text
npm run test -- src/components/NeonD/hooks/__tests__/useGameEngine.test.ts
npm run test -- src/components/NeonD/hooks/__tests__/usePersistedGameState.test.ts
```

Expected: PASS with no regressions in reset, migration, ticking, or persistence behavior.

- [ ] **Step 5: Commit the engine integration**

```text
git add -- src/Brmble.Web/src/components/NeonD/hooks/useGameEngine.ts src/Brmble.Web/src/components/NeonD/hooks/__tests__/useGameEngine.test.ts
git commit -m "feat: support importing Neon-D state"
```

### Task 3: Add export/import controls and browser file handling

**Files:**
- Modify: `src/Brmble.Web/src/components/NeonD/NeonDGame.tsx`
- Modify: `src/Brmble.Web/src/components/NeonD/NeonD.module.css`
- Test: `src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx`

**Interfaces:**
- Consumes `serializeNeonDSave`, `parseNeonDSave`, and `useGameEngine().importGame`.
- Export creates a Blob download named `brmble-neon-d-save.json`.
- Import reads a selected file, confirms with `{ title: 'Import Neon-D save?', message: 'Import this Neon-D save? Your current empire will be replaced.', confirmLabel: 'Import', cancelLabel: 'Cancel', destructive: true }`, then calls `importGame` only after confirmation.

- [ ] **Step 1: Read the UI guide sections for header actions, buttons, confirmations, and error states**

Review `docs/UI_GUIDE.md` and existing Neon-D styles before changing JSX/CSS. Reuse `Icon` names and CSS custom-property tokens already used by the game header.

- [ ] **Step 2: Write failing component tests**

Extend the existing `useGameEngine` mock with `importGameMock`, then add tests that:

```ts
it('exports the current Neon-D state as a JSON download', async () => {
  // mock Blob, URL.createObjectURL, URL.revokeObjectURL, and anchor.click
  // click Export save
  // assert the serialized envelope, download filename, and click
});

it('imports only after confirmation and preserves state on invalid files', async () => {
  // upload a valid File, resolve confirm(false), and assert importGameMock was not called
  // upload malformed JSON, assert importGameMock was not called and an error is visible
});
```

Add a same-file retry test: upload an invalid file, then upload the same file again after fixing the mocked file/read result, and assert the second selection is processed.

- [ ] **Step 3: Run the component tests and verify the expected failures**

```text
npm run test -- src/components/NeonD/__tests__/NeonDGame.test.tsx
```

Expected: FAIL because the controls, browser handlers, and `importGame` mock contract are not implemented.

- [ ] **Step 4: Implement export and import interactions**

Add a hidden JSON file input with a stable label/test id, an `Export save` button, and an `Import save` button in the header. Export the current `state` with `serializeNeonDSave`, create a JSON Blob, set an anchor's `href` and `download`, click it, and revoke the object URL. For import, reset the input value before opening the picker, read the selected file as text, parse it, ask for confirmation, call `importGame` only when confirmed, and reset the input in `finally`. Render a scoped inline error for read/parse/validation failures without changing game state.

Add the smallest CSS needed for the action group, using existing Neon-D tokens and button patterns.

- [ ] **Step 5: Run component tests and verify they pass**

```text
npm run test -- src/components/NeonD/__tests__/NeonDGame.test.tsx
```

Expected: PASS, including existing reset/upgrade/dealer tests and the new import/export cases.

- [ ] **Step 6: Commit the UI integration**

```text
git add -- src/Brmble.Web/src/components/NeonD/NeonDGame.tsx src/Brmble.Web/src/components/NeonD/NeonD.module.css src/Brmble.Web/src/components/NeonD/__tests__/NeonDGame.test.tsx
git commit -m "feat: add Neon-D save import and export"
```

### Task 4: Run final verification

**Files:**
- No additional files expected.

- [ ] **Step 1: Run all Neon-D tests**

```text
npm run test -- src/components/NeonD
```

Expected: PASS with no unhandled rejections or console errors introduced by import/export tests.

- [ ] **Step 2: Run the web type check and production build**

```text
npm run type-check
npm run build
```

Expected: both commands exit successfully.

- [ ] **Step 3: Review the diff and working tree**

```text
git diff HEAD~3..HEAD -- src/Brmble.Web/src/components/NeonD
git status --short
```

Confirm the feature is limited to Neon-D save format, engine integration, UI controls, tests, and the approved documentation; do not stage unrelated existing user files.

- [ ] **Step 4: Commit any final test-only corrections separately**

```text
git add -- <only-corrected-Neon-D-files>
git commit -m "test: harden Neon-D save import export"
```

Only create this final commit if verification requires a correction after the three implementation commits.
