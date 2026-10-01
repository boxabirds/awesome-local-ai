import { isValidBoardId } from '../shared/board-id';
import type { Env } from './index';

const HOOK_PATH = /^\/__test\/boards\/([^/]+)\/(corrupt-snapshot|repair|initialize|seed-legacy)$/;

/** Test-only storage corruption/repair routes; null unless env.TEST_HOOKS === '1' and the path matches. */
export async function handleTestHook(req: Request, env: Env): Promise<Response | null> {
  if (env.TEST_HOOKS !== '1' || req.method !== 'POST') return null;
  const m = HOOK_PATH.exec(new URL(req.url).pathname);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  if (!isValidBoardId(id)) return new Response('Bad Request', { status: 400 });
  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  if (m[2] === 'corrupt-snapshot') await room.testCorruptSnapshot();
  else if (m[2] === 'repair') await room.testRepairSnapshot();
  else if (m[2] === 'initialize') await room.initialize(); // creates a board at a chosen id
  else await room.testSeedLegacy(new Uint8Array(await req.arrayBuffer())); // body: a Yjs update
  return new Response('ok');
}
