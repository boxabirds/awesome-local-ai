import { describe, it, expect, afterEach } from 'vitest';
import { SELF, env, reset, runInDurableObject } from 'cloudflare:test';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import {
  addSticky,
  bindings,
  connectRoom,
  newBoardIdFor,
  openClient,
  settle,
} from './helpers/room';

/**
 * The storage test hooks (task "Test hooks"), anchor `persist.client_status`.
 *
 * The important assertion is the negative one: with `TEST_HOOKS` unset - which
 * is how `wrangler.jsonc` is written, so it is how a deployed Worker runs -
 * these addresses are not routes at all. The rest shows the hooks do what the
 * browser tests need them to do.
 */

const SELF_ORIGIN = 'http://board.test';
const OPEN: { close(): void }[] = [];

afterEach(async () => {
  for (const socket of OPEN.splice(0)) {
    try {
      socket.close();
    } catch {
      // Already gone.
    }
  }
  delete (env as Record<string, unknown>).TEST_HOOKS;
  await reset();
});

const hook = (board: string, action: string, method: string = 'POST'): Promise<Response> =>
  SELF.fetch(`${SELF_ORIGIN}/__test/boards/${board}/${action}`, { method });

describe('storage test hooks', () => {
  it('are absent from a build without TEST_HOOKS (production)', async () => {
    const board = newBoardIdFor('hooksoff');
    const response = await hook(board, 'corrupt-snapshot');

    // Not a hook answer. With no hook route the request lands on the static
    // client build, which refuses a POST to an address that is not a file -
    // either way, no hook in a deployed Worker ever touches a board.
    const body = await response.text();
    expect(body).not.toContain('"ok"');
    expect(response.status).not.toBe(200);
  });

  it(
    'answer when TEST_HOOKS is 1, and drive a board from damaged to loadable',
    async () => {
    (env as Record<string, unknown>).TEST_HOOKS = '1';
    const board = newBoardIdFor('hooksgonna');

    const client = await openClient(board);
    OPEN.push(client);
    client.edit((doc) => {
      addSticky(doc, 20, 20, 'saved to a snapshot');
    });
    await settle(300);

    const stats = await hook(board, 'stats', 'GET');
    expect(stats.status).toBe(200);
    const body = (await stats.json()) as { ok: boolean; stats: { updateRows: number } };
    expect(body.ok).toBe(true);
    expect(body.stats.updateRows).toBe(1);

    const compacted = await hook(board, 'compact');
    expect(((await compacted.json()) as { compacted: boolean }).compacted).toBe(true);

    const corrupted = await hook(board, 'corrupt-snapshot');
    expect(((await corrupted.json()) as { ok: boolean }).ok).toBe(true);

    // The damage only shows when the room reads its board again, which is what
    // happens once the last person has left and someone comes back.
    client.close();
    await settle(300);

    const socket = await connectRoom(board);
    OPEN.push(socket);
    expect((await socket.closed(5_000)).code).toBe(CLOSE_BOARD_LOAD_FAILED);

    const repaired = await hook(board, 'repair');
    expect(((await repaired.json()) as { ok: boolean }).ok).toBe(true);

    // The room will not read the board again until its failure is old enough,
    // so the test ages it rather than waiting five seconds.
    const ns = bindings().BOARD_ROOM;
    await runInDurableObject(ns.get(ns.idFromName(board)), (instance) =>
      instance.testAgeLoadFailure(LOAD_RETRY_MIN_INTERVAL_MS),
    );

    const back = await openClient(board);
    OPEN.push(back);
    expect(back.snapshot().map((note) => note.text)).toEqual(['saved to a snapshot']);
    },
    20_000,
  );

  it('reject a bad board id and an unknown action', async () => {
    (env as Record<string, unknown>).TEST_HOOKS = '1';

    const invalid = await hook('not-a-board-id', 'corrupt-snapshot');
    expect(invalid.status).toBe(400);

    const unknown = await hook(newBoardIdFor('hooksunknown'), 'explode-the-board');
    expect(unknown.status).toBe(404);

    const wrongMethod = await hook(newBoardIdFor('hooksmethod'), 'repair', 'GET');
    expect(wrongMethod.status).toBe(405);
  });
});
