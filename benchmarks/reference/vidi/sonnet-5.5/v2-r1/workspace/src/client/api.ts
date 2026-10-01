export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };
export type CheckResponse = { kind: 'exists' } | { kind: 'not_found' } | { kind: 'unreachable' };

/** Network errors and anything but 201 with an id are `failed`. */
export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const res = await fetch('/api/boards', { method: 'POST' });
    if (res.status !== 201) return { kind: 'failed' };
    const body = (await res.json()) as { id?: unknown };
    return typeof body.id === 'string' ? { kind: 'created', id: body.id } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/** 200 exists, 404 not_found; network errors, 5xx and anything unexpected are `unreachable` (retried). */
export async function checkBoard(id: string): Promise<CheckResponse> {
  try {
    const res = await fetch(`/api/boards/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (res.status === 200) return { kind: 'exists' };
    if (res.status === 404) return { kind: 'not_found' };
    return { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}
