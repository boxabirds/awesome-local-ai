/**
 * Integration: the board-surgery hooks that story 4's browser test uses, and the
 * guarantee that comes with them — they are not in the deployed thing.
 *
 * `env` here is `wrangler.jsonc`'s own environment, which is the production one, and it
 * does not set `TEST_HOOKS`. So `SELF.fetch` answers exactly as a deployed Worker would,
 * and the first case below is that claim rather than a mock of it. To test the hooks
 * themselves the handler is called with the environment the e2e web server starts with
 * (`--var TEST_HOOKS:1`), which is the only place that combination exists.
 *
 * The damage is real: chunk 0 of the board's snapshot is replaced with random bytes
 * inside the Durable Object's SQLite. What follows is not scripted — the next reader is
 * refused because the room genuinely cannot rebuild the board, and the board comes back
 * because the bytes genuinely go back.
 */

import { env, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky } from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import worker, { type Env } from '../../src/worker/index';
import { join, leaveAll, TestClient } from './helpers/ws-client';

/** The environment the end-to-end web server runs with, and nothing else ever does. */
const withHooks = { ...env, TEST_HOOKS: '1' } as unknown as Env;

/**
 * The handler, called the way the runtime calls it. The cast is because the exported
 * handler's request and context parameter types are the narrow ones a real entrypoint
 * guarantees, and this is a plain call rather than an entrypoint.
 */
const callWorker = worker.fetch as unknown as (request: Request, env: Env) => Promise<Response>;

/** Ask for board surgery, or ask badly and see what comes back. */
function hook(
  boardId: string,
  action: string,
  options: { method?: string; env?: Env } = {}
): Promise<Response> {
  return callWorker(
    new Request(`https://vidi6.example/__test/boards/${boardId}/${action}`, {
      method: options.method ?? 'POST'
    }),
    options.env ?? withHooks
  );
}

/** Clients opened by a test, closed whatever the test did with them. */
let opened: TestClient[] = [];

afterEach(async () => {
  const clients = opened;
  opened = [];
  await leaveAll(clients);
});

describe('the deployed configuration has no hooks', () => {
  it('serves the app for a hook path when TEST_HOOKS is not set', async () => {
    // This is the production environment, and the variable is not in it. (The binding
    // types are generated from `wrangler.jsonc`, which has no such var — hence asking
    // for it as the optional thing it is rather than pretending it is declared.)
    expect((env as { TEST_HOOKS?: string }).TEST_HOOKS).toBeUndefined();

    const boardId = newBoardId();
    const response = await SELF.fetch(`https://vidi6.example/__test/boards/${boardId}/corrupt-snapshot`);
    // Not a hook: the path is unknown to this Worker, so the assets answer with the app
    // like they do for any other path it does not know.
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(await response.text()).toContain('<div id="root"');

    // The same path by POST — the method the hook would take — is still not a hook, and
    // above all it does not touch a board.
    const posted = await SELF.fetch(
      `https://vidi6.example/__test/boards/${boardId}/corrupt-snapshot`,
      { method: 'POST' }
    );
    expect(posted.status).not.toBe(200);
    expect(posted.headers.get('Content-Type') ?? '').not.toContain('application/json');
  });

  it('never looks up a room for a hook path it is not serving', async () => {
    const idFromName = vi.spyOn(env.BOARD_ROOM, 'idFromName');
    await SELF.fetch(`https://vidi6.example/__test/boards/${newBoardId()}/repair`, { method: 'POST' });
    expect(idFromName).not.toHaveBeenCalled();
    idFromName.mockRestore();
  });
});

describe('the hooks, when they are on', () => {
  it('take only the two paths, only by POST, and only from a real board id', async () => {
    const boardId = newBoardId();
    const idFromName = vi.spyOn(env.BOARD_ROOM, 'idFromName');

    const asked: [string, Response][] = [
      // GET is not an offer to damage a board: the hooks are POST only, and say so.
      ['a method that is not POST', await hook(boardId, 'corrupt-snapshot', { method: 'GET' })],
      // Only the two hooks exist; a plausible third one is not there.
      ['a path that is not one of the two', await hook(boardId, 'delete-everything')],
      // An id that is not an id never selects a room, hooked or not.
      ['a board id that is not an id', await hook('not-an-id', 'corrupt-snapshot')],
      ['a path missing its board', await callWorker(
        new Request('https://vidi6.example/__test/corrupt-snapshot', { method: 'POST' }),
        withHooks
      )]
    ];
    for (const [what, response] of asked.slice(1)) {
      expect(response.status, what).toBe(404);
    }
    expect(asked[0][1].status).toBe(405);
    expect(idFromName).not.toHaveBeenCalled();
    idFromName.mockRestore();
  });

  // TC-24's server half, without a browser in the way.
  it(
    'damages a board, shuts the next reader out, and hands it back whole',
    async () => {
      const boardId = newBoardId();
      const author = await join(boardId);
      opened = [author];
      for (let index = 0; index < 3; index += 1) createSticky(author.doc, { x: index * 40, y: index * 30 });
      expect(author.snapshot()).toHaveLength(3);
      const left = author.snapshot();
      await leaveAll(opened);
      opened = [];

      const corrupted = await hook(boardId, 'corrupt-snapshot');
      expect(corrupted.status).toBe(200);
      const damage = await corrupted.json<{ ok: boolean; bytes: number }>();
      expect(damage.ok).toBe(true);
      expect(damage.bytes).toBeGreaterThan(0);

      // The next person to open this board is turned away with the code that says the
      // board could not be opened — not shown an empty board.
      const refused = await join(boardId, { silent: true });
      opened = [refused];
      const closure = await refused.waitForClose();
      expect(closure.code).toBe(CLOSE_BOARD_LOAD_FAILED);

      // Put the bytes back. The room does not notice until it tries to read again, and
      // it will not try inside the retry window — so this waits the window out rather
      // than being told to.
      const repaired = await hook(boardId, 'repair');
      expect(repaired.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 5_400));

      const reader = await join(boardId);
      opened = [reader];
      expect(reader.snapshot()).toEqual(left);
    },
    40_000
  );
});
