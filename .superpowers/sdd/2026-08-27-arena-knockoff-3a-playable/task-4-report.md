# Task 4 Report: Checked Fixed-Point Math And Arena Ruleset V1

## Status

Implemented the deterministic C# fixed-point primitives, Arena ruleset version 1, named prediction constants, and matching TypeScript prediction math. The work stayed within the five Task 4 source/test files plus this report.

## RED Evidence

### C#

Command:

```text
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~FixedPointTests
```

The first run failed with `CS0234` because the test imported the not-yet-created `Brmble.Server.Games.Arena` namespace. I removed that import so compilation could reach the required missing symbols and reran before adding production code.

The corrected RED failed because the math types were absent:

```text
CS0246: The type or namespace name 'FixedVec' could not be found
CS0103: The name 'FixedPointHash' does not exist in the current context
CS0103: The name 'ArenaRulesetV1' does not exist in the current context
```

`FixedPointHash` and `ArenaRulesetV1` occur only in expressions, so Roslyn reports unresolved names as `CS0103`; `FixedVec` occurs in a type position and reports the brief's `CS0246`. No production implementation existed.

### TypeScript

Command from `src/Brmble.Web`:

```text
npm test -- --run src/components/Games/Arena/arenaMath.test.ts
```

The RED failed to resolve the required missing module:

```text
Error: Failed to resolve import "./arenaMath"
Test Files 1 failed (1)
```

## GREEN Evidence

Required x64 C# command:

```text
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~FixedPointTests -a x64
Passed! - Failed: 0, Passed: 14, Skipped: 0, Total: 14
```

Required TypeScript command from `src/Brmble.Web`:

```text
npm test -- --run src/components/Games/Arena/arenaMath.test.ts
Test Files 1 passed (1)
Tests 12 passed (12)
```

Additional verification:

```text
npm run type-check
tsc -b tsconfig.test.json --force
Exit code 0

git diff --check
Exit code 0
```

## Implementation

- Added `FixedVec` Q15 normalization and scaling with widened signed `long` products and checked `int` conversions.
- Added a restoring integer square root over `ulong`; no floating-point square root is used.
- Added FNV-1a 64 hashing with offset basis `14695981039346656037`, prime `1099511628211`, and declared-order little-endian signed 32-bit fields.
- Added every frozen `ArenaRulesetV1` constant and the exact move, knockback, recoil, charge, and arena-radius formulas.
- Added the sealed `ArenaPredictionConstants` record with explicit JSON property names matching all 16 fields in `welcome.prediction`.
- Added TypeScript parity helpers using BigInt widened products, BigInt restoring square root, toward-zero BigInt division, and checked conversion to JavaScript safe integers.
- Added the exact C# and TypeScript golden vectors from the brief without alternate expected values.

## Files

- `src/Brmble.Server/Games/Continuous/FixedPoint.cs`
- `src/Brmble.Server/Games/Arena/ArenaRulesetV1.cs`
- `tests/Brmble.Server.Tests/Games/Continuous/FixedPointTests.cs`
- `src/Brmble.Web/src/components/Games/Arena/arenaMath.ts`
- `src/Brmble.Web/src/components/Games/Arena/arenaMath.test.ts`
- `.superpowers/sdd/2026-08-27-arena-knockoff-3a-playable/task-4-report.md`

## Self-Review

- All simulation/prediction multiply-divide paths widen before division and truncate toward zero.
- C# computed state writes checked-convert to `int`; TypeScript converts BigInt results only after checking the safe-integer bounds.
- Integer square root uses restoring integer arithmetic only. No `Math.Sqrt`, `Math.sqrt`, `double`, floating-point division, or RNG was introduced.
- Hashing preserves caller field order and writes each field little-endian before applying exact FNV-1a constants.
- Ruleset constants were compared line-by-line with the frozen Task 4 constants block.
- Prediction JSON names were compared with the frozen welcome object: all 16 names and values match.
- No spectator, event-bus snapshot, `IGameEngine`, `GameSessionManager`, catalog, router, or other out-of-scope implementation file changed.
- The protected untracked `.opencode/plans` files were not touched.

## Concerns

None. The initial C# RED required removing an impossible namespace import to expose the requested missing-type diagnostics; that correction occurred before production code was written and is documented above.

## Fix Round 1

### Findings Addressed

- Changed the TypeScript restoring integer square root to choose the largest power-of-four bit not exceeding the BigInt radicand. This supports the full safe-integer coordinate domain accepted by the exported API, including radicands wider than 64 bits.
- Added a literal FNV-1a 64 expected value for signed fields `(1, -2, 3, -4)` serialized in declared order as little-endian `int32` bytes.
- Did not address the three deferred Minor findings.

### Independent Hash Calculation

The expected hash was calculated independently from the production implementation using these literal bytes:

```text
01 00 00 00 FE FF FF FF 03 00 00 00 FC FF FF FF
```

Starting with FNV-1a offset basis `14695981039346656037`, XORing each byte in order, and multiplying modulo `2^64` by prime `1099511628211` gives:

```text
decimal: 7956192837767188637
hex:     0x6e6a133b739ed09d
```

The test asserts the decimal literal `7_956_192_837_767_188_637UL`; it does not call production code to derive the expected value.

### RED Evidence

TypeScript command from `src/Brmble.Web`:

```text
npm test -- --run src/components/Games/Arena/arenaMath.test.ts
Test Files 1 failed (1)
Tests 1 failed | 12 passed (13)
AssertionError: expected { x: 68717379599, y: +0 } to deeply equal { x: 32767, y: +0 }
```

The new regression used `normalizeQ15(Number.MAX_SAFE_INTEGER, 0)`. Its squared radicand is wider than 64 bits, proving that fixed `1n << 62n` initialization skipped high-order radicand bits and leaked an unsafe normalized component.

C# command:

```text
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~FixedPointTests -a x64
Passed! - Failed: 0, Passed: 14, Skipped: 0, Total: 14
```

The hash assertion strengthens already-correct production behavior, so it passed when introduced. Its expected value was independently calculated as documented above.

### GREEN Evidence

TypeScript command from `src/Brmble.Web`:

```text
npm test -- --run src/components/Games/Arena/arenaMath.test.ts
Test Files 1 passed (1)
Tests 13 passed (13)
```

C# x64 command:

```text
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~FixedPointTests -a x64
Passed! - Failed: 0, Passed: 14, Skipped: 0, Total: 14
```

TypeScript type-check from `src/Brmble.Web`:

```text
npm run type-check
tsc -b tsconfig.test.json --force
Exit code 0
```

Repository whitespace check:

```text
git diff --check
Exit code 0
```

### Mutation Reasoning

- Restoring the fixed `1n << 62n` initial bit makes the `Number.MAX_SAFE_INTEGER` axis regression fail with `x = 68717379599`, so the test specifically detects truncated high-order square-root work and unsafe output leakage.
- Reversing field order changes the literal byte stream and fails the fixed hash assertion.
- Writing big-endian rather than little-endian changes each four-byte group and fails the fixed hash assertion.
- Encoding negative values without their signed two's-complement `int32` bytes changes `FE FF FF FF` or `FC FF FF FF` and fails the fixed hash assertion.
- Changing the FNV offset basis, prime, XOR/multiply order, or 64-bit wrap behavior changes `0x6e6a133b739ed09d` and fails the fixed hash assertion.

### Concerns

None. Dynamic BigInt initialization preserves the restoring algorithm and existing golden vectors while matching the exported TypeScript functions' safe-integer input range.
