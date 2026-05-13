# Companion Speech Balloon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `Full Companion` overlay render its existing bubble as a speech balloon with a tail that mirrors correctly for left and right overlay positions.

**Architecture:** Keep the current `FullCompanionOverlay` behavior and accessibility contract intact, and make the change in the shared full-overlay rendering path only. Add a stable test hook on the existing bubble element, then use CSS pseudo-elements plus position-aware selectors to render the balloon panel and mirrored tail without introducing companion-specific logic or changing `Minimal` mode.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Testing Library

---

## File Structure

- `src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.tsx`
  Responsibility: render the shared `Full Companion` overlay shell and expose a stable balloon test hook on the existing bubble element.
- `src/Brmble.Web/src/components/CompanionOverlay/CompanionOverlay.css`
  Responsibility: define the full overlay layout, speech-balloon panel styling, and mirrored left/right tail rules.
- `src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.test.tsx`
  Responsibility: verify idle rendering still omits the bubble, and active chat rendering keeps the status role and exposes the shared speech-balloon hook.

### Task 1: Lock The Speech-Balloon Contract With Tests

**Files:**
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('renders the shared speech balloon status for active chat', () => {
  let snapshot = updateFullCompanionContext(createOverlaySnapshot('7', 'Raid'), {
    localMuted: true,
    liveUserSessions: [0],
  });
  snapshot = {
    ...snapshot,
    fullCompanion: {
      ...snapshot.fullCompanion,
      activeDisplay: {
        id: 'chat-1',
        kind: 'chat',
        representedSession: 0,
        representedName: 'You',
        companionId: 'bee',
        row: 4,
        bubble: 'You: hello',
        startedAt: 1_000,
        expiresAt: 6_000,
        isProxy: false,
        badges: {
          muted: true,
          live: true,
        },
      },
    },
  };

  render(<FullCompanionOverlay snapshot={snapshot} position="bottom-left" />);

  const balloon = screen.getByRole('status');

  expect(balloon).toHaveAttribute('data-testid', 'companion-speech-balloon');
  expect(balloon).toHaveTextContent('You: hello');
  expect(screen.getByLabelText('Muted')).toBeInTheDocument();
  expect(screen.getByLabelText('Live')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/components/CompanionOverlay/FullCompanionOverlay.test.tsx`

Expected: FAIL because the rendered bubble does not yet expose `data-testid="companion-speech-balloon"`.

- [ ] **Step 3: Keep the idle no-bubble guard intact**

```tsx
it('renders one idle local companion from atlas row 1 without a bubble', () => {
  const snapshot = resolveFullCompanionDisplay(createOverlaySnapshot('7', 'Raid'), 1_000);

  render(<FullCompanionOverlay snapshot={snapshot} position="bottom-left" />);

  expect(screen.getByTestId('companion-overlay-root')).toHaveClass('companion-overlay--position-bottom-left');
  expect(screen.getAllByTestId('companion-sprite')).toHaveLength(1);
  expect(screen.getByTestId('companion-sprite')).toHaveAttribute('data-row', '1');
  expect(screen.queryByRole('status')).toBeNull();
});
```

- [ ] **Step 4: Run test to verify the suite still fails only on the new balloon assertion**

Run: `npm run test -- src/components/CompanionOverlay/FullCompanionOverlay.test.tsx`

Expected: FAIL on the new balloon test, while the idle test still passes.

- [ ] **Step 5: Commit the red test checkpoint**

```bash
git add src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.test.tsx
git commit -m "test(overlay): pin companion speech balloon contract"
```

### Task 2: Implement The Shared Speech Balloon

**Files:**
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.tsx`
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/CompanionOverlay.css`
- Test: `src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.test.tsx`

- [ ] **Step 1: Add the stable speech-balloon hook to the existing bubble**

```tsx
{display.bubble && (
  <aside
    className="companion-bubble"
    data-testid="companion-speech-balloon"
    role="status"
    aria-live="polite"
  >
    <p>{display.bubble}</p>
  </aside>
)}
```

- [ ] **Step 2: Style the existing bubble as a speech balloon with a mirrored tail**

```css
.companion-bubble {
  position: relative;
  max-width: min(320px, calc(100vw - 96px));
  padding: 10px 14px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 18px;
  background: rgba(20, 24, 31, 0.92);
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.35);
}

.companion-bubble::before,
.companion-bubble::after {
  content: '';
  position: absolute;
  bottom: 12px;
  width: 0;
  height: 0;
  border-style: solid;
}

.companion-bubble::before {
  border-width: 10px 12px 0 0;
  border-color: rgba(255, 255, 255, 0.72) transparent transparent transparent;
}

.companion-bubble::after {
  bottom: 13px;
  border-width: 8px 10px 0 0;
  border-color: rgba(20, 24, 31, 0.92) transparent transparent transparent;
}

.companion-overlay--position-top-left .companion-bubble::before,
.companion-overlay--position-bottom-left .companion-bubble::before {
  left: 22px;
}

.companion-overlay--position-top-left .companion-bubble::after,
.companion-overlay--position-bottom-left .companion-bubble::after {
  left: 23px;
}

.companion-overlay--position-top-right .companion-bubble::before,
.companion-overlay--position-bottom-right .companion-bubble::before {
  right: 22px;
  transform: scaleX(-1);
}

.companion-overlay--position-top-right .companion-bubble::after,
.companion-overlay--position-bottom-right .companion-bubble::after {
  right: 23px;
  transform: scaleX(-1);
}

.companion-bubble p {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.6);
}
```

- [ ] **Step 3: Run the focused test to verify the new contract passes**

Run: `npm run test -- src/components/CompanionOverlay/FullCompanionOverlay.test.tsx`

Expected: PASS. The full companion test file should show the idle case still omits the bubble, and the active chat case should now find `companion-speech-balloon`.

- [ ] **Step 4: Run the companion overlay regression suite**

Run: `npm run test -- src/components/CompanionOverlay`

Expected: PASS. Full, minimal, sprite, and overlay model tests should remain green.

- [ ] **Step 5: Commit the implementation**

```bash
git add src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.tsx src/Brmble.Web/src/components/CompanionOverlay/CompanionOverlay.css src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.test.tsx
git commit -m "feat(overlay): render companion speech balloon"
```
