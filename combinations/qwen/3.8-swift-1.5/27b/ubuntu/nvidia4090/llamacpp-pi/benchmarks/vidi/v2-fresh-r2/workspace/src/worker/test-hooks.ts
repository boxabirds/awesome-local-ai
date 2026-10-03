/**
 * Test-only worker routes (story 5).
 *
 * Enabled only when the `TEST_HOOKS` binding is '1' (set via `vars` in
 * wrangler.jsonc for the integration pool and the e2e wrangler dev server).
 *
 * Routes (all under /__test):
 * - GET  /__test/boards/:id/tables        → table names in sqlite_master
 * - GET  /__test/boards/:id/exists        → 200/404 via exists()
 * - POST /__test/boards/:id/sql           → run a read-only query (body)
 * - POST /__test/boards/:id/seed-legacy   → seed legacy data (no created_at)
 * - POST /__test/boards/:id/init          → call initialize()
 */
import type { Env } from './index';

const HOOK_PATH = /^\/__test\/boards\/([^/]+)\/(tables|exists|sql|seed-legacy|init)$/;

export async function handleTestHook(
  req: Request,
  env: Env,
  url: URL,
): Promise<Response | null> {
  const match = url.pathname.match(HOOK_PATH);
  if (!match) return null;
  const [, boardId, action] = match;
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));

  switch (action) {
    case 'tables': {
      const rows = (await stub.testSql(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )) as unknown[];
      return Response.json(rows);
    }
    case 'exists': {
      const exists = await stub.exists();
      return exists
        ? Response.json({ exists: true })
        : new Response('Not Found', { status: 404 });
    }
    case 'sql': {
      if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      const query = await req.text();
      const rows = (await stub.testSql(query)) as unknown[];
      return Response.json(rows);
    }
    case 'seed-legacy': {
      if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      const seeded = await stub.seedLegacy();
      return Response.json({ seeded });
    }
    case 'init': {
      if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      const result = await stub.initialize();
      return Response.json({ result });
    }
    default:
      return null;
  }
}
