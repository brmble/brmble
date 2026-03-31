# Spec: Wizard Server Import Deduplication

**Date:** 2026-03-31  
**Branch:** feature/onboarding-wizard-redesign  
**Status:** Approved

## Problem

When the onboarding wizard is reopened (e.g. after a user deletes all profiles), it may detect Mumble server favourites that are already saved in Brmble's `servers.json`. Currently there is no deduplication — importing silently creates duplicates, and the user has no visual indication that a server is already saved.

## Goal

Mark already-saved servers with an "Already saved" badge in the wizard's server import step. Pre-deselect them so re-importing is opt-in. Users can still re-select and import them if desired (e.g. to restore a deleted entry).

## Matching Criteria

Two servers are considered the same if `host` matches (case-insensitive) **and** `port` matches. Label and username are not considered.

## Changes

### 1. Backend — `ServerlistService.cs`

In the `mumble.detectServers` handler:

1. After calling `DetectMumbleServers()`, call `GetServers()`.
2. Build a `HashSet<string>` of `"host:port"` keys from saved servers (host lowercased, port as integer). Use `srv.Host` and `srv.Port` — both are nullable; skip entries where either is null.
3. For each detected Mumble server, compute its key as `$"{detected.host.ToLowerInvariant()}:{detected.port}"` and check membership in the set.
4. Add `alreadySaved: bool` to each entry in the `mumble.detectedServers` response payload.

Response shape (updated):
```json
{
  "servers": [
    { "label": "My Server", "host": "mumble.example.com", "port": 64738, "username": "alice", "alreadySaved": true }
  ]
}
```

The `mumble.importServers` handler is **not changed**.

### 2. Frontend — `OnboardingWizard.tsx`

1. Add `alreadySaved: boolean` to the `MumbleServer` interface.
2. In the `mumble.detectedServers` handler, only add an index to `selectedServers` if `!srv.alreadySaved`. Already-saved servers start deselected.
3. On each import card:
   - If `alreadySaved` is true **and** the card is not selected: show badge with class `onboarding-identity-badge saved` and text "Already saved".
   - If `alreadySaved` is true **and** the card is selected: show the normal `onboarding-identity-badge brmble` "Import" badge (user opted in to re-import).
   - If `alreadySaved` is false: existing behaviour unchanged ("Import" badge when selected, no badge when deselected).

### 3. CSS — `OnboardingWizard.css`

Add a `.saved` variant after the existing `.mumble` variant:

```css
.onboarding-identity-badge.saved {
  background: var(--bg-subtle);
  color: var(--text-muted);
}
```

Uses muted/neutral tokens so it is visually distinct from both the blue `.brmble` (import) and green `.mumble` (detected from Mumble) badges.

## Out of Scope

- The `mumble.importServers` handler does not need to guard against duplicates — the frontend controls what gets sent, and a user who re-selects an already-saved server is intentionally choosing to re-import.
- No changes to the `servers.list` message or any other part of the server list UI.

## Files Affected

| File | Change |
|---|---|
| `src/Brmble.Client/Services/Serverlist/ServerlistService.cs` | Enrich `mumble.detectedServers` with `alreadySaved` |
| `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx` | Read `alreadySaved`, update pre-selection and badge logic |
| `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.css` | Add `.onboarding-identity-badge.saved` |
