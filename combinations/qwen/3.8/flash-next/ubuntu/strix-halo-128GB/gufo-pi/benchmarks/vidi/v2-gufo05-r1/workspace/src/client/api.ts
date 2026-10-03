/**
 * The two board endpoints, and nothing else.
 *
 * Pages call these instead of `fetch` so that the meaning of a response lives in one
 * place: `createBoardRequest` answers whether a board exists now at an address, and
 * `checkBoard` answers whether an address is a board. Every failure that is not the
 * server's answer — no network, a truncated response, a body that is not JSON — is
 * reported as `unreachable` rather than as "not found", because those are different
 * facts to a person waiting to open their board and different decisions to the page:
 * one is retried, the other ends the attempt.
 *
 * Tests replace these two functions (`vi.spyOn(api, 'checkBoard')`), which is why no page
 * reaches for `fetch` itself.
 */
import { isValidBoardId } from '../shared/board-id';

/** What `POST /api/boards` meant. */
export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };

/** What `GET /api/boards/:id` meant. */
export type CheckResponse = { kind: 'exists' } | { kind: 'not_found' } | { kind: 'unreachable' };

/** Ask for a new board. The only way a board comes into existence. */
export async function createBoardRequest(): Promise<CreateResponse> {
  let response: Response;
  try {
    response = await fetch('/api/boards', { method: 'POST' });
  } catch {
    return { kind: 'failed' };
  }
  if (response.status !== 201) return { kind: 'failed' };
  const body: unknown = await response.json().catch(() => null);
  const id = (body as { id?: unknown } | null)?.id;
  // An id the client could not put in a link is a failure, not a success: navigating to
  // it would land the person on a board that their own browser cannot address.
  if (typeof id !== 'string' || !isValidBoardId(id)) return { kind: 'failed' };
  return { kind: 'created', id };
}

/**
 * Ask whether an address is a board. Never creates one, and never retries: the page does.
 *
 * An address that cannot name a board is answered here rather than asked about. The server
 * would say the same thing (TC-07), but a client that forwarded nonsense would give a bad
 * address the appearance of a question worth retrying, and `/b/<nonsense>` is exactly the
 * case where the page has to stop and say "not found" instead of waiting for a service.
 */
export async function checkBoard(id: string): Promise<CheckResponse> {
  if (!isValidBoardId(id)) return { kind: 'not_found' };

  let response: Response;
  try {
    response = await fetch(`/api/boards/${encodeURIComponent(id)}`);
  } catch {
    return { kind: 'unreachable' };
  }
  if (response.status === 200) return { kind: 'exists' };
  if (response.status === 404) return { kind: 'not_found' };
  // A 5xx means the Worker could not answer, not that the board is gone. Saying "not
  // found" would delete a real board from somebody's view of the world.
  return { kind: 'unreachable' };
}
