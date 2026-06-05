# LiveKit & Screen Sharing Feature Roadmap

**Date:** 2026-04-17
**Status:** Active roadmap. Foundation, recent follow-up fixes, E. Token & Security, and F1/F2 reliability work are implemented; remaining F work is future reliability hardening.

This is the master feature list for LiveKit and screen sharing work. Completed sub-projects and shipped follow-up fixes are tracked here, while future work should continue through design -> plan -> implementation cycles.

## Sub-Projects

| ID | Name | Status | Spec |
|----|------|--------|------|
| A | Multi-Share Foundation | Implemented | `2026-04-17-multi-share-foundation-design.md` |
| A2 | Multi-Share Layouts | Implemented | `2026-04-20-multi-share-layouts-design.md` |
| B | Broadcaster Controls | Not started | -- |
| C | Viewing Experience | Not started | -- |
| D | Game Overlay | Not started | -- |
| E | Token & Security | Implemented | `2026-04-30-livekit-token-security-phase-design.md`, `2026-05-11-livekit-token-refresh-revocation-design.md` |
| F | Connection & Reliability | F1/F2 implemented; future hardening pending | `2026-05-15-livekit-connection-reliability-f2-design.md` |
| G | UI/UX Polish | Not started | -- |
| H | Clips & Screenshots | Not started | -- |
| I | Performance & Quality | Not started | -- |
| J | Viewer Interaction | Not started | -- |

## A. Multi-Share Foundation (Implemented)

> Multiple people sharing at once -- infrastructure that many other features depend on.

1. Simultaneous shares in the same channel
2. Share switcher via channel user list monitor icons (clickable)
3. ~~Grid/mosaic view~~ -> moved to A2 (implemented)
4. ~~Primary + thumbnail layout~~ -> moved to A2 (implemented)
5. Auto-switch on activity (optional) -- future
6. ~~Share pinning~~ -> deferred (not in A2 scope)

**Current shipped behavior:** one LiveKit room per channel, lazy room creation, one share per user, manual opt-in viewing, and multi-view layouts for up to four watched shares.

**Recent shipped follow-up fixes:**
- self-slot/sidebar cleanup (`2026-04-21-screenshare-self-slot-design.md`)
- auto-stop when capture ends externally (`2026-04-25-screen-share-auto-stop-design.md`)
- picker-cancel handling without false error state (`2026-04-25-screen-share-picker-cancel-design.md`)

See full spec: `2026-04-17-multi-share-foundation-design.md`

## B. Broadcaster Controls

> What the person sharing can do.

7. Window picker (specific window, not just full screen)
   - Active slice: preferred capture source setting defaults to Window and passes a LiveKit/browser capture hint while keeping the native picker user-controlled.
   - Deferred follow-up: suggest the current game window when starting share, using native foreground-window detection and later overlay/in-game context. The picker cannot be preselected programmatically, so this should remain a suggestion rather than automatic selection.
8. Application/system audio capture
   - Active slice: screen-share audio defaults to enabled with system audio opt-in; viewers attach LiveKit screen-share audio tracks when present.
9. Region capture (share a rectangle)
10. Share the Brmble window itself (quick-share)
11. Auto-stop on lock/sleep
12. Quality presets (presentation mode vs. gaming mode)
13. Multi-monitor support (choose which monitor)
14. Webcam overlay (small camera feed in corner)

## C. Viewing Experience

> How viewers consume a share.

15. Pop-out window (detached native OS window via WebView2)
16. Picture-in-Picture (floating mini-player, browser PiP API)
17. Fullscreen polish (auto-hiding controls)
18. Fit-to-window vs. original size toggle
19. Low-bandwidth viewer mode (request lower quality via simulcast/dynacast)
20. Viewer count overlay on the stream

**Deferred:** Screen-share audio mute/volume controls for viewers -- basic playback is implemented, but per-share viewer audio controls are not yet designed.

**Deferred:** Zoom & pan -- cut for now.

## D. Game Overlay

> Transparent always-on-top window over games/apps (Discord-style overlay).

21. Native transparent overlay window (C# WebView2 popup, always-on-top, click-through)
22. Voice activity indicators (who's talking, with avatars/names)
23. Active screen share indicators (who's sharing, quick-watch button)
24. PiP viewer inside the overlay (watch someone's share while gaming)
25. Overlay position/size customization (corner, edge, draggable)
26. Overlay toggle hotkey (show/hide)
27. Overlay opacity/transparency settings

**Note:** This is a major new feature area. The overlay is a separate native window rendered by the C# client, containing a dedicated WebView2 instance with its own overlay-specific UI. It needs to be click-through for game input, with hotkey-activated interaction mode.

## E. Token & Security

> Hardening the LiveKit auth layer.

28. Token scoping (publish vs. subscribe-only tokens for viewers) -- implemented in E1
29. Token rotation (auto-refresh before expiry without interrupting stream) -- implemented in E2
30. Token revocation (server-side, tied to channel kick via RemoveParticipant) -- implemented in E2
31. Auth on `/livekit/active-share` endpoint (issue #349) -- implemented in E1
32. Rate limiting on LiveKit endpoints (issue #351) -- implemented in E2 for token and active-share endpoints
33. Room-level permissions tied to channel permissions

**Implemented E-pass behavior:** authenticated active-share discovery, explicit publish/subscribe token access modes, server-side channel permission checks for token issuance, 1-hour token expiry metadata, targeted LiveKit endpoint rate limiting, duplicate share-start suppression, idle/leave-voice screenshare cleanup, client token refresh before expiry, active LiveKit participant tracking, participant-scoped early revocation on observed voice lifecycle changes, and retrying participant removal to cover join-after-revoke timing windows.

**E completion note:** Issue `#354` is addressed by the current E2 work and is ready to close after PR review. Fine-grained permission-loss events beyond the current Mumble disconnect/move lifecycle remain reusable future hardening if the Mumble integration exposes additional ACL event sources, but they are not blocking for the E phase.

**Deferred:** Share passwords -- not needed, channel membership is the access boundary.

## F. Connection & Reliability

> Making it robust.

- [x] 34. Auto-reconnect on drop -- implemented for Brmble server/session and Matrix reconnect after Brmble services restarts; LiveKit rooms intentionally clear and require manual restart/watch.
- [ ] 35. ICE fallback / TURN relay hardening -- future work.
- [x] 36. Connection quality indicator -- implemented for LiveKit screen-share UI through room/share quality state, sidebar tooltip text, and watched-tile quality badges.
- [x] 37. Graceful degradation -- implemented as informational reconnecting/poor-quality UI that preserves watched tiles during transient LiveKit reconnects.
- [x] 38. Disconnect notification when share ends unexpectedly -- implemented through Brmble notifications for watched/local share interruption.
- [x] 39. Reconnect non-voice services independently when Mumble stays connected -- implemented for Brmble server/session, Matrix chat, and screen-share support state.
- [x] 40. Share state recovery after crash -- completed by intentionally clearing stale LiveKit state; users restart sharing/watching manually after crash or terminal service loss.

## G. UI/UX Polish

> Making it feel great.

41. Disable share button while connecting (issue #359) -- partially implemented for duplicate in-flight share starts; broader UI disabled-state polish remains future
42. Share preview thumbnail in sidebar
43. Animated share indicator in channel tree
44. Drag-to-resize viewer
45. Full keyboard shortcuts (toggle share, switch between shares, fullscreen, PiP)
46. Context menu: "Watch screen", "Stop sharing", "Invite to watch" (issue #412; kept here as a UI/context-menu action rather than a separate Viewer Interaction item)
47. Share notification sounds
48. Viewer list (who's watching your stream -- no kick from LiveKit, channel kick handles that)

**Deferred:** Settings live preview before going live -- window picker is sufficient for now.

## H. Clips & Screenshots

> Capture moments from streams.

49. Screenshot current frame (one-click)
50. Local recording (broadcaster side)
51. Viewer-side recording
52. Short clip capture (last 30-60s buffer)
53. Auto-post clip/screenshot to chat channel
54. Recording indicator visible to all viewers

**Deferred:** Server-side recording (LiveKit Egress) -- not needed for now.

**Future idea:** The deferred "bookmarks" concept could evolve into a "clips" feature where users share short video highlights in chat channels.

## I. Performance & Quality

> Encoding and streaming optimization.

55. Simulcast (multiple quality layers, viewers auto-select)
56. Dynacast (encode only layers that active viewers need)
57. Hardware encoding (NVENC/QuickSync/VCE for lower CPU usage)
58. Adaptive FPS (drop FPS before dropping resolution under load)
59. Codec selection (VP9/AV1 for screen content with text/UI, H.264 for motion)
60. CPU/GPU usage monitoring for broadcaster

## J. Viewer Interaction

> Social features on streams.

61. Remote cursor display (show sharer's cursor position to viewers)
62. Reaction overlays (emoji reactions floating on stream)

**Deferred:** Viewer cursor / laser pointer, remote control, bookmarks.

## K. Explicitly Deferred (Future / Maybe)

These items were discussed and explicitly parked:

- Pause/resume (broadcaster and viewer) -- always live for now
- Drawing/annotation overlay on shared screen
- Viewer cursor / laser pointer
- Remote control (OS-level input injection)
- Bookmarks (may evolve into clips feature in H)
- Share passwords (channel membership is sufficient)
- Co-browsing mode (shared pointer space)
- Mobile viewer (deferred to mobile app phase)
- Stream to external services like Twitch/YouTube (LiveKit Egress)
- Scheduled shares ("I'll be sharing at 3pm")
- Whiteboard mode (collaborative canvas)
- Zoom & pan on shared screen
- Settings live preview before going live

## Next-Phase Issue Shortlist

Remaining F priority work is future reliability hardening:

- ICE/TURN relay hardening
- production TURN/relay deployment decisions

Implemented by the current E-pass:

- `#349` `[SECURITY] /livekit/active-share endpoint has no authentication`
- `#351` `[SECURITY] No rate limiting on any endpoint` for LiveKit token/active-share paths
- `#354` `[SECURITY] LiveKit tokens have no early revocation`
- `#359` `Disable Screenshare button and keybinding while LiveKit is connecting` for duplicate in-flight share starts

Known phase-F roadmap gaps with no dedicated issue yet:

- ICE/TURN relay hardening

## Suggested Build Order

The recommended next sequence is:

1. **A. Multi-Share Foundation** -- implemented
2. **A2. Multi-Share Layouts** -- implemented
3. **E. Token & Security** -- implemented
4. **F. Connection & Reliability** -- F1/F2 implemented; remaining priority is future ICE/TURN relay hardening
5. **C. Viewing Experience** -- pop-out, PiP, fullscreen (needed before overlay)
6. **B. Broadcaster Controls** -- window picker, audio, quality presets
7. **D. Game Overlay** -- depends on C (PiP/pop-out patterns) and voice system
8. **G. UI/UX Polish** -- refinements across all features
9. **I. Performance & Quality** -- optimization pass
10. **H. Clips & Screenshots** -- capture features
11. **J. Viewer Interaction** -- social features last
