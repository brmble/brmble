# Vacant Zone Dealer Transfer Design

## Goal

Let players initiate a dealer transfer directly from any vacant, unreserved dealer slot in a zone.

## Interaction

Each vacant zone dealer slot continues to show **Hire dealer** and additionally shows **Transfer dealer**. Selecting transfer opens the existing dealer-transfer modal with that zone and slot already selected as the destination.

## Eligibility and State

The existing transfer rules remain authoritative. The modal offers only active dealers from other zones that are neither arrested nor already travelling. Confirming starts the current two-minute transfer and reserves both the source and selected destination slots.

## Implementation Boundaries

The change is contained in the distribution UI and its component test coverage. It reuses the existing transfer modal and hook action; no transfer-state, save-format, or timing changes are needed.

## Testing

Add a UI test proving that selecting **Transfer dealer** on a vacant Rome-style slot opens the existing transfer modal with that exact destination preselected, while the existing hire action remains present.
