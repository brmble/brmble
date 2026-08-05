# Settings Admin Channels Disclosure Design

## Goal

Improve the channel management list in the settings admin interface so channel names are immediately readable on the left and the expand/collapse affordance is obvious on the right.

## Approved interaction

- Clicking anywhere on an expandable channel row toggles its access panel.
- The right-side arrow remains a dedicated disclosure control with `aria-expanded`, `aria-controls`, and an accessible label.
- Clicking the arrow stops event propagation so the row does not toggle twice.
- The arrow points to the collapsed or expanded state consistently and receives a visible hover/focus treatment.
- The existing right-click context menu, drag-and-drop ordering, selected-row styling, and inline access panel remain available.
- The root channel is not expandable and continues to show that group access is managed in Groups.

## Layout

The channel row uses a left-to-right layout:

1. Channel name, left-aligned and allowed to truncate.
2. Position pill, right-aligned before the disclosure control.
3. Disclosure arrow on the far right, visually distinct from the metadata.

The expanded access panel remains directly below its channel row. The row should read as one clickable disclosure surface without changing the existing panel content or data flow.

## Implementation scope

- Update `AdminChannelsSection` so row click and keyboard activation toggle expansion rather than only updating selection.
- Move the disclosure button after the name and position metadata in the rendered markup.
- Update admin channel CSS to support the new order, stronger affordance visibility, and responsive behavior without affecting unrelated admin sections.
- Extend the existing admin workspace tests to verify row-click expansion/collapse and preserve arrow accessibility behavior.

## Non-goals

- No changes to channel access rules, ACL persistence, channel ordering logic, context-menu actions, or root-channel permissions.
- No redesign of the expanded `ChannelAccessPanel`.

## Verification

- Run the focused `AdminWorkspaceSections` test suite.
- Run the web build/type checks used by the repository.
- Confirm the row, arrow, and expanded panel remain usable at narrow widths.
