# Standardizing Motion, Micro-Interactions, and Visual Feedback

## Goal
Address the remaining points from our CSS gap analysis: Point 3 (Animation/Motion Inconsistencies) and Point 5 (Micro-interactions & Visual Feedback). This involves creating a standardized set of animation keyframes/classes and ensuring consistent hover, focus, and transition states across the entire application.

## Problem Statement

### Point 3: Animation/Motion Inconsistencies
Currently, animations are scattered and duplicated across different CSS files.
- `slideUp` is defined in `index.css` but also redefined in local component CSS.
- Dialog and modal entry animations have different timings and easing curves (e.g., `card-slide-in` vs `slideUp`).
- Overlays have different fade-in timings.

### Point 5: Micro-interactions & Visual Feedback
Interactive elements need consistent feedback.
- `focus-visible` states are not uniformly applied.
- Transition timings (fast, normal, slow) are sometimes hardcoded instead of using variables.
- We need a standardized custom CSS toggle switch to replace default browser checkboxes.

## Proposed Solution

1.  **Consolidate Keyframes in `index.css`:**
    *   Define a standard set of keyframes:
        *   `fadeIn` (opacity 0 -> 1)
        *   `slideUp` (opacity + Y translation)
        *   `slideDown` (opacity + Y translation downwards)
        *   `popIn` (scale 0.95 -> 1 + opacity)
    *   Remove all locally defined keyframes (`card-slide-in`, `content-fade-in`, `shortcut-card-slide-in`, etc.) from component CSS files.

2.  **Create Standard Animation Utility Classes:**
    *   `.animate-fade-in`
    *   `.animate-slide-up`
    *   `.animate-pop-in`
    *   Apply these classes to components (modals, dialogs, dropdowns) instead of writing custom animation CSS blocks.

3.  **Standardize Transitions:**
    *   Ensure all hover/focus/active states use the global transition variables defined in `index.css`:
        *   `var(--transition-fast)` (150ms)
        *   `var(--transition-normal)` (250ms)
        *   `var(--transition-slow)` (400ms)
    *   Search and replace hardcoded `transition: all 0.2s`, `transition: 0.15s`, etc.

4.  **Enhance Focus States:**
    *   Verify `.brmble-input`, `.btn`, and other interactive elements have clear, consistent `:focus-visible` styles utilizing `var(--accent-berry-glow)` or similar variables.

5.  **Build a Global Custom Toggle Switch:**
    *   Extract the toggle switch CSS currently residing in `SettingsModal.css` (or wherever it was originally defined).
    *   Move it to `index.css` as a global `.brmble-toggle` class.
    *   Refactor components using checkboxes for settings to use this global toggle switch structure.

## Implementation Steps

1.  **Update `index.css`:** Add keyframes and animation utility classes. Add `.brmble-toggle` styles.
2.  **Audit Modals/Dialogs:** Replace local animations with global animation utility classes in `ConnectModal`, `SettingsModal`, `CloseDialog`, `UserInfoDialog`, etc.
3.  **Audit Transitions:** Use `grep` to find hardcoded `transition: ...` values in `*.css` and replace them with `var(--transition-fast)` or `var(--transition-normal)`.
4.  **Refactor Toggles:** Update `InterfaceSettingsTab` and `AudioSettingsTab` to use the new `.brmble-toggle` class.

