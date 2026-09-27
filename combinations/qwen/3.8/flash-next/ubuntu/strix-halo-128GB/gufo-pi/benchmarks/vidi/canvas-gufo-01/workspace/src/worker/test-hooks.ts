// Test-only routes, active ONLY when env.TEST_HOOKS === '1' (set in the e2e
// `wrangler dev` invocation, never in production). They exist so tests can
// construct a "legacy board" — storage with content but no created_at marker —
// which is impossible through the public API (PRD share.legacy_boards).

import * as Y from 'yjs';
import { createSticky, initDoc, setStickyColor, getStickyText } from '../shared/board-model';
import { newBoardId } from '../shared/board-id';
import type { Env } from './env';

export const SEED_LEGACY_ROUTE = '/__test/seed-legacy-board';

interface SeedBody {
  notes?: { x?: number; y?: number; color?: string; text?: string }[];
}

/** Build one Yjs update containing the requested sticky notes. */
function buildLegacyUpdate(notes: NonNullable<SeedBody['notes']>): string {
  const doc = new Y.Doc();
  initDoc(doc);
  for (const note of notes) {
    const id = createSticky(doc, {
      x: Number.isFinite(note.x) ? Number(note.x) : 0,
      y: Number.isFinite(note.y) ? Number(note.y) : 0,
    });
    if (typeof note.color === 'string') setStickyColor(doc, id, note.color);
    if (typeof note.text === 'string') getStickyText(doc, id)?.insert(0, note.text);
  }
  const update = Y.encodeStateAsUpdate(doc);
  let bin = '';
  for (const b of update) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function handleTestHook(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> {
  if (env.TEST_HOOKS !== '1') return null; // route does not exist without the flag
  if (pathname !== SEED_LEGACY_ROUTE) return null;
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const body = (await request.json().catch(() => ({}))) as SeedBody;
  const id = newBoardId();
  const updateB64 = buildLegacyUpdate(Array.isArray(body.notes) ? body.notes : []);
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  await stub.seedLegacy([updateB64]);
  return Response.json({ id }, { status: 201 });
}
