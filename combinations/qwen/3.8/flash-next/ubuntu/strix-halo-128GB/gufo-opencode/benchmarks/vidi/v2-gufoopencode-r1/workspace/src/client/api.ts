export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };
export type CheckResponse = { kind: 'exists' } | { kind: 'not_found' } | { kind: 'unreachable' };

// createBoardRequest turns any transport failure or non-201 response into a
// single `failed` outcome; the page decides what to show.
export async function createBoardRequest(): Promise<CreateResponse> {
  let response: Response;
  try {
    response = await fetch('/api/boards', { method: 'POST' });
  } catch {
    return { kind: 'failed' };
  }
  if (response.status !== 201) return { kind: 'failed' };
  const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
  if (body === null || typeof body.id !== 'string') return { kind: 'failed' };
  return { kind: 'created', id: body.id };
}

// checkBoard maps 200 -> exists, 404 -> not_found, and both transport errors
// and 5xx to `unreachable` (retry is the right response for both).
export async function checkBoard(id: string): Promise<CheckResponse> {
  let response: Response;
  try {
    response = await fetch(`/api/boards/${encodeURIComponent(id)}`);
  } catch {
    return { kind: 'unreachable' };
  }
  if (response.status === 200) return { kind: 'exists' };
  if (response.status === 404) return { kind: 'not_found' };
  return { kind: 'unreachable' };
}
