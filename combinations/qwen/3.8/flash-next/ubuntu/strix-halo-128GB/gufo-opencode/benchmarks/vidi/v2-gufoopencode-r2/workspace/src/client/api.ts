// Story 5: typed fetch wrappers for the board API. Transport-level failures
// are results, never thrown: pages render them as states.

export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };
export type CheckResponse = { kind: 'exists' } | { kind: 'not_found' } | { kind: 'unreachable' };

export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const response = await fetch('/api/boards', { method: 'POST' });
    if (response.status === 201) {
      const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
      if (typeof body?.id === 'string' && body.id.length > 0) {
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
    const response = await fetch(`/api/boards/${encodeURIComponent(id)}`);
    if (response.status === 200) return { kind: 'exists' };
    if (response.status === 404) return { kind: 'not_found' };
    return { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}
