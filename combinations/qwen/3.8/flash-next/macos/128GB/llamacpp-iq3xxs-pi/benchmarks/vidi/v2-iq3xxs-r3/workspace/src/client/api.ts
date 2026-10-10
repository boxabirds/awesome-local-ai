/**
 * The two questions the client asks the server (design: `client/api.ts`).
 *
 * Both return an answer rather than throwing, because every answer this client
 * gets back is something the page knows how to show: a board id, "no board is
 * here", "that could not be answered". A thrown fetch would have to be turned
 * into one of those by every caller anyway, and the fourth possibility — a
 * forgotten `catch` — is a page that shows nothing at all.
 */
import { BOARD_ID_PATTERN } from '../shared/board-id';
import { CREATE_BUDGET_MS } from '../shared/config';

/**
 * `POST /api/boards`. The id, or null if the board could not be made.
 *
 * The request gets `budgetMs` and no more: creation that has not answered is a
 * failure the person can see and try again, not a button that spins forever. A
 * board made just after the budget ran out is a board nobody has the link to, and
 * it is left alone — nothing in the app looks for a board by anything but its id.
 */
export async function createBoard({
  budgetMs = CREATE_BUDGET_MS,
}: {
  budgetMs?: number;
} = {}): Promise<string | null> {
  const controller = new AbortController();
  const spent = setTimeout(() => controller.abort(), budgetMs);
  let response: Response | null = null;
  try {
    response = await fetch('/api/boards', { method: 'POST', signal: controller.signal });
  } catch (error) {
    // An abort reads the same as a network failure, and the page shows the same
    // message for both: from here they are the same thing.
    console.error('[client] POST /api/boards failed to reach the server', error);
    return null;
  } finally {
    clearTimeout(spent);
  }
  if (response.status !== 201) {
    // 500 create_failed (share.create_failure) is the expected failure, and a
    // board that could not be made is not worth a link: the message says so and
    // the button is enabled again.
    console.error(`[client] POST /api/boards -> ${response.status}`);
    return null;
  }
  const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
  const id = body?.id;
  if (typeof id !== 'string' || !BOARD_ID_PATTERN.test(id)) {
    console.error('[client] POST /api/boards answered 201 without a usable id', body);
    return null;
  }
  return id;
}

/**
 * `GET /api/boards/:id`, as an answer rather than a status: `missing` is the
 * definite one (a 404 came back and said so), `unreachable` means the question
 * was not answered and the page should ask again rather than declare a board gone.
 */
export type BoardAnswer = 'exists' | 'missing' | 'unreachable';

export async function askBoard(boardId: string): Promise<BoardAnswer> {
  try {
    const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}`);
    if (response.status === 200) return 'exists';
    if (response.status === 404) return 'missing';
    // Anything else — a 500, a 502 from something in front, an HTML error page —
    // says nothing about whether the board exists.
    console.error(`[client] GET /api/boards/${boardId} -> ${response.status}`);
    return 'unreachable';
  } catch (error) {
    console.error('[client] GET /api/boards failed to reach the server', error);
    return 'unreachable';
  }
}
