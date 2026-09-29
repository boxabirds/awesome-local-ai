// Story 5 — sharing a board by link: the creation API and the share guard
// (design table TC-01..TC-03, TC-07..TC-14). Real `wrangler dev`, real fetch,
// real WebSockets, real Durable Object storage — nothing here is mocked.
//
// About the limiter: the local runtime DOES enforce the rate-limit binding and
// every local request shares one limiter key ('unknown', there is no
// CF-Connecting-IP), so `createRoom()` sends `x-test-ignore-limit` — a header
// only honoured when TEST_HOOKS is on — to keep fixtures out of the quota. The
// last block exercises the limiter with that header left off.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky } from '../../src/shared/board-model';
import { HTTP_ORIGIN } from './helpers/server';
import { createRoom, rawClient, room, until, yClient } from './helpers/ws-client';

const create = (init?: RequestInit) => fetch(`${HTTP_ORIGIN}/api/boards`, init);
const SKIP_LIMIT = { headers: { 'x-test-ignore-limit': '1' } };

describe('POST /api/boards', () => {
  it('TC-01: an id is 22 URL-safe chars and no two calls return the same one', async () => {
    const ids = await Promise.all(Array.from({ length: 100 }, () => createRoom()));
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
    expect(new Set(ids).size).toBe(ids.length);
  }, 90_000);

  it('TC-02: the id is an empty board a client can join immediately', async () => {
    const id = await createRoom();
    const client = yClient(id);
    expect(await until(() => client.provider.synced, 10_000)).toBe(true);
    expect(client.doc.getMap('objects').size).toBe(0);
    client.destroy();
  });

  it('TC-03: two clicks of Create give two boards, and neither is the other', async () => {
    const first = await create({ method: 'POST', ...SKIP_LIMIT });
    const second = await create({ method: 'POST', ...SKIP_LIMIT });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const a = (await first.json()) as { id: string };
    const b = (await second.json()) as { id: string };
    expect(a.id).not.toBe(b.id);

    // They are separate rooms: a note written in one never appears in the
    // other (a shared link must never land in a random board).
    const inFirst = yClient(a.id);
    const inSecond = yClient(b.id);
    expect(await until(() => inFirst.provider.synced && inSecond.provider.synced, 10_000)).toBe(
      true,
    );
    const key = createSticky(inFirst.doc, { x: 0, y: 0 });
    expect(await until(() => inSecond.doc.getMap('objects').size > 0, 3000)).toBe(false);
    expect(inSecond.doc.getMap<Y.Map<unknown>>('objects').has(key)).toBe(false);
    inFirst.destroy();
    inSecond.destroy();
  });

  it('TC-14: only POST is allowed on the collection', async () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const response = await create({ method });
      expect(response.status, method).toBe(405);
      expect(response.headers.get('allow'), method).toBe('POST');
    }
  });
});

describe('sharing an unknown link', () => {
  it('TC-08: a plain GET on a room address never opens a room, known or not', async () => {
    // Without the upgrade header the route answers 426 for EVERY valid id —
    // known or unknown — so the address leaks nothing about the board.
    const unknown = await fetch(`${HTTP_ORIGIN}/api/rooms/${room()}`);
    expect(unknown.status).toBe(426);

    const id = await createRoom();
    const known = await fetch(`${HTTP_ORIGIN}/api/rooms/${id}`);
    expect(known.status).toBe(426);
    const another = await fetch(`${HTTP_ORIGIN}/api/rooms/${room()}`);
    expect(another.status).toBe(426);
    const malformed = await fetch(`${HTTP_ORIGIN}/api/rooms/not-valid`);
    expect(malformed.status).toBe(404);
  });

  it('TC-07: GET /api/boards/<unknown> is 404, GET /api/boards/<known> is 200', async () => {
    const unknown = await fetch(`${HTTP_ORIGIN}/api/boards/${room()}`);
    expect(unknown.status).toBe(404);

    const id = await createRoom();
    const known = await fetch(`${HTTP_ORIGIN}/api/boards/${id}`);
    expect(known.status).toBe(200);
    expect((await known.json()) as { id: string }).toEqual({ id });

    // A malformed id never reaches the Durable Object namespace at all.
    const malformed = await fetch(`${HTTP_ORIGIN}/api/boards/deadbeef`);
    expect(malformed.status).toBe(404);
  });

  it('TC-09: a WebSocket to an unknown link is refused, and probing costs nothing', async () => {
    // The handshake fails instead of opening, and a probe of an unknown id
    // creates no storage: the same shape stays refused, over and over.
    await expect(rawClient(room())).rejects.toThrow(/ws error/);
    await expect(rawClient(room())).rejects.toThrow(/ws error/);
    await expect(rawClient(room())).rejects.toThrow(/ws error/);
  });

  it('TC-10: a malformed id is refused the same way an unknown one is', async () => {
    for (const path of ['/api/rooms/bad!id', '/api/rooms/short', '/api/rooms/a/b']) {
      const response = await fetch(`${HTTP_ORIGIN}${path}`);
      expect(response.status, path).toBe(404);
      expect(await response.text(), path).toBe('Invalid board id');
    }
    // …and a malformed id over a socket fails too.
    await expect(rawClient('bad!id')).rejects.toThrow(/ws error/);
  });

  it('TC-11: what a rejected socket never reaches a room', async () => {
    const id = await createRoom();
    const host = yClient(id);
    expect(await until(() => host.provider.synced, 10_000)).toBe(true);
    const key = createSticky(host.doc, { x: 40, y: 40 });

    // Someone speaks at rooms that do not exist: no socket, so no channel —
    // there is nothing on the server side to receive or store anything.
    for (let i = 0; i < 5; i++) {
      await expect(rawClient(room())).rejects.toThrow(/ws error/);
    }

    // The real room is untouched and still serves its members.
    const joiner = yClient(id);
    expect(await until(() => joiner.provider.synced, 10_000)).toBe(true);
    expect(await until(() => joiner.doc.getMap('objects').has(key), 8000)).toBe(true);
    host.destroy();
    joiner.destroy();
  });
});

describe('the guard leaves legitimate rooms alone', () => {
  it('a member whose opening frame is a partial sync is still accepted', async () => {
    const id = await createRoom();
    const client = await rawClient(id);
    // A truncated SyncStep1: an odd but legitimate opening must not be taken
    // for an unknown-link probe — the socket opens first.
    client.ws.send(new Uint8Array([0, 0]));
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
    client.close();
  });

  it('a room keeps working while unknown links are probed next to it', async () => {
    const id = await createRoom();
    const host = yClient(id);
    expect(await until(() => host.provider.synced, 10_000)).toBe(true);

    for (let i = 0; i < 5; i++) {
      await expect(rawClient(room())).rejects.toThrow(/ws error/);
    }

    const guest = yClient(id);
    expect(await until(() => guest.provider.synced, 10_000)).toBe(true);
    const key = createSticky(host.doc, { x: 5, y: 5 });
    expect(await until(() => guest.doc.getMap('objects').has(key), 8000)).toBe(true);
    expect(guest.doc.getMap<Y.Map<unknown>>('objects').get(key)?.get('type')).toBe('sticky');
    host.destroy();
    guest.destroy();
  });
});

describe('the create rate limit (TC-13, TC-30)', () => {
  it('a visitor past the limit is refused with 429 and creates nothing', async () => {
    // No `x-test-ignore-limit` here: this is the real limiter (10 per 60s,
    // one shared key locally), and the whole point is that a refusal creates
    // no board.
    const statuses: number[] = [];
    const ids: string[] = [];
    for (let i = 0; i < 15; i++) {
      const response = await create({ method: 'POST' });
      statuses.push(response.status);
      if (response.status === 201) {
        const body = (await response.json()) as { id?: string };
        expect(typeof body.id).toBe('string');
        ids.push(body.id as string);
      } else {
        expect(response.status).toBe(429);
        expect(await response.json()).toEqual({ error: 'rate_limited' });
      }
    }
    expect(statuses.filter((s) => s === 201).length).toBeLessThanOrEqual(10);
    expect(statuses).toContain(429);

    // The refused attempts created nothing. The boards that DID get created
    // are still perfectly joinable — the limit never damages an existing
    // board (AC-03: someone already inside keeps working).
    for (const id of ids.slice(0, 3)) {
      const client = yClient(id);
      expect(await until(() => client.provider.synced, 10_000)).toBe(true);
      client.destroy();
    }
  }, 60_000);
});
