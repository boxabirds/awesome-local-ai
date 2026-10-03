/**
 * TEST-ONLY worker routes and module state, enabled only when
 * `env.TEST_HOOKS === '1'` (set via wrangler `vars` for local dev and tests).
 *
 * Routes (all under `/__test/`):
 * - `POST /__test/fail-next-create`  make the next `POST /api/boards` fail with 500 (TC-12)
 * - `GET  /__test/namespace-gets`    count of Durable Object namespace gets (TC-07: no RPC for malformed ids)
 * - `GET  /__test/storage/:id`       storage facts: tables, created_at, row counts
 * - `POST /__test/seed-board/:id`    seed legacy `updates` rows without `created_at` (TC-08, e2e TC-31)
 * - `POST /__test/initialize/:id`    call `initialize()` directly (TC-15)
 *
 * None of these are reachable unless TEST_HOOKS is set; in that case they are
 * part of the local dev surface, consistent with the `window.__vidi6` hooks
 * (see NOTES.md).
 */
import { isValidBoardId } from '../shared/board-id';
import type { BoardRoomStub } from './board-room';
import type { Env } from './index';

let failNextCreate = false;
let namespaceGets = 0;

export function setFailNextCreate(fail: boolean): void {
  failNextCreate = fail;
}

/** Returns (and clears) the pending "fail next create" flag. */
export function consumeFailNextCreate(): boolean {
  const v = failNextCreate;
  failNextCreate = false;
  return v;
}

export function recordNamespaceGet(): void {
  namespaceGets += 1;
}

export function getNamespaceGetCount(): number {
  return namespaceGets;
}



function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function base64ToBytes(b64: string): Uint8Array {
  const base64 = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Handles a TEST-ONLY request; returns null when the request is not a test
 * route (or test hooks are disabled) so the caller falls through.
 */
export async function handleTestHook(req: Request, env: Env): Promise<Response | null> {
  if (env.TEST_HOOKS !== '1') return null;
  const url = new URL(req.url);
  const m = url.pathname.match(/^\/__test\/([a-z-]+)(?:\/([^/]+))?$/);
  if (!m) return null;
  const [, name, arg] = m;

  switch (name) {
    case 'fail-next-create': {
      if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      setFailNextCreate(true);
      return json({ ok: true });
    }
    case 'namespace-gets': {
      return json({ count: getNamespaceGetCount() });
    }
    case 'init-count': {
      const { BoardRoom } = await import('./board-room');
      return json({
        initializeCalls: BoardRoom.__testInitializeCalls,
        initializeThrew: BoardRoom.__testInitializeThrew,
      });
    }
    case 'reset-counters': {
      if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      const { BoardRoom } = await import('./board-room');
      BoardRoom.__testInitializeCalls = 0;
      BoardRoom.__testInitializeThrew = false;
      return json({ ok: true });
    }
    case 'storage': {
      if (!arg || !isValidBoardId(arg)) return json({ error: 'bad_id' }, 400);
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(arg)) as BoardRoomStub;
      const info = await stub.__testStorageInfo();
      return json(info);
    }
    case 'seed-board': {
      if (req.method !== 'POST' || !arg || !isValidBoardId(arg)) {
        return json({ error: 'bad_request' }, 400);
      }
      const body = (await req.json()) as { updates: string[] };
      const updates = (body.updates ?? []).map(base64ToBytes);
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(arg)) as BoardRoomStub;
      await stub.__testSeed(updates);
      return json({ ok: true });
    }
    case 'initialize': {
      if (req.method !== 'POST' || !arg || !isValidBoardId(arg)) {
        return json({ error: 'bad_request' }, 400);
      }
      const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(arg)) as BoardRoomStub;
      const result = await stub.initialize();
      const info = await stub.__testStorageInfo();
      return json({ result, createdAt: info.createdAt });
    }
    default:
      return json({ error: 'unknown_test_route' }, 404);
  }
}
