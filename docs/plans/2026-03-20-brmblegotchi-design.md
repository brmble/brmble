# Brmblegotchi Visual Prototype Design

**Date:** 2026-03-20

## Overview

A floating, Tamagotchi-style virtual pet widget integrated into the Brmble VOIP client. Non-intrusive, visually branded to Brmble, with basic care interactions.

## Layout & Placement

- **Position:** Bottom-right corner by default, draggable
- **Always on top** of main UI (but behind modals)
- **Collapsible:** X button to dismiss widget
- **Persistence:** Dismiss state saved to localStorage; re-enableable via Settings

## Pet Visual

### Brmble-Branded Pet
- Circular avatar area (80x80px) using Brmble ring architecture
- Concentric rings styled with theme accent colors
- Pet state expressed through:
  - **Color shifts:** Healthy = accent-primary; neglected = desaturated
  - **Expression:** Eyes change (happy → neutral → sad)
  - **Animation:** Ring pulse speed reflects mood (excited = faster, sad = slower)

### States
| State | Visual |
|-------|--------|
| Happy | Vibrant accent color, happy eyes, fast pulse |
| Content | Normal color, neutral eyes, normal pulse |
| Sad | Desaturated, sad eyes, slow pulse |
| Sleeping | Eyes closed (when idle for long period) |

## Stats Display

Always visible below pet (thin bars):

| Stat | Icon | Color |
|------|------|-------|
| Hunger | Food icon | accent-primary |
| Happiness | Heart icon | accent-secondary |
| Cleanliness | Droplet icon | accent-decorative |

Bar style: 40px wide, 4px tall, rounded, fills left-to-right

## Action Menu

**Trigger:** Click on pet area

**Style:** Bubble/popup menu, appears above or beside pet

**Actions:**
| Action | Icon | Effect |
|--------|------|--------|
| Feed | Food/apple | Restores hunger |
| Play | Ball/toy | Increases happiness |
| Clean | Droplet | Resets cleanliness |

Menu dismisses on action complete or click outside.

## Controls

- **Dismiss button:** Small X in corner → hides entire widget
- **Drag handle:** Pet area acts as drag handle for repositioning

## Theme Compatibility

All elements use CSS custom property tokens:
- `--accent-primary*` for pet rings and hunger bar
- `--accent-secondary*` for happiness bar
- `--accent-decorative*` for cleanliness bar
- `--bg-surface`, `--glass-border`, `--shadow-*` for widget container
- `--font-body` for any labels

## Out of Scope (for prototype)

- Actual stat decay logic
- Save/load game state
- Sound effects
- Pet progression/aging
- Achievements

## Component Structure

```
BrmblegotchiWidget (container, draggable)
├── PetDisplay (rings + expression)
├── StatsBar x3 (icon + progress bar)
├── ActionMenu (popup, triggered on pet click)
└── DismissButton (X icon)
```

## Implementation Notes

- Pure React + CSS prototype (no game logic)
- Uses existing BrmbleLogo ring animation as base
- Mock stat values for visual demo (random decay simulation)
- CSS transitions for all state changes
