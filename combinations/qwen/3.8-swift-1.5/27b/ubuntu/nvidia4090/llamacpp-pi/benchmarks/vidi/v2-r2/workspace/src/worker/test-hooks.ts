import { __installFaultyStoreFactory, __setFaults, type Env, type FaultConfig } from './board-room';

/**
 * Test-only HTTP endpoints, enabled only when env.TEST_HOOKS === '1'.
 * Used by integration tests (store/sql/fault access to a board's Durable
 * Object storage) and e2e tests (snapshot corruption/repair).
 */
export async function handleTestHooks(req: Request, env: Env): Promise<Response | null> {
  if (env.TEST_HOOKS !== '1') {
    return new Response('forbidden', { status: 403 });
  }
  const url = new URL(req.url);
  const match = url.pathname.match(/^\/__test\/boards\/([A-Za-z0-9_-]+)\/(sql|store|corrupt|repair|faults|reset)$/);
  if (!match || req.method !== 'POST') {
    return new Response('not found', { status: 404 });
  }
  const [, boardId, op] = match;
  const stub = await env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, detail: 'invalid json body' }, 400);
  }

  try {
    switch (op) {
      case 'sql': {
        const rows = await stub.__testSql(String(body.query), (body.params as (string | number | { b64: string })[]) ?? []);
        return json({ ok: true, rows });
      }
      case 'store': {
        const result = await stub.__testStore(
          String(body.op),
          body.updateB64 as string | undefined,
          body.selectMatch as string | undefined,
          body.updatesB64 as string[] | undefined
        );
        return json(result);
      }
      case 'corrupt': {
        const result = await stub.__testCorruptSnapshot('corrupt');
        return json(result);
      }
      case 'repair': {
        const result = await stub.__testCorruptSnapshot('repair');
        return json(result);
      }
      case 'reset': {
        const result = await stub.__testReset();
        return json(result);
      }
      case 'faults': {
        __installFaultyStoreFactory();
        // Faults are keyed by the DO's opaque id (what the room sees as ctx.id).
        const doId = env.BOARD_ROOM.idFromName(boardId).toString();
        if (body.reset) {
          __setFaults(doId, null);
          return json({ ok: true });
        }
        const fault: FaultConfig = {
          appendFailures: Number(body.appendFailures ?? 0),
          failSelectsMatching: (body.failSelectsMatching as string | null) ?? null,
        };
        __setFaults(doId, fault);
        return json({ ok: true });
      }
      default:
        return json({ ok: false, detail: `unknown op: ${op}` }, 400);
    }
  } catch (e) {
    return json({ ok: false, detail: String(e) }, 500);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
