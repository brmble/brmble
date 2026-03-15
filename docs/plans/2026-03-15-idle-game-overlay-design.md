# Idle Game Overlay Design

**Date:** 2026-03-15

## Overview
Add an idle farming game as a floating overlay triggered by clicking the Brmble logo in the header. The game serves as a fun distraction for users while in voice chat.

## Integration
- Copy `GameUI.tsx`, `GameUI.css`, `useGameState.ts`, and `types.ts` from the game into `src/Brmble.Web/src/components/Game/` (new folder)
- Add `showGame` boolean state in App.tsx
- Pass `onClick` handler to BrmbleLogo that toggles `showGame`

## UI Layout
- Floating overlay centered on screen, ~600px wide, auto-height based on content
- Semi-transparent backdrop (click outside to close)
- Close button in top-right corner
- Uses Brmble's theme tokens — remove game's theme files entirely

## Theme Integration
- Replace game CSS variables with Brmble's token variables (`--bg-surface`, `--text-primary`, etc.)
- Game's existing layout (crops grid, upgrade buttons) adapts to Brmble's token system

## Data Flow
- Game state stays in `useGameState` hook (no changes needed)
- Already uses localStorage with its own key (`idle-farm-save`) — won't conflict with Brmble settings
- Auto-save every 30 seconds, persists independently

## Error Handling
- Invalid localStorage data falls back to `INITIAL_STATE` (already implemented)
- No backend required