// The api module is the seam between HTTP statuses and what the pages render,
// including the "network error" case the design (TC-17) asks for. Only `status`
// and `json()` are used, so a plain object stands in for Response.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkBoard, createBoardRequest } from '../../src/client/api';

function reply(status: number, body?: unknown): Response {
  return { status, json: async () => body } as unknown as Response;
}

function stubFetch(impl: (input: unknown) => Promise<Response>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: unknown): Promise<Response> => impl(input));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('createBoardRequest', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the id from a 201 response', async () => {
    const fetchMock = stubFetch(async () => reply(201, { id: 'Zx9_-kQ7mT2pLb4nRw8Yd1cF' }));
    expect(await createBoardRequest()).toEqual({ kind: 'created', id: 'Zx9_-kQ7mT2pLb4nRw8Yd1cF' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/boards');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('POST');
  });

  it('maps 429 to the rate-limited kind', async () => {
    stubFetch(async () => reply(429, { error: 'rate_limited' }));
    expect(await createBoardRequest()).toEqual({ kind: 'rate_limited' });
  });

  it('maps a 500 to a plain failure', async () => {
    stubFetch(async () => reply(500, { error: 'create_failed' }));
    expect(await createBoardRequest()).toEqual({ kind: 'failed' });
  });

  it('maps a 201 without a usable id to a plain failure', async () => {
    stubFetch(async () => reply(201, { id: 12 }));
    expect(await createBoardRequest()).toEqual({ kind: 'failed' });
  });

  it('maps a transport error to a plain failure instead of throwing', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await createBoardRequest()).toEqual({ kind: 'failed' });
  });
});

describe('checkBoard', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('200 means the board exists', async () => {
    const fetchMock = stubFetch(async () => reply(200, { id: 'x' }));
    expect(await checkBoard('abc')).toEqual({ status: 'exists' });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/boards/abc');
  });

  it('404 means not found', async () => {
    stubFetch(async () => reply(404, { error: 'not_found' }));
    expect(await checkBoard('abc')).toEqual({ status: 'not_found' });
  });

  it('anything else means we could not reach the service', async () => {
    for (const status of [500, 503, 400, 204]) {
      stubFetch(async () => reply(status));
      expect(await checkBoard('abc')).toEqual({ status: 'unreachable' });
    }
  });

  it('a transport error means we could not reach the service', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await checkBoard('abc')).toEqual({ status: 'unreachable' });
  });

  it('encodes the link code it is given', async () => {
    const fetchMock = stubFetch(async () => reply(404));
    await checkBoard('a b/c?d');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/boards/a%20b%2Fc%3Fd');
  });
});
