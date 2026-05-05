# Rock-Paper-Scissors Multiplayer Investigation

## Overview

Can we make the Rock-Paper-Scissors game playable between two Brmble users instead of player vs CPU?

**Short answer: YES, we can make this work.**

**Long answer: With some design considerations around synchronisation, timing, and state management.**

---

## Current Game Model (Player vs CPU)

The existing game in `docs/investigations/steen-pappier-schaar.md` works as:

```
┌──────────────────────────────────────────────────────────────┐
│  PLAYER vs CPU (Single Player)                                │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Player clicks move → Immediately deduct from budget        │
│  CPU selects move → (async delay for tension)                │
│  Reveal both → Update scores                                 │
│  Repeat until budget depleted                                │
│                                                              │
│  Everything happens locally on one device                    │
│  No network required                                        │
└──────────────────────────────────────────────────────────────┘
```

**Key characteristics:**
- Player chooses first, then CPU responds
- 1.2 second delay for "ANALYSIS..." tension
- Both moves revealed simultaneously after delay
- Score updated immediately on device
- Total 9 rounds (3 of each move per player)

---

## Multiplayer Model (Brmble vs Brmble)

For two players, we need to sync:

```
┌──────────────────────────────────────────────────────────────┐
│  PLAYER 1 vs PLAYER 2 (Multiplayer)                          │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Both players select moves (hidden from each other)         │
│  Both confirm selection                                     │
│  Both moves revealed simultaneously                         │
│  Scores update on both devices                              │
│  Repeat until depleted                                      │
│                                                              │
│  Requires network synchronisation                          │
│  Need protocol for move selection                           │
│  Need timing coordination                                    │
└──────────────────────────────────────────────────────────────┘
```

---

## Core Challenges & Solutions

### Challenge 1: Hidden Information

**Problem:** In RPS, both players need to choose without seeing the other's choice. In a networked game, we can't simply send the move when clicked.

**Solution Options:**

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **Commit-Reveal** | Both players "lock in" their move, then reveal on round start | Fair, simple | Players might hesitate to lock |
| **Timer-Based** | Both choose within a time limit, then reveal simultaneously | Fast, keeps tension | Can feel rushed |
| **Server-Held** | Server collects both moves, reveals when both received | Most secure | Requires server changes |

**Recommended: Commit-Reveal with Timer**

1. Round starts with countdown (3-2-1)
2. Both players select their move and hit "LOCK IN"
3. Game shows "Waiting for opponent..." if one locks first
4. When both locked → Reveal both moves simultaneously
5. Update scores

This preserves the tension of your original game while handling network delays naturally.

---

### Challenge 2: Budget Synchronisation

**Problem:** Each player has 3 of each move. We need both devices to show the same remaining budget.

**Solution:**

```
START OF GAME:
┌──────────────────────────────────────────────────────────────┐
│  Server (or room host) controls the "master state"          │
│                                                              │
│  Player 1 (initiator) starts game                            │
│  Server creates room with:                                   │
│    - player1_budget: { rock: 3, paper: 3, scissors: 3 }     │
│    - player2_budget: { rock: 3, paper: 3, scissors: 3 }      │
│    - round: 1                                                │
│    - state: waiting_for_players                              │
│                                                              │
│  Both players receive same initial state                    │
└──────────────────────────────────────────────────────────────┘
```

**During rounds:**

```
ROUND RESOLUTION:
┌──────────────────────────────────────────────────────────────┐
│  Client A sends: { p1Move: 'rock' } to Server                │
│  Client B sends: { p1Move: 'paper' } to Server                │
│                                                              │
│  Server calculates:                                         │
│    - rock beats scissors ❌                                   │
│    - paper beats rock ✓                                      │
│    - Winner: Player B                                        │
│                                                              │
│  Server sends to both: {                                     │
│    p1Move: 'rock',                                          │
│    p2Move: 'paper',                                         │
│    winner: 'player2'                                        │
│    p1Budget: { rock: 2, paper: 3, scissors: 3 }              │
│    p2Budget: { rock: 3, paper: 2, scissors: 3 }            │
│  }                                                          │
│                                                              │
│  Both clients update UI identically                         │
└──────────────────────────────────────────────────────────────┘
```

This ensures both players always see the exact same state.

---

### Challenge 3: Network Latency

**Problem:** What if one player's move takes 500ms to arrive? The other has to wait.

**Solution:**

**Option A: Optimistic UI (Recommended for UX)**
```
Player A clicks "rock" → UI immediately shows "rock selected"
Send move to server in background
Show loading indicator if opponent hasn't locked
When both moves received → Reveal simultaneously
```

**Option B: Deferred Reveal**
```
Both players lock in moves
Server waits for both (max timeout: 10 seconds)
If both arrive → Reveal
If timeout → Cancel round, redistribute move budgets
```

**Recommendation:** Use optimistic UI with the "Waiting" state. This keeps your game feeling responsive while handling real network conditions.

---

### Challenge 4: Disconnects / Rage Quits

**Problem:** What if a player disconnects mid-game?

**Solution:**

| Scenario | Handling |
|----------|----------|
|Disconnect before locking | Opponent gets a "win by forfeit" or game pauses |
|Disconnect after locking | Other player wins the round |
|Complete disconnect | Game ends, scores are final |
|Reconnect within 60s | Game pauses, resumes when both back |

**Implementation:** Server tracks connection state per player. If one disconnects, notify the other player.

---

## Game Flow Design

### Proposed Multiplayer Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 1: INVITE                                            │
├─────────────────────────────────────────────────────────────────┤
│                                                          │
│  Player A clicks "Challenge [User]" in user list            │
│  Player B receives: "Player A challenges you to RPS!"      │
│  Player B accepts or declines                             │
│  If accepted → Create game room, load both players       │
│                                                          │
└─────────────────────────────────────────────────────────────────┘
                ↓
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 2: COUNTDOWN                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                          │
│  Both clients show: "Round 1 starting in 3... 2... 1..."   │
│  Budget displayed: Each player sees their own + opponent    │
│  Move buttons enabled                                     │
│                                                          │
└─────────────────────────────────────────────────────────────────┘
                ↓
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 3: SELECT                                           │
├─────────────────────────────────────────────────────────────────┤
│                                                          │
│  Player clicks move (e.g., "rock")                         │
│  Moves are NOT sent to opponent yet                       │
│  UI shows: "Selection locked - click to change"            │
│  Player can change until they hit "LOCK IN"                │
│                                                          │
│  When player hits "LOCK IN":                              │
│  Send move to server, UI shows "Waiting for opponent..."  │
│                                                          │
└─────────────────────────────────────────────────────────────────┘
                ↓
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 4: RESOLUTION                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                          │
│  Server has both moves                                     │
│  Server calculates winner                                 │
│  Server broadcasts result to both players:                │
│    - Show "VS" with both moves revealed                   │
│    - Show winner announcement                             │
│    - Update scores                                     │
│    - Deduct from budgets                                │
│                                                          │
│  If rounds remaining → Next countdown                  │
│  If budgets depleted → Show final scores, winner         │
│                                                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Technical Architecture (High-Level)

### How to send messages

Brmble already has a bridge system for communication. We can reuse it:

```
RPS Bridge Messages:
┌──────────────���──────────────────────────────────────────────────┐
│  From Client → Server                                      │
├─────────────────────────────────────────────────────────── │
│  rps.invite: { targetSession }                             │
│  rps.accept: { roomId }                                    │
│  rps.lockMove: { move, roomId }                           │
│  rps.withdrawMove: { roomId }  (change before lock)       │
│  rps.forfeit: { roomId }                                  │
├─────────────────────────────────────────────────────────── │
│  Server → Client                                          │
├─────────────────────────────────────────────────────────── │
│  rps.roomCreated: { roomId, playerNumber }                │
│  rps.playerJoined: { roomId, opponentName }              │
│  rps.roundStart: { roundNumber, timeLimit }              │
│  rps.moveLocked: { roomId, opponentMove }               │
│  rps.roundResult: { p1Move, p2Move, winner, scores }    │
│  rps.gameOver: { winner, finalScores }                    │
│  rps.opponentDisconnected: { }                            │
│  rps.opponentReconnected: { }                          │
└─────────────────────────────────────────────────────────┘
```

### State Machine

```
IDLE ──(invite)──→ INVITED ──(accept)──→ COUNTDOWN ──(both ready)──→ SELECT
   ↑                                              │
   │                                              ↓
   │←──────────────── (forfeit/disconnect) ─────────┘
   │
   └────────────────── (game over) ────────────────┘
```

---

## User Interface Additions Needed

To make this work, the UI needs:

| Component | Description |
|-----------|-------------|
|Challenge button | Next to user in user list or user info dialog|
|Invite dialog | Shows when challenged by someone |
|In-game HUD | Shows opponent's selection status ("Locked" / waiting) |
|Score panel | Player 1 score vs Player 2 score |
|Forfeit button | Allow players to quit mid-game |
|Game results | Final scores, winner announcement, rematch option |

**Changes to existing UI:**

- Add "Challenge" to user context menu (right-click on user in channel)
- Add challenge notification (toast/popup)
- Possibly add RPS game mode to a channel feature toggle

---

## Fair Play Considerations

### Anti-Cheat

```
┌──────────────────────────────────────────────────────────────┐
│  RISK: Player modifies client to always pick counter       │
├──────────────────────────────────────────────────────────────┤
│  MITIGATION:                                              │
│                                                              │
│  1. Server controls the "reveal" timing                   │
│     - Player sends committed move hash                       │
│     - Server waits for both players                       │
│     - Server reveals simultaneously                    │
│                                                              │
│  2. Can't fake "I locked rock but meant paper"            │
│     - Server logs each locked move                      │
│     - Cannot change after lock                         │
│                                                              │
│  This is similar to online poker fair-play mechanisms  │
└──────────────────────────────────────────────────────────────┘
```

### Cheat Detection

| Cheat Attempt | Detection Method |
|--------------|-----------------|
| Client modification | Server-authoritative outcome calculation |
| Same machine playing both sides | Require different sessions/machines |
| Disconnecting to avoid loss | Forfeit penalty, score counted |

---

## Can We Build This?

### Feasibility Assessment

| Aspect | Verdict | Notes |
|--------|--------|-------|
| Game logic | ✅ Easy | RPS rules are simple |
| State sync | ✅ Easy | Server is single source of truth |
| Network protocol | ✅ Easy | Reuse existing bridge |
| UI additions | ⚠️ Moderate | Need challenge/result UI |
| Fair play | ✅ Easy | Server-authoritative |
| Disconnect handling | ⚠️ Moderate | Need timeout logic |

### Estimated Effort

- **Backend:** ~2-4 hours (add game room logic, state management)
- **Frontend:** ~4-6 hours (challenge UI, in-game HUD, score panel, result screen)
- **Testing:** ~2 hours (sync, latency, disconnect scenarios)

**Total: ~8-12 hours for a first working version**

### What We Need

1. **Backend team to add:**
   - Game room management
   - Move commit/reveal protocol
   - Round state tracking
   - Disconnect handlers

2. **Frontend team to add:**
   - Challenge button in user menu
   - Invite accept/decline dialog
   - In-game "waiting for opponent" UI
   - Multiplayer RPSGame component (reuse your logic!)
   - Final scoreboard

---

## Alternative: Channel-Based Challenges

Instead of a formal room system, we could do simpler challenges:

```
SIMPLE APPROACH:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Player A types: !rps challenge @PlayerB
Server creates 1-on-1 game context
Both players get game overlay
Game runs for 9 rounds
Game ends, scores shown
Both return to normal chat

Pros: No complex room system needed
Cons: Less robust, no pause/reconnect
```

**This might be a good MVP** - simpler to implement, proves the concept works, then iterate to add room polish.

---

## Summary

| Question | Answer |
|----------|--------|
| Can we do multiplayer RPS? | **YES** |
| Is it technically complex? | **NO** - similar to existing game flows |
| Do we need server changes? | **YES** - basic room/state management |
| Do we need significant UI changes? | **MODERATE** - challenge + game UI |
| Can players cheat? | **Minimised** - server-authoritative reveal |
| Estimated effort | **8-12 hours** |

The core RPS game logic stays completely the same - we just need to:
1. Replace CPU move selection with "wait for opponent move"
2. Add server-side state management
3. Add challenge/accept UI

**Recommendation: Build the single-player version first (as planned), then add multiplayer backend as a follow-up.**

---

*Investigation Date: 2026-04-25*
*Investigator: Claude (via user request)*
*Status: FEASIBLE with moderate effort*