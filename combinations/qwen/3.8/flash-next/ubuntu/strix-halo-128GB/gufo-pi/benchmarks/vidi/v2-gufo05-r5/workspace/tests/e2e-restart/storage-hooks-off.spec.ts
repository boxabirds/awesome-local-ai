/**
 * The storage hooks are not a feature (TC-24's other half): a server that was not started with
 * `TEST_HOOKS=1` must not answer them at all.
 *
 * This is the part of the story that keeps a test-only door from becoming a real one, so it is
 * checked against a server started the way production is - the same `wrangler.jsonc`, no variables -
 * rather than by reading the source and agreeing it looks gated. It also checks the board still
 * works on that server: turning the hooks off must not turn anything else off with them.
 */
import { expect, test } from '@playwright/test';
import { WranglerProcess } from '../e2e/helpers/wrangler-process';
import { readBoard, seedBoard } from '../e2e/helpers/seed-board';
import { newBoardId } from '../../src/shared/board-id';

test.describe('storage hooks on a server that does not have them', () => {
  test('TC-24 the hook routes are not routed, and the board is unaffected', async () => {
    test.setTimeout(300_000);
    // the same config the production build ships, and no `TEST_HOOKS` in it
    const server = new WranglerProcess(test.info().workerIndex, { testHooks: false });
    await server.start();
    const boardId = newBoardId();
    try {
      for (const action of ['corrupt-snapshot', 'repair'] as const) {
        const response = await fetch(`${server.baseUrl}/__test/boards/${boardId}/${action}`, {
          method: 'POST',
        });
        const body = await response.text();
        // Not routed means not routed. The path is not the room API, so the Worker hands it to the
        // assets, which refuse a POST to a file (405) or answer 404 - either way, no hook ran, and
        // nothing came back that a hook would have said. `200` with a chunk count is the hook
        // answering, and that is what must not happen here.
        expect(
          [404, 405],
          `${action} answered ${response.status} with "${body.slice(0, 120)}"`,
        ).toContain(response.status);
        expect(body).not.toContain('chunks');
      }

      // and a GET to the same address is an ordinary unknown path: the SPA fallback, like any
      // address the app does not have
      const page = await fetch(`${server.baseUrl}/__test/boards/${boardId}/corrupt-snapshot`);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type') ?? '').toContain('text/html');
      expect(await page.text()).toContain('id="root"');

      // and the server is otherwise an ordinary one: a board written to it comes back
      const seeded = await seedBoard(server.wsUrl, boardId, 2);
      expect(seeded).toHaveLength(2);
      expect((await readBoard(server.wsUrl, boardId))).toHaveLength(2);
    } finally {
      await server.dispose();
    }
  });
});
