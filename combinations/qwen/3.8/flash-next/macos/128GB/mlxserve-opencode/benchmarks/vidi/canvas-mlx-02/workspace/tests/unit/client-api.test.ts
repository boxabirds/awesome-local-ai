// The two questions the client asks the server, and the four answers each one can
// come back with. What a response *means* is decided here, once, so a page never
// has to guess whether a number was a verdict about a board.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkBoardRequest, createBoardRequest } from '../../src/client/api.ts';
import { newBoardId } from '../../src/shared/board-id.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('asking for a board', () => {
  it('a board that was made is the id that came back, read out of the body', async () => {
    const boardId = newBoardId();
    const fetchMock = vi.fn().mockResolvedValue(response(201, { id: boardId }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createBoardRequest()).resolves.toEqual({ kind: 'created', boardId });
    expect(fetchMock).toHaveBeenCalledWith('/api/boards', { method: 'POST' });
  });

  it('TC-18: being told to wait is its own answer, not a failure and not a board', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(429, { error: 'rate_limited' })));
    await expect(createBoardRequest()).resolves.toEqual({ kind: 'rate_limited' });
  });

  it('a server that refused is a refusal, and a server that never answered is that', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(500, { error: 'boom' })));
    await expect(createBoardRequest()).resolves.toEqual({ kind: 'failed' });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(createBoardRequest()).resolves.toEqual({ kind: 'unreachable' });
  });

  it('TC-27: a 201 whose body is not a board id is not a board to hand someone', async () => {
    // The response is parsed, not assumed: a link the client cannot trust is not a
    // board, and must not be shown as one.
    for (const body of [undefined, {}, { id: 42 }, { id: 'nope' }, { id: null }, []]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(201, body)));
      await expect(createBoardRequest()).resolves.toEqual({ kind: 'unreachable' });
    }
  });

  it('a 201 with a body that is not even json is not a board either', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 201 })));
    await expect(createBoardRequest()).resolves.toEqual({ kind: 'unreachable' });
  });
});

describe('asking whether a link is a board', () => {
  const boardId = newBoardId();

  it('yes and no are different answers, and both are answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(200, { exists: true })));
    await expect(checkBoardRequest(boardId)).resolves.toEqual({ kind: 'exists' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(404, { error: 'not_found' })));
    await expect(checkBoardRequest(boardId)).resolves.toEqual({ kind: 'missing' });
  });

  it('TC-23b: an answer that is not a yes or a no is its own answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(500, { error: 'busy' })));
    await expect(checkBoardRequest(boardId)).resolves.toEqual({ kind: 'unknown' });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(checkBoardRequest(boardId)).resolves.toEqual({ kind: 'unknown' });
  });

  it('TC-25: a thing that is not a code is not worth a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(checkBoardRequest('short')).resolves.toEqual({ kind: 'missing' });
    await expect(checkBoardRequest('')).resolves.toEqual({ kind: 'missing' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the question is asked about the code in the address, and nothing else', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, { exists: true }));
    vi.stubGlobal('fetch', fetchMock);

    await checkBoardRequest(boardId);
    expect(fetchMock).toHaveBeenCalledWith(`/api/boards/${boardId}`);
  });
});
