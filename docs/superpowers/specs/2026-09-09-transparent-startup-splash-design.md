# Transparent Startup Splash Design

## Goal

Show only the existing Brmble logo tile and the `Starting Brmble...` label during startup. Remove the dark blue rectangular panel so the desktop is visible around the branded content.

## Presentation

The startup splash remains a native, centered, topmost, non-focus-stealing window. Its visible content is unchanged: the theme-specific Brmble logo asset above the startup label. The surrounding pixels are transparent, so the splash has no visible panel or opaque background. The existing loading pulse, reduced-motion behavior, startup error state, and close behavior remain intact.

The splash window will use a compact content-sized surface rather than retaining a large invisible hit area. The logo and label will remain centered with enough spacing for the label to read clearly, while transparent margins around them will not be visible.

## Implementation

`StartupSplashWindow` will render its content to a 32-bit premultiplied-alpha bitmap and present that bitmap through a layered Win32 window using per-pixel alpha. This avoids color-key halos around anti-aliased logo and text edges. The native startup lifecycle and theme asset lookup stay in the existing class; no WebView or React startup entry changes are required.

The window style will retain `WS_EX_TOPMOST`, `WS_EX_NOACTIVATE`, and `WS_EX_TOOLWINDOW`, adding `WS_EX_LAYERED`. Painting and timer invalidation will update the layered surface without introducing a production delay. Native resources will be released when the splash closes or is disposed.

## Testing and verification

Add a focused native test that verifies the splash uses the layered-window style. Preserve the existing tests for topmost behavior, focus prevention, module-handle resolution, and the preview delay yielding to the message loop.

Run the focused client test suite and Debug build. Manually verify that normal startup shows only the logo tile and `Starting Brmble...` over the desktop, that the loading pulse still works, that reduced motion remains static, and that closing the splash still exits cleanly.

## Scope

This change is limited to the native startup splash presentation. It does not redesign the Brmble logo, alter the main application window, change startup sequencing, or modify the existing web startup screen.
