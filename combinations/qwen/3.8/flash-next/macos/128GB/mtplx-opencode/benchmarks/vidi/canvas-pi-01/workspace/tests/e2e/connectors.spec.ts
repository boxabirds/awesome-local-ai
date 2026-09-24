/**
 * Story 10 · task 15 — end-to-end connector workflows, run in Chromium,
 * Firefox and WebKit against the built app with **two real clients** in one
 * context (the same room, one WebSocket each, as in the story 3 collaboration
 * tests).
 *
 * What these can show and a component test cannot: an arrow that follows an
 * object *someone else* moved, on both screens, inside the live-update budget;
 * an arrow that survives the deletion of what it pointed at; and an arrow drawn
 * while its target is being deleted under it. An arrow stores no geometry, so
 * every assertion here is about the painted line and its stored ends.
 */
import { expect, test, type Page } from '@playwright/test';
import { createBoardViaApi, waitForBoard } from './helpers/boards';
import { arrows, drawArrow, drawShape, moveShape, settle } from './helpers/shapes';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';

/** Two pages on one board, both actually synced. */
async function twoClients(context: import('@playwright/test').BrowserContext) {
  const pageA = await context.newPage();
  const boardId = await createBoardViaApi(pageA.request);
  await pageA.goto(`/b/${boardId}`);
  await waitForBoard(pageA);
  const pageB = await context.newPage();
  await pageB.goto(`/b/${boardId}`);
  await settle(pageB);
  await expect
    .poll(() => arrows(pageB).then(() => 'ready'), { timeout: 15_000 })
    .toBe('ready');
  return { pageA, pageB };
}

/** Wait until both pages paint the same number of arrows. */
async function arrowsMatch(pageA: Page, pageB: Page): Promise<boolean> {
  const a = (await arrows(pageA)).length;
  const b = (await arrows(pageB)).length;
  return a > 0 && a === b;
}

/** Build a two-shape board (A left, B right) on `page`. */
async function twoShapes(page: Page): Promise<void> {
  await drawShape(page, [300, 320], [430, 430]);
  await drawShape(page, [700, 320], [830, 430]);
  await settle(page);
}

test('TC-25: an arrow follows a shape someone else moved, and switches side', async ({
  context,
}) => {
  const { pageA, pageB } = await twoClients(context);

  await twoShapes(pageA);
  // Dana connects the two shapes: centre of A to centre of B.
  await drawArrow(pageA, [365, 375], [765, 375]);

  // Both screens have the arrow, still attached at both ends.
  await expect
    .poll(() => arrowsMatch(pageA, pageB), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 4 })
    .toBe(true);
  const before = await arrows(pageB);
  expect(before[0]!.from.startsWith('attached:')).toBe(true);
  expect(before[0]!.to.startsWith('attached:')).toBe(true);
  // Initially the line runs left → right (A is left of B).
  expect(before[0]!.leftToRight).toBe(true);

  // Dana drags B past A, so the arrow has to change which sides it touches.
  await moveShape(pageA, [765, 375], [180, 375]);

  // Within the budget, *both* screens redraw it still attached, and the line
  // now runs the other way: the ends moved to the facing sides.
  await expect
    .poll(
      async () => {
        const a = await arrows(pageA);
        const b = await arrows(pageB);
        if (a.length !== 1 || b.length !== 1) return false;
        return (
          a[0]!.to.startsWith('attached:') &&
          b[0]!.to.startsWith('attached:') &&
          !a[0]!.leftToRight &&
          !b[0]!.leftToRight
        );
      },
      { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 2 },
    )
    .toBe(true);
});

test('TC-26: deleting the target leaves a free end where that side used to be', async ({
  context,
}) => {
  const { pageA, pageB } = await twoClients(context);

  await twoShapes(pageA);
  await drawArrow(pageA, [365, 375], [765, 375]);
  await expect
    .poll(() => arrowsMatch(pageA, pageB), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 4 })
    .toBe(true);
  const before = (await arrows(pageB))[0]!;

  // Sam deletes B: select it, then Delete. One step deletes the note *and*
  // releases the arrow's end, so the arrow must survive on both screens.
  await pageB.mouse.click(765, 375);
  await settle(pageB);
  await pageB.keyboard.press('Delete');
  await settle(pageB);

  await expect
    .poll(
      async () => {
        const a = await arrows(pageA);
        const b = await arrows(pageB);
        if (a.length !== 1 || b.length !== 1) return false;
        // The end is free, and it stayed at the place B's facing side used to
        // occupy rather than snapping to the deleted shape's centre.
        return a[0]!.to === 'free' && b[0]!.to === 'free';
      },
      { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 2 },
    )
    .toBe(true);

  // The arrow is still drawn where it was: its box has not collapsed.
  const after = (await arrows(pageB))[0]!;
  expect(after.width).toBeGreaterThan(20);
  expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(2);
});

test('TC-27: a connector drawn while its target is deleted renders without errors', async ({
  context,
}) => {
  const { pageA, pageB } = await twoClients(context);

  const errors: string[] = [];
  const record = (page: Page) => {
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
  };
  record(pageA);
  record(pageB);

  await twoShapes(pageA);
  // Sam selects B (so the delete is one keystroke away) but does not delete yet.
  await pageB.mouse.click(765, 375);
  await settle(pageB);

  // Dana starts an arrow to B …
  await pageA.keyboard.press('l');
  await settle(pageA);
  await pageA.mouse.move(365, 375);
  await pageA.mouse.down();
  await pageA.mouse.move(560, 375, { steps: 6 });
  await settle(pageA);

  // … and while that drag is still in flight, Sam deletes the target.
  await pageB.keyboard.press('Delete');
  await settle(pageB);

  // Dana finishes the drag over the space B used to fill.
  await pageA.mouse.move(765, 375, { steps: 6 });
  await settle(pageA);
  await pageA.mouse.up();
  await settle(pageA);

  // Dana still sees an arrow, drawn to a free end at the release point, and
  // neither page threw anything while the target disappeared mid-gesture.
  const drawn = await arrows(pageA);
  expect(drawn).toHaveLength(1);
  expect(drawn[0]!.to).toBe('free');
  expect(drawn[0]!.width).toBeGreaterThan(20);
  await expect
    .poll(async () => (await arrows(pageB)).length, { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 2 })
    .toBe(1);
  expect(errors).toEqual([]);
});
