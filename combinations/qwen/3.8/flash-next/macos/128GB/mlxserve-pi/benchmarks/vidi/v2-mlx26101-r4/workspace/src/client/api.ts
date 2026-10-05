/**
 * The browser's half of the board API: two requests, both about whether a board exists.
 *
 * These are the only places the client talks to `/api/boards`, and both are deliberately small.
 * A board's contents — the notes, where they are, what they say — travel over the board's
 * connection (story 3) and never through here, because that traffic needs a stream and this needs
 * one answer. What is kept out of these two files is as important as what is in them: there is no
 * list of boards to fetch, because this product has no account to list them for; and nothing here
 * sends an identity, because a board's link is the whole of its access control.
 *
 * Both functions return a *state* rather than throwing. A person who mistypes a link has to be
 * told "Board not found", and a person whose network is down has to be told "Couldn't reach vidi6"
 * — the same shape of answer, arrived at differently, and the difference has to survive until it
 * reaches the page. A thrown error would flatten the two into one, and the flattest reading of "I
 * could not find out" is "there is nothing there", which is the one thing this screen must never
 * say when it is not sure.
 */
import { isValidBoardId } from '../shared/board-id';

/** What asking for a new board came to. */
export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };

/**
 * What asking about one board came to.
 *
 * `unreachable` is not a shrug added for completeness: it is the state that keeps a service that
 * is having a bad minute from telling people their board is gone. Only a 404 — an answer, from the
 * board itself, that it is not there — becomes `not_found`.
 */
export type CheckResponse = { kind: 'exists' } | { kind: 'not_found' } | { kind: 'unreachable' };

/** Ask the service for a board, and take the id it gives back. */
export async function createBoardRequest(): Promise<CreateResponse> {
  let response: Response;
  try {
    response = await fetch('/api/boards', { method: 'POST' });
  } catch {
    // Nothing answered: no network, no service, the request never left the browser.
    return { kind: 'failed' };
  }
  if (!response.ok) return { kind: 'failed' };

  const body: unknown = await response.json().catch(() => null);
  const id = typeof body === 'object' && body !== null ? (body as { id?: unknown }).id : undefined;
  // The id has to be an id. A service that answers 200 with something else would otherwise send
  // the app to an address that cannot hold a board, where the honest page waiting there — "Board
  // not found" — would be a lie about a board that was just made.
  if (typeof id !== 'string' || !isValidBoardId(id)) return { kind: 'failed' };
  return { kind: 'created', id };
}

/** Whether there is a board at this address. */
export async function checkBoard(id: string): Promise<CheckResponse> {
  let response: Response;
  try {
    response = await fetch(`/api/boards/${encodeURIComponent(id)}`);
  } catch {
    return { kind: 'unreachable' };
  }
  if (response.status === 404) return { kind: 'not_found' };
  if (response.ok) return { kind: 'exists' };
  // 5xx, and anything else that is not an answer about this board. The service is speaking, but it
  // is not saying that the board is absent, so the page keeps asking instead of concluding so.
  return { kind: 'unreachable' };
}
