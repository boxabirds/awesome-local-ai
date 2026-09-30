/**
 * Test-only hooks for e2e tests. These routes are only registered when
 * `env.TEST_HOOKS === '1'` (set only in the e2e wrangler environment).
 */
export async function handleTestHooks(
  req: Request,
  env: { BOARD_ROOM: DurableObjectNamespace; TEST_HOOKS?: string },
): Promise<Response | null> {
  if (env.TEST_HOOKS !== '1') return null;

  const url = new URL(req.url);

  // POST /__test/boards/:id/corrupt-snapshot
  if (url.pathname.match(/^\/__test\/boards\/[^/]+\/corrupt-snapshot$/) && req.method === 'POST') {
    const boardId = url.pathname.split('/')[3];
    const id = env.BOARD_ROOM.idFromName(boardId);
    const stub = env.BOARD_ROOM.get(id);

    // Use a special fetch to the DO to corrupt the snapshot
    const resp = await stub.fetch(new Request('http://internal/__corrupt_snapshot', {
      method: 'POST',
    }));
    return new Response(await resp.text(), { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  // POST /__test/boards/:id/repair-snapshot
  if (url.pathname.match(/^\/__test\/boards\/[^/]+\/repair-snapshot$/) && req.method === 'POST') {
    const boardId = url.pathname.split('/')[3];
    const id = env.BOARD_ROOM.idFromName(boardId);
    const stub = env.BOARD_ROOM.get(id);

    const resp = await stub.fetch(new Request('http://internal/__repair_snapshot', {
      method: 'POST',
    }));
    return new Response(await resp.text(), { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  return null;
}
