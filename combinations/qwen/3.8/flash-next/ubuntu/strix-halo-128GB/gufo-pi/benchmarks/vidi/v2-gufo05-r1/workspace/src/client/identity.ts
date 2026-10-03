/**
 * Who this person is, for the board.
 *
 * Story 6 gives the board real identity — an avatar, a name, presence, and a
 * sign-in that survives a reload. Until then an object still has to record who
 * made it: `createdBy` is part of the schema from the moment the first object type
 * needs an owner, and an object created without it could never be attributed later.
 *
 * So this is a per-tab identifier: random, private, and stable for as long as this
 * tab holds the board open. It is deliberately *not* stored anywhere durable —
 * a fresh tab is a fresh person, which is what a board with no accounts actually
 * knows — and it is deliberately the same shape story 6 will hand out, so the call
 * sites below do not change when that identity arrives.
 */

export interface Identity {
  /** Stable for this tab. Written into `createdBy` on every object this tab makes. */
  readonly id: string;
}

/**
 * This tab's identity, made once.
 *
 * One per module load rather than one per object: two notes made by the same person
 * in the same tab should look like the same person made them.
 */
export const SELF: Identity = { id: crypto.randomUUID() };
