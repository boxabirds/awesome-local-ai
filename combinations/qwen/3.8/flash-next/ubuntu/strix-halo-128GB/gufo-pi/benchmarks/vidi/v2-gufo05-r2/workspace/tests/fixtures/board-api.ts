/**
 * The board API as a test client sees it: the two routes story 5 adds, for tests
 * that are not a browser.
 *
 * A browser test clicks "New board"; a Node test cannot, so it asks the same route.
 * That is worth keeping separate from the test hooks (`fixtures/hooks.ts`): where a
 * hook reaches into a room at an address the test invented, this is the real API,
 * which picks its own address and is the only thing a user has. Tests that care how
 * a board comes to exist use this; tests that merely need one use the hook.
 */

/** Create a board the way the home page does, and return its link code. */
export async function createBoardAt(
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(`${origin}/api/boards`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`POST /api/boards failed with ${response.status}`);
  }
  const body = (await response.json()) as { id?: string };
  if (typeof body.id !== 'string' || body.id.length === 0) {
    throw new Error('POST /api/boards answered with no id');
  }
  return body.id;
}

/** What `GET /api/boards/:id` says about this address. */
export async function boardStatusAt(
  origin: string,
  boardId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  return (await fetchImpl(`${origin}/api/boards/${boardId}`)).status;
}
