# Advertisement Selection Modal - Design Spec

## Overview

When clicking "Find New Ad", instead of automatically generating one ad, display a modal with 3 randomly generated ad options. This creates a mini-game feel where players choose the best ad contract.

## UI Specification

### Modal Design

**Trigger:** Click "Find New Ad" button (only enabled after 5-minute cooldown)

**Layout:**
- Centered overlay modal with backdrop blur
- Title: "Choose Your Ad Contract"
- 3 horizontal ad cards in a row
- Cancel button at bottom

**Ad Card Content:**
- Ad type badge (video/banner/popup/sponsored)
- Ad name (adjective + company name)
- Volume stars (1-5)
- Margin stars (1-5)
- Select button

### Modal Structure

```
┌─────────────────────────────────────┐
│        Choose Your Ad Contract       │
├───────────┬───────────┬─────────────┤
│ [VIDEO]   │ [BANNER]  │ [SPONSORED] │
│ Elite     │ Standard  │ Premium     │
│ VidMax    │ WebAd    │ BrandSync   │
│           │           │             │
│ Vol: ★★★☆☆│ Vol: ★★★★☆│ Vol: ★★☆☆☆ │
│ Mar: ★★☆☆☆│ Mar: ★★★★★│ Mar: ★★★★☆ │
│           │           │             │
│  [Select] │  [Select] │  [Select]  │
├───────────┴───────────┴─────────────┤
│              [Cancel]              │
└─────────────────────────────────────┘
```

## Behavior Specification

### Ad Generation

Each ad in the modal is randomly generated with:
- **Type:** Random from ['video', 'banner', 'popup', 'sponsored']
- **Volume:** Random 1-5 stars
- **Margin:** Random 1-5 stars
- **Name:** Adjective + Company (using existing AD_TYPE_NAMES and AD_ADJECTIVES)

### Selection Flow

1. User clicks "Find New Ad"
2. Modal appears with 3 ad options
3. User clicks Select on preferred ad
4. Modal closes
5. Selected ad added to advertisements array
6. If slots full, oldest ad is removed (FIFO)
7. lastAdRefresh timestamp updated

### Cancel Flow

1. User clicks "Find New Ad"
2. Modal appears
3. User clicks Cancel (or clicks outside modal)
4. Modal closes, no changes made
5. lastAdRefresh timestamp NOT updated (can retry immediately)

## Component Changes

### modify: useGameState.ts

- `refreshAdvertisement` action changes to return 3 ads instead of adding one directly
- Rename to `generateAdOptions` - returns array of 3 Advertisement objects
- `selectAd` action - takes an ad, adds to slots (replacing oldest if full)

### modify: types.ts

- `GameActions.refreshAdvertisement` signature changes to return options array
- Add `GameActions.selectAd` action

### modify: GameUI.tsx

- Add `AdSelectionModal` component
- Update HostingTab to show modal when "Find New Ad" clicked
- Show 3 generated options in modal
- Handle selection/cancel

## File Changes

| File | Change |
|------|--------|
| `types.ts` | Update GameActions interface |
| `useGameState.ts` | Modify refreshAdvertisement to generate options, add selectAd |
| `GameUI.tsx` | Add AdSelectionModal component |
| `GameUI.css` | Add modal and ad-card styles |

## CSS Requirements

### Modal Styles
- `.ad-modal-overlay` - backdrop with blur
- `.ad-modal` - centered modal container
- `.ad-modal-header` - title bar
- `.ad-modal-cards` - flex container for cards
- `.ad-card` - individual card styling
- `.ad-card-type` - type badge
- `.ad-card-select` - select button

## Acceptance Criteria

1. Clicking "Find New Ad" shows modal with exactly 3 ads
2. Each ad has random type, volume (1-5), margin (1-5), and name
3. Clicking Select on an ad closes modal and adds ad to slots
4. Clicking Cancel closes modal without changes
5. Clicking outside modal closes without changes
6. When slots full, oldest ad is replaced
7. Cooldown timer still works correctly
