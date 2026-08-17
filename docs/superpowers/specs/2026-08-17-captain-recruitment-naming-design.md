# Captain Recruitment Naming

## Goal

When a player recruits a new Captain, they can choose the Captain's name immediately before the purchase is completed.

## Scope

- Add a recruitment-time name-entry dialog to the Neon-D Captain recruitment flow.
- Start the input with the generated default name, such as `Captain 2`.
- Create and persist the Captain with the confirmed name.
- Preserve the existing Captain cost, prestige/run reset, assignment, and later rename behavior.
- Do not change normal dealer recruitment or Captain naming for existing saves.

## User flow

1. The player presses the existing **Hire Captain** action.
2. A modal dialog opens with the generated default Captain name selected or ready to edit.
3. The player enters a name and presses **Confirm**.
4. The dialog trims the name and confirms it is non-empty.
5. The game engine charges the existing Captain cost, creates the Captain with the chosen name, and performs the existing reset-run behavior.
6. Cancel, Escape, or backdrop close dismisses the dialog without changing cash, Captains, or run state.

The existing inline rename control remains available for later edits.

## Architecture

`NeonDGame` owns the dialog's open/closed state and renders a focused `CaptainRecruitmentDialog` component. The dialog receives the generated default name and an `onConfirm(name)` callback.

The game engine changes `buyCaptain` to accept the confirmed name. It validates the trimmed name defensively, then passes it to `createCaptain`. The engine does not mutate state until a valid name has been confirmed, so cancelling the dialog cannot create an unnamed Captain or charge the player.

`createCaptain` accepts the name used for the new Captain while retaining the existing generated-name behavior as the default for callers that need it.

## Validation and error handling

- Surrounding whitespace is removed before the name is saved.
- The Confirm action is disabled for an empty or whitespace-only value.
- The engine ignores empty or whitespace-only names as a defensive safeguard.
- No additional name-length or uniqueness rule is introduced in this change.
- Existing saves and existing Captain rename behavior remain valid.

## Testing

Component tests will verify that:

- the dialog opens with the generated default name;
- editing and confirming sends the chosen name to recruitment;
- Cancel and Escape do not recruit a Captain; and
- whitespace-only names cannot be confirmed.

Engine tests will verify that:

- a confirmed name is used for the created Captain and survives persistence;
- empty names do not create a Captain or charge cash; and
- existing recruitment pricing and reset behavior remain unchanged.

The targeted Neon-D test suite and the web build will be run after implementation.

## Out of scope

- Renaming normal dealers.
- Adding name uniqueness or maximum-length rules.
- Reworking the existing post-recruitment rename control.
- Changing Captain economics, unlock thresholds, or save schema semantics.
