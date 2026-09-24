/**
 * The Worker's bindings, in one place so `create-board.ts` and the fetch layer
 * agree on them.
 *
 * Deliberately **no** import from `cloudflare:workers` and no import of the
 * `BoardRoom` class: the create logic is pure enough to unit-test in plain Node
 * (TC-01 … TC-04), and pulling the Cloudflare ambient types into that project
 * would make the shapes unresolvable there. The two members the Worker actually
 * calls are declared structurally instead — which is also exactly the subset a
 * test needs to fake.
 */

/** What the Worker calls on a board's Durable Object. */
export interface BoardRoomLike {
  /** Create the board if it is absent; `'exists'` means the id was taken. */
  initialize(): Promise<'created' | 'exists'>;
  /** Read-only existence probe. */
  exists(): Promise<boolean>;
  /** The collab upgrade and the test-only storage routes. */
  fetch(request: Request): Promise<Response>;
}

/** The subset of `DurableObjectNamespace` the create path uses. */
export interface RoomNamespaceLike {
  idFromName(name: string): string;
  get(id: string): BoardRoomLike;
}

/** What a create attempt reports back. */
export type InitOutcome = 'created' | 'exists';

/** A visitor create-limiter: `success: false` means "over the limit". */
export interface Limiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  /** Absent in a plain `vite build` test build: a create then fails honestly. */
  BOARD_ROOM?: RoomNamespaceLike;
  /** Absent means the create limit is not enforced in that environment. */
  BOARD_CREATE_LIMITER?: Limiter;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  /** Test-only escape hatch (story 4 test hooks); read via `test-hooks.ts`. */
  TEST_HOOKS?: string;
}
