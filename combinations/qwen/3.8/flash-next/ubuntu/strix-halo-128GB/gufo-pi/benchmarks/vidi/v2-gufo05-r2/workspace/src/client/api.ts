/**
 * The two questions this client asks the server, and nothing else (share.board_api).
 *
 * Both answers come back as a `kind`, never as a thrown exception: for a person
 * opening a link there is a difference between the board not existing (share.not_found
 * — say so, and offer a new board), and the service not being reachable
 * (share.unreachable — say that, and ask again). A throw would flatten both into
 * "something went wrong", which is the one answer that is never true enough to act on.
 */

export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };

export type CheckResponse =
  | { kind: 'exists' }
  | { kind: 'not_found' }
  | { kind: 'unreachable' };

/**
 * Ask for a new board (POST /api/boards).
 *
 * `failed` covers everything that is not a fresh id: the server's own 500
 * (share.create_failure), a network that answered nothing, and an answer that was
 * not the shape we expect. The home page treats them the same way — nothing was
 * opened, try again — because from a click there is nothing to distinguish.
 */
export async function createBoardRequest(): Promise<CreateResponse> {
  try {
    const response = await fetch('/api/boards', { method: 'POST' });
    if (!response.ok) return { kind: 'failed' };
    const body = (await response.json().catch(() => null)) as unknown;
    const id =
      typeof body === 'object' && body !== null && typeof (body as { id?: unknown }).id === 'string'
        ? ((body as { id: string }).id as string)
        : '';
    return id ? { kind: 'created', id } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * Does this board exist? (GET /api/boards/:id)
 *
 * 200 exists, 404 does not, anything else — including no answer at all — means the
 * service could not be reached, which is the case the page retries.
 */
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
