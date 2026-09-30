import { isValidBoardId } from '../shared/board-id';

/**
 * Typed fetch wrappers for the board API. These are the only client calls to
 * `/api/boards`; the pages decide what each outcome means. A network failure is
 * turned into a value, never thrown, so a page can react to "could not reach
 * the service" as a state rather than an exception (share.unreachable).
 *
 * The paths are relative on purpose: the board link is never widened to an
 * origin the request could be attributed to, matching the app's no-referrer
 * stance (design: privacy).
 */

export type CreateResponse = { kind: 'created'; id: string } | { kind: 'failed' };

export type CheckResponse =
  | { kind: 'exists' }
  | { kind: 'not_found' }
  | { kind: 'unreachable' };

/** Ask the service to create a board. Anything but a 201 with a usable id is a
 * failure that the Home page shows and lets the person retry (share.create_failure). */
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
  // A 201 that does not carry a usable board id is treated as a failure, not as
  // a board we may navigate to.
  return typeof id === 'string' && isValidBoardId(id)
    ? { kind: 'created', id }
    : { kind: 'failed' };
}

/** Ask whether a board exists. A definite 404 is "not found"; everything the
 * service cannot answer right now (network error, 5xx, an unexpected status) is
 * "unreachable", so a board is never declared gone on a flaky response
 * (share.not_found vs share.unreachable). */
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
