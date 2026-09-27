// Board API client. Never throws: transport problems are values the pages can
// render. `createBoardRequest` POSTs /api/boards, `checkBoard` GETs /api/boards/:id.

export type CreateResponse =
  | { kind: 'created'; id: string }
  | { kind: 'rate_limited' }
  | { kind: 'failed' };

export type CheckResponse =
  | { status: 'exists' }
  | { status: 'not_found' }
  | { status: 'unreachable' };

export async function createBoardRequest(): Promise<CreateResponse> {
  let response: Response;
  try {
    response = await fetch('/api/boards', { method: 'POST' });
  } catch {
    return { kind: 'failed' };
  }
  if (response.status === 201) {
    const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
    if (typeof body?.id === 'string' && body.id.length > 0) return { kind: 'created', id: body.id };
    return { kind: 'failed' };
  }
  if (response.status === 429) return { kind: 'rate_limited' };
  return { kind: 'failed' };
}

/** Existence check for a link code. Anything other than 200/404 is unreachable. */
export async function checkBoard(id: string): Promise<CheckResponse> {
  let response: Response;
  try {
    response = await fetch(`/api/boards/${encodeURIComponent(id)}`);
  } catch {
    return { status: 'unreachable' };
  }
  if (response.status === 200) return { status: 'exists' };
  if (response.status === 404) return { status: 'not_found' };
  return { status: 'unreachable' };
}
