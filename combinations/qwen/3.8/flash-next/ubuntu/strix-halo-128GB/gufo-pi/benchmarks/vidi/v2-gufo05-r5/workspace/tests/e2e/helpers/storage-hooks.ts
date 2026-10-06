/**
 * Calling the Worker's test-only storage hooks, from the test.
 *
 * `POST <server>/__test/boards/<id>/corrupt-snapshot` and `POST <server>/__test/boards/<id>/repair`
 * are implemented in `src/worker/test-hooks.ts`, answered only when that server was started with
 * `TEST_HOOKS=1`, and act on the board's real stored rows: corrupt replaces the folded snapshot with
 * bytes that are not a Yjs update, repair writes the originals back.
 *
 * So a test can show a browser a board that genuinely cannot be read - and put it right again while
 * the tab is still open - without the production code offering any such thing to anybody else.
 */
// The two actions the Worker's `/__test/boards/:id/...` routes answer. Named here rather than
// imported from `src/worker/test-hooks.ts`: that file belongs to the Worker project, whose runtime
// types the client project this test is compiled under does not have. An action this list gets wrong
// is not a silent failure - the Worker routes nothing and the hook call above reports the answer.
export type StorageHookAction = 'corrupt-snapshot' | 'repair';

/** What a hook answered: how many snapshot rows it touched. */
export interface StorageHookResult {
  ok: boolean;
  chunks: number;
}

/**
 * Calls one hook and fails loudly when the server refuses it - which it does, with the room's own
 * reason, when the board has nothing of that kind (a board that was never compacted has no snapshot
 * to corrupt, and a board nobody corrupted has nothing to repair).
 */
export async function callStorageHook(
  httpBaseUrl: string,
  boardId: string,
  action: StorageHookAction,
): Promise<StorageHookResult> {
  const url = `${httpBaseUrl}/__test/boards/${encodeURIComponent(boardId)}/${action}`;
  const response = await fetch(url, { method: 'POST' });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`POST ${url} answered ${response.status}: ${body.slice(0, 300)}`);
  }
  try {
    return JSON.parse(body) as StorageHookResult;
  } catch {
    throw new Error(`POST ${url} answered ${response.status} with something that is not JSON: ${body.slice(0, 200)}`);
  }
}
