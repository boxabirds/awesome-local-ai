import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';
import worker, { type Env } from '../../src/worker/index';
import type { BoardRoom } from '../../src/worker/board-room';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { createSticky } from '../../src/shared/board-model';
import {
  boardId,
  boardState,
  env,
  Participant,
  waitForConvergence,
} from './helpers/ws-client';

/**
 * `sync.worker_entry` in the real runtime: the requests below go through the Worker's own
 * `fetch` handler (via `SELF.fetch`, or via the exported handler with a watching
 * environment where a call to the Durable Object has to be counted), so routing and status
 * codes are observed as request-handling facts rather than as mocks.
 */

/** A `BOARD_ROOM` namespace that records every `idFromName` call. */
function watchingNamespace(namespace: DurableObjectNamespace<BoardRoom>): {
  readonly value: DurableObjectNamespace<BoardRoom>;
  readonly names: string[];
} {
  const names: string[] = [];
  const value = new Proxy(namespace, {
    get(target, property, receiver) {
      if (property === 'idFromName') {
        return (name: string): DurableObjectId => {
          names.push(name);
          return target.idFromName(name);
        };
      }
      const member = Reflect.get(target, property, receiver);
      return typeof member === 'function' ? (member as CallableFunction).bind(target) : member;
    },
  });
  return { value, names };
}

/** The Worker's handler plus an environment that counts room lookups. */
function handlerWithWatch(): {
  fetch(request: Request): Promise<Response>;
  names: string[];
} {
  const watch = watchingNamespace(env.BOARD_ROOM);
  const watched: Env = { BOARD_ROOM: watch.value, ASSETS: env.ASSETS };
  return {
    fetch: (request: Request) => worker.fetch(request, watched),
    names: watch.names,
  };
}

describe('worker routing (TC-04 to TC-06)', () => {
  it('answers an invalid board id with 404 and never creates a room (TC-04, negative)', async () => {
    // A board id is 22 characters of base64url and nothing else, so none of these is allowed
    // to reach a Durable Object at all.
    const invalid = [
      'bad!id',
      'a'.repeat(21),
      'a'.repeat(23),
      `${'a'.repeat(22)}=`,
      `${'a'.repeat(20)}..`,
      'has space',
      '../x',
    ];
    const handler = handlerWithWatch();
    for (const candidate of invalid) {
      const response = await handler.fetch(
        new Request(`http://localhost/api/rooms/${encodeURIComponent(candidate)}`, {
          headers: { Upgrade: 'websocket' },
        }),
      );
      // 404, where story 3 answered 400: from story 5 a link that is not a board id and a link
      // to a board that was never made get the same answer, because the difference between them
      // is information about which links are real (share.not_found).
      expect(response.status, candidate).toBe(404);
    }
    expect(handler.names).toEqual([]);
  });

  it('answers a request that is not an upgrade with 426 (TC-05)', async () => {
    const response = await SELF.fetch(
      new Request(`http://localhost/api/rooms/${boardId()}`),
    );
    expect(response.status).toBe(426);
  });

  it('serves index.html for a board address (TC-06, SPA fallback)', async () => {
    const response = await SELF.fetch(new Request(`http://localhost/b/${boardId()}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type') ?? '').toContain('text/html');
    expect(await response.text()).toContain('id="root"');
  });
});

describe('participants and boards (TC-13, TC-17)', () => {
  it('accepts more people than the capacity setting and still syncs them (TC-13)', async () => {
    const id = boardId();
    const people: Participant[] = [];
    try {
      for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i += 1) {
        // Every socket is upgraded: nobody is refused, not even the 6th.
        people.push(await new Participant().connect(id));
      }
      await Promise.all(people.map((person) => person.waitFor(() => person.synced, 'sync')));
      const latecomer = people[people.length - 1];
      if (latecomer === undefined) {
        throw new Error('the last participant is missing');
      }
      createSticky(latecomer.doc, { x: 40, y: 60 });
      const others = people.slice(0, -1);
      await waitForConvergence([latecomer, ...others]);
      expect(latecomer.snapshot()).toHaveLength(1);
      for (const other of others) {
        expect(other.snapshot()[0]?.text).toBe('');
      }
    } finally {
      for (const person of people) {
        person.close();
      }
    }
  });

  it('keeps two boards apart (TC-17, negative)', async () => {
    const first = boardId();
    const second = boardId();
    const inFirst = await new Participant().connect(first);
    const inSecond = await new Participant().connect(second);
    const alsoFirst = await new Participant().connect(first);
    try {
      await waitForConvergence([inFirst, inSecond, alsoFirst]);
      // From here on, every frame that arrives on the second board would be a leak.
      const seenOnSecond = inSecond.frames.length;
      createSticky(inFirst.doc, { x: 0, y: 0 });
      createSticky(inFirst.doc, { x: 10, y: 20 });
      // The board it belongs to does get them, so the test would notice a working relay.
      await waitForConvergence([inFirst, alsoFirst]);
      expect(alsoFirst.snapshot()).toHaveLength(2);
      await new Promise((resolve) => {
        setTimeout(resolve, 250);
      });
      expect(inSecond.snapshot()).toEqual([]);
      expect(boardState(inSecond)).toBe('[]');
      expect(inSecond.frames.length).toBe(seenOnSecond);
    } finally {
      inFirst.close();
      inSecond.close();
      alsoFirst.close();
    }
  });
});
