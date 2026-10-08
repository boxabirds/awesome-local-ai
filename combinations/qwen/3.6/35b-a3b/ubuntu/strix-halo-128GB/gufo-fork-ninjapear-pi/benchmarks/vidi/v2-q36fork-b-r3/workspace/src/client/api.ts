/** Board API client — story 5 */

export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };
export type CheckResponse =
  | { kind: 'exists' }
  | { kind: 'not_found' }
  | { kind: 'unreachable' };

export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const res = await fetch('/api/boards', { method: 'POST' });
    if (!res.ok) return { kind: 'failed' };
    const data = (await res.json()) as { id: string };
    return { kind: 'created', id: data.id };
  } catch {
    return { kind: 'failed' };
  }
}

export async function checkBoard(id: string): Promise<CheckResponse> {
  try {
    const res = await fetch(`/api/boards/${id}`);
    if (!res.ok && !(res.status === 404)) {
      // 5xx or other error → unreachable
      return { kind: 'unreachable' };
    }
    if (res.status === 404) {
      return { kind: 'not_found' };
    }
    return { kind: 'exists' };
  } catch {
    return { kind: 'unreachable' };
  }
}
