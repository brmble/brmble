# Trusted Author Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trust bridged author metadata only when the Matrix event sender is the exact configured Brmble bot.

**Architecture:** Derive the bot identity once from `MatrixSettings.ServerDomain`, expose it in the authenticated web Matrix credentials, and pass it explicitly into both server parsing and web event transformation. Invalid sender/metadata combinations fall back to the actual Matrix sender.

**Tech Stack:** ASP.NET Core/C#, MSTest, React/TypeScript, Vitest.

## Global Constraints

- Preserve existing bridged message formatting and deletion-window behavior.
- Use exact ordinal Matrix user-ID comparisons.
- Add regression coverage before production changes.

---

### Task 1: Server trust validation

**Files:**
- Modify: `src/Brmble.Server/Messages/MessageDeletionPolicy.cs`
- Modify: `src/Brmble.Server/Messages/MessageDeletionService.cs`
- Modify: `src/Brmble.Server/Auth/AuthEndpoints.cs`
- Modify: `tests/Brmble.Server.Tests/Messages/MessageDeletionPolicyTests.cs`

- [ ] Write a failing test that parses forged metadata from `@alice:test` with trusted bot `@brmble:test` and expects `AuthorMatrixUserId` to be null.
- [ ] Run the server policy test and confirm it fails because parsing currently accepts the field.
- [ ] Add `trustedBotUserId` to parsing, retaining metadata only on an exact sender match; pass the configured bot ID from deletion service and expose the same ID in the auth Matrix payload.
- [ ] Add/retain the positive bot-authored parsing test.
- [ ] Run the server policy tests and confirm they pass.

### Task 2: Web trust validation

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts`
- Modify: `src/Brmble.Web/src/utils/matrixCredentials.ts`
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`
- Modify: `src/Brmble.Web/src/utils/matrixCredentials.test.ts`

- [ ] Write a failing transformer test where a non-bot sender forges the author field and expect the sender ID to remain the event sender.
- [ ] Run the focused Vitest test and confirm it fails because metadata is currently trusted unconditionally.
- [ ] Add `botUserId` to credentials and transformer inputs, and honor metadata only when the actual sender exactly equals that ID.
- [ ] Include `botUserId` in credential equality.
- [ ] Run focused web tests and confirm they pass.

### Task 3: Full verification

**Files:**
- No additional files.

- [ ] Run the full server test project.
- [ ] Run the full web test suite.
- [ ] Review the diff for scope, exact comparisons, and absence of forged-metadata paths.
