// This tab's identity, in the shape story 6 will give it a name.
//
// Story 6 has not run yet, and the design for story 9 says so plainly: a text
// object's `createdBy` takes a locally generated id for now. One id per tab,
// made once, so every object this tab creates carries the same mark and the
// story that brings real identities has exactly one line to change.
let cached: string | null = null;

export function localIdentityId(): string {
  if (cached === null) {
    cached =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `g_${Math.random().toString(36).slice(2, 10)}`;
  }
  return cached;
}
