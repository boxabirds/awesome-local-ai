/**
 * Board creation and the existence seam (story 5, `share.create`,
 * `share.unguessable`, `share.not_found`).
 *
 * Creating a board is two steps and nothing else: one 128-bit random id from
 * `newBoardId()`, then one `initialize()` RPC that writes `created_at` inside
 * the board's own storage. There is no retry loop and no "create if absent"
 * dance: a collision between 128 random bits is not a practical event, and if
 * it ever happened `initialize()` would answer `exists` and creation would
 * fail with a 500 rather than quietly hand two people the same board.
 *
 * The point of doing it server-side (story 3 generated the id in the browser)
 * is that a board address now has to be *granted* by the service: a guessed or
 * mistyped address lands on Board not found instead of silently starting a
 * board nobody asked for.
 *
 * The types here describe the Durable Object stub by *what we call on it*, so
 * both the real `DurableObjectNamespace` binding and a test double satisfy
 * them, and this module stays loadable outside the Workers runtime (the RPC
 * methods really are callable on a stub — server-to-server RPC).
 */

import { newBoardId } from '../shared/board-id'

/** The RPC surface of a `BoardRoom` (callable on a namespace stub). */
export interface BoardRoomStubLike {
  fetch(request: Request): Promise<Response>
  /** Migrate + write `created_at` if absent. */
  initialize(): Promise<'created' | 'exists'>
  /** Read-only existence check: never creates tables. */
  exists(): Promise<boolean>
  /** Test-hook only: seed stored updates without `created_at`. */
  seed(updates: string[]): Promise<number>
}

export interface BoardRoomNamespaceLike {
  idFromName(name: string): unknown
  get(id: unknown): BoardRoomStubLike
}

/** Everything board creation needs from the Worker environment. */
export interface CreateBoardEnv {
  BOARD_ROOM: BoardRoomNamespaceLike
}

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Create one new board and return its address.
 *
 * `ok: false` covers both a thrown RPC and a freshly generated id whose object
 * already answered `exists`; the caller turns either into
 * `500 {"error":"create_failed"}` and the client keeps the person on the home
 * page with an explanation (`share.create_failure`).
 */
export async function createBoard(env: CreateBoardEnv): Promise<CreateResult> {
  const id = newBoardId()
  const namespace = env.BOARD_ROOM
  const stub = namespace.get(namespace.idFromName(id))

  try {
    const result = await stub.initialize()
    if (result === 'created') return { ok: true, id }
    console.error(`[create-board] initialize(${id}) answered ${result}: refusing to share an existing board`)
    return { ok: false, reason: 'create_failed' }
  } catch (error) {
    console.error(`[create-board] initialize(${id}) threw: ${messageOf(error)}`)
    return { ok: false, reason: 'create_failed' }
  }
}
