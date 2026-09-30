/**
 * Typed fetch wrappers for the board API (story 5).
 * Network failures are reported as values, never thrown: the pages render
 * their failure states instead (e.g. "Couldn't reach vidi6. Retrying…").
 */

export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };

export type CheckResponse = { kind: 'exists' } | { kind: 'not_found' } | { kind: 'unreachable' };

export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const res = await fetch('/api/boards', { method: 'POST' });
    if (res.status === 201) {
      const body = (await res.json()) as { id?: string };
      if (typeof body.id === 'string' && body.id.length > 0) {
        return { kind: 'created', id: body.id };
      }
    }
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

export async function checkBoard(id: string): Promise<CheckResponse> {
  try {
    const res = await fetch(`/api/boards/${id}`);
    if (res.status === 200) return { kind: 'exists' };
    if (res.status === 404) return { kind: 'not_found' };
    return { kind: 'unreachable' }; // 5xx
  } catch {
    return { kind: 'unreachable' }; // network failure
  }
}
