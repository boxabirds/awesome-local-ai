// Typed fetch wrappers for the board API (share.pages / share.board_api).
//
// These are the ONLY client calls into the board HTTP API. They translate the
// HTTP contract into a small discriminated union so the page components can
// drive their state machines without touching `fetch` or status codes:
//
//   POST /api/boards      → createBoardRequest()
//   GET  /api/boards/:id  → checkBoard(id)
//
// In ui-component tests `api.ts` is mocked, so every page state (created /
// rate-limited / failed / unreachable) can be forced deterministically.

export type CreateResponse =
  | { kind: 'created'; id: string }
  | { kind: 'rate_limited' }
  | { kind: 'failed' };

export type CheckResponse =
  | { kind: 'exists' }
  | { kind: 'not_found' }
  | { kind: 'unreachable' };

/** POST /api/boards. A 201 yields the new id; 429 is the rate-limit message;
 * any other status OR a network/parse error is `failed` (the home page keeps
 * the visitor and re-enables the button). */
export async function createBoardRequest(fetchImpl: typeof fetch = fetch): Promise<CreateResponse> {
  let response: Response;
  try {
    response = await fetchImpl('/api/boards', { method: 'POST' });
  } catch {
    return { kind: 'failed' };
  }
  if (response.ok && response.status === 201) {
    try {
      const body = (await response.json()) as { id?: string };
      if (typeof body.id === 'string' && body.id.length > 0) return { kind: 'created', id: body.id };
    } catch {
      /* fall through to failed */
    }
    return { kind: 'failed' };
  }
  if (response.status === 429) return { kind: 'rate_limited' };
  return { kind: 'failed' };
}

/** GET /api/boards/:id. 200 → exists, 404 → not_found, anything else OR a
 * network error → unreachable (BoardPage retries these). */
export async function checkBoard(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckResponse> {
  let response: Response;
  try {
    response = await fetchImpl(`/api/boards/${id}`);
  } catch {
    return { kind: 'unreachable' };
  }
  if (response.status === 200) return { kind: 'exists' };
  if (response.status === 404) return { kind: 'not_found' };
  return { kind: 'unreachable' };
}