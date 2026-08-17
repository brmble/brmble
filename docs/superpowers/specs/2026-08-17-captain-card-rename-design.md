# Captain Card Rename Control

## Goal

Make it easy to rename an owned Captain after hiring by adding a discoverable edit control to the Captain card header.

## Scope

- Add a small pencil icon button to each owned Captain card header, next to the existing collapse control.
- Support the control for both assigned and unassigned Captains.
- Reveal a compact inline name field when the icon is activated.
- Reuse the existing `renameCaptain` engine behavior so names remain trimmed, persisted, and synchronized into assigned slots.
- Add the pencil icon to the shared icon registry and document it in the UI guide.
- Add focused component tests for opening, saving, canceling, and rejecting an empty rename.

## User flow

1. The player sees a Captain card in the Distribution panel.
2. The player activates the pencil button in the card header.
3. A compact name field appears below the card header with the current name.
4. The player enters a new name and presses Enter or leaves the field.
5. The name is trimmed and sent through the existing `renameCaptain` callback.
6. The updated name is displayed in the card and, when assigned, in the slot representation.
7. Escape cancels the edit. A blank or whitespace-only name is rejected and leaves the current name unchanged.

## Architecture

`DistributionPanel` owns the temporary edit state for each Captain card. The card header renders a button with an accessible label such as `Rename Captain One`; activating it adds the inline editor for that Captain and focuses its input.

The editor is local UI state only. On commit, it trims the value and calls the existing `onRenameCaptain(captainId, name)` prop. The game engine already validates the name, updates the owned Captain, and mirrors the result into any assigned slot through `syncAssignedCaptainSlots`. No save schema or engine API change is required.

The shared `Icon` component receives a Lucide-style `pencil` path in its UI actions group. The rename button uses the existing compact card-control styling and token-based CSS values; it does not introduce a new modal, notification, or bespoke interaction system.

## Validation and interaction details

- The input starts with the Captain's current name.
- Enter commits the value and keeps the editor behavior predictable for keyboard users.
- Blur commits the value, matching the existing Captain candidate rename behavior.
- Escape restores the original value and closes the editor without calling the callback.
- Empty or whitespace-only values close the editor without calling the callback.
- The edit button and collapse button have distinct accessible labels and remain independently operable.
- The editor must not interfere with the existing card collapse control or Talent Ledger actions.

## Testing

Component tests will verify that:

- each Captain card exposes a rename button;
- activating the button reveals the current name in an input;
- Enter commits a trimmed name through `onRenameCaptain`;
- Escape cancels without invoking the callback; and
- a whitespace-only value is rejected.

Existing engine tests already cover trimming, blank-name rejection, and synchronization into an assigned slot. The targeted Neon-D component tests, web type-check, and web build will be run after implementation.

## Out of scope

- Renaming normal dealers.
- Changing Captain name validation or persistence formats.
- Adding a rename prompt immediately after recruitment.
- Adding uniqueness or maximum-length rules.
- Reworking card collapse, Talent Ledger, or recruitment flows.
