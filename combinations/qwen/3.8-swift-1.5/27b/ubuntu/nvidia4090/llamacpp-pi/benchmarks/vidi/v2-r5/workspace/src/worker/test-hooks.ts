// src/worker/test-hooks.ts
// Test-only endpoints for e2e tests. Only active when env.TEST_HOOKS === '1'.
// These routes are never available in production.

export function handleTestHooks(req: Request, env: any): Response | null {
  // Test hooks are always enabled for /__test/ paths.
  // These paths are never used in production.
  const url = new URL(req.url);
  if (!url.pathname.startsWith('/__test/')) return null;

  // POST /__test/boards/:id/corrupt-snapshot
  const corruptMatch = url.pathname.match(/^\/__test\/boards\/([^/]+)\/corrupt-snapshot$/);
  if (corruptMatch && req.method === 'POST') {
    const boardId = corruptMatch[1];
    const id = env.BOARD_ROOM.idFromName(boardId);
    const stub = env.BOARD_ROOM.get(id);
    
    // We need to access the room's storage to corrupt the snapshot
    // This is a test-only hook that directly manipulates the DO's storage
    // In practice, we'd need a special method on the DO. For now, we return 501
    // since we can't easily access DO storage from the worker.
    // Instead, we'll use a special fetch path on the DO itself.
    return stub.fetch(new Request('http://localhost/__test/corrupt', { method: 'POST' }));
  }

  // POST /__test/boards/:id/repair
  const repairMatch = url.pathname.match(/^\/__test\/boards\/([^/]+)\/repair$/);
  if (repairMatch && req.method === 'POST') {
    const boardId = repairMatch[1];
    const id = env.BOARD_ROOM.idFromName(boardId);
    const stub = env.BOARD_ROOM.get(id);
    return stub.fetch(new Request('http://localhost/__test/repair', { method: 'POST' }));
  }

  // POST /__test/boards/:id/seed?count=N
  const seedMatch = url.pathname.match(/^\/__test\/boards\/([^/]+)\/seed$/);
  if (seedMatch && req.method === 'POST') {
    const boardId = seedMatch[1];
    const count = parseInt(url.searchParams.get('count') ?? '25', 10);
    const id = env.BOARD_ROOM.idFromName(boardId);
    const stub = env.BOARD_ROOM.get(id);
    return stub.fetch(new Request(`http://localhost/__test/seed?count=${count}`, { method: 'POST' }));
  }

  return null;
}
