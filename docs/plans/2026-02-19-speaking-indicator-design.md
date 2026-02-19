# Local Speaking Indicator Design

## Overview
Show a mint green glow around users when transmitting voice, visible in both the channel list (ChannelTree) and user panel (UserPanel).

## Visual Style
- Uses existing `--accent-mint` (#50c878) and `--accent-mint-glow` from brmble palette
- Pulsing animation to indicate active transmission
- Consistent with existing self-user styling (mint accent)

## Changes

### 1. Backend Bridge Message
The backend already sends `voice.userSpeaking` with `{ session: number }`. Frontend needs to:
- Listen for `voice.userSpeaking` event
- Track speaking state per user session

### 2. Types (src/Brmble.Web/src/types/index.ts)
- Add `speaking?: boolean` to User interface

### 3. App.tsx
- Add listener for `voice.userSpeaking` 
- Add state to track speaking users (Map<session, boolean>)
- Pass speaking state to ChannelTree and UserPanel

### 4. ChannelTree.tsx
- Accept speaking prop or find self-user's speaking state
- Add `.user-row.speaking` CSS class with mint glow
- Display speaking indicator for both self and remote users

### 5. UserPanel.tsx
- Accept `speaking?: boolean` prop
- Add `.user-avatar.speaking` CSS class with mint glow animation
- Apply to avatar element

### 6. CSS
- Add `.user-row.speaking` in ChannelTree.css
- Add `.user-avatar.speaking` in UserPanel.css
- Use pulsing animation with mint glow

## Implementation Notes
- Speaking state should be tracked per-session
- Both local (self) and remote users show the indicator
- Uses existing brmble design tokens for consistency
