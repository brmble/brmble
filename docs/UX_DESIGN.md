# Brmble UX Design Foundation

This document defines the core user experience (UX) fundamentals, aesthetic guidelines, and theming architecture for Brmble. Any future UI changes, component creations, or agent-driven development should adhere strictly to these principles to maintain consistency and quality.

## 1. Aesthetic Vision: "Brmble Classic"

The default theme of Brmble is **"Brmble Classic"** (internally nicknamed "Vintage Lounge").

- **Vibe:** A dark, moody, glassmorphic UI that feels refined, slightly mysterious, and atmospheric. It should evoke the feeling of stepping into a low-lit, premium cocktail lounge.
- **Backgrounds:** Deep, rich purples (`#0f0a14`, `#1a1025`) rather than flat blacks or grays. We use varying opacities of glassmorphism (e.g., `rgba(26, 16, 37, 0.85)`) over these backgrounds to create spatial depth.
- **Accents:** 
  - **Berry:** (`#d4145a`) The primary action color. Bold, passionate, and slightly dangerous.
  - **Lemon:** (`#f4d03f`) Secondary accent, used for "own" messages or pressed/active states. Provides a sharp, acidic contrast to the dark backgrounds.
  - **Mint:** (`#50c878`) Used sparingly for success or active voice/speaking states.

*Important Note:* Avoid generic "AI-slop" aesthetics like standard blue/purple gradients on dark-gray backgrounds, or over-reliance on system fonts. Brmble must feel *distinctive*.

## 2. Typography

Typography is a primary driver of the Brmble aesthetic. We pair a highly characterful display font with a clean, modern body font.

- **Display (`--font-display`):** *Cormorant Garamond*. Used for headers, avatars, large numbers, and distinct UI labels. It provides elegance and a touch of vintage editorial feel.
- **Body (`--font-body`):** *Outfit*. A geometric sans-serif that remains highly legible at small sizes while retaining modern character. Used for all chat messages, settings, and general UI text.
- **Monospace (`--font-mono`):** *JetBrains Mono*. Used for code blocks, badges, and technical readouts.

## 3. Theming System & CSS Architecture

Brmble uses a strict **Design Token** system driven by CSS Custom Properties (`:root` variables in `index.css`). 

- **NO HARDCODED VALUES:** Hex codes, `rgba()`, and explicit `border-radius` pixels are strictly forbidden in component CSS files.
- **Semantic Mapping:** Colors are mapped to intention (`--text-primary`, `--bg-hover`, `--accent-berry-wash`) rather than literal names in component files.

### Preparing for Multiple Themes
The token system is designed to support future themes (e.g., "Brmble Clean", "Lightmode", "Cyberpunk"). To achieve this:
1. **Never assume a dark background:** Use `--bg-primary` instead of `#1a1025`.
2. **Keep alphas consistent:** When a component needs a subtle highlight, use a token like `--bg-surface-hover` rather than manually mixing `rgba()` in the component. The theme will dictate what a "surface hover" looks like.

## 4. UX Fundamentals & Micro-Interactions

A great interface is tactile. Elements should react predictably and delightfully to user input.

### Hover States
- Interactive elements must have a defined hover state.
- Prefer background lightening (`--bg-hover`, `--bg-surface-hover`) and subtle transforms (`transform: translateY(-2px)`) over harsh border changes.
- Transitions should use `--transition-fast` (150ms) for snappy, responsive feedback.

### Active/Pressed States
- Buttons should feel tactile. Use `transform: scale(0.95)` and swap to an accent color (e.g., Berry to Lemon) to provide clear visual feedback that an action is occurring.

### Accessibility: Focus Visibility
- Keyboard navigation is a first-class citizen. 
- Elements should NOT show focus rings on mouse click (to keep the UI clean), but MUST show clear focus rings on keyboard navigation.
- We rely on `:focus-visible` globally. The standard Brmble focus ring is a dual-ring box-shadow (2px background color, 4px accent berry) to ensure contrast against any background.

### Motion
- **Page Loads:** Use staggered, slide-in animations (e.g., sidebar loading 100ms before main content) to make the app feel alive upon opening.
- **Modals/Dialogs:** Should fade in and slide up slightly (`translateY`) using `--transition-normal` (250ms).

## 5. Spatial Composition

- **Padding/Margin:** Rely on `0.5rem`, `0.75rem`, `1rem`, and `1.5rem` steps.
- **Border Radius:** Use the defined scale (`--radius-xs` to `--radius-xl`). Avoid completely sharp corners in "Brmble Classic", but do not overuse `--radius-full` outside of avatars and specific badges.
- **Negative Space:** Allow content to breathe. The "Classic" theme relies on dark negative space to draw the eye to the bright, saturated accents.
## 6. Pending Refinements (TODOs)

The following aesthetic improvements are scheduled to be implemented to fully realize the "Brmble Classic" vision:

- **[TODO] Custom Cursors:**
  Implement a custom CSS cursor (e.g., a subtle berry-colored dot or a stylized pointer) that reacts to hover states (`:hover`, `:active`). This aligns with the guidelines for art-directed details, giving the app an immediate tactile and distinctive feel.
