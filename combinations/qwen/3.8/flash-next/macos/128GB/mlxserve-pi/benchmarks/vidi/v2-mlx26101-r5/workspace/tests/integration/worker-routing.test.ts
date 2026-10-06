/**
 * Worker routing (tasks 3.1–3.6).
 *
 * Two ways of calling, deliberately:
 *   - `worker.fetch(request, fakeEnv)` with spied bindings, for the assertions about
 *     which board ids are allowed to create a Durable Object at all (TC-04, TC-05);
 *   - `SELF.fetch`, the Worker's real service binding, for everything that needs the
 *     real Durable Object and the real assets binding (TC-06, TC-07, TC-08, TC-09).
 *
 * Story 5 changed one of the answers asserted here: a malformed board id on the room route used
 * to be a 400, and is now the same 404 as a link to a board that does not exist. The assertions
 * that a malformed id never instantiates an object, never reaches the assets binding and never
 * gets the client shell are unchanged, because story 5 did not change them.
 */

import { describe, expect, it, vi } from 'vitest';
import { SELF } from 'cloudflare:test';

import { newBoardId } from '../../src/shared/board-id';
import type { BoardRoom } from '../../src/worker/board-room';
import worker, { type Env } from '../../src/worker/index';
import { RoomSocket } from './helpers/ws-client';

/** The origin the tests address the Worker by. */
const ORIGIN = 'https://vidi6.test';

/** A board id with nothing wrong with it. */
const validId = newBoardId();

/** The headers of a WebSocket upgrade. */
const UPGRADE = { Upgrade: 'websocket', Connection: 'Upgrade' };

/** Bindings that record every call, so "no instance was created" is assertable. */
function spiedEnv() {
  const stub = { fetch: vi.fn(async () => new Response('the room', { status: 418 })) };
  const idFromName = vi.fn(() => 'durable-object-id' as unknown as DurableObjectId);
  const get = vi.fn(() => stub as unknown as DurableObjectStub<BoardRoom>);
  const assetsFetch = vi.fn(async () => new Response('the client', { status: 200 }));
  const env = {
    BOARD_ROOM: { idFromName, get } as unknown as Env['BOARD_ROOM'],
    ASSETS: { fetch: assetsFetch } as unknown as Env['ASSETS'],
  } satisfies Env;
  return { env, idFromName, get, assetsFetch };
}

/** A request to the Worker, as a client would send it. */
function request(path: string, init?: RequestInit): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

/** Board ids that must never be turned into a Durable Object id. */
const malformed: readonly { label: string; id: string }[] = [
  { label: 'an empty id', id: '' },
  { label: 'one character', id: 'a' },
  { label: '21 characters, one short', id: 'a'.repeat(21) },
  { label: '23 characters, one over', id: 'a'.repeat(23) },
  { label: 'characters outside base64url', id: 'abcdefghijklmnopqrstuv+w' },
  { label: 'an id with a slash in it', id: 'api/rooms' },
  { label: 'an id with a dot in it', id: 'a.b.c.d.e.f.g.h.i.j.k' },
  { label: 'an id with spaces', id: 'aaaa bbbb cccc dddddddd' },
  { label: 'a percent-encoded slash', id: 'abc%2FdefghiJKLMNOP' },
  { label: 'a whole URL', id: 'https://evil.test/x' },
];

describe('the room route refuses malformed board ids (TC-04, TC-05)', () => {
  for (const { label, id } of malformed) {
    it(`${label} is a 404 and never reaches a Durable Object`, async () => {
      const { env, idFromName, get, assetsFetch } = spiedEnv();

      const upgraded = await worker.fetch(request(`/api/rooms/${id}`, { headers: UPGRADE }), env);
      const plain = await worker.fetch(request(`/api/rooms/${id}`), env);

      for (const response of [upgraded, plain]) {
        // 404, where story 3 answered 400 (share.not_found). A malformed id is not a different
        // kind of error to a person at this route: it is a link that is not a board, and the
        // answer to both is the same page. What has not changed is that nothing was instantiated.
        expect(response.status).toBe(404);
        expect(response.headers.get('x-vidi6-error')).toBe('invalid_board_id');
      }
      expect(idFromName).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
      expect(assetsFetch).not.toHaveBeenCalled();
    });
  }

  it('the real Worker answers a malformed id the same way, with no room behind it', async () => {
    const response = await SELF.fetch(
      request(`/api/rooms/${'not-a-board-id'}`, { headers: UPGRADE }),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(response.headers.get('x-vidi6-error')).toBe('invalid_board_id');
    expect(response.webSocket).toBeFalsy();
    response.webSocket?.close();
  });

  it('a query string cannot smuggle a different id to the room', async () => {
    const { env, idFromName } = spiedEnv();

    await worker.fetch(request(`/api/rooms/${validId}?redirect=evil`, { headers: UPGRADE }), env);

    expect(idFromName.mock.calls).toEqual([[validId]]);
  });

  it('a path that only looks like traversal is resolved before routing, and gets no room', async () => {
    // `new URL` collapses `/api/rooms/../../etc/passwd` to `/etc/passwd`, so this is
    // a client route, not a board route. Either way the Durable Object is untouched.
    const { env, idFromName } = spiedEnv();
    const response = await worker.fetch(
      request('/api/rooms/../../etc/passwd', { headers: UPGRADE }),
      env,
    );

    expect(response.status).toBe(200); // the client stub, because the path is no longer an API path
    expect(idFromName).not.toHaveBeenCalled();

    const real = await SELF.fetch(request('/api/rooms/..', { headers: UPGRADE }));
    expect(real.webSocket).toBeFalsy();
    expect(real.headers.get('x-vidi6-error')).toBe('not_found');
    real.webSocket?.close();
  });
});

describe('the client is served for every non-API route (TC-06)', () => {
  it('GET /b/<valid id> returns index.html', async () => {
    const response = await SELF.fetch(request(`/b/${validId}`));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('<div id="root"');
  });

  it('GET / returns index.html too', async () => {
    const response = await SELF.fetch(request('/'));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="root"');
  });

  it('a deep client route is served the shell as well', async () => {
    const response = await SELF.fetch(request('/some/other/client/route'));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="root"');
  });
});

describe('GET /api/rooms/<valid id> without an Upgrade header is 426 (TC-07)', () => {
  it('answers 426 and does not fall through to the client', async () => {
    const response = await SELF.fetch(request(`/api/rooms/${validId}`));

    expect(response.status).toBe(426);
    expect(response.headers.get('x-vidi6-error')).toBe('upgrade_required');
    expect(await response.text()).not.toContain('<div id="root"');
    expect(response.webSocket).toBeFalsy();
  });

  it('a valid id is routed by the id itself, and the same id is the same room', async () => {
    const { env, idFromName, get } = spiedEnv();

    const first = await worker.fetch(request(`/api/rooms/${validId}`, { headers: UPGRADE }), env);
    const second = await worker.fetch(request(`/api/rooms/${validId}`, { headers: UPGRADE }), env);

    expect([first.status, second.status]).toEqual([418, 418]); // the stub's answer
    expect(idFromName.mock.calls).toEqual([[validId], [validId]]);
    // One id, one stub: both connections are handed the same room.
    expect(get.mock.calls).toEqual([
      [idFromName.mock.results[0]?.value],
      [idFromName.mock.results[0]?.value],
    ]);
    expect(get.mock.results[0]?.value).toBe(get.mock.results[1]?.value);
  });

  it('two different boards are two different rooms', async () => {
    const { env, idFromName } = spiedEnv();
    const a = newBoardId();
    const b = newBoardId();

    await worker.fetch(request(`/api/rooms/${a}`, { headers: UPGRADE }), env);
    await worker.fetch(request(`/api/rooms/${b}`, { headers: UPGRADE }), env);

    expect(idFromName.mock.calls).toEqual([[a], [b]]);
  });
});

describe('routes that are not a board do not return index.html (TC-08)', () => {
  const paths = ['/api', '/api/', '/api/rooms', '/api/room-thing', '/api/liveness'];

  for (const path of paths) {
    it(`${path} is a JSON error, not the client shell`, async () => {
      const response = await SELF.fetch(request(path));
      const body = await response.text();

      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(response.headers.get('x-vidi6-error')).toBe('not_found');
      expect(body).not.toContain('<div id="root"');
      expect(JSON.parse(body)).toMatchObject({ error: 'not_found' });
    });
  }

  it('an empty id on the room route is the malformed-id answer, not index.html', async () => {
    const response = await SELF.fetch(request('/api/rooms/'));

    expect(response.status).toBe(404);
    expect(response.headers.get('x-vidi6-error')).toBe('invalid_board_id');
    expect(await response.text()).not.toContain('<div id="root"');
  });

  it('a malformed id on the room route is JSON as well', async () => {
    const response = await SELF.fetch(request('/api/rooms/nope'));

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.text()).not.toContain('<div id="root"');
  });
});

describe('a well-formed id with an Upgrade header reaches a BoardRoom (TC-09)', () => {
  it('upgrades and hands back a working WebSocket', async () => {
    const socket = await RoomSocket.connect(validId);

    expect(socket.isClosed).toBe(false);
    socket.close(1000, 'test over');
    // workerd reports the close back on the client end, so a test can tell
    // "the room closed me" from "the test closed me".
    expect(await socket.closed()).toEqual({ code: 1000, reason: 'test over', wasClean: true });
  });

  it('the room opens the conversation with a SyncStep1, unprompted', async () => {
    const socket = await RoomSocket.connect(validId);

    // [messageSync, syncStep1, stateVector] — the room asks the newcomer what it has.
    expect(Array.from(await socket.nextFrame())).toEqual([0, 0, 1, 0]);
    socket.close();
  });
});
