# Spectator Entry And Per-Turn Detail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make spectating reachable in one click from the channel row, show each player's most recent action on their own card, and give spectators the RPS reveal beat.

**Architecture:** Three independent slices. The server gains one derived field (`LastRollBy`) with no new engine state. The client gains a shared `rpsShared.ts` module (so the reveal constant and pick icons are not duplicated), per-player action rendering on both spectator boards, a ported reveal gate that also holds the new icons, and an `eye` toggle on the channel row threaded App → Sidebar → ChannelTree.

**Tech Stack:** ASP.NET Core, MSTest + Moq (server tests); React 19 + TypeScript + Vite, Vitest + @testing-library/react (client tests).

**Spec:** `docs/superpowers/specs/2026-08-25-spectator-entry-and-per-turn-detail-design.md` — approved. Read it before Task 1.

**Branch:** `feature/spectator-entry-and-detail`, stacked on `feature/game-spectating`. Do not commit to `main`. Do not push or open a PR without asking.

---

## Global Constraints

- **No hardcoded visual values** in any CSS or UI code — no colours, font sizes, font families, spacing, radii, shadows or transition durations. Tokens only. Read `docs/UI_GUIDE.md` before any UI task; see `src/Brmble.Web/src/themes/_template.css` for the token set.
- **One deliberate exception, per the guide:** *component-specific dimensions* (icon, avatar and button sizes) that do not map to a spacing token use a **local CSS custom property with a literal**, e.g. `--duel-badge-size: 32px`. That is the sanctioned pattern (UI_GUIDE §12 rule 3, and `.channel-duel-icon` in `ChannelTree.css:124-139`), **not** a violation. Never substitute a spacing token for an element dimension.
- **`opacity` is not a banned value.** `.btn:disabled` uses a literal `opacity: 0.5`; match that precedent rather than inventing a token.
- **`DuelQueueModal` and its Watch button are unchanged by this project.** The row toggle is an additional entry point, not a replacement.
- **The RPS privacy boundary must not regress.** Picks render **only** from `view.lastRound`, never from `view.committed`. `RpsSpectatorView` carries no field capable of expressing an unresolved pick, and that must stay true.
- **Latest action only.** No history, no accumulating strips, no round logs on any spectator board. `game.feed` remains the record.
- **No turn countdown for spectators.** The reveal beat is a different device.
- **Spectating stays same-channel only**, gated by the canonical `activityChannelMatchesPresence`.
- **Spectating never sets `MainPanelMode = 'game'`.** Do not touch `selectMainPanelMode` or its inputs.
- Player ids in spectator views are Mumble **session** ids. Resolve names via `players.find(p => p.sessionId === id)`.
- Server tests are **MSTest** (`[TestClass]` / `[TestMethod]` / `Assert.*` / `CollectionAssert.*`) with Moq, not xUnit.
- Wire JSON is camelCased by `BrmbleEventBus.JsonOptions`; C# records stay PascalCase.
- **Shell is Windows PowerShell 5.1.** `&&` does not work — use `;`. Use `Push-Location`/`Pop-Location`, not chained `cd`.
- **Never use `Get-Content | Set-Content`** — in PS 5.1 it decodes BOM-less UTF-8 as CP1252 and silently mojibakes emoji and em dashes while tests stay green. Read `git diff` before every commit.

---

## Verified Reference Map

Verified against the working tree at `ecb04c8a`. Re-verify by reading before editing if an earlier task shifted a file.

| Thing | Location |
|---|---|
| `DeathrollEngine.State` (`Players`, `CurrentIndex`, `LastRoll`, `LoserId`) | `src/Brmble.Server/Games/Engines/DeathrollEngine.cs:22-32` |
| `DeathrollEngine.DoRoll` (sets `LastRoll`, flips `CurrentIndex` only on a non-fatal roll) | `DeathrollEngine.cs:98-121` |
| `DeathrollEngine.ApplyTimeoutPenalty` (fatal sets `LastRoll = 1` + `LoserId`; non-fatal touches neither) | `DeathrollEngine.cs:82-96` |
| `DeathrollEngine.SpectatorView` | `DeathrollEngine.cs:151-165` |
| `DeathrollSpectatorView` record | `src/Brmble.Server/Games/Spectators/SpectatorViews.cs` |
| `SpectatorViewTests` | `tests/Brmble.Server.Tests/Games/SpectatorViewTests.cs` |
| `PICKS` (id → label → `IconName`) | `src/Brmble.Web/src/components/Games/RpsBoard.tsx:25-29` |
| `REVEAL_SECONDS = 3` (module-local, **not** exported) | `RpsBoard.tsx:32` |
| Reveal gate (two `useEffect`s, `display`/`pendingRef`/`shownSeqRef`) | `RpsBoard.tsx:56-102` |
| `RpsSpectatorBoard` | `src/Brmble.Web/src/components/Games/RpsSpectatorBoard.tsx` (player card `:57-65`) |
| `DeathrollSpectatorBoard` | `src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.tsx` (player card `:34-42`, stats `:46-55`) |
| `DeathrollSpectatorView` / `RpsResolvedRound` TS types | `src/Brmble.Web/src/api/games.ts` |
| Duel badge on the channel row (the pattern to sit beside) | `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx:414-428` |
| Screen-share watch toggle (the pattern to copy) | `ChannelTree.tsx:485-500` |
| `.channel-duel-icon` / `.active` | `src/Brmble.Web/src/components/Sidebar/ChannelTree.css:124`, `:142` |
| `ChannelTree` props + destructure | `ChannelTree.tsx:71-77`, `:109` |
| `Sidebar` duel props passthrough | `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx:50`, `:92`, `:462-465` |
| `App` → `Sidebar` duel props | `src/Brmble.Web/src/App.tsx:5384-5387` |
| `handleWatchDuel` | `App.tsx:5042-5060` |
| `activityChannelMatchesPresence` | `src/Brmble.Web/src/workspace/activityPresence.ts` |
| `duelChannelIds` (active ∪ readyCheck ∪ queue) | `App.tsx:1137-1141` |
| `spectator` hook instance | `App.tsx:1093` |

---

## File Structure

### Created

| File | Responsibility |
|---|---|
| `src/Brmble.Web/src/components/Games/rpsShared.ts` | `REVEAL_SECONDS` and the pick→icon/label map, shared by the participant and spectator RPS boards |

### Modified

Server: `Games/Spectators/SpectatorViews.cs`, `Games/Engines/DeathrollEngine.cs`.
Client: `api/games.ts`, `components/Games/RpsBoard.tsx`, `RpsSpectatorBoard.tsx` + `.module.css`, `DeathrollSpectatorBoard.tsx` + `.module.css`, `components/Sidebar/ChannelTree.tsx` + `.css`, `components/Sidebar/Sidebar.tsx`, `App.tsx`.
Docs: `docs/UI_GUIDE.md`.

---

## Task Order

| # | Task | Gate |
|---|---|---|
| 1 | `LastRollBy` on the Deathroll spectator view | Server |
| 2 | Extract `rpsShared.ts` (`REVEAL_SECONDS` + picks) | Must precede Tasks 4 and 5 |
| 3 | Deathroll: roll number on the player card | Boards |
| 4 | RPS: pick icon on the player card | Boards |
| 5 | RPS: reveal gate for spectators (holds the icons) | Must follow Tasks 2 and 4 |
| 6 | Channel-row `eye` toggle in `ChannelTree` | Entry point |
| 7 | Thread through `Sidebar` + `App`, integration tests | Entry point |
| 8 | `docs/UI_GUIDE.md` | Docs |

---

### Task 1: `LastRollBy` on the Deathroll spectator view

**Files:**
- Modify: `src/Brmble.Server/Games/Spectators/SpectatorViews.cs`
- Modify: `src/Brmble.Server/Games/Engines/DeathrollEngine.cs` (`SpectatorView`, `:151-165`)
- Test: `tests/Brmble.Server.Tests/Games/SpectatorViewTests.cs` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `DeathrollSpectatorView` gains a final positional member `long? LastRollBy`. Task 3 consumes it as `lastRollBy` on the wire.

**Why derivation works (do not add engine state):** `DoRoll` sets `LastRoll` and flips `CurrentIndex` **only** when the roll is non-fatal (`DeathrollEngine.cs:110-119`); on a fatal roll it sets `LoserId` to the roller and leaves `CurrentIndex` alone. `ApplyTimeoutPenalty` either sets `LastRoll = 1` **and** `LoserId` (fatal, `:89-91`) or touches neither `LastRoll` nor `CurrentIndex` (non-fatal, `:94-95`). So the owner of `LastRoll` is `LoserId` when set, and otherwise the player `CurrentIndex` has flipped away from. Deathroll is always exactly 2 players (`InitialState` throws otherwise, `:44`), so `^ 1` is safe and matches the existing `CurrentIndex ^= 1`.

- [ ] **Step 1: Write the failing tests**

Append to `SpectatorViewTests`:

```csharp
    [TestMethod]
    public void DeathrollSpectatorView_BeforeAnyRoll_HasNoLastRollBy()
    {
        var engine = new DeathrollEngine();
        var state = engine.InitialState([new GamePlayer(10), new GamePlayer(20)], new FixedRandom(50));

        var view = (DeathrollSpectatorView)engine.SpectatorView(state);

        Assert.IsNull(view.LastRoll);
        Assert.IsNull(view.LastRollBy, "Nobody has rolled yet.");
    }

    [TestMethod]
    public void DeathrollSpectatorView_AttributesANonFatalRollToTheRoller()
    {
        var engine = new DeathrollEngine();
        var state = engine.InitialState([new GamePlayer(10), new GamePlayer(20)], new FixedRandom(50));
        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["roll"] = true }, new FixedRandom(50));

        var view = (DeathrollSpectatorView)engine.SpectatorView(state);

        Assert.AreEqual(50, view.LastRoll);
        Assert.AreEqual(10L, view.LastRollBy, "Player 10 rolled, even though it is now player 20's turn.");
        Assert.AreEqual(20L, view.CurrentPlayer);
    }

    [TestMethod]
    public void DeathrollSpectatorView_AttributesTheFatalRollToTheLoser()
    {
        var engine = new DeathrollEngine();
        var state = engine.InitialState([new GamePlayer(10), new GamePlayer(20)], new FixedRandom(50));
        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["roll"] = true }, new FixedRandom(50));
        // Player 20 rolls a 1 and loses. CurrentIndex is NOT flipped on a fatal roll.
        engine.ApplyAction(state, 20, new Dictionary<string, object?> { ["roll"] = true }, new FixedRandom(1));

        var view = (DeathrollSpectatorView)engine.SpectatorView(state);

        Assert.AreEqual(1, view.LastRoll);
        Assert.AreEqual(20L, view.LoserId);
        Assert.AreEqual(20L, view.LastRollBy, "The losing roll belongs to the loser.");
        Assert.IsNull(view.CurrentPlayer, "The match is over, so nobody is to move.");
    }

    [TestMethod]
    public void DeathrollSpectatorView_ANonFatalTimeoutLeavesTheRollWithItsOriginalRoller()
    {
        var engine = new DeathrollEngine();
        var state = engine.InitialState([new GamePlayer(10), new GamePlayer(20)], new FixedRandom(50));
        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["roll"] = true }, new FixedRandom(50));
        // Player 20 times out. The ceiling drops; LastRoll and CurrentIndex are untouched.
        engine.ApplyTimeoutPenalty(state, new FixedRandom(50));

        var view = (DeathrollSpectatorView)engine.SpectatorView(state);

        Assert.AreEqual(50, view.LastRoll);
        Assert.AreEqual(10L, view.LastRollBy, "A timeout by player 20 does not transfer player 10's roll.");
    }
```

> `ApplyTimeoutPenalty(object state, IRandomSource rng)` is the real timeout entry point — verified on `IGameEngine.cs:54` and `DeathrollEngine.cs:81`. It is the established name across the whole engine surface (`RpsEngine`, `GameSessionManager`). `FixedRandom` is the existing helper at the bottom of this test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter SpectatorViewTests`
Expected: **compile error** — `DeathrollSpectatorView` has no `LastRollBy`.

- [ ] **Step 3: Add the record member**

In `src/Brmble.Server/Games/Spectators/SpectatorViews.cs`, add a final positional member to `DeathrollSpectatorView`:

```csharp
    /// <summary>
    /// Who made <see cref="LastRoll"/>, as a Mumble SESSION id. Null before the first
    /// roll. Derived, never stored: the engine holds no per-roll attribution, and this
    /// project deliberately did not add any.
    /// </summary>
    long? LastRollBy);
```

Keep it last so every existing positional construction stays valid until updated.

- [ ] **Step 4: Derive it in the engine**

In `DeathrollEngine.SpectatorView`, after `LoserId: s.LoserId`:

```csharp
            LoserId: s.LoserId,
            // Derived, not stored. DoRoll flips CurrentIndex only on a NON-fatal roll,
            // and a non-fatal timeout penalty touches neither LastRoll nor CurrentIndex —
            // so the owner of LastRoll is LoserId once set, and otherwise the player
            // CurrentIndex has just flipped away from. Deathroll is always 2 players.
            LastRollBy: s.LastRoll is null ? null : s.LoserId ?? s.Players[s.CurrentIndex ^ 1]);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter SpectatorViewTests`
Expected: all PASS.
Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`
Expected: all PASS. Any other construction of `DeathrollSpectatorView` (there is one in `SpectatorServiceTests` and one in `GameEndpointsTests`) will need the new argument — add `null` unless the test is about attribution.
Run: `dotnet build` — clean.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Server/Games/Spectators/SpectatorViews.cs src/Brmble.Server/Games/Engines/DeathrollEngine.cs tests/Brmble.Server.Tests/Games/SpectatorViewTests.cs
git commit -m "feat(games): attribute the Deathroll spectator last roll to its roller"
```

---

### Task 2: Extract `rpsShared.ts`

**Files:**
- Create: `src/Brmble.Web/src/components/Games/rpsShared.ts`
- Modify: `src/Brmble.Web/src/components/Games/RpsBoard.tsx` (`:25-32`)

**Interfaces:**
- Produces: `export const REVEAL_SECONDS: number`, `export interface RpsPick { id: string; label: string; icon: IconName }`, `export const PICKS: RpsPick[]`, `export function pickIcon(pick: string): IconName | null`, `export function pickLabel(pick: string): string`. Tasks 4 and 5 consume these.

**Why:** `REVEAL_SECONDS` exists to keep the participant and spectator surfaces in sync; a copied constant could drift silently and no test would notice. `PICKS` would be the second verbatim duplication between these boards, which a whole-branch review already flagged as an emerging pattern. **This task is a pure move — no behaviour changes.**

- [ ] **Step 1: Create the shared module**

Create `src/Brmble.Web/src/components/Games/rpsShared.ts`:

```ts
import type { IconName } from '../Icon/Icon';

/**
 * Seconds of anticipation before a resolved round is revealed.
 *
 * Shared deliberately: the participant board and the spectator board must run the
 * same beat, so a watcher sitting beside a player sees the result at the same moment.
 * Two copies could drift and nothing would catch it — import this, never redeclare it.
 */
export const REVEAL_SECONDS = 3;

export interface RpsPick {
  id: string;
  label: string;
  icon: IconName;
}

/** The three throws, in board order. */
export const PICKS: RpsPick[] = [
  { id: 'rock', label: 'Rock', icon: 'rps-rock' },
  { id: 'paper', label: 'Paper', icon: 'rps-paper' },
  { id: 'scissors', label: 'Scissors', icon: 'rps-scissors' },
];

/**
 * Icon for a throw, or null when there is nothing to show. `none` is a real wire
 * value — the engine emits it for a player who never threw (idle timeout or
 * forfeit) — and it deliberately has no icon rather than a fabricated one.
 */
export function pickIcon(pick: string): IconName | null {
  return PICKS.find(p => p.id === pick)?.icon ?? null;
}

/** Human label for a throw. `none` reads as "No throw". */
export function pickLabel(pick: string): string {
  return PICKS.find(p => p.id === pick)?.label ?? 'No throw';
}
```

> Verify `IconName` is exported from `components/Icon/Icon` and adjust the import path if not.

- [ ] **Step 2: Point the participant board at it**

In `RpsBoard.tsx`, delete the local `PICKS` array, the local `REVEAL_SECONDS` and the local `pickLabel` function, and import instead:

```tsx
import { PICKS, REVEAL_SECONDS, pickLabel } from './rpsShared';
```

**Behaviour must not change.** Note the local `pickLabel` returned `'None'` for `none`; the shared one returns `'No throw'`. If any existing `RpsBoard` test asserts `'None'`, that is a real copy change — **stop and report it** rather than editing the test. If nothing asserts it, adopt `'No throw'` and note the change in your report.

- [ ] **Step 3: Verify nothing moved**

Run: `cd src/Brmble.Web; npm run type-check` — clean.
Run: `cd src/Brmble.Web; npm run test` — full suite, **pass count unchanged**. A changed count means you changed behaviour.

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/Games/rpsShared.ts src/Brmble.Web/src/components/Games/RpsBoard.tsx
git commit -m "refactor(games): share the RPS reveal constant and pick map between boards"
```

---

### Task 3: Deathroll — roll number on the player card

**Files:**
- Modify: `src/Brmble.Web/src/api/games.ts` (`DeathrollSpectatorView`)
- Modify: `src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.tsx` (`:34-42`)
- Modify: `src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.module.css`
- Test: `src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.test.tsx` (append)

**Interfaces:**
- Consumes: `lastRollBy` from Task 1.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing tests**

Append to `DeathrollSpectatorBoard.test.tsx`:

```tsx
  it("shows the roll on its roller's card, not the player to move", () => {
    render(
      <DeathrollSpectatorBoard
        view={{ ...live, lastRoll: 73, lastRollBy: 10, currentPlayer: 20 }}
        players={players}
        outcome={null}
      />,
    );
    expect(screen.getByTestId('spectator-roll-10')).toHaveTextContent('73');
    expect(screen.queryByTestId('spectator-roll-20')).not.toBeInTheDocument();
  });

  it('shows no roll on any card before the first roll', () => {
    render(
      <DeathrollSpectatorBoard
        view={{ ...live, lastRoll: null, lastRollBy: null }}
        players={players}
        outcome={null}
      />,
    );
    expect(screen.queryByTestId('spectator-roll-10')).not.toBeInTheDocument();
    expect(screen.queryByTestId('spectator-roll-20')).not.toBeInTheDocument();
  });

  it("keeps the losing roll on the loser's card after the match ends", () => {
    render(
      <DeathrollSpectatorBoard
        view={{ ...live, lastRoll: 1, lastRollBy: 20, currentPlayer: null, finished: true, loserId: 20 }}
        players={players}
        outcome={{ winnerId: 10, loserId: 20, draw: false }}
      />,
    );
    expect(screen.getByTestId('spectator-roll-20')).toHaveTextContent('1');
  });
```

> The existing `live` fixture at the top of this file needs `lastRollBy` added to keep the file type-checking. Give it `lastRollBy: null` so existing tests keep their current meaning.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/Brmble.Web; npm run test -- DeathrollSpectatorBoard`
Expected: FAIL — `lastRollBy` is not a known property, then no `spectator-roll-*` element.

- [ ] **Step 3: Add the wire type**

In `src/Brmble.Web/src/api/games.ts`, add to `DeathrollSpectatorView` after `lastRoll`:

```ts
  /**
   * Who made `lastRoll`, as a Mumble SESSION id — resolve against
   * `SpectatorSnapshot.players[].sessionId`. Null before the first roll.
   */
  lastRollBy: number | null;
```

- [ ] **Step 4: Render it on the card**

In `DeathrollSpectatorBoard.tsx`, inside the player card, after the `playerTurn` span:

```tsx
            <span className={styles.playerName}>{nameOf(sessionId)}</span>
            {view.currentPlayer === sessionId && <span className={styles.playerTurn}>Rolling…</span>}
            {view.lastRoll != null && view.lastRollBy === sessionId && (
              <span className={styles.playerRoll} data-testid={`spectator-roll-${sessionId}`}>
                {view.lastRoll}
              </span>
            )}
```

Leave the `Last roll` stat tile alone — it is the match-level value and the card is the per-player one.

- [ ] **Step 5: Add the CSS**

Append to `DeathrollSpectatorBoard.module.css`, tokens only:

```css
/* The roll that produced the current ceiling, shown on the card of whoever made
   it. Large and quiet: it is the thing a spectator looks at, but it must not
   out-shout the active-player treatment. */
.playerRoll {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  color: var(--text-primary);
  line-height: 1;
}
```

> `--text-xl` is declared in `src/index.css`. **Do not introduce a literal font size.**

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd src/Brmble.Web; npm run test -- DeathrollSpectatorBoard` — all PASS.
Run: `cd src/Brmble.Web; npm run type-check` — clean.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/api/games.ts src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.tsx src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.module.css src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.test.tsx
git commit -m "feat(games): show each player's last roll on their spectator card"
```

---

### Task 4: RPS — pick icon on the player card

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/RpsSpectatorBoard.tsx`
- Modify: `src/Brmble.Web/src/components/Games/RpsSpectatorBoard.module.css`
- Test: `src/Brmble.Web/src/components/Games/RpsSpectatorBoard.test.tsx` (append)

**Interfaces:**
- Consumes: `pickIcon` / `pickLabel` from Task 2.
- Produces: a `styles.playerPick` element per card. Task 5 gates it behind the reveal.

**The privacy rule this task must not break:** the icon renders **only** from `view.lastRound`, index-mapped (`view.players[0]` → `pick0`). It must never read `view.committed`. `RpsSpectatorView` has no field carrying an unresolved pick, so the boundary holds structurally — but the test below is what keeps it that way.

- [ ] **Step 1: Write the failing tests**

Append to `RpsSpectatorBoard.test.tsx`:

```tsx
  it("shows each player's throw from the resolved round on their own card", () => {
    render(
      <RpsSpectatorBoard
        view={{
          ...unresolved,
          lastRound: { roundNumber: 1, sequence: 1, pick0: 'rock', pick1: 'scissors', winnerId: 10, tie: false },
        }}
        players={players}
        outcome={null}
      />,
    );
    expect(screen.getByTestId('spectator-pick-10')).toHaveAttribute('data-pick', 'rock');
    expect(screen.getByTestId('spectator-pick-20')).toHaveAttribute('data-pick', 'scissors');
  });

  it('shows no throw on either card before the first round resolves', () => {
    render(<RpsSpectatorBoard view={unresolved} players={players} outcome={null} />);
    expect(screen.queryByTestId('spectator-pick-10')).not.toBeInTheDocument();
    expect(screen.queryByTestId('spectator-pick-20')).not.toBeInTheDocument();
  });

  it('renders an idle timeout as no-throw rather than inventing an icon', () => {
    render(
      <RpsSpectatorBoard
        view={{
          ...unresolved,
          lastRound: { roundNumber: 1, sequence: 1, pick0: 'none', pick1: 'scissors', winnerId: 20, tie: false },
        }}
        players={players}
        outcome={null}
      />,
    );
    const idle = screen.getByTestId('spectator-pick-10');
    expect(idle).toHaveAttribute('data-pick', 'none');
    expect(idle).toHaveTextContent(/no throw/i);
    expect(idle.querySelector('svg')).toBeNull();
  });

  it('never shows an icon for the round currently in progress', () => {
    // The dangerous state: round 2 is being played while round 1's reveal is on screen.
    // Round 1 was rock/scissors; if a card ever showed 'paper' it could only have come
    // from the live round, which the wire does not carry and the board must not invent.
    render(
      <RpsSpectatorBoard
        view={{
          ...unresolved,
          roundNumber: 2,
          committed: [true, false],
          lastRound: { roundNumber: 1, sequence: 1, pick0: 'rock', pick1: 'scissors', winnerId: 10, tie: false },
        }}
        players={players}
        outcome={null}
      />,
    );
    for (const sessionId of [10, 20]) {
      const pick = screen.getByTestId(`spectator-pick-${sessionId}`).getAttribute('data-pick');
      expect(pick).toBe(sessionId === 10 ? 'rock' : 'scissors');
    }
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/Brmble.Web; npm run test -- RpsSpectatorBoard`
Expected: FAIL — no `spectator-pick-*` element.

- [ ] **Step 3: Render the icon**

In `RpsSpectatorBoard.tsx`, replace the local `PICK_LABELS` map and `pickLabel` with the shared module:

```tsx
import { Icon } from '../Icon/Icon';
import { pickIcon, pickLabel } from './rpsShared';
```

Inside the player card, after the commit span:

```tsx
            {view.lastRound && (() => {
              const pick = index === 0 ? view.lastRound.pick0 : view.lastRound.pick1;
              const icon = pickIcon(pick);
              return (
                <span
                  className={styles.playerPick}
                  data-testid={`spectator-pick-${sessionId}`}
                  data-pick={pick}
                  aria-label={`${nameOf(sessionId)} threw ${pickLabel(pick)}`}
                >
                  {icon ? <Icon name={icon} size={24} /> : pickLabel(pick)}
                </span>
              );
            })()}
```

Keep the existing `lastRoundText` block — it carries the round number and who took it, which the icons do not.

- [ ] **Step 4: Add the CSS**

Append to `RpsSpectatorBoard.module.css`, tokens only:

```css
/* The throw this player made in the round that just resolved. Rendered only from
   `lastRound` — never from `committed`, which says only WHETHER a player has thrown. */
.playerPick {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-primary);
  font-size: var(--text-2xs);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src/Brmble.Web; npm run test -- RpsSpectatorBoard` — all PASS.
Run: `cd src/Brmble.Web; npm run type-check` — clean.

- [ ] **Step 6: Prove the privacy test bites**

Temporarily change the pick expression to read the live round instead:

```tsx
const pick = view.committed[index] ? 'paper' : pickFromLastRound;
```

Run: `cd src/Brmble.Web; npm run test -- RpsSpectatorBoard`
Expected: `never shows an icon for the round currently in progress` **FAILS**. **Then revert.** Paste the failure into your report. If it does not fail, the test is not guarding anything — fix the test before proceeding.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/components/Games/RpsSpectatorBoard.tsx src/Brmble.Web/src/components/Games/RpsSpectatorBoard.module.css src/Brmble.Web/src/components/Games/RpsSpectatorBoard.test.tsx
git commit -m "feat(games): show each player's resolved throw on their spectator card"
```

---

### Task 5: RPS — reveal gate for spectators

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/RpsSpectatorBoard.tsx`
- Test: `src/Brmble.Web/src/components/Games/RpsSpectatorBoard.test.tsx` (append)

**Interfaces:**
- Consumes: `REVEAL_SECONDS` (Task 2); the `styles.playerPick` element (Task 4).
- Produces: nothing.

**The substantive requirement:** the whole board — scores, commit state, last-round text **and the Task 4 icons** — must render from a single gated `display` value. Rendering the icons from the incoming view while the gate holds the rest spoils the reveal a beat early, which is the failure this task exists to avoid.

- [ ] **Step 1: Write the failing tests**

Append to `RpsSpectatorBoard.test.tsx` (add `vi` to the vitest import):

```tsx
  describe('reveal beat', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    const round1 = { roundNumber: 1, sequence: 1, pick0: 'rock', pick1: 'scissors', winnerId: 10, tie: false };
    const round2 = { roundNumber: 2, sequence: 2, pick0: 'paper', pick1: 'rock', winnerId: 10, tie: false };

    it('adopts the first view immediately, without suspense', () => {
      render(<RpsSpectatorBoard view={{ ...unresolved, lastRound: round1 }} players={players} outcome={null} />);
      expect(screen.getByTestId('spectator-pick-10')).toHaveAttribute('data-pick', 'rock');
    });

    it('holds a newly resolved round, icons included, then reveals it', () => {
      const { rerender } = render(
        <RpsSpectatorBoard view={{ ...unresolved, lastRound: round1 }} players={players} outcome={null} />,
      );

      rerender(<RpsSpectatorBoard view={{ ...unresolved, lastRound: round2 }} players={players} outcome={null} />);

      // Still showing round 1 — the icons must not run ahead of the rest of the board.
      expect(screen.getByTestId('spectator-pick-10')).toHaveAttribute('data-pick', 'rock');
      expect(screen.getByTestId('spectator-last-round')).toHaveTextContent(/round 1/i);

      act(() => { vi.advanceTimersByTime(REVEAL_SECONDS * 1000); });

      expect(screen.getByTestId('spectator-pick-10')).toHaveAttribute('data-pick', 'paper');
      expect(screen.getByTestId('spectator-last-round')).toHaveTextContent(/round 2/i);
    });
  });
```

> Import `act` from `@testing-library/react` and `REVEAL_SECONDS` from `./rpsShared`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/Brmble.Web; npm run test -- RpsSpectatorBoard`
Expected: the hold test FAILS — round 2 appears immediately.

- [ ] **Step 3: Port the gate**

In `RpsSpectatorBoard.tsx`, rename the prop to `view: incoming` and gate it. Place this above `nameOf`:

```tsx
  // Reveal suspense, ported from the participant board so a watcher sitting beside a
  // player sees the same beat. Keyed on lastRound.sequence, which increments on every
  // resolution including ties. EVERYTHING below renders from `view`, never `incoming` —
  // in particular the per-player pick icons, which would otherwise spoil the reveal.
  const [view, setView] = useState<RpsSpectatorView>(incoming);
  const [revealing, setRevealing] = useState(false);
  const shownSeqRef = useRef<number | null>(null);
  const pendingRef = useRef<RpsSpectatorView | null>(null);

  useEffect(() => {
    const seq = incoming.lastRound?.sequence ?? 0;
    if (shownSeqRef.current === null) {
      // First view for this match: adopt without suspense (covers joining mid-match).
      shownSeqRef.current = seq;
      setView(incoming);
      return;
    }
    if (incoming.lastRound && seq > shownSeqRef.current) {
      pendingRef.current = incoming;
      setRevealing(true);
      return;
    }
    setView(incoming);
  }, [incoming]);

  useEffect(() => {
    if (!revealing) return;
    const id = window.setTimeout(() => {
      const pending = pendingRef.current;
      if (pending) {
        shownSeqRef.current = pending.lastRound?.sequence ?? shownSeqRef.current;
        setView(pending);
        pendingRef.current = null;
      }
      setRevealing(false);
    }, REVEAL_SECONDS * 1000);
    return () => window.clearTimeout(id);
  }, [revealing]);
```

Add `useEffect`, `useRef`, `useState` to the React import, and `REVEAL_SECONDS` from `./rpsShared`.

**A new match must reset the gate.** `useSpectatorState` swaps in a new `matchId` without unmounting this component, so a match-2 round 1 (`sequence: 1`) would be gated as stale against match 1's high sequence. Reset when the match changes — pass `matchId` down, or reset when `incoming.lastRound` is null while `shownSeqRef.current` is non-null. **Decide, implement it, and cover it with a test**; report which you chose.

**A frame arriving mid-reveal supersedes, it does not queue.** If another frame lands while the countdown runs (the next round's commit, say), `pendingRef` is overwritten with the newer view and the timer keeps running — latest-wins, one reveal. That is correct and matches the participant board. What must **not** happen is such a frame reaching `setView` and revealing early; check your branch ordering makes that impossible.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src/Brmble.Web; npm run test -- RpsSpectatorBoard` — all PASS, including the Task 4 privacy tests.
Run: `cd src/Brmble.Web; npm run type-check` — clean.
Run: `cd src/Brmble.Web; npm run test` — full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/Games/RpsSpectatorBoard.tsx src/Brmble.Web/src/components/Games/RpsSpectatorBoard.test.tsx
git commit -m "feat(games): give spectators the RPS reveal beat"
```

---

### Task 6: Channel-row `eye` toggle

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx` (props `:71-77`, destructure `:109`, badge block `:414-428`)
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.css`
- Test: `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx` (append)

**Interfaces:**
- Consumes: `activityChannelMatchesPresence` from `workspace/activityPresence`.
- Produces: two new optional `ChannelTreeProps` — `spectatingChannelId?: number | null` and `onToggleSpectate?: (channelId: number) => void`. Task 7 supplies both.

- [ ] **Step 1: Write the failing tests**

Append to `ChannelTree.test.tsx`, following the file's existing render helper:

```tsx
  it('offers a watch toggle on a channel with duel activity', () => {
    renderTree({ duelChannelIds: new Set([1]), joinedChannelId: '1', onToggleSpectate: vi.fn() });
    expect(screen.getByRole('button', { name: /watch games in/i })).toBeEnabled();
  });

  it('offers no watch toggle on a channel with no duel activity', () => {
    renderTree({ duelChannelIds: new Set<number>(), joinedChannelId: '1', onToggleSpectate: vi.fn() });
    expect(screen.queryByRole('button', { name: /watch games in/i })).not.toBeInTheDocument();
  });

  it('disables the toggle for a channel you have not joined', () => {
    renderTree({ duelChannelIds: new Set([1]), joinedChannelId: '2', onToggleSpectate: vi.fn() });
    expect(screen.getByRole('button', { name: /watch games in/i })).toBeDisabled();
  });

  it('reflects the watched channel with aria-pressed', () => {
    renderTree({ duelChannelIds: new Set([1]), joinedChannelId: '1', spectatingChannelId: 1, onToggleSpectate: vi.fn() });
    expect(screen.getByRole('button', { name: /stop watching/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('dispatches the toggle with the channel id', () => {
    const onToggleSpectate = vi.fn();
    renderTree({ duelChannelIds: new Set([1]), joinedChannelId: '1', onToggleSpectate });
    fireEvent.click(screen.getByRole('button', { name: /watch games in/i }));
    expect(onToggleSpectate).toHaveBeenCalledWith(1);
  });
```

> Adapt `renderTree` and the channel id to whatever the file already provides. If it has no shared render helper, add one rather than repeating the full prop list five times.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/Brmble.Web; npm run test -- ChannelTree`
Expected: FAIL — unknown props, no such button.

- [ ] **Step 3: Add the props**

In `ChannelTreeProps`, beside the duel props:

```tsx
  /** The channel currently being spectated, if any. Drives the watch toggle's pressed state. */
  spectatingChannelId?: number | null;
  /** Start watching this channel, or stop if it is already the watched one. */
  onToggleSpectate?: (channelId: number) => void;
```

Add both to the destructure at `:109`.

- [ ] **Step 4: Render the toggle**

Import the predicate:

```tsx
import { activityChannelMatchesPresence } from '../../workspace/activityPresence';
```

Immediately after the closing `)}` of the duel-badge block:

```tsx
          {duelChannelIds?.has(channel.id) && onToggleSpectate && (() => {
            const watching = spectatingChannelId === channel.id;
            // Same-channel only, via the canonical predicate the modal's Watch button
            // uses — one encoding of the rule, not two. It also excludes server-root.
            const canWatch = activityChannelMatchesPresence(joinedChannelId, String(channel.id));
            return (
              <Tooltip content={
                watching ? 'Stop watching'
                  : canWatch ? 'Watch games in this channel'
                    : 'You can only watch games in the channel you have joined'
              }>
                <span className="tooltip-wrapper">
                  <button
                    type="button"
                    className={`channel-spectate-icon${watching ? ' watching' : ''}`}
                    aria-label={watching ? `Stop watching ${channel.name}` : `Watch games in ${channel.name}`}
                    aria-pressed={watching}
                    disabled={!canWatch}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleSpectate(channel.id);
                    }}
                  >
                    <Icon name="eye" size={12} />
                  </button>
                </span>
              </Tooltip>
            );
          })()}
```

> The `tooltip-wrapper` span is required because a disabled button fires no mouse events — the same idiom `DuelQueueModal`'s Watch button uses. Verify `joinedChannelId`'s type in this component is the `string | null` the predicate expects.

- [ ] **Step 5: Add the CSS**

Append to `ChannelTree.css`. This mirrors `.channel-duel-icon` (`:124-146`) so the two sit as siblings, including its component-local hit-target dimension:

```css
/* Watch toggle for spectating a channel's games. Sits beside the duel badge and
   mirrors its box exactly so the two read as a pair. `.watching` marks an active
   subscription, the same way the screen-share watch control does. */
.channel-spectate-icon {
  /* Component-specific hit-target size — spacing tokens must not be reused for
     element dimensions (UI_GUIDE §12 rule 3). Matches --duel-badge-size. */
  --spectate-badge-size: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--spectate-badge-size);
  min-height: var(--spectate-badge-size);
  color: var(--text-secondary);
  margin-left: var(--space-2xs);
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}

/* Active subscription, matching .channel-duel-icon.active. */
.channel-spectate-icon.watching {
  color: var(--accent-primary);
  background: var(--accent-primary-wash);
  border-radius: var(--radius-sm);
}

/* Same treatment as .btn:disabled (index.css). Keep pointer-events on: the
   Tooltip wrapper needs hover to explain why the control is unavailable. */
.channel-spectate-icon:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

> The resting colour is `--text-secondary` rather than the duel badge's `--accent-primary`: the badge signals "something is happening here", the eye is an available action. If that reads wrong against the row, switch it to match the badge and say so in your report.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd src/Brmble.Web; npm run test -- ChannelTree` — all PASS, existing tests unchanged.
Run: `cd src/Brmble.Web; npm run type-check` — clean.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx src/Brmble.Web/src/components/Sidebar/ChannelTree.css src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx
git commit -m "feat(games): add a channel-row watch toggle for spectating"
```

---

### Task 7: Thread through `Sidebar` and `App`

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx` (`:50`, `:92`, `:462-465`)
- Modify: `src/Brmble.Web/src/App.tsx` (handler near `:5042`, `Sidebar` props `:5384-5387`)
- Test: `src/Brmble.Web/src/App.spectator.test.tsx` (append)

**Interfaces:**
- Consumes: the two `ChannelTree` props from Task 6; `handleWatchDuel` (`App.tsx:5042`); `spectator` (`App.tsx:1093`).
- Produces: the feature is live.

- [ ] **Step 1: Write the failing integration tests**

Append to `App.spectator.test.tsx`, following the file's existing harness:

```tsx
  it('starts spectating from the channel row and lights the Game chip', async () => {
    mocks.duelQueue.byChannel = new Map([[7, activeDuelSnapshot(7)]]);
    renderApp();

    fireEvent.click(screen.getByRole('button', { name: /watch games in/i }));

    await waitFor(() => expect(mocks.spectator.startSpectating).toHaveBeenCalledWith(7));
  });

  it('stops spectating when the row toggle is clicked again', () => {
    mocks.duelQueue.byChannel = new Map([[7, activeDuelSnapshot(7)]]);
    mocks.spectator.spectatingChannelId = 7;
    renderApp();

    fireEvent.click(screen.getByRole('button', { name: /stop watching/i }));

    expect(mocks.spectator.stopSpectating).toHaveBeenCalledTimes(1);
    expect(mocks.spectator.startSpectating).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/Brmble.Web; npm run test -- App.spectator`
Expected: FAIL — no such button (the props are not threaded yet).

- [ ] **Step 3: Pass the props through `Sidebar`**

Add the same two props to `SidebarProps`, to the destructure, and to the `<ChannelTree>` render beside `duelChannelIds` / `onOpenDuelQueue`. Pure passthrough — no logic.

- [ ] **Step 4: Add the toggle handler in `App`**

Immediately after `handleWatchDuel`:

```tsx
  /**
   * The channel row's watch toggle. Starting reuses handleWatchDuel so the modal path
   * and the row path behave identically — same explicit-activity focus, same error
   * surfacing. Stopping clears locally first, which handleWatchDuel's counterpart in
   * the hook already does.
   */
  const handleToggleSpectate = useCallback((channelId: number) => {
    if (spectator.spectatingChannelId === channelId) {
      spectator.stopSpectating();
      return;
    }
    handleWatchDuel(channelId);
  }, [spectator.spectatingChannelId, spectator.stopSpectating, handleWatchDuel]);
```

Then in the `<Sidebar>` render, beside `duelChannelIds`:

```tsx
          spectatingChannelId={spectator.spectatingChannelId}
          onToggleSpectate={handleToggleSpectate}
```

- [ ] **Step 5: Run everything**

Run: `cd src/Brmble.Web; npm run type-check` — clean.
Run: `cd src/Brmble.Web; npm run test` — full suite; **no pre-existing test may change status.**
Run: `dotnet build` — clean.
Run: `dotnet test` — all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/Sidebar/Sidebar.tsx src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.spectator.test.tsx
git commit -m "feat(games): wire the channel-row watch toggle into the app"
```

---

### Task 8: `docs/UI_GUIDE.md`

**Files:**
- Modify: `docs/UI_GUIDE.md` — Game Spectator Pattern, Project 1 Duel Queue Pattern

**Interfaces:** documentation only.

**Every line number is stale — re-locate each section by heading before editing.**

- [ ] **Step 1: Split the countdown rule**

The Game Spectator Pattern rule stating spectator boards have "no countdown bar (a spectator has no turn)" conflates two devices. Replace with both:

```markdown
6. Spectator boards are **read-only**: no action buttons, no forfeit, no Head-to-head
   panel, and **no turn countdown** — a spectator has no turn, so a timer measuring
   their time running out would be meaningless.
7. A **reveal beat is not a turn countdown.** RPS holds a newly resolved round for
   `REVEAL_SECONDS` before showing it, on the spectator board as well as the
   participant board, so a watcher gets the same moment of tension. The constant is
   shared (`components/Games/rpsShared.ts`) and imported by both boards, never copied:
   its whole purpose is keeping the two surfaces synchronised.
```

Renumber the following rules.

- [ ] **Step 2: Record the entry point**

Amend the opt-in rule so it names both entry points:

```markdown
1. **Opt-in is always a local click**, and there are two entry points. The channel row
   carries a **watch toggle** (`eye`) beside the swords badge, shown whenever the
   channel has duel activity — a live match, a ready-check, or a queue — and enabled
   only for the channel you have joined. `DuelQueueModal`'s active-duel card keeps its
   **Watch** button. Both run the same handler. No activity may appear without a click.
```

- [ ] **Step 3: Record that Idle is now reachable**

Replace the note saying the Idle card is a continuation state with no entry:

```markdown
4. The Idle card shows only the upcoming pair, game and format, or the ready-check
   waiting line, read from the already-broadcast queue snapshot. **No queue list and no
   ETAs.** It is reachable directly: the channel-row toggle appears on any duel
   activity, so you can start watching a queued channel and see the next-up card before
   the match begins.
```

- [ ] **Step 4: Record the player cards**

Add a rule:

```markdown
9. Player cards carry each player's **latest** action — the number they just rolled
   (Deathroll) or the throw they just made (RPS). This is deliberately **not history**:
   there is no strip, log or scrollback on a spectator board. `game.feed` remains the
   running record, and duplicating it on the board would create a second source of
   truth that can disagree with it.
```

- [ ] **Step 5: Update the Duel Queue Pattern**

Amend the Watch sentence so it no longer implies the modal is the only way in:

```markdown
- The active-duel card carries a single action, **Watch**, enabled only when
  `snapshot.channelId` matches the joined channel. It is one of two entry points into
  spectating; the other is the watch toggle on the channel row. See the Game Spectator
  Pattern.
```

- [ ] **Step 6: Verify**

```bash
git grep -n "components/Games/" docs/UI_GUIDE.md
```
Every referenced path must exist on disk — including the new `rpsShared.ts`.

Re-read the edited sections in context and confirm they do not contradict each other or the Main Panel Region Pattern.

Run: `cd src/Brmble.Web; npm run test` and `dotnet test` once more — both green.

- [ ] **Step 7: Commit**

```bash
git add docs/UI_GUIDE.md
git commit -m "docs: document the spectator entry toggle, reveal beat and player cards"
```

---

## Final Verification

- [ ] `dotnet build` — clean
- [ ] `dotnet test` — all PASS
- [ ] `cd src/Brmble.Web; npm run type-check` — clean
- [ ] `cd src/Brmble.Web; npm run test` — all PASS
- [ ] `cd src/Brmble.Web; npm run build` — clean
- [ ] `git grep -n "REVEAL_SECONDS" -- src/Brmble.Web/src` — declared **once**, in `rpsShared.ts`
- [ ] Manual, three clients: an eye appears on a channel with a queued duel; clicking it shows the Idle next-up card; the match starts and flows in live; each card shows that player's roll/throw; RPS holds each round for three seconds before revealing, icons included; clicking the eye again clears the chip.
- [ ] Ask before pushing or opening a PR.

## Spec Coverage

| Spec section | Task |
|---|---|
| §1 Channel-row spectate toggle | 6, 7 |
| §1 Idle card reachable | 6, 8 |
| §2 RPS pick icons | 4 |
| §2 Deathroll roll attribution | 1, 3 |
| §2 No new engine state | 1 (derived) |
| §3 Reveal beat | 5 |
| §3 `REVEAL_SECONDS` shared, not copied | 2 |
| §3 Icons gated by the same held view | 5 |
| Documentation | 8 |
| Privacy boundary held | 4 (mutation-verified in Step 6) |
