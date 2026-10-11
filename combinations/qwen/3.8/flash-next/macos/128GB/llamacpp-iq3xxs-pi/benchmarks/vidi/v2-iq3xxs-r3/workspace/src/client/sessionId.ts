/**
 * The anonymous id of this tab, for the few fields that ask who made a thing.
 *
 * Story 6 (identity) is not in this build, so there is no user to name and no
 * `useIdentity` to ask one for. Story 9's text objects store `createdBy`, and
 * what they store is this: one identifier, generated once per tab, that means
 * "the screen that typed it" and nothing more — it is not shared between tabs,
 * not stable across a reload, and never presented as a name.
 *
 * When story 6 lands it replaces the *argument* at the call sites, not the
 * signatures: `createText(doc, at, sessionId())` becomes
 * `createText(doc, at, identity.id)`.
 */
export function sessionId(): string {
  if (id === undefined) id = crypto.randomUUID();
  return id;
}

let id: string | undefined;
