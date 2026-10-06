/**
 * The board API, as the client knows it.
 *
 * Two questions and one request each: *make me a board*, and *is this link a board*. They are
 * here rather than inline in the pages for one reason: the answer has to be sorted into the
 * three things a page can do with it — go ahead, say it is not there, or wait and try again —
 * and that sorting is the same in both pages and worth getting right once.
 *
 * The distinction that matters most is between `not_found` and `unreachable`. A 404 is an
 * answer: the service is working and says there is no board at this link, so the page says so
 * and stops. A thrown `fetch`, a 500 or a body that is not the JSON we agreed is not an answer:
 * we do not know whether the board exists, and telling somebody their link leads nowhere on the
 * strength of a bad minute in the network is the exact mistake `share.not_found` exists to
 * prevent. Those are `unreachable`, and the page waits and asks again.
 */

/** What came back from asking for a new board. */
export type CreateBoardResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

/** What came back from asking about a link. */
export type BoardLookup =
  /** There is a board with this id. */
  | { ok: true; id: string }
  /** There is no board with this id. The service is fine; the link is not. */
  | { ok: false; reason: 'not_found' }
  /**
   * Nothing was learned. The status is here for the log, never for the screen: the person
   * reading it is told "we could not reach vidi6", because that is all either of us knows.
   */
  | { ok: false; reason: 'unreachable'; status: number | null };

/** `POST /api/boards` — one new board, and its id. */
export async function createBoard(): Promise<CreateBoardResult> {
  try {
    const response = await fetch('/api/boards', { method: 'POST' });
    if (!response.ok) return createFailed(response.status, `HTTP ${String(response.status)}`);
    const body: unknown = await response.json().catch(() => null);
    const id =
      typeof body === 'object' && body !== null ? (body as { id?: unknown }).id : undefined;
    if (typeof id !== 'string' || id === '') {
      return createFailed(response.status, 'no id in the answer');
    }
    return { ok: true, id };
  } catch (error) {
    return createFailed(null, error instanceof Error ? error.message : String(error));
  }
}

/** `GET /api/boards/:id` — is this link a board? Reads, and never makes one. */
export async function getBoard(boardId: string): Promise<BoardLookup> {
  try {
    const response = await fetch(`/api/boards/${boardId}`);
    if (response.status === 404) return { ok: false, reason: 'not_found' };
    if (!response.ok) return unreachable(response.status, `HTTP ${String(response.status)}`);
    const body: unknown = await response.json().catch(() => null);
    const id =
      typeof body === 'object' && body !== null ? (body as { id?: unknown }).id : undefined;
    // A 200 that does not name the board we asked about tells us nothing about it.
    if (id !== boardId) return unreachable(response.status, 'the answer is not about this board');
    return { ok: true, id: boardId };
  } catch (error) {
    return unreachable(null, error instanceof Error ? error.message : String(error));
  }
}

/**
 * "The service did not answer the way it should have", turned into the one result that means
 * it, after putting the detail somewhere a person with the console open can find it. Neither
 * page is told *why* the service failed, because none of the reasons change what the person
 * does next: try again.
 */
function createFailed(status: number | null, detail: string): CreateBoardResult {
  console.warn(`vidi6: could not create a board (${detail})`, { status });
  return { ok: false, reason: 'create_failed' };
}

/** …and the same for a link we could not ask about. */
function unreachable(status: number | null, detail: string): BoardLookup {
  console.warn(`vidi6: could not reach the board service (${detail})`, { status });
  return { ok: false, reason: 'unreachable', status };
}
