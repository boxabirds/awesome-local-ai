// Thin client for the board API (story 5, share.pages): the two requests the
// pages make, reduced to the outcome types the pages reason about. Network
// errors are outcomes, never thrown.

export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };
export type CheckResponse = { kind: 'exists' } | { kind: 'not_found' } | { kind: 'unreachable' };

/** POST /api/boards — create a new empty board. 5xx and network errors → failed. */
export async function createBoardRequest(): Promise<CreateResponse> {
  let res: Response;
  try {
    res = await fetch('/api/boards', { method: 'POST' });
  } catch {
    return { kind: 'failed' };
  }
  if (!res.ok) return { kind: 'failed' };
  const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
  return typeof body?.id === 'string' ? { kind: 'created', id: body.id } : { kind: 'failed' };
}

/** GET /api/boards/:id — does this board exist? 404 → not_found; network errors
 *  and 5xx → unreachable (the caller retries with backoff). */
export async function checkBoard(id: string): Promise<CheckResponse> {
  let res: Response;
  try {
    res = await fetch(`/api/boards/${id}`);
  } catch {
    return { kind: 'unreachable' };
  }
  if (res.status === 200) return { kind: 'exists' };
  if (res.status === 404) return { kind: 'not_found' };
  return { kind: 'unreachable' };
}
