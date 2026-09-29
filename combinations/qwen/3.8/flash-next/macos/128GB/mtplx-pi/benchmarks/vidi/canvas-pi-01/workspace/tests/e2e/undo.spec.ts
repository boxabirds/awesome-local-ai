/**
 * Story 8 · task 9 — end-to-end undo / redo (TC-22 … TC-24), run in Chromium,
 * Firefox and WebKit against the built app served by `wrangler dev`.
 *
 * These prove the two things the design reserves for e2e: that Ctrl+Z drives the
 * personal history in a real browser (not the browser's own text undo), and that
 * the history is per-session and per-user. Geometry is read from the rendered
 * page (each note's stamped world `x`), so a revert is a measured fact, not an
 * echo of the model.
 */
import { expect, test, type Page } from '@playwright/test';
import { settle } from './helpers/board';
import { createBoardViaApi, openFreshBoard, waitForBoard } from './helpers/boards';
import { createNoteAt, readNotes, settle as stickySettle } from './helpers/sticky';

/** Drag from a screen point by a screen delta (button held, then settle). */
async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
  await page.mouse.up();
  await stickySettle(page);
}

/** World `x` of a note by id, or null if it is gone. */
async function noteX(page: Page, id: string): Promise<number | null> {
  const note = (await readNotes(page)).find((n) => n.id === id);
  return note ? note.wx : null;
}

/** The first note's id (any). */
async function firstNoteId(page: Page): Promise<string | null> {
  const notes = await readNotes(page);
  return notes.length > 0 ? notes[0].id : null;
}
test('TC-22 golden path: drag then Ctrl+Z reverts the drag; Ctrl+Shift+Z redoes it', async ({
  page,
}) => {
  await openFreshBoard(page);
  await settle(page);

  // Create a note and move it — two own steps.
  await createNoteAt(page, 300, 300);
  await page.keyboard.type('Hello');
  await page.keyboard.press('Escape');
  await stickySettle(page);

  const note = (await readNotes(page))[0];
  const homeX = note.cx;

  // Drag it right; the whole drag is one step.
  await dragBy(page, { x: note.cx, y: note.cy }, 200, 0);
  const movedX = (await noteX(page, note.id))!;

  // Undo the drag: the note returns to where it was before the gesture.
  await page.keyboard.press('Meta+z');
  await stickySettle(page);
  const reverted = (await readNotes(page)).find((n) => n.id === note.id)!;
  expect(reverted.wx).not.toBe(movedX);
  expect(Math.abs(reverted.cx - homeX)).toBeLessThan(4);

  // Redo re-applies the drag.
  await page.keyboard.press('Shift+Meta+z');
  await stickySettle(page);
  const redone = (await readNotes(page)).find((n) => n.id === note.id)!;
  expect(redone.cx).toBeGreaterThan(reverted.cx + 100);
});

test('TC-22b Ctrl+Z inside a note undoes the whole typing burst', async ({ page }) => {
  await openFreshBoard(page);
  await settle(page);
  await createNoteAt(page, 300, 300);
  // Type a burst with no pause — one undo step for the whole run.
  await page.keyboard.type('abcdef');
  const editor = page.getByTestId('sticky-editor');
  await expect(editor).toHaveValue('abcdef');

  // While still editing, Ctrl+Z reverts the burst (beyond any browser undo).
  await page.keyboard.press('Meta+z');
  await stickySettle(page);
  await expect(editor).toHaveValue('');

  // Ctrl+Shift+Z re-applies it.
  await page.keyboard.press('Shift+Meta+z');
  await stickySettle(page);
  await expect(editor).toHaveValue('abcdef');
});

test('TC-23 a page reload clears the history', async ({ page }) => {
  await openFreshBoard(page);
  await settle(page);
  await createNoteAt(page, 300, 300);
  await page.keyboard.type('Hello');
  await page.keyboard.press('Escape');
  await stickySettle(page);

  const id = (await readNotes(page))[0].id;
  const beforeX = (await noteX(page, id))!;

  // Reload the page: the next Ctrl+Z does nothing.
  await page.reload();
  await waitForBoard(page);
  await stickySettle(page);

  // The Undo button is disabled — the fresh session has no own changes.
  await expect(page.getByTestId('undo-button')).toBeDisabled();

  // Ctrl+Z changes nothing (the note and its position survive).
  await page.keyboard.press('Meta+z');
  await stickySettle(page);
  const afterX = await noteX(page, id);
  expect(afterX).not.toBeNull();
  expect(afterX).toBeCloseTo(beforeX, 0);
});

test("TC-24 the history is per-user: one profile cannot undo another profile's change", async ({
  context,
}) => {
  const pageA = await context.newPage();
  const boardId = await createBoardViaApi(pageA.request);
  await pageA.goto(`/b/${boardId}`);
  await waitForBoard(pageA);
  const pageB = await context.newPage();
  await pageB.goto(`/b/${boardId}`);
  await stickySettle(pageA);
  await stickySettle(pageB);

  // A creates a note via the toolbar; B receives it as a remote change.
  await pageA.getByTestId('create-sticky').click();
  await expect
    .poll(() => readNotes(pageB).then((n) => n.length), { timeout: 20_000 })
    .toBe(1);

  // B never made a change, so it has nothing to undo: the button is disabled and
  // Ctrl+Z leaves the remote note exactly where A put it.
  await expect(pageB.getByTestId('undo-button')).toBeDisabled();
  const remoteX = await firstNoteId(pageB);
  const remoteBefore = (await noteX(pageB, remoteX!))!;
  await pageB.keyboard.press('Meta+z');
  await stickySettle(pageB);
  const stillThere = await noteX(pageB, remoteX!);
  expect(stillThere).not.toBeNull();
  expect(stillThere).toBeCloseTo(remoteBefore, 0);

  // But B can undo its OWN change: B creates a second note, then undoes it.
  await pageB.getByTestId('create-sticky').click();
  await stickySettle(pageB);
  await expect(pageB.getByTestId('undo-button')).toBeEnabled();
  await pageB.keyboard.press('Meta+z');
  await stickySettle(pageB);
  // B's own note is gone from B (undo of B's own create).
  await expect
    .poll(() => readNotes(pageB).then((n) => n.length), { timeout: 10_000 })
    .toBe(1);
});