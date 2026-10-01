import { isValidBoardId } from '../shared/board-id';
import type { Env } from './index';

const HOOK_PATH = /^\/__test\/boards\/([^/]+)\/(corrupt-snapshot|repair)$/;

/** Test-only storage corruption/repair routes; null unless env.TEST_HOOKS === '1' and the path matches. */
export async function handleTestHook(req: Request, env: Env): Promise<Response | null> {
  if (env.TEST_HOOKS !== '1' || req.method !== 'POST') return null;
  const m = HOOK_PATH.exec(new URL(req.url).pathname);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  if (!isValidBoardId(id)) return new Response('Bad Request', { status: 400 });
  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  if (m[2] === 'corrupt-snapshot') await room.testCorruptSnapshot();
  else await room.testRepairSnapshot();
  return new Response('ok');
}
