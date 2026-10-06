/**
 * Transaction origins shared by every board document module.
 *
 * It lives in its own file so the object-type modules (`objects/sticky`, `objects/text`, …)
 * can mark their writes without importing the whole document model, which keeps the import
 * graph one-directional. `board-model` re-exports it, so existing callers are unchanged.
 */

/** Transaction origin for changes made by this user (story 3 never echoes these back). */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6-local');

/**
 * Transaction origin for a box that grew to hold the text drawn on this screen (story 9).
 *
 * It is a local write - it syncs to everybody, like any other - but it is not something the person
 * did, so the UndoManager, which follows `LOCAL_ORIGIN`, leaves it out of the undo steps.
 */
export const BOX_ORIGIN: unique symbol = Symbol('vidi6-box');

function originOf(value: unknown): unknown {
  return value && typeof value === 'object' && 'origin' in value
    ? (value as { origin: unknown }).origin
    : undefined;
}

/**
 * Was this change made here, or did it arrive from someone else?
 *
 * Pass the arguments the observer was given:
 *
 * ```ts
 * ytext.observe((event, transaction) => {
 *   if (transactionOrigin(event, transaction) !== LOCAL_ORIGIN) { ... }
 * });
 * ```
 *
 * A type observer receives `(event, transaction)` and the origin is on the transaction; a
 * transaction passed on its own is understood too. `undefined` means "not a change made here",
 * which is what an update from the server - or from another client through the server - carries.
 *
 * The `Doc`'s own `update` event is the exception: it hands the origin directly, so there the
 * comparison is written against that argument.
 */
export function transactionOrigin(...observed: unknown[]): unknown {
  for (const value of observed) {
    // an event, and the transaction it belongs to
    const fromEvent = originOf((value as { transaction?: unknown } | null)?.transaction);
    if (fromEvent !== undefined) return fromEvent;
    // the transaction itself
    const direct = originOf(value);
    if (direct !== undefined) return direct;
  }
  return undefined;
}
