import { expect, test } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';

/**
 * Story 4's safety rule, checked against the server the whole rest of the suite
 * runs on: the storage-damage hooks exist only where `TEST_HOOKS` is on, and this
 * server — the one built the way production is built — was started without it.
 * A request that could corrupt a board gets the same answer as any other nonsense.
 */
test.describe('Production configuration', () => {
  test('the room test hooks are not routed', async ({ request }) => {
    const boardId = newBoardId();
    for (const hook of ['corrupt-snapshot', 'repair-snapshot', 'seed-notes', 'pump-notes']) {
      const post = await request.post(`/__test/${boardId}/${hook}`);
      expect(post.status(), `POST /__test/.../${hook}`).toBe(404);
    }
  });
});
