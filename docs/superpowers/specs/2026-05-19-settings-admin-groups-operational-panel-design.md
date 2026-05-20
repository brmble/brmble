# Settings Admin Groups Operational Panel Design

## Summary

Refresh the `Settings > Admin > Groups` tab so it matches Brmble's visual language while adopting a denser, more operational admin layout.

The current implementation feels like a stack of placeholders:

- large generic cards
- oversized group tiles
- nested boxes inside nested boxes
- a membership area that does not read like a real transfer tool
- a permissions area that still looks unfinished

The target is a true admin editor that still feels native to Brmble's dark glassy styling, accent blue states, and modal framing.

## Goals

- Keep the existing Brmble shell, tabs, typography, colors, and modal atmosphere.
- Rebuild the `Groups` tab into a flatter, denser workspace.
- Make the group list feel like a real management rail rather than a grid of large tiles.
- Present membership editing as a true three-column transfer workspace.
- Replace the permissions placeholder with a structured checklist matrix.
- Keep loading, channel errors, and empty states visible without letting them dominate the layout.

## Non-Goals

- Do not redesign the wider settings modal.
- Do not introduce a new visual language that fights the rest of Brmble.
- Do not add new backend capability beyond the current ACL-backed flow.
- Do not over-polish with decorative motion or extra chrome.

## Layout Structure

The `Groups` tab should be organized as three stacked work zones inside the existing admin workspace:

1. `Groups List`
2. `Membership Transfer`
3. `Group Permissions`

Each zone should feel like part of one shared operational surface rather than separate oversized cards.

### Container behavior

- Keep the overall section width aligned with the existing admin workspace.
- Use tighter vertical rhythm than the current layout.
- Preserve rounded Brmble containers, but reduce the sense of "card inside card inside card".
- Use subtle borders and tonal separation rather than large padded boxes everywhere.

## Groups List

The top zone contains a compact left-aligned group management rail.

### Structure

- Section label: `Groups List`
- Vertical list of selectable groups
- Action row directly below the list with:
  - `Add Group`
  - `Delete Group`

### Visual behavior

- Group rows should be compact and list-like, not tall tiles.
- Selected state should use Brmble's blue highlight/border treatment with a slightly brighter surface.
- Unselected rows should remain quiet and readable.
- The group rail should feel narrow and intentional, not stretched across the whole page.

### Content rules

- Group names are the primary visible content.
- If no group is selected, the first available group should become selected by default.
- Destructive action styling for `Delete Group` should remain present but less visually heavy than the current red block.

## Membership Transfer Workspace

The middle zone is the core editor.

### Structure

Use a true three-column layout:

1. `Available Users`
2. `Actions`
3. `Members of "<selected group>"`

### Available and member lists

- Each side should render as a compact list surface with repeated rows.
- Each row should contain:
  - primary name
  - muted metadata line with registered ID
- Rows should be denser than the current user cards.
- Lists should have enough minimum height to feel like editor panes even with few users.

### Actions column

- Render a narrow central action strip.
- Use vertically stacked transfer controls aligned to the middle of the workspace.
- Controls should visually read as transfer operations rather than row-level CTA buttons.

### Phase-1 interaction behavior

Because the current implementation stages changes in local draft state rather than using a full desktop-style selection model, phase 1 should keep interactions simple:

- each user row may still contain an explicit `Add` or `Remove` button
- the surrounding layout should nevertheless read as a three-column transfer editor
- if bulk move controls like `>>` or `<<` are not yet implemented, do not fake them
- the visual structure should leave room for future bulk actions without requiring another layout rewrite

### Status messaging

Loading, invalid channel state, and fetch failures should appear as subdued inline admin status messaging above the transfer grid.

Rules:

- do not center a large warning in the middle of the editor body
- do not let red error text overpower the whole membership section
- show status early, small, and clearly
- when data is still partially usable, keep the rest of the editor visible

## Group Permissions

The bottom zone replaces the placeholder with a real permissions editor.

### Structure

- Section heading: `Group Permissions`
- Multiple permission categories stacked vertically
- Each category includes:
  - category heading
  - subtle divider
  - compact checklist grid

### Initial category set

Phase 1 should present the permissions in admin-friendly groups matching the intended product language:

- `General Permissions`
- `Moderation Permissions`
- `Channel Management`
- `Administrative Permissions`

### Checklist behavior

- Use Brmble-styled checkboxes.
- Present permissions in compact multi-column rows.
- Keep labels short and scannable.
- Disabled or unsupported permissions must be clearly labeled if they cannot yet be persisted.
- The area should look complete even if some mappings remain partial under the hood.

### Mapping guidance

The UI language should stay user-facing and role-oriented.

- Prefer labels like `Kick Users` and `Manage Groups`
- Avoid exposing raw ACL terminology
- Internal ACL mapping details remain implementation-only

## Footer Actions

The footer should remain simple:

- `Cancel`
- `Save Changes`

Behavior:

- right-aligned within the tab
- preserve Brmble button styling
- spacing should feel deliberate and not detached from the editor above

## Visual Direction

The design should stay unmistakably Brmble:

- dark layered surfaces
- subtle blue-accent selected states
- soft rounded corners
- muted secondary text
- restrained borders

But it should move away from the current "placeholder card stack" feel:

- less empty padding
- fewer nested frames
- flatter row treatments
- denser list rhythm
- clearer section hierarchy

## Responsive Behavior

Desktop and wider modal states:

- group list remains compact
- membership editor reads as three columns
- permissions grid uses multiple columns

Narrower modal widths:

- membership zone may collapse into stacked columns
- action controls remain centered or visually separated
- permissions grid can reduce column count without breaking readability

The mobile or narrow-state fallback should preserve structure rather than reverting to oversized tiles.

## Error And Empty States

The page should use calm, explicit states:

- no selected group: prompt to select a group
- no members in selected group: show a small empty-state message inside the member pane
- no available users: show a small empty-state message inside the available pane
- invalid ACL scope or channel issues: show inline status above the transfer editor
- registered user fetch failure: show scoped error text without hiding the group list

## Testing Expectations

Add or update focused frontend tests to verify:

- compact group list still renders and selection works
- selected group name appears in the membership header
- registered users render into available and member panes
- add and remove actions still update staged membership correctly
- permission groups render with labeled categories
- loading and error states appear in the scoped status region

## Success Criteria

- The `Groups` tab feels like a real admin workspace, not a placeholder.
- The layout clearly resembles an operational group-management tool.
- The page still looks native to Brmble rather than imported from another design system.
- Membership editing is easier to parse at a glance.
- The permissions area looks intentional and complete.
- The overall result is visibly closer to the provided ASCII mockup while respecting Brmble's established styling.
