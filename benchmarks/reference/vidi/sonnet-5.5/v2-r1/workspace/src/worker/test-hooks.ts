import { isValidBoardId } from '../shared/board-id';
import type { Env } from './index';

const HOOK_ROUTE = /^\/__test\/boards\/([^/]*)\/(corrupt-snapshot|repair|seed-legacy)$/;

/** Storage corruption/repair routes for the broken-board e2e. Exists only when `env.TEST_HOOKS === '1'`. */
export async function handleTestHook(req: Request, env: Env): Promise<Response | null> {
  if (env.TEST_HOOKS !== '1') return null;
  const match = HOOK_ROUTE.exec(new URL(req.url).pathname);
  if (!match) return null;
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  if (!isValidBoardId(match[1])) return new Response('Bad Request', { status: 400 });
  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(match[1]));
  if (match[2] === 'seed-legacy') await room.testSeedLegacy(new Uint8Array(await req.arrayBuffer()));
  else if (match[2] === 'corrupt-snapshot') await room.testCorruptSnapshot();
  else await room.testRepairSnapshot();
  return new Response(null, { status: 204 });
}
