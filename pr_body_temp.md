## Summary

This PR implements the Brmblegotchi companion overlay feature - Phase 1 of bringing interactive companion mechanics to Brmble. The overlay appears as a persistent in-game element displaying the user's Brmblegotchi companion with real-time voice activity, speaker presence, and event feeds.

### Key Features

- **Companion Overlay UI**: Dual-mode overlay system with full companion display and minimal mode for low-visibility scenarios
- **Voice Activity Integration**: Real-time visual feedback from Mumble voice channel state
- **Speaker Stack**: Live display of active speakers with speaker icons and activity indicators
- **Event Feed System**: Event notification system for companion interactions and channel events
- **Bridge Integration**: Full C# ↔ JavaScript bridge for native overlay window communication
- **Settings Integration**: New Interface Settings tab for overlay customization and voice event preferences
- **Overlay Window**: Separate WebView2 overlay window (overlay.html) rendered as topmost window

### Technical Highlights

**Frontend (React + TypeScript)**
- New `CompanionOverlay` component directory with modular architecture
- Overlay model system with state management (minimal/full modes, sprite positioning)
- Speaker stack component for displaying active voice participants
- Event feed for companion notifications
- Hook: `useCompanionOverlayPublisher` for event publishing to companion overlay
- CSS system with overlay-specific styling and animations

**Backend (C# + WebView2)**
- `CompanionOverlayHost` class for managing native overlay window lifecycle
- `CompanionOverlayRelay` for bridging Mumble events to overlay
- Integration with `MumbleAdapter` for voice channel state events
- Overlay window configuration and native interop

**Testing**
- Unit tests for overlay model logic and state transitions
- Component tests for UI behavior (full/minimal modes, speaker stack)
- Relay tests for event bridging between core and overlay
- Voice event integration tests with MumbleAdapter

**Configuration**
- Vite configuration updated for dual-entry-point build (main app + overlay)
- AppSettings extended with companion overlay preferences
- Integration with existing Settings modal

### Architecture Changes

- **New Overlay Window Model**: Separate WebView2 window for overlay rendering (topmost, always-visible)
- **Bridge Extension**: Added overlay-specific message protocols for event publishing
- **Settings Tab Extension**: New "Companion" section in Interface Settings for overlay controls

### Files Changed

**New Files (34)**
- Companion overlay components and tests
- Overlay host and relay services
- Overlay entry point and HTML
- Design specs and implementation plans
- Investigation documentation

**Modified Files (8)**
- Core client program setup
- App settings configuration
- Mumble adapter voice events
- Win32 window interop
- Settings modal and types
- Vite build config

### Testing

All new code includes comprehensive unit and component tests:
- Overlay model state transitions
- Speaker stack display logic
- Event feed rendering
- Bridge relay communication
- Settings integration

Run tests: `dotnet test`

### Breaking Changes

None. This feature is fully backward compatible.

### Notes for Review

1. **Overlay Window Lifecycle**: Review `CompanionOverlayHost.cs` for window creation and cleanup patterns
2. **Bridge Message Protocol**: Overlay uses new `overlay.*` message namespacing (e.g., `overlay.event`, `overlay.error`)
3. **Settings Integration**: New "Companion" settings tab follows existing patterns in `InterfaceSettingsTab.tsx`
4. **Performance**: Overlay uses event-driven updates via bridge to minimize performance impact

### Fase 1 Scope

This initial implementation focuses on:
- Core overlay UI and rendering
- Voice activity visualization
- Settings integration
- Foundation for future companion features (interaction, state persistence, etc.)

Future phases will add interactive mechanics and persistence layers.
