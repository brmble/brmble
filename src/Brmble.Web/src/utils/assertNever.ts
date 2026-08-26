/**
 * Exhaustiveness guard. Put this in a `default:` (or final `else`) branch over a
 * union: TypeScript only accepts the call when every member has been handled, so
 * adding a union member turns a silent fallthrough into a compile error.
 *
 * It also throws at runtime, because narrowing can be defeated by data arriving
 * from outside the type system (a server event, `JSON.parse`), and a loud failure
 * beats a silently wrong render.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled union member: ${JSON.stringify(value)}`);
}
