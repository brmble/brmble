# Settings Admin Users Real Data Design

**Date:** 2026-05-19
**Status:** Proposed design
**Parent:** `docs/superpowers/specs/2026-05-19-settings-admin-workspace-design.md`

## Context

The admin workspace shell now exists inside Settings, but the `Users` tab is still mostly placeholder UI. It shows a search input and static empty states rather than the user information that admins actually need.

We already have enough real data paths to make this tab useful without waiting for a brand-new backend surface:

- `/admin/registered-users` returns registered Mumble users for server admins
- `voice.getBans` and `voice.unban` already power the live ban workflow
- the app already receives live voice events and session mapping events that describe connected users

This design turns `Users` into a genuinely useful admin view by merging those sources into one searchable table.

## Goals

- Replace the placeholder `Users` content with a real data-driven admin surface
- Show one unified searchable user list rather than separate panels
- Merge registered, connected, and banned state into a shared row model
- Keep the existing unban behavior available directly from the `Users` tab
- Reuse existing frontend and backend paths instead of introducing parallel admin plumbing
- Keep partial failures isolated so one bad source does not blank the whole tab

## Non-Goals

- Do not add a new server endpoint just to aggregate users
- Do not implement brand-new moderation actions beyond what current bridge/server paths already support
- Do not redesign the rest of the admin workspace in this follow-up
- Do not guess at identity joins when the available data is ambiguous

## Recommended Approach

Use a client-side merge strategy inside `AdminUsersSection`.

The section should load three real sources independently:

- registered users from `/admin/registered-users`
- banned users from the existing `voice.getBans` flow
- connected/session data from bridge events already emitted to the app

Those sources should be normalized into one shared admin row model and rendered in a single table with badges that communicate each user's current state.

This is the recommended approach because it ships immediately with existing capabilities, keeps the UI simple for admins, and avoids backend work that is not necessary for phase 1.

## Why Not A New Aggregated Endpoint

A dedicated admin-users backend endpoint would be cleaner long-term, but it would also duplicate information the client already has or can already request. For this iteration, the cost is not justified.

If the merged client-side model becomes too fragile or if more write actions are added later, we can revisit a dedicated server-side aggregate view in a later phase.

## UI Shape

`AdminUsersSection` should be restructured into four stacked areas:

1. Header and refresh state
2. Search/filter input
3. Unified results table
4. Inline empty/error/help messaging

The old `Registered Users` placeholder and separate `Banned Users` block should be removed. Their information becomes part of the same table.

## Unified Row Model

Each displayed row should represent the best-known admin view of one user-like subject. The row model should capture:

- display name
- searchable aliases or identifiers when available
- registration state
- connection state
- ban state
- connected session id when available
- registration user id when available
- ban index when available for unban
- source provenance so the UI knows which actions are safe

The UI should prefer one row for the same person when identity can be matched confidently. If confidence is low, keep separate rows rather than risk offering actions against the wrong target.

## Identity Merge Rules

The merge logic should be deliberately conservative.

### Safe merges

- a connected session row and a mapping row that share the same session id
- a registered row and another row when both expose the same stable registration id
- a ban row and another row when a stable unique identifier matches exactly

### Soft merges

- name-based merges may be used only when the data source is already registration-oriented and the match is exact after normalization

### Unsafe merges

- partial name matches
- fuzzy string similarity
- combining rows just because they appear close in time

When in doubt, render separate rows and expose the ambiguity through status badges rather than hiding it.

## Data Sources

### Registered users

Use `GET /admin/registered-users`.

This dataset forms the baseline table content because it is the most stable identity source available for server admins. The component should request it on mount and expose a local refresh control.

If the request returns `401` or `403`, the section should show a scoped error message rather than crashing the admin workspace.

### Connected users

Use the same bridge-driven live voice events already consumed in `App.tsx`, especially session/user mapping updates and live join/leave events.

The implementation for the settings surface should reuse those event shapes rather than introduce a new admin-only channel. Connected rows should update live while the settings modal is open.

If there is no complete initial snapshot path for connected users inside the modal, the first iteration may show only users observed during the current open session unless we can safely tap an existing snapshot event already emitted in the app.

### Banned users

Reuse the same ban loading and unban behavior already used by `AdminModerationSection`.

Ban records should appear as rows in the unified table with a `Banned` badge and an `Unban` action when an unban index is present.

## Search Behavior

The search input should filter the unified list client-side.

The filter should match against:

- display name
- registered name
- address or hash when those are displayed for banned users

Filtering should not trigger new server requests in phase 1.

## Table Behavior

The table should make mixed state obvious without requiring multiple panels.

Each row should show:

- primary identity text
- status badges such as `Connected`, `Registered`, `Banned`
- secondary metadata when useful
- row-level actions only when they are actually supported

This section should feel operational, not decorative. A user who is both registered and connected should visibly communicate both states.

## Actions

### Unban

Rows backed by a live ban index should expose `Unban`.

This action should use the same confirmation pattern and bridge request currently used in moderation:

- confirm through the shared prompt flow
- call `voice.unban` with the ban index
- refresh the ban portion of the unified dataset afterward

### Unsupported actions

Rows may show read-only state without edit controls when no safe backend path exists yet. We should not invent disabled buttons for speculative actions unless they are useful and honestly explained.

## Loading And Error Handling

Each source should load independently and report errors independently.

Rules:

- registered user failure must not hide connected or banned rows
- ban failure must not hide registered or connected rows
- live connected data absence should degrade gracefully to the static sources
- the overall empty state appears only when all active sources have finished and no rows match the current filter

The section should use small, contextual error and status text rather than one large generic error banner.

## Shared Logic Extraction

The ban loading behavior now exists in moderation and will also be needed in users. To avoid duplicating that logic, implementation should extract the ban request/unban/refresh behavior into a shared helper or hook that both sections can use.

The same principle applies to any user-normalization helper introduced for merging datasets.

## Testing

Add focused tests for:

- registered users rendering in the unified table
- banned users rendering in the same table with `Unban`
- client-side search filtering across mixed row types
- partial failure behavior when one source fails and others still render
- conservative merge behavior for clearly matching vs ambiguous identities

Existing moderation tests should remain in place to ensure the ban workflow still works in the dedicated moderation tab too.

## Success Criteria

- `Users` no longer renders placeholder-only content
- registered users appear in the table using `/admin/registered-users`
- banned users appear in the same table and can be unbanned
- connected-user state appears when available from existing live events
- search filters the combined dataset locally
- source-specific failures are visible but do not collapse the whole section
- identity merges are conservative and never rely on fuzzy guesses
