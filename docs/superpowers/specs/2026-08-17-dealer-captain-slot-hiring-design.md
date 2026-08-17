# Dealer and Captain Slot Hiring

## Goal

Replace the empty-slot dealer countdown with an explicit hiring flow where a
player chooses either a random normal dealer or an owned, unassigned Captain.
Normal dealers and Captains consume the same reputation-unlocked dealer slots.

## User experience

An empty dealer slot shows a button labeled `Hire dealers X/Y`, where `X` is
the number of occupied slots and `Y` is the number of unlocked dealer slots.
Clicking the button opens a hiring modal for the selected empty slot.

The modal contains:

- Three current random normal-dealer candidates in the existing three-column
  card layout. Each card shows the candidate name, volume and margin ratings,
  sales information, and a hire action.
- A `Refresh dealers` action that rerolls only the three normal-dealer
  candidates. It uses the existing persisted one-minute recruitment refresh
  timestamp. The action is disabled during cooldown and displays the remaining
  time. Opening or closing the modal does not reroll candidates or reset the
  timer.
- A Captain section below the normal dealers. It lists owned Captains that are
  not currently assigned to a slot. Each Captain shows a crown icon before the
  name, six-star ratings, sales information, available talent information when
  applicable, and a hire action.

Hiring either a dealer or Captain fills only the selected empty slot and closes
the modal. A player cannot hire into an occupied slot. If all unlocked slots
are occupied, the hiring action is unavailable. If Captains are owned before
the player unlocks a dealer slot, they remain available but cannot be assigned
until a slot is unlocked.

Captains can be renamed inline from their active Captain card and from their
modal candidate card. Renaming updates the existing Captain record and is
persisted in saves and exports.

## State model

Dealer slots will hold a union of normal dealers and Captains:

```ts
activeDealers: (Dealer | Captain | null)[]
```

This keeps slot capacity represented in exactly one place. The existing
Captain collection remains the source of ownership and progression data. A
Captain is assigned when its identity appears in a slot and unassigned when it
does not appear in any slot.

Seller-kind checks will keep normal-dealer-only actions such as protection,
bail, and arrest state from being offered to Captains. Captain-specific
progression, talents, equipment, products, and earnings continue to use the
existing Captain record.

## Data flow

1. The game engine exposes a single assignment action that validates the target
   slot is unlocked and empty, then assigns either a normal dealer candidate or
   an owned Captain.
2. Assigning a normal dealer removes it from the candidate pool. Assigning a
   Captain leaves it in the owned Captain collection while its slot assignment
   makes it unavailable in the modal.
3. Simulation and earnings calculation read assigned sellers from the slot
   collection. Unassigned Captains do not sell or earn income.
4. The modal derives its Captain list by filtering owned Captains against
   assigned Captain IDs.
5. The existing candidate refresh timestamp remains the authority for the
   normal-dealer refresh cooldown. Refreshing updates the timestamp and
   replaces the three candidates; it does not modify Captains.

## Save compatibility

Existing saves with normal dealers in `activeDealers` remain valid. Existing
Captains remain owned and unassigned after migration; no Captain is silently
placed into a slot. Save parsing and serialization must accept the expanded
slot union while retaining validation for unique seller IDs and slot capacity.
Older saves without Captain names continue using their existing generated name
and all current Captain progression fields are preserved.

## Components and boundaries

- `DistributionPanel` owns the presentation of assigned seller cards, empty
  slots, the hiring trigger, and the hiring modal.
- A focused hiring-modal component renders normal-dealer and Captain candidate
  cards, refresh cooldown state, and rename controls.
- `useGameEngine` owns assignment, refresh, and Captain rename state changes.
- Seller helpers and simulation code distinguish normal dealers from Captains
  without changing unrelated economy rules.
- Existing styling and accessible modal conventions are reused. The modal must
  provide a dialog label, keyboard-dismiss behavior, focus return to its opener,
  and readable text equivalents for the crown and star ratings.

## Error handling and invariants

- Assignment is a no-op when the slot is occupied, locked, the candidate is
  missing, or the Captain is already assigned.
- Refresh is a no-op during cooldown and never changes Captain availability.
- A Captain cannot receive dealer arrest/protection mutations.
- Save import rejects malformed seller unions, duplicate IDs, invalid slot
  counts, or assigned seller records that cannot be resolved.
- Renames trim surrounding whitespace and reject empty names, preserving the
  previous name on invalid input.

## Testing

Add or update tests covering:

- normal dealer and Captain assignment into empty slots;
- rejection of assignment into occupied or locked slots;
- Captains remaining unassignable until a reputation slot exists;
- assigned Captains disappearing from the modal candidate list;
- unassigned Captains producing no income;
- one-minute refresh cooldown, persistence across modal close/reopen, and
  Captain-list stability during dealer refresh;
- Captain rename validation and save round-trip persistence;
- save migration for existing dealer-only slot arrays;
- modal rendering of the crown icon, six-star Captain ratings, talent summary,
  refresh state, and accessible hire actions.

The feature does not change Captain recruitment cost, reputation slot pricing,
dealer economics, Captain talent rules, or normal-dealer refresh duration.
