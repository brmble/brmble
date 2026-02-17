# Voice Channel Chat Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable real Mumble text messaging in voice channel chats by sending messages via the bridge for non-root channels.

**Architecture:** Add an `else` branch to `handleSendMessage` in App.tsx. All other plumbing (backend send, frontend receive/routing, echo suppression) already works.

**Tech Stack:** React + TypeScript (frontend only)

---

### Task 1: Send voice channel messages via Mumble protocol

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:270-272`

**Step 1: Add else branch for non-root channel sending**

Change lines 270-272 from:

```typescript
      if (currentChannelId === 'server-root') {
        bridge.send('voice.sendMessage', { message: content, channelId: 0 });
      }
```

to:

```typescript
      if (currentChannelId === 'server-root') {
        bridge.send('voice.sendMessage', { message: content, channelId: 0 });
      } else if (currentChannelId) {
        bridge.send('voice.sendMessage', { message: content, channelId: Number(currentChannelId) });
      }
```

**Step 2: Build frontend**

Run: `npm run build` from `src/Brmble.Web/`
Expected: Build succeeded

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: send voice channel chat messages via Mumble protocol"
```
