import { test as base } from '@playwright/test';
import { boardPath, createBoard, openBoard } from './boards';

/**
 * A `test` whose page is already standing on a board of its own.
 *
 * Suites about the canvas — panning, zooming, dragging notes — are not testing
 * how a board comes into existence; they need one to exist. Story 5 made that a
 * deliberate act rather than something a URL does, so this fixture does the
 * asking: one board per test, created over the API, opened and synced before the
 * first line of the test runs.
 *
 * Per *test*, not per suite: a shared board would carry one test's notes into
 * the next, and "the drag moved the note" would stop meaning anything. Each
 * board gets its own fake visitor address, so the create rate limit is never the
 * reason a canvas test failed (see `./boards.ts`).
 */
export type BoardFixtures = {
  /** The board this test was given, already created. */
  boardId: string;
};

export const test = base.extend<BoardFixtures>({
  boardId: async ({ request }, use, testInfo) => {
    const tag = `${testInfo.project.name} ${testInfo.titlePath.join(' / ')}`;
    await use(await createBoard(request, tag, `${testInfo.project.name}:${testInfo.parallelIndex}`));
  },

  // Overriding Playwright's own `page` is deliberate: the alternative is a
  // `page.goto` at the top of every canvas test, which is the thing this fixture
  // exists to make unnecessary.
  page: async ({ page, boardId }, use) => {
    await openBoard(page, boardPath(boardId));
    await use(page);
  },
});

export { expect } from '@playwright/test';
