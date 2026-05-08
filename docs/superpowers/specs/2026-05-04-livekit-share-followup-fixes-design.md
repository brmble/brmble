# LiveKit Share Follow-Up Fixes Design

**Date:** 2026-05-04
**Status:** Approved
**Scope:** Fix three follow-up issues discovered during manual testing: root-channel share discovery, intentional disconnect notification behavior, and clearer messaging for capture-start failures on blocked windows/apps.

## Overview

Manual testing after the discovery-vs-watch work surfaced three remaining product issues:

1. users in the root channel do not reliably see active share badges unless they first enter a real channel
2. intentional local disconnect while sharing is misclassified as a technical interruption and shows the wrong warning notification
3. trying to share certain Windows apps, such as Snipping Tool, produces a generic technical error even though the likely cause is platform-level capture denial rather than an unknown internal failure

These are separate from the earlier discovery/watch authorization split. The earlier work fixed cross-channel share visibility for channel-scoped discovery and protected watch permissions. This follow-up focuses on product polish and correct intent handling on top of that corrected base.

## Goals

- Show active share badges while the user is in the root channel.
- Make intentional local disconnect/back-to-server teardown silent with respect to local share-ended notifications.
- Replace vague generic technical share-start errors with clearer messaging when Windows/WebView2 blocks sharing a selected window/app.

## Non-Goals

- Changing watch authorization rules.
- Changing publish authorization rules.
- Refactoring the broader LiveKit room lifecycle.
- Building future per-channel privacy settings for hiding share visibility.
- Fixing all avatar-loading or metadata-timing issues in the app.

## Root Share Discovery

### Product rule

When the selected channel is `server-root`, the UI should still show who is actively sharing across the server.

This is visibility metadata only. It does not imply that the user may watch those shares from root.

### Recommended behavior

- channel views keep using room-scoped discovery for that specific channel
- root view uses a global discovery snapshot of all currently active shares across channels
- sidebar rendering continues to consume the shared `activeShares` state; it does not need a new rendering model

### Data shape

The global/root discovery response should include the same share identity fields already used elsewhere:

- `roomName`
- `userName`
- `userId`
- `matrixUserId`
- `sessionId` when available

This keeps root and channel badge rendering on one common data model.

## Intentional Disconnect Behavior

### Product rule

If the local user intentionally disconnects or returns to the server list while sharing, the share should stop silently.

The app should not show a warning that the share ended for an unknown technical reason.

### Recommended behavior

- intentional teardown should flow through the same `manual` local-share-ended path as pressing the explicit stop-sharing button
- room disconnects caused by that intentional teardown must not be reclassified as `interrupted`

### Design boundary

This is an intent-preservation problem, not a transport problem.

The fix should explicitly carry user intent through teardown rather than trying to infer it after the LiveKit room has already disconnected.

## Capture-Start Failure Messaging

### Product rule

If the user selects a window/app and Windows or WebView2 refuses to start capture, the UI should explain that the selected app/window could not be shared, rather than implying an unknown internal technical issue.

### Recommended behavior

- keep picker cancel silent
- keep genuine internal failures as error notifications
- classify post-selection capture-start denials separately when the browser/platform reports the known failure pattern

### Message intent

The user-facing message should say the selected window/app could not be shared because Windows blocked it or does not support sharing it reliably.

It should not claim the user did something wrong, and it should not imply that Brmble itself lost internal state.

## Error Handling

### Root/global discovery

- root discovery failure should be diagnosable and should not silently clear all known badges unless a successful empty result is received
- successful global discovery may reconcile the entire known share set because its scope is intentionally global

### Intentional disconnect

- no share-ended toast/notification for manual disconnect or back-to-server actions
- unexpected network/room loss should still use the existing interruption path

### Blocked app/window capture

- show a clearer error notification for platform-blocked capture-start failures
- continue using the generic error path for unrelated failures that do not match the known blocked-capture pattern

## Testing Strategy

### Root discovery tests

- root selection triggers global discovery
- global discovery result populates badges for shares across channels
- channel selection still performs room-scoped discovery
- global discovery failure does not wipe previously known badges

### Intentional disconnect tests

- disconnect while sharing stops the share without any local share-ended notification
- back-to-server while sharing also stays silent
- unexpected room disconnect still produces the interruption/warning path

### Capture-start messaging tests

- picker cancel stays silent
- blocked app/window capture maps to the clearer blocked-capture message
- unrelated capture failure still maps to the generic error path

## Risks

- If root discovery reuses room-scoped reconciliation rules, root may still miss or partially wipe global share state.
- If intentional disconnect is not marked early enough, the room disconnect event may still arrive first and produce the wrong warning.
- If blocked-capture classification is too broad, genuine internal errors may be mislabeled as Windows limitations.

## Success Criteria

- a user in root can see all active share badges across channels
- a user outside a share's channel still cannot watch without joining that channel
- intentionally disconnecting while sharing does not show a warning notification
- sharing blocked Windows apps/windows produces a clearer, user-understandable error message
