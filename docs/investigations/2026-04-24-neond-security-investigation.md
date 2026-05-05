# Security Investigation Report: NeonD Component

**Date:** 2026-04-24  
**Component:** `src/Brmble.Web/src/components/NeonD/`  
**Files Analyzed:**
- `NeonDGame.tsx` (455 lines)
- `types.ts` (44 lines)
- `constants.ts` (86 lines)
- `hooks/useGameEngine.ts` (275 lines)

---

## Executive Summary

No critical security vulnerabilities were found. The NeonD component is a client-side idle game with no backend communication, no external data handling, and no exposure of sensitive information.

---

## Findings

### ✅ Secure: No External Communication
The game operates entirely on client-side React state. There are no:
- API calls to external servers
- WebSocket connections
- Data exfiltration mechanisms
- User authentication or authorization logic

### ✅ Secure: No Sensitive Data
No secrets, API keys, credentials, or personal information are present in the codebase.

### ✅ Secure: Input Handling
The component does not render user-supplied HTML or accept unsafe input. All displayed data is:
- Hardcoded game constants
- Client-generated random values
- Local React state

### ✅ Secure: Cryptographic Usage
- Uses `crypto.randomUUID()` for dealer IDs (cryptographically secure)
- `Math.random()` is used for game mechanics only (acceptable for client-side games)

---

## Potential Improvements (Non-Critical)

### 1. Undefined Reference Risk (Low)
**Location:** `NeonDGame.tsx:339`

```tsx
{slot.name} ({state.production[slot.selling]?.name})
```

The `slot.selling` could reference a product ID that isn't in `state.production`. While the `?.` optional chaining prevents a crash, this indicates a potential logic issue where a dealer's selling product might not exist.

**Recommendation:** Validate that `slot.selling` always references a valid unlocked product.

### 2. Undefined Side Hustle Product (Low)
**Location:** `NeonDGame.tsx:75`, `useGameEngine.ts:225`

```tsx
description: `Sell ${state.production[productId]?.name} at 10% volume`
```

When generating upgrade options, the code accesses `state.production[productId]?.name`. If the product ID doesn't exist (e.g., due to race conditions or state corruption), this would show "undefined" in the UI.

**Recommendation:** Filter out invalid product IDs before generating upgrade options.

### 3. Missing Validation for Dealer Selling Product
**Location:** `useGameEngine.ts:249-258`

The `setDealerSelling` function doesn't validate that the new `selling` value corresponds to an unlocked production item:

```tsx
const setDealerSelling = (dealerId: string, selling: string) => {
  // No validation that 'selling' is in unlockedProduction
  newActiveDealers[slotIndex] = { ...dealer, selling };
```

**Recommendation:** Add validation:
```tsx
if (!prev.unlockedProduction.includes(selling)) return prev;
```

---

## Conclusion

The NeonD component is a self-contained client-side game with no significant security concerns. The issues identified above are:
- Not security vulnerabilities per se
- More like robustness/logic improvements
- Would only affect the single user's local game experience

**Risk Level:** 🟢 **Low** - No actionable security issues found.