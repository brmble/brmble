# Idle Screenshare Channel Boundary Design

## Goal

Keep screen sharing and watching strictly scoped to the user's current voice channel, including manual channel changes, manual leave-voice, and idle auto-leave.

## Current Behavior

The idle feature combines Brmble app activity, Windows system idle, and lock state. `useIdleActions` sends `voice.leaveVoice` when the user is locked or when both Brmble and Windows idle timers reach 10 minutes. The backend leave-voice toggle moves the user to root channel `0`, mutes/deafens them, and emits `voice.leftVoiceChanged`.

Manual leave-voice and channel switch prompts currently ask whether to stop sharing, but the cancel path still leaves or moves while keeping the local share alive. That conflicts with the desired same-channel restriction for screenshare and watching.

## Desired Behavior

### Same-Channel Restriction

Sharing and watching remain valid only while the user is in the same voice channel as the share. Future invite-to-watch work can intentionally relax this rule, but this design keeps the current channel boundary strict.

### Manual Channel Switch While Sharing

If the user is sharing and tries to move to another voice channel, Brmble shows one prompt:

- Title: `Screen share active`
- Message: `Moving to another channel will end your screen share. Move and stop sharing?`
- Confirm: `Move and Stop Sharing`
- Cancel: `Stay Here`

Confirming stops the local screen share, clears local sharing state, then joins the target channel. Cancelling leaves the user in the current channel and keeps sharing.

### Manual Leave Voice While Sharing

If the user is sharing and presses leave voice, Brmble shows one prompt:

- Title: `Screen share active`
- Message: `Leaving voice will end your screen share. Leave voice and stop sharing?`
- Confirm: `Leave and Stop Sharing`
- Cancel: `Stay Here`

Confirming stops the local screen share, clears local sharing state, then sends `voice.leaveVoice`. Cancelling leaves the user in the current channel and keeps sharing.

### Idle Pre-Leave Notification

At 60 seconds before idle auto-leave, Brmble shows an info notification:

- Title: `Still there?`
- Detail: `You'll leave voice soon due to inactivity.`
- Duration/progress bar: 60 seconds

The notification has no button. Normal activity already means the user is present: mouse movement, click, typing, scroll, and local voice transmit all reset the Brmble idle timer. Windows input resets the system idle timer.

### Idle Warning Cancelled By Activity

If user activity cancels the pending idle leave while the pre-idle notification is visible, Brmble replaces it with a short info notification:

- Title: `Welcome back`
- Detail: `Auto leave cancelled.`
- Duration/progress bar: 5 seconds

This avoids notification flicker and teaches the user that ordinary activity cancelled auto-leave.

### Idle Auto-Leave

If the user remains idle until the threshold, Brmble does not prompt. It stops local sharing, stops watched shares, then sends `voice.leaveVoice`. The post-action notification is:

- Title: `Out of voice`
- Detail: `You were moved out of voice after inactivity. Screen sharing and watched streams were stopped.`

### Root / Left-Voice Safety Net

When the frontend receives `voice.leftVoiceChanged` with `leftVoice: true`, it must stop/disconnect watched shares, stop local sharing if still active, clear share UI state, and select the server/root UI. This catches non-UI root transitions, backend moves, and idle leave.

## Testing Scope

Add focused tests for:

- manual channel switch prompt confirm and cancel behavior while sharing
- manual leave-voice prompt confirm and cancel behavior while sharing
- pre-idle notification threshold, cancellation, and post-idle notification behavior
- idle auto-leave stopping sharing/watching before sending `voice.leaveVoice`
- left-voice safety-net cleanup
