# Admin Groups Root ACL Workflow

## Goal

Make the Admin Groups tab editable during normal use, including when the client has already populated its channel list. Groups in this tab represent server-wide root ACL groups, not an aggregate catalog of per-channel groups.

## Design

`AdminGroupsSection` will always use the root ACL snapshot through `useAclAdmin(0)`. The `channels` prop will no longer select a read-only catalog mode or disable group editing. Existing editable operations—creating and deleting groups, changing memberships and permissions, canceling, and saving—will therefore remain available regardless of channel-list population.

The channel catalog hook will no longer be part of the Groups tab’s data path. It may remain available for other consumers, but it must not determine whether the root Groups editor is editable.

The native bridge will accept channel ID `0` for ACL read/write and ACL group-member/password operations. The server ACL endpoints already use `0` as the root channel identifier and perform root ACL authorization, so the bridge should forward that valid domain value instead of treating it as an invalid channel. Non-ACL channel-management validation remains unchanged.

## Data flow

1. The Groups tab requests `acl.getChannel` with `channelId: 0`.
2. The desktop bridge forwards the root request to `/acl/channels/0`.
3. The server returns the root ACL snapshot.
4. The component renders and edits that snapshot using its existing draft and save workflow.
5. Saves and supported membership/password operations continue to use channel ID `0`.

## Error handling

Existing ACL loading and save errors remain unchanged. Invalid or missing connection/API configuration continues to produce the existing bridge error. Only the special case for root ACL channel ID `0` changes; negative IDs remain invalid.

## Testing

- Add a component regression test showing that populated channels do not switch Groups into read-only mode: editable controls are enabled and root snapshot groups are rendered.
- Preserve coverage for existing editing behavior and update/remove obsolete catalog-mode expectations.
- Add a client bridge regression test proving an ACL request with `channelId: 0` reaches the API and does not emit the invalid-channel error.
- Run the focused frontend and client tests, then the relevant builds or broader test commands supported by the repository.

## Scope

This change is limited to root ACL group management and its bridge validation. It does not change channel catalog semantics elsewhere, non-ACL channel ID validation, server authorization, or the ACL data model.
