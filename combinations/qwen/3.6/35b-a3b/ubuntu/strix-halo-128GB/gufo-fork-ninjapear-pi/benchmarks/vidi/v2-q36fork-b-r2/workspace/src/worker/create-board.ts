import { newBoardId } from '../shared/board-id';

// Runtime Env type — matches wrangler.jsonc bindings
interface RuntimeEnv {
  BOARD_ROOM: {
    get(name: string): {
      initialize(): Promise<'created' | 'exists'>;
      exists(): boolean;
    };
    idFromName(name: string): string;
  };
}

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'create_failed' };

/**
 * Create a new board: generate a random id, call initialize() RPC.
 * No retry loop — 128-bit ids never collide in practice.
 */
export async function createBoard(
  env: RuntimeEnv,
): Promise<CreateResult> {
  const id = newBoardId();
  try {
    const room = env.BOARD_ROOM!.get(env.BOARD_ROOM!.idFromName(id));
    const result = await room.initialize();
    if (result === 'exists') {
      // Id collision: extremely unlikely but possible if DurableObject was already initialized
      return { ok: false, reason: 'create_failed' };
    }
    return { ok: true, id };
  } catch (_e: unknown) {
    console.error({ msg: 'board-api.create-failed', error: _e });
    return { ok: false, reason: 'create_failed' };
  }
}
