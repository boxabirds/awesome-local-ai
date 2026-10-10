import { expect, test, type Page } from '@playwright/test';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { getNotes } from './helpers/sticky';
import { joinBoard, newLiveBoardId, trackErrors, waitForSameBoard } from './helpers/live';
import {
  createNotesAt,
  dragObjectBy,
  marqueeSelect,
  setZoomCamera,
  waitForPositions,
  waitForSelectedIds,
  waitForSelectionBarText,
} from './helpers/selection';

const COLUMNS = 5;
const ROWS = 4;
const ZOOM = 0.5;

const centreOf = (column: number, row: number): { x: number; y: number } => ({
  x: 150 + column * 300,
  y: 150 + row * 300,
});

const FIXTURE_CENTRES: { x: number; y: number }[] = [];
for (let row = 0; row < ROWS; row += 1) {
  for (let column = 0; column < COLUMNS; column += 1) {
    FIXTURE_CENTRES.push(centreOf(column, row));
  }
}

/** The world rectangle that box-selects exactly one column of the fixture. */
const columnRect = (column: number): { from: { x: number; y: number }; to: { x: number; y: number } } => ({
  from: { x: centreOf(column, 0).x - 120, y: 30 },
  to: { x: centreOf(column, 0).x + 120, y: 1170 },
});

/** Each editor moves their own column by their own amount (world units). */
const worldDeltaOf = (column: number): { x: number; y: number } => ({
  x: 60 * (column + 1),
  y: -20 * (column + 1),
});

const toScreen = (world: { x: number; y: number }): { x: number; y: number } => ({
  x: world.x * ZOOM,
  y: world.y * ZOOM,
});

/**
 * Story 7, task 15 - "Full-capacity reorganisation" (TC-36):
 * MAX_CONCURRENT_EDITORS browsers each reorganise a different part of one board at
 * the same time, and every browser ends up with the identical result.
 */
test.describe('story 7: full-capacity reorganisation', () => {
  test('TC-36: every editor reorganises their own selection and ends up identical', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const boardId = newLiveBoardId();
    const contexts = await Promise.all(
      Array.from({ length: MAX_CONCURRENT_EDITORS }, () => browser.newContext()),
    );
    try {
      const pages: Page[] = [];
      for (const context of contexts) {
        pages.push(await joinBoard(context, boardId));
      }
      const errors = pages.flatMap((page) => trackErrors(page));

      // Everyone looks at the board the same way, then one of them seeds it.
      await Promise.all(pages.map((page) => setZoomCamera(page, ZOOM)));
      const ids = await createNotesAt(pages[0] as Page, FIXTURE_CENTRES);
      for (const page of pages) {
        await expect
          .poll(async () => (await getNotes(page)).length, { timeout: 20_000 })
          .toBe(FIXTURE_CENTRES.length);
      }

      // Each editor selects their own column and drags it, all at the same time.
      const started = Date.now();
      await Promise.all(
        pages.map(async (page, column) => {
          const rect = columnRect(column);
          await marqueeSelect(page, rect.from, rect.to);
          const columnIds = Array.from({ length: ROWS }, (_, row) => ids[row * COLUMNS + column]!);
          await waitForSelectedIds(page, columnIds);
          await waitForSelectionBarText(page, `${ROWS} selected`);
          const delta = toScreen(worldDeltaOf(column));
          await dragObjectBy(page, columnIds[0]!, delta.x, delta.y);
        }),
      );

      // The boards become identical everywhere, and they match what was intended.
      await waitForSameBoard(pages);
      const ms = Date.now() - started;
      console.log(
        `TC-36 full-capacity convergence: ${ms} ms with ${MAX_CONCURRENT_EDITORS} editors ` +
          `(latency budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms per hop)`,
      );

      const expected: Record<string, { x: number; y: number }> = {};
      for (let row = 0; row < ROWS; row += 1) {
        for (let column = 0; column < COLUMNS; column += 1) {
          const id = ids[row * COLUMNS + column]!;
          const start = { x: centreOf(column, row).x - 100, y: centreOf(column, row).y - 100 };
          const delta = worldDeltaOf(column);
          expected[id] = { x: start.x + delta.x, y: start.y + delta.y };
        }
      }
      // Every editor's board holds the same final positions.
      for (const page of pages) {
        await waitForPositions(page, expected);
      }
      for (const [column, page] of pages.entries()) {
        const columnIds = Array.from({ length: ROWS }, (_, row) => ids[row * COLUMNS + column]!);
        await waitForSelectedIds(page, columnIds);
      }

      expect(errors).toEqual([]);
      const everyBoard = await Promise.all(pages.map((page) => getNotes(page)));
      const canonical = (notes: Awaited<ReturnType<typeof getNotes>>): string =>
        notes
          .map((note) => `${note.id}|${note.x}|${note.y}`)
          .sort()
          .join(',');
      const first = canonical(everyBoard[0] as Awaited<ReturnType<typeof getNotes>>);
      for (const notes of everyBoard) {
        expect(canonical(notes)).toBe(first);
      }
    } finally {
      for (const context of contexts) {
        await context.close();
      }
    }
  });
});
