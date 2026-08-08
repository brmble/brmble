# Admin Groups Empty-Snapshot Loop Fix

## Goal

Prevent `AdminGroupsSection` from repeatedly hydrating draft state when the ACL hook has no snapshot yet, while preserving the existing behavior for real snapshots and local edits.

## Design

`AdminGroupsSection` will use stable module-level empty arrays for the `snapshot === null` fallback values. The hydration effect will therefore see stable dependencies while the initial ACL request transitions the hook through loading and eventually supplies a snapshot. No hook API or production behavior outside this component changes.

## Testing

Add a regression test to `AdminGroupsSection.test.tsx` whose mocked `refresh` changes the mocked ACL hook state from `snapshot: null` to a real snapshot and triggers a rerender. The test will assert that refresh is called once and that the hydrated group appears, covering the state transition that the current mock setup does not exercise.

## Scope

Only the component fallback handling and its focused test are in scope. Existing unrelated working-tree changes remain untouched.
