# Settings Admin Workspace Design

**Date:** 2026-05-19
**Status:** Approved design

## Context

The current Admin area inside the settings modal is a small sub-tab surface with `Ban List`, `Channel Requests`, and `Registered Users`. That structure is too narrow for the broader admin workflow we want now.

The intended direction is to keep administration inside the existing `Admin` settings tab, but expand it into a true admin workspace. This workspace should feel like a cohesive control center for server operators while still respecting phase-1 backend limits. Existing ACL and channel-management plumbing already exists in Brmble, so the design should build on that foundation rather than introduce a disconnected admin system.

## Goals

- Replace the current narrow admin sub-tab setup with a richer admin workspace inside Settings.
- Introduce first-class admin sections for:
  - `Channels`
  - `Users`
  - `Groups`
  - `Moderation`
  - `Audit Log`
- Make the workspace feel like a real server administration surface rather than a collection of placeholders.
- Reuse current ACL-backed capabilities where they already exist.
- Present `Groups` as server-style roles in the UI, even when phase 1 maps some behavior to channel ACL groups underneath.
- Keep unsupported or partial actions visible only when they can be explained clearly and honestly.

## Non-Goals

- Do not create a new standalone admin window outside the existing Settings modal.
- Do not require all tabs to be fully backed by new server capabilities in phase 1.
- Do not invent a second permission system separate from the current Mumble/ACL model.
- Do not hide incomplete areas behind broken buttons or misleading "fake complete" flows.
- Do not redesign the full Settings modal beyond what is needed to support the admin workspace.

## Product Shape

The top-level `Admin` settings category remains in place, but its inner content becomes a full admin workspace instead of the current lightweight sub-tabs.

This workspace has five sections:

- `Channels`
- `Users`
- `Groups`
- `Moderation`
- `Audit Log`

Each section has a distinct job:

- `Channels` is the operational overview and management hub.
- `Users` is the person-centric admin view.
- `Groups` is the role and permissions center.
- `Moderation` is the enforcement surface.
- `Audit Log` is the trace and history view.

The experience should feel like one connected control surface. Admins should not have to think in terms of separate legacy screens for bans, requests, and registered users. Those older concepts are absorbed into the new structure.

## Information Architecture

The admin workspace should use a two-level structure:

- level 1: the five admin tabs
- level 2: within each tab, a stable split between overview content and task actions

This gives consistency without forcing every tab into the exact same layout.

### Channels

- Primary management overview
- Existing channel list in a management table
- Channel requests shown as a secondary section in the same tab
- Row-level actions such as `Edit` or `Manage`
- Global action such as `Create Channel`
- `Delete Channel` requires the admin to type the exact channel name before confirming
- Channel request approval actions should live inline with each request row, attached to the request status area

Phase 1 may show some of these actions in a disabled or partial state when backend support is missing, but the layout should still preserve the same mental model.

### Users

- Search and filter at the top
- Results table or list in the main area
- Selecting a user reveals profile/admin details and available actions
- Group membership changes can be initiated here as user-focused actions
- A banned-users section appears at the bottom so admins can review bans and unban directly when needed

### Groups

- Left-side group list
- `Add Group` and `Delete Group` controls
- Membership movement area using a dual-list pattern
- Permission editing area below or beside membership controls
- Explicit `Cancel` and `Save Changes` actions for staged edits
- This is the strongest expression of the server-role mental model

Even when the underlying data is ACL-scoped in phase 1, the UI should speak in terms of groups/roles and permissions, not raw ACL implementation details.

### Moderation

- Ban list moved here from the current admin sub-tabs
- Space for future moderation functions alongside bans
- Clear separation between live moderation actions and not-yet-supported tools

### Audit Log

- Read-only operational history view
- Narrow, intentionally simple phase-1 scope
- Designed as a log viewer, not a broad admin dashboard

## Phase-1 Capability Model

Phase 1 should use three capability levels so the workspace stays coherent without pretending all backend support already exists.

### Fully Live In Phase 1

- Channel browsing and selection in `Channels`
- Channel ACL-backed editing flows already supported by the current system
- Group creation, deletion, membership changes, and permission editing in `Groups`
- Existing ban-list behavior, relocated into `Moderation`
- Banned-user review and unban actions in the bottom section of `Users`

### Partially Live In Phase 1

- `Users` search and inspection, with editable actions only where support exists
- Channel request presentation inside `Channels`, with only supported actions enabled

### Present But Read-Only Or Placeholder In Phase 1

- Moderation tools beyond the current supported ban flows
- Audit history beyond what current server logging or events can reasonably expose
- Destructive or creation actions without backend support, such as full create/delete channel flows; these remain visible but disabled with explanatory copy

## UX Rules For Partial Support

The admin workspace must be honest about current capabilities.

- Supported actions render as normal controls.
- Unsupported actions render disabled with explanatory copy.
- Partially supported sections include short scope notes such as "available in this context" or "not available yet".
- Empty sections should use intentional empty states, not blank panels.
- We should avoid fake buttons that appear interactive but do nothing.

This is especially important because the visual design is broader than current backend support.

## UI Composition And Behavior

The `Admin` tab should become a full-width workspace inside the existing settings modal. It should feel denser and more operational than personal settings tabs while still fitting the modal's design system.

## UI Guide Compliance

This admin workspace is UI work and must follow `docs/UI_GUIDE.md` explicitly. The implementation should treat the guide as a hard constraint, not a loose reference.

### Existing Settings Pattern Rules

- Keep the feature inside the existing Settings modal rather than introducing a separate admin window
- Preserve the modal pattern already defined in the UI guide
- Treat Admin as the documented exception to the normal "no sub-tabs in settings" rule
- Continue to structure each admin area with existing settings and section patterns where they still fit

### Heading And Section Rules

- Admin workspace title remains an `h2.heading-title.modal-title`
- Major sections inside each admin tab use `h3.heading-section.settings-section-title`
- Small labels inside panes, tables, or sidebars use `h4.heading-label` where appropriate
- Do not invent new heading tiers or ad-hoc section-title styling

### Tokens And Styling Rules

- Do not hardcode colors, spacing, radius, shadows, font sizes, or transition values
- Use existing CSS custom property tokens from `index.css` and theme tokens from `_template.css`
- Reuse existing shared button classes such as `btn`, `btn-primary`, `btn-secondary`, `btn-danger`, `btn-ghost`, and `btn-sm`
- Reuse shared glass, modal, settings, and form input patterns before introducing any new component styling

### Help, Empty States, And Messaging

- Do not place plain inline help paragraphs under active settings controls
- If a control needs explanation in a settings-style row, use `SettingsHelp`
- Inline text remains acceptable for empty states, loading states, validation errors, and feature placeholders
- Disabled admin actions should explain why they are unavailable using guide-compliant helper text or empty-state copy, not custom tooltip-only behavior

### Interaction Pattern Rules

- Use the shared prompt/confirmation pattern for destructive actions
- Use the shared `Tooltip` pattern where hover help is appropriate
- Use the centralized `Icon` component for standard icons rather than text glyphs or emoji
- Do not introduce native browser dialogs, ad-hoc tooltips, or one-off button patterns

### If The Guide Does Not Cover A Needed Pattern

If implementation reveals an admin-workspace UI pattern that is not covered cleanly by `docs/UI_GUIDE.md`, update the guide in the same branch before or alongside the UI implementation. Do not invent a private admin-only pattern without documenting it.

### Top-Level Admin Navigation

- Replace the current `Ban List`, `Channel Requests`, and `Registered Users` sub-tabs with:
  - `Channels`
  - `Users`
  - `Groups`
  - `Moderation`
  - `Audit Log`
- Keep the existing settings modal framing and close behavior
- Do not force one global save action across the entire admin area

Admin workflows should save per action or per edited section, because different tabs represent different operational tasks rather than a single draft form.

### Channels Tab Composition

- Main management overview table
- Secondary request queue section
- Row-level management actions
- Optional inline detail panel or focused editor for the selected channel
- `Create Channel` remains a bottom action-row control
- `Delete Channel` acts on the currently selected channel and opens a typed confirmation prompt
- `Approve` and `Deny` request actions appear inline in the request row near or within the status column
- Disabled-but-explained actions for unsupported flows when needed

The `Channels` tab should feel like the operational hub of the workspace.

The phase-1 interaction model for `Channels` should be:

- `Edit` is a row-level channel action
- selecting a channel enables `Delete Channel`
- deleting a channel requires typing the exact channel name in the shared prompt flow before confirming
- request approval is row-level, not a detached global action
- each request row should make `Approve` and `Deny` visible from the status/action area

### Users Tab Composition

- Search/filter controls at the top
- Results table or list in the main content area
- Selected user detail panel or section
- Banned-users section at the bottom
- Action groups that distinguish:
  - live now
  - scope-limited
  - not yet supported

The banned-users section in `Users` should:

- reuse the existing live ban data and unban behavior
- appear as a secondary admin section below the main user-management area
- help admins resolve user issues without leaving the user-management context

### Groups Tab Composition

- Group list on the left
- `Add Group` and `Delete Group` actions near the group list
- Membership transfer area in the middle
- Permission matrix below or to the side
- `Cancel` and `Save Changes` actions at the bottom of the editor
- This tab should feel like the most advanced "power admin" surface in the workspace

The dual-list pattern from the original concept is the right anchor layout here because it matches familiar ACL, directory, and community-management tools.

The phase-1 `Groups` tab is a real editor, not a placeholder. It must support:

- selecting a group from the list
- creating a group
- deleting a group
- moving users in and out of the selected group
- editing the selected group's permission checklist
- discarding staged changes with `Cancel`
- applying staged changes with `Save Changes`

### Moderation Tab Composition

- Existing ban list as a reusable section
- Additional moderation sections can appear as disabled or empty-state panels
- The tab should still feel purposeful even before every moderation tool is implemented

### Audit Log Tab Composition

- Read-only event list
- Show a simple chronological event list in phase 1; add lightweight filtering only when backed by existing log or event data
- Clear messaging when the visible log is limited in scope

## Migration Of Existing Admin Content

The current admin content should be redistributed as follows:

- `Ban List` moves into `Moderation`
- `Channel Requests` moves into `Channels`
- `Registered Users` evolves into `Users`

The old sub-tab model should be removed entirely so the new admin IA stays clean. We should not mix the old and new navigation structures in the same `Admin` tab.

## Data And Scoping Model

The UI should present itself as a server administration surface. However, the implementation may still rely on channel-scoped ACL data for some workflows in phase 1.

That scoping detail should remain mostly internal:

- The UI speaks in admin terms such as `Groups`, `Permissions`, and `Manage User`
- The implementation may resolve some of those workflows through selected-channel ACL snapshots and group operations
- Group lifecycle actions, including add and delete, must be backed by real persistence behavior rather than placeholder controls
- Where a workflow only applies within a current channel or scoped context, the UI should explain that clearly

This keeps the product language aligned with the end-state vision without blocking phase 1 on a fully server-wide backend model.

## Error Handling And State Behavior

Each admin tab should own its own state behavior:

- loading
- empty
- error
- partial support

A failure in one section should not block the entire admin workspace. Data should load independently where possible.

Additional rules:

- Preserve explicit refresh affordances for data that may change externally
- Use confirmation prompts for destructive actions, matching the current unban pattern
- Typed destructive confirmation should use the shared `prompt()` pattern rather than a custom modal or browser dialog
- Prefer narrow, contextual error messages over one global admin error banner

## Testing

Add or update focused tests around the admin workspace refactor:

- `AdminSettingsTab` navigation updates from the old three-tab structure to the new five-tab workspace
- Existing ban-list behavior continues working after being moved under `Moderation`
- `Channels` renders management overview and request sections correctly
- `Channels` uses typed confirmation for delete and inline approve/deny request actions
- `Users` renders search, results, and scoped-action states
- `Users` shows banned users at the bottom and supports unban actions there
- `Groups` renders dual-list membership management, add/delete actions, and save/cancel controls
- Placeholder and disabled-state messaging is explicit and consistent

If phase 1 introduces new shared admin subcomponents, add focused tests for those components rather than overloading one large integration test.

## Success Criteria

- The `Admin` settings area presents a cohesive workspace with `Channels`, `Users`, `Groups`, `Moderation`, and `Audit Log`.
- Legacy admin sub-tabs are removed.
- Existing live functionality, especially ban management and ACL-backed admin flows, remains usable after the restructure.
- The `Groups` tab supports real group lifecycle editing, including create and delete.
- Partial or unsupported admin functions are clearly communicated and never appear broken.
- The `Groups` experience reflects a server-role mental model even if some phase-1 behavior is backed by channel ACL data.
- The workspace leaves room for future backend expansion without requiring another admin IA redesign.
