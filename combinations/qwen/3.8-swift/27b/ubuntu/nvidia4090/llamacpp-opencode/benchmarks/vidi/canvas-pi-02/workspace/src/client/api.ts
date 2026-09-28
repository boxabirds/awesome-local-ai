// Client-side board API (story 5, share.board_api / share.create):
// POST /api/boards creates a board server-side and GET /api/boards/:id is
// the board page's existence check. The board page calls checkBoard with
// retries (useBoardExistence in BoardPage.tsx).

/** Thrown when the board does not exist (404) — a definite answer, as
 *  distinct from a network/transport failure which is retryable. */
export class BoardNotFound extends Error {
  constructor(boardId: string) {
    super(`board ${boardId} not found`);
    this.name = 'BoardNotFound';
  }
}

/** 429: the visitor is creating boards too quickly (share.rate_limit). */
export class BoardCreateRateLimited extends Error {
  constructor() {
    super('board creation rate limited');
    this.name = 'BoardCreateRateLimited';
  }
}

/** 5xx or network failure: the creation failed for an unknown reason. */
export class BoardCreateFailed extends Error {
  constructor() {
    super('board creation failed');
    this.name = 'BoardCreateFailed';
  }
}

export interface CreatedBoard {
  id: string;
}

/** Creates a board server-side (POST /api/boards). Returns its id, which
 *  is a safe-to-share /b/<id> address (share.create). Rejects with
 *  BoardCreateRateLimited (429) or BoardCreateFailed (5xx / network). */
export async function createBoard(): Promise<CreatedBoard> {
  let res: Response;
  try {
    res = await fetch('/api/boards', { method: 'POST' });
  } catch {
    throw new BoardCreateFailed();
  }
  if (res.status === 429) throw new BoardCreateRateLimited();
  if (!res.ok) throw new BoardCreateFailed();
  return (await res.json()) as CreatedBoard;
}

/**
 * Existence check (GET /api/boards/:id). Resolves when the board exists;
 * rejects with BoardNotFound on a 404 (definite) and with Error on
 * transport failures / 5xx (transient — the caller retries either way).
 */
export async function checkBoard(boardId: string): Promise<void> {
  const res = await fetch(`/api/boards/${boardId}`);
  if (res.status === 404) throw new BoardNotFound(boardId);
  if (!res.ok) throw new Error(`board check failed: ${res.status}`);
}
