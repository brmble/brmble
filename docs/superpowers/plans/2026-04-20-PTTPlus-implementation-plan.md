# PTT+ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Push-to-Talk Plus mode that eliminates clipping by keeping mic, APM, and encoder always running in the background with a software gate.

**Architecture:** Enum addition with software gate in OnMicData. Same as Continuous Voice but with a gate that opens/closes based on PTT key state.

**Tech Stack:** C#, NAudio, MumbleVoiceEngine (EncodePipeline), WebRTC APM

---

## File Structure

- **Modify:** `src/Brmble.Client/Services/Voice/AudioManager.cs` (enum, OnMicData gate)
- **Modify:** `src/Brmble.Client/Services/Voice/VoiceService.cs` (interface doc)
- **Modify:** `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` (mode handling)
- **Modify:** `src/Brmble.Client/Services/AppConfig/AppSettings.cs` (default)
- **Modify:** `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx` (UI)
- **Modify:** `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx` (UI)

---

## Task 1: Add PushToTalkPlus Enum

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs:18`

- [ ] **Step 1: Add enum value**

```csharp
public enum TransmissionMode { Continuous, VoiceActivity, PushToTalk, PushToTalkPlus }
```

- [ ] **Step 2: Run build to verify**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: BUILD SUCCEEDED

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat: add PushToTalkPlus enum value"
```

---

## Task 2: Update OnMicData Software Gate

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs:966`

- [ ] **Step 1: Find the existing gate logic**

Read line 966 in AudioManager.cs - this is where PTT gate is checked:
```csharp
if (!virtualMic && _transmissionMode == TransmissionMode.PushToTalk && !_pttActive) return;
```

- [ ] **Step 2: Add PTT+ gate logic**

Change line 966 from:
```csharp
if (!virtualMic && _transmissionMode == TransmissionMode.PushToTalk && !_pttActive) return;
```

To:
```csharp
if (!virtualMic && _transmissionMode == TransmissionMode.PushToTalk && !_pttActive) return;
if (!virtualMic && _transmissionMode == TransmissionMode.PushToTalkPlus && !_pttActive) return;
```

- [ ] **Step 3: Run build to verify**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: BUILD SUCCEEDED

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat: add software gate for PTT+ mode in OnMicData"
```

---

## Task 3: Update SetTransmissionMode for PTT+

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs:1291`

- [ ] **Step 1: Find SetTransmissionMode logic**

Read around line 1291-1334 in AudioManager.cs - handles PTT mode setup.

Current logic stops mic in PTT mode:
```csharp
if (mode == TransmissionMode.PushToTalk)
    StopMic();
```

- [ ] **Step 2: Add PTT+ behavior**

Add after line 1331:
```csharp
if (mode == TransmissionMode.PushToTalkPlus)
    StartMic(); // Always-on: keep mic running
```

And update the check around line 1291 to include PTT+:
```csharp
if (mode != TransmissionMode.PushToTalk && mode != TransmissionMode.PushToTalkPlus)
```

- [ ] **Step 3: Run build to verify**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: BUILD SUCCEEDED

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat: keep mic running in PTT+ mode"
```

---

## Task 4: Update MumbleAdapter Mode Handling

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:657-670`

- [ ] **Step 1: Find SetTransmissionMode parser**

Read lines 657-670 - maps string to enum.

- [ ] **Step 2: Add PTT+ parsing**

Add at line 659:
```csharp
"pushToTalkPlus" => TransmissionMode.PushToTalkPlus,
```

- [ ] **Step 3: Run build to verify**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: BUILD SUCCEEDED

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: add PTT+ mode parsing in MumbleAdapter"
```

---

## Task 5: Update AppSettings Defaults

**Files:**
- Modify: `src/Brmble.Client/Services/AppConfig/AppSettings.cs:8`

- [ ] **Step 1: Find default transmission mode**

Line 8 has `string TransmissionMode = "voiceActivity",`

- [ ] **Step 2: No change needed**

Default stays as-is. PTT+ is a user choice, not default.

- [ ] **Step 3: Commit (no-op, skip this task)**

---

## Task 6: Update Frontend Type Definition

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx:21`

- [ ] **Step 1: Add type to TransmissionMode**

Add `'pushToTalkPlus'` to the type:
```typescript
export type TransmissionMode = 'pushToTalk' | 'voiceActivity' | 'continuous' | 'pushToTalkPlus';
```

- [ ] **Step 2: Add UI option**

Add at line 218-220:
```typescript
{ value: 'pushToTalkPlus', label: 'PTT+' },
{ value: 'pushToTalk', label: 'Push to Talk' },
{ value: 'voiceActivity', label: 'Voice Activity' },
{ value: 'continuous', label: 'Continuous' },
```

- [ ] **Step 3: Add conditional rendering for PTT+ key binding**

```typescript
{(localSettings.transmissionMode === 'pushToTalk' || localSettings.transmissionMode === 'pushToTalkPlus') && (
```

- [ ] **Step 4: Run frontend build**

Run: `cd src/Brmble.Web && npm run build`
Expected: BUILD SUCCEEDED

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx
git commit -m "feat: add PTT+ option in AudioSettingsTab"
```

---

## Task 7: Update OnboardingWizard

**Files:**
- Modify: `src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx:101`

- [ ] **Step 1: Add type to TransmissionMode**

Add at line 101:
```typescript
type TransmissionMode = 'pushToTalk' | 'voiceActivity' | 'continuous' | 'pushToTalkPlus';
```

- [ ] **Step 2: Add UI option**

Add around line 965-967:
```typescript
{ value: 'pushToTalkPlus', label: 'PTT+' },
{ value: 'pushToTalk', label: 'Push to Talk' },
{ value: 'voiceActivity', label: 'Voice Activity' },
{ value: 'continuous', label: 'Continuous' },
```

- [ ] **Step 3: Add conditional rendering for key binding**

```typescript
{(settings.transmissionMode === 'pushToTalk' || settings.transmissionMode === 'pushToTalkPlus') && (
```

- [ ] **Step 4: Run frontend build**

Run: `cd src/Brmble.Web && npm run build`
Expected: BUILD SUCCEEDED

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/OnboardingWizard/OnboardingWizard.tsx
git commit -m "feat: add PTT+ option in OnboardingWizard"
```

---

## Task 8: Verify App.tsx Handling

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:544`

- [ ] **Step 1: Check if transmission mode needs update**

Read around line 544 in App.tsx - checks `newMode === 'pushToTalk'`.

- [ ] **Step 2: Add PTT+ handling**

Add check for PTT+:
```typescript
newMode === 'pushToTalk' || newMode === 'pushToTalkPlus'
```

- [ ] **Step 3: Run frontend build**

Run: `cd src/Brmble.Web && npm run build`
Expected: BUILD SUCCEEDED

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: handle PTT+ mode in App.tsx"
```

---

## Task 9: Full Integration Test

- [ ] **Step 1: Build both client and web**

Run: `dotnet build` and `cd src/Brmble.Web && npm run build`
Expected: BUILD SUCCEEDED

- [ ] **Step 2: Commit final**

```bash
git add .
git commit -m "feat: complete PTT+ implementation"
```