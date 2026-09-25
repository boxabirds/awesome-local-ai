/**
 * The pure half of creating a board (story 5).
 *
 * Two rules, both of which exist because a board link is a capability: whoever
 * has it can edit the board. So a link is only ever minted deliberately — by
 * clicking *Create a board* — and it is only handed out if it is nobody else's.
 *
 * This file holds the decisions, not the I/O: how many times to look for a free
 * id, and what to do when the search runs out. It deliberately imports nothing
 * from `cloudflare:workers` or the Durable Object world, so the same function
 * can be unit-tested with a fake resolver and run inside the Worker. The
 * performing half — the rate limiter binding and the room stub — is in
 * `../worker/create-board.ts`.
 *
 * The retry uses a *new* random id each time rather than re-asking for the same
 * one. A taken id is not the visitor's to keep, and asking for it twice spends
 * the attempt budget twice for a result that was already known.
 */
import { CREATE_ID_MAX_ATTEMPTS } from './config';

/** What one create attempt is allowed to answer. */
export type InitializeResult = 'created' | 'exists';

/**
 * The shape of a Workers rate-limit binding, and of the fake used in tests.
 *
 * `limit` is allowed to reject. It is treated exactly like a denial: the point
 * of the limit is to stop work before it happens, and a limiter nobody can hear
 * is not stopping anything.
 */
export interface Limiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** The outcome of a create, in the words the routes need. */
export type CreateResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: 'rate_limited' | 'create_failed' };

/**
 * Mint ids until one is free, or the attempts run out.
 *
 * `generate` is called once per attempt, and only per attempt — a fifth call
 * would mean a fifth attempt, which is the thing the ceiling forbids. `resolve`
 * answers `exists` for an id that is already somebody's, including one that was
 * merely taken *this attempt* by a racing request; both mean "try a different
 * id", never "wait for the one you have".
 */
export async function createWithRetries(
  generate: () => string,
  resolve: (id: string) => Promise<InitializeResult>,
  maxAttempts: number = CREATE_ID_MAX_ATTEMPTS,
): Promise<{ ok: true; id: string } | { ok: false }> {
  // A non-positive budget is a misconfiguration, not an infinite loop, and it
  // is reported the same way an exhausted one is.
  if (!(maxAttempts > 0)) return { ok: false };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = generate();
    let outcome: InitializeResult;
    try {
      outcome = await resolve(id);
    } catch {
      // A storage error is not a collision. Retrying it against the same broken
      // storage would only spend the budget, and the difference between
      // "someone has this id" and "we could not look" is not the caller's to
      // act on: either way there is no board to hand out.
      return { ok: false };
    }
    if (outcome === 'created') return { ok: true, id };
  }
  return { ok: false };
}
