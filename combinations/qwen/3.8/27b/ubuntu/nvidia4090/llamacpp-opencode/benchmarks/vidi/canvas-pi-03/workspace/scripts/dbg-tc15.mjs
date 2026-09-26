const BASE = 'http://localhost:8899';
const boardId = 'b_' + Math.random().toString(36).slice(2, 12);
async function hook(op, body) {
  const method = body === undefined ? 'GET' : 'POST';
  const res = await fetch(`${BASE}/__test/boards/${boardId}/${op}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
// build 25-note board updates (reuse fixture via a quick inline)
const Y = (await import('yjs')).default;
console.log('boardId', boardId);
// seed via a small inline build: use the boards fixture bundled separately
