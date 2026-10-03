/**
 * The small shared helpers every module reaches for.
 *
 * `isFiniteNumber` is the guard for anything that has come from a pointer, a
 * wheel delta, a URL or another peer's document: `Number.isFinite` also rules out
 * the strings and `NaN`s that JSON and `Number(undefined)` produce, which is the
 * difference between a board that ignores a broken gesture and a board that
 * stores an unreadable object for everybody (`sticky.invalid`).
 */

/** Is this a number, and a usable one? Narrows `unknown` to `number`. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
