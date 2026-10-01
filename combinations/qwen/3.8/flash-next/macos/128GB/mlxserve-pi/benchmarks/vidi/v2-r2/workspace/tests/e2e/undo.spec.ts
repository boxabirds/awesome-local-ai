// Story 8 end-to-end: undo and redo across real browsers on one board, through
// the real provider. The point none of the unit or component tests can make is
// that this person's undo never reaches another person's work: every local change
// carries LOCAL_ORIGIN and is the only thing the local UndoManager tracks, while
// a colleague's change arrives over the socket under the provider's own origin and
// is never in these undo/redo stacks. (TC-22 to TC-24.)

import { test, expect, type Browser, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  content,
  createBoard,
  createNote,
  createNoteViaToolbar,
  deleteNote,
  editNote,
  noteCount,
  openBoard,
  type Content,
} from './helpers/live';

/** Open `n` editors on one board and wait until they agree. */
async function openMany(browser: Browser, n: number, boardId: string): Promise<Page[]> {
  const pages: Page[] = [];
  for (let i = 0; i < n; i++) pages.push(await openBoard(browser, boardId));
  await waitForContentsMatch(pages);
  return pages;
}

async function waitForContentsMatch(pages: Page[]): Promise<void> {
  await expect
    .poll(async () => sameContent(pages), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(true);
}

async function sameContent(pages: Page[]): Promise<boolean> {
  const all = await Promise.all(pages.map(content));
  const first = JSON.stringify(all[0]);
  return all.every((c) => JSON.stringify(c) === first);
}

/** This editor's undo, from the keyboard, focus on the board (not a note's text). */
async function pressUndo(page: Page): Promise<void> {
  await page.keyboard.press('Control+z');
}
async function pressRedo(page: Page): Promise<void> {
  await page.keyboard.press('Control+Shift+z');
}

/** Select every object on this board and delete them as one group (one step). */
async function deleteEverything(page: Page): Promise<void> {
  await page.locator('[data-testid="board-viewport"]').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+a');
  await page.getByTestId('selection-delete').click();
}

/** Drag whatever note sits under a fixed screen point, by a delta. */
async function dragAt(page: Page, at: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + dx / 2, at.y + dy / 2, { steps: 4 });
  await page.mouse.move(at.x + dx, at.y + dy, { steps: 4 });
  await page.mouse.up();
}

/** Type into the note that sits under a fixed screen point, then commit. */
async function typeAt(page: Page, at: { x: number; y: number }, text: string): Promise<void> {
  await editNote(page, await indexAt(page, at));
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

/** Which painted note has its centre nearest a screen point. */
async function indexAt(page: Page, at: { x: number; y: number }): Promise<number> {
  return page.evaluate((p) => {
    const notes = [...document.querySelectorAll<HTMLElement>('[data-testid="sticky-note"]')];
    let best = 0;
    let bestDist = Infinity;
    notes.forEach((el, i) => {
      const b = el.getBoundingClientRect();
      const d = Math.hypot(b.x + b.width / 2 - p.x, b.y + b.height / 2 - p.y);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }, at);
}

const byId = (rows: Content[]): Map<string, Content> => new Map(rows.map((r) => [r.id, r]));

test('TC-22 my undo brings back what I deleted while a colleague keeps their new note', async ({
  browser,
  request,
}) => {
  const boardId = await createBoard(request);
  const [mia, raj] = await openMany(browser, 2, boardId);

  // Mia makes eight notes, then deletes them all as one group.
  for (let i = 0; i < 8; i++) {
    await createNoteViaToolbar(mia, `n${i}`);
  }
  await waitForContentsMatch([mia, raj]);
  expect(await noteCount(mia)).toBe(8);

  await deleteEverything(mia);
  await waitForContentsMatch([mia, raj]);
  expect(await noteCount(mia)).toBe(0);

  // Raj adds his own note while the eight are gone; it arrives over the socket.
  await createNote(raj, { x: 640, y: 500 }, 'raj');
  await waitForContentsMatch([mia, raj]);
  expect(await noteCount(mia)).toBe(1);

  // Mia undoes: her eight return on both screens, Raj's note is untouched.
  await pressUndo(mia);
  await waitForContentsMatch([mia, raj]);
  const restored = await content(mia);
  expect(restored).toHaveLength(9);
  expect(restored.some((n) => n.text === 'raj')).toBe(true);
  expect(restored.filter((n) => /^n\d$/.test(n.text))).toHaveLength(8);

  // Redo takes her eight away again; Raj's is still there.
  await pressRedo(mia);
  await waitForContentsMatch([mia, raj]);
  const redone = await content(mia);
  expect(redone.map((n) => n.text)).toEqual(['raj']);
});

test('TC-23 undoing a move of a note a colleague deleted does nothing and errors nothing', async ({
  browser,
  request,
}) => {
  const boardId = await createBoard(request);
  const [mia, raj] = await openMany(browser, 2, boardId);

  await createNote(mia, { x: 400, y: 300 }, 'mine');
  await waitForContentsMatch([mia, raj]);
  const id = (await content(mia))[0].id;

  // Mia moves the note, then Raj deletes it; both screens agree it is gone.
  await dragAt(mia, { x: 400, y: 300 }, 120, 80);
  await waitForContentsMatch([mia, raj]);
  await deleteNote(raj, 0);
  await waitForContentsMatch([mia, raj]);
  expect(await noteCount(mia)).toBe(0);

  // Mia undoes her move of a note that no longer exists: nothing happens, no
  // error, and the history stays usable (undo again, then redo, without a crash).
  await pressUndo(mia);
  await pressUndo(mia);
  await pressRedo(mia);
  await waitForContentsMatch([mia, raj]);

  await expect(mia.getByTestId('board-viewport')).toBeVisible();
  expect(await noteCount(mia)).toBe(0);
  expect((await content(mia)).find((n) => n.id === id)).toBeUndefined();
});

test('TC-24 every editor undoes only their own move and typing while everyone works at once', async ({
  browser,
  request,
}) => {
  const boardId = await createBoard(request);
  const pages = await openMany(browser, MAX_CONCURRENT_EDITORS, boardId);

  // Fixed, well-separated slots so each editor always grabs their own two notes:
  // the top row is each editor's "move" note, the bottom row their "type" note.
  const moveSlot = (i: number): { x: number; y: number } => ({ x: 120 + i * 220, y: 140 });
  const typeSlot = (i: number): { x: number; y: number } => ({ x: 120 + i * 220, y: 560 });

  // One editor lays out all the notes; every board ends up holding them.
  for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
    await createNote(pages[0], moveSlot(i), '');
    await createNote(pages[0], typeSlot(i), '');
  }
  await waitForContentsMatch(pages);
  const baseline = await content(pages[0]);
  expect(baseline).toHaveLength(MAX_CONCURRENT_EDITORS * 2);

  // Each editor moves their own top-row note and types in their own bottom-row
  // note - all at the same time.
  await Promise.all(
    pages.map(async (page, i) => {
      await dragAt(page, moveSlot(i), 40, 40);
      await typeAt(page, typeSlot(i), `edit-${i}`);
    }),
  );
  await waitForContentsMatch(pages);

  // ...then each presses Ctrl/Cmd+Z twice: once for their typing, once for their
  // move. Nobody's note disappears; only each editor's own two edits give way.
  await Promise.all(
    pages.map(async (page) => {
      await pressUndo(page);
      await pressUndo(page);
    }),
  );
  await waitForContentsMatch(pages);

  const after = await content(pages[0]);
  const before = byId(baseline);
  expect(after).toHaveLength(MAX_CONCURRENT_EDITORS * 2);
  for (const note of after) {
    const original = before.get(note.id);
    expect(original).toBeDefined();
    // own move and own typing are reverted...
    expect(note.x).toBe(original!.x);
    expect(note.y).toBe(original!.y);
    expect(note.text).toBe('');
  }
  // ...and every board is identical.
  expect(await sameContent(pages)).toBe(true);
});
