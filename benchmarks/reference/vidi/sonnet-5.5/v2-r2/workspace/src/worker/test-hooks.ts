import { isValidBoardId } from '../shared/board-id';
import type { Env } from './index';

const HOOK_PATH = /^\/__test\/boards\/([^/]+)\/(corrupt-snapshot|repair)$/;

/** Test-only storage corruption routes; only called when `env.TEST_HOOKS === '1'`. */
export async function handleTestHook(req: Request, env: Env, pathname: string): Promise<Response | null> {
  const match = HOOK_PATH.exec(pathname);
  if (!match || req.method !== 'POST') return null;
  if (!isValidBoardId(match[1])) return new Response('Bad Request', { status: 400 });
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(match[1]));
  try {
    if (match[2] === 'corrupt-snapshot') await stub.testCorruptSnapshot();
    else await stub.testRepairSnapshot();
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
  return new Response(null, { status: 204 });
}
