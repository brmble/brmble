# Admin Group Membership Save Isolation

## Problem

Confirming a membership change currently sends the complete local group and ACL draft. This unintentionally persists unrelated staged edits and makes them part of the server snapshot, so Cancel cannot discard them.

## Design

Membership confirmation will submit a payload derived from the server snapshot, changing only the selected group’s membership fields. Local group and ACL drafts will remain untouched except for the confirmed membership change, and the submitted-draft tracking will represent only the membership-specific server result. The existing Save Changes flow will continue to submit the complete local draft.

If the selected group exists in the server snapshot, update that server group with the confirmed membership change. For an ACL-only group, materialize the group from the server snapshot’s ACL-derived display data and apply the membership change. The response hydration path will then retain unrelated local edits until the user explicitly saves or cancels them.

## Testing

Add a regression test that stages an unrelated permission or group edit, confirms a membership change, and verifies the membership save does not include the unrelated edit. Verify that Cancel restores the server-backed state for both the membership and unrelated draft changes. Keep existing membership serialization and normal full-draft save tests passing.

## Scope

No server API changes or unrelated refactoring. The change is limited to `AdminGroupsSection` and its focused tests.
