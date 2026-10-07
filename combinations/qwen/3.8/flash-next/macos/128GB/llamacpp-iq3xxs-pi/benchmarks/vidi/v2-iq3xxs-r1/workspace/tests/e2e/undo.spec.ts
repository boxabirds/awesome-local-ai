import { expect, test, type Page } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import type { StickySnapshot } from '../../src/shared/board-model';
import {
  boardSignature,
  closeScreens,
  createNote,
  expectNoteText,
  expectNotesOn,
  expectSameBoard,
  gotoNewBoard,
  liveNoteIds,
  openScreen,
  waitForSynced,
} from './helpers/sync';
import { dragNote, marqueeSelect, noteBox, pressDelete, selectedIds } from './helpers/selection';

/**
 * Story 8 — "Undo and redo my own changes without undoing anyone else's" (TC-22 to
 * TC-24).
 *
 * Every test needs at least two screens, each in its own browser context, so the only
 * thing a person's undo can travel through is the shared document. Undo and redo are
 * driven the way a person drives them — Ctrl/Cmd+Z, the toolbar's Undo and Redo — and
 * what is checked afterwards is what each screen shows, including the screens whose
 * work was *not* touched.
 */

/** Spots for the eight notes: a 4x2 grid, clear of the toolbar and of each other. */
const EIGHT = [
  { x: 380, y: 280 },
  { x: 620, y: 280 },
  { x: 860, y: 280 },
  { x: 1100, y: 280 },
  { x: 380, y: 520 },
  { x: 620, y: 520 },
  { x: 860, y: 520 },
  { x: 1100, y: 520 },
];

/** Five people, five notes, none on top of another. */
const FIVE = [
  { x: 360, y: 260 },
  { x: 860, y: 260 },
  { x: 360, y: 560 },
  { x: 860, y: 560 },
  { x: 610, y: 410 },
];

const undoButton = (page: Page) => page.getByTestId('undo');
const redoButton = (page: Page) => page.getByTestId('redo');

const pressUndo = (page: Page) => page.keyboard.press('Control+z');

/** This screen's board, sorted by id, so two boards can be compared whole. */
async function notes(page: Page): Promise<StickySnapshot[]> {
  const all = await page.evaluate(() => [...window.__vidi6!.getSnapshot()]);
  return all.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** The same board limited to the notes we are interested in. */
async function notesOf(page: Page, ids: readonly string[]): Promise<StickySnapshot[]> {
  const wanted = new Set(ids);
  return (await notes(page)).filter((n) => wanted.has(n.id));
}

const canUndo = (page: Page) => page.evaluate(() => window.__vidi6!.canUndo());
const canRedo = (page: Page) => page.evaluate(() => window.__vidi6!.canRedo());

/** Collect everything a screen complains about, so "no error" is a real assertion. */
function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

/** Open another screen on the same board (a fresh context, as always). */
async function join(page: Page, boardId: string): Promise<Page> {
  const screen = await openScreen(page, new URL(`/b/${boardId}`, page.url()).toString());
  await waitForSynced(screen);
  return screen;
}

/** Paint a couple of the notes so "colour" is not the default in what follows. */
async function recolour(page: Page, ids: readonly string[], color: string): Promise<void> {
  for (const id of ids) {
    const box = await noteBox(page, id);
    await page.mouse.click(box.x, box.y);
    await page.getByTestId(`color-${color}`).click();
  }
  await page.mouse.click(20, 20);
}

/** Press Ctrl/Cmd+Z until this person's history runs out, and say how often it took. */
async function undoEverything(page: Page, limit = 60): Promise<number> {
  let presses = 0;
  while (presses < limit && !(await undoButton(page).isDisabled())) {
    await pressUndo(page);
    presses++;
  }
  await expect(undoButton(page)).toBeDisabled();
  return presses;
}

test.describe('undo while other people work (TC-22 to TC-24)', () => {
  // TC-22: my accidental delete, recovered — and my colleague's note is untouched.
  test('TC-22 recovers eight deleted notes while a colleague works beside them', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors = watchForErrors(page);
    const screens: Page[] = [page];
    const boardId = await gotoNewBoard(page);
    await waitForSynced(page);

    // Mia's eight notes, two of them coloured.
    const mine: string[] = [];
    for (const [i, spot] of EIGHT.entries()) {
      mine.push(await createNote(page, spot, `retro ${i + 1}`));
    }
    await recolour(page, mine.slice(0, 2), 'blue');

    // Raj joins the same board.
    const raj = await join(page, boardId);
    screens.push(raj);
    const rajErrors = watchForErrors(raj);

    // Everything on the board right now is Mia's, and this is what it looks like.
    const before = await notesOf(page, mine);
    expect(before).toHaveLength(8);

    // Mia box-selects her eight notes and deletes them by accident.
    await marqueeSelect(page, { x: 200, y: 160 }, { x: 1270, y: 770 });
    expect(await selectedIds(page)).toHaveLength(8);
    await pressDelete(page);
    await expectNotesOn(screens, []);

    // Raj keeps working on the same board.
    const rajNote = await createNote(raj, { x: 640, y: 700 }, 'raj was here');
    await expectNotesOn(screens, [rajNote]);

    // Ctrl+Z: the eight come back on both screens, exactly as they were.
    await pressUndo(page);
    await expectNotesOn(screens, [...mine, rajNote]);
    const restored = await notesOf(page, mine);
    expect(restored).toEqual(before);
    expect(await notesOf(raj, mine)).toEqual(before);
    expect(await canRedo(page)).toBe(true);

    // The Redo button deletes them again — on both screens.
    await redoButton(page).click();
    await expectNotesOn(screens, [rajNote]);

    // Undo stays available until Mia's own history runs out, and never once touches
    // Raj's note.
    const presses = await undoEverything(page);
    expect(presses).toBeGreaterThanOrEqual(10);
    await expectNotesOn(screens, [rajNote]);
    expect(await canUndo(page)).toBe(false);

    expect(errors).toEqual([]);
    expect(rajErrors).toEqual([]);
    await closeScreens(screens);
  });

  // TC-23: the note I moved is gone by the time I undo — nothing breaks.
  test('TC-23 undoes a move of a note a colleague already deleted', async ({ page }) => {
    const errors = watchForErrors(page);
    const screens: Page[] = [page];
    const boardId = await gotoNewBoard(page);
    await waitForSynced(page);
    const raj = await join(page, boardId);
    screens.push(raj);
    const rajErrors = watchForErrors(raj);

    // Mia makes a note and moves it twice.
    const moved = await createNote(page, FIVE[0]!, 'mine to move');
    await dragNote(page, moved, 60, 40);
    await dragNote(page, moved, 60, 40);
    await expectSameBoard(page, raj);

    // Raj deletes the note Mia was moving.
    const box = await noteBox(raj, moved);
    await raj.mouse.click(box.x, box.y);
    await pressDelete(raj);
    await expectNotesOn(screens, []);

    // Mia presses Ctrl+Z. Undoing a move of a note that no longer exists is neither
    // an error nor a resurrection: both screens stay as Raj left them.
    expect(await canUndo(page)).toBe(true);
    await pressUndo(page);
    await expectNotesOn(screens, []);
    expect(await liveNoteIds(raj)).toEqual([]);

    // Her history is still usable: a fresh note of hers, and her next Ctrl+Z takes
    // its text back on both screens.
    const hers = await createNote(page, FIVE[1]!, 'still working');
    await expectNotesOn(screens, [hers]);
    await expectNoteText(page, hers, 'still working');
    await pressUndo(page);
    await expectNoteText(page, hers, '');
    await expectNoteText(raj, hers, '');
    expect(await liveNoteIds(raj)).toEqual([hers]);

    expect(errors).toEqual([]);
    expect(rajErrors).toEqual([]);
    await closeScreens(screens);
  });

  // TC-24: MAX_CONCURRENT_EDITORS people undoing at the same time.
  test('TC-24 every person undoing at once leaves only other people work standing', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const screens: Page[] = [page];
    const errors: string[] = watchForErrors(page);
    const boardId = await gotoNewBoard(page);
    await waitForSynced(page);

    // One board, MAX_CONCURRENT_EDITORS screens on it.
    for (let i = 1; i < MAX_CONCURRENT_EDITORS; i++) {
      const screen = await join(page, boardId);
      screens.push(screen);
      errors.push(...watchForErrors(screen));
    }
    expect(screens).toHaveLength(MAX_CONCURRENT_EDITORS);

    // The board everyone joins: one note per person, each with its own text.
    const ids: string[] = [];
    for (const [i, spot] of FIVE.slice(0, MAX_CONCURRENT_EDITORS).entries()) {
      ids.push(await createNote(page, spot, `note ${i + 1}`));
    }
    await expectSameBoard(screens[0]!, screens[1]!);
    const start = await notes(page);
    expect(start).toHaveLength(MAX_CONCURRENT_EDITORS);

    // Each person moves *their own* note and types into the *next* person's note.
    const typed: string[] = [];
    for (const [i, screen] of screens.entries()) {
      await dragNote(screen, ids[i]!, 40, 30);
      typed.push(` own${i + 1}`);
    }
    for (const [i, screen] of screens.entries()) {
      const target = ids[(i + 1) % MAX_CONCURRENT_EDITORS]!;
      const box = await noteBox(screen, target);
      await screen.mouse.dblclick(box.x, box.y);
      await screen.keyboard.type(typed[i]!);
      await screen.keyboard.press('Escape');
      await screen.mouse.click(20, 20);
    }
    // Everyone sees all of it.
    for (const screen of screens) await expectSameBoard(screens[0]!, screen, 10_000);
    const moved = await notes(screens[0]!);
    expect(moved.map((n) => Math.round(n.x))).not.toEqual(start.map((n) => n.x));

    // Round one: each presses Ctrl+Z once, so each own typing goes back and every
    // move — every one of them somebody else's — is still there.
    for (const screen of screens) await pressUndo(screen);
    for (const screen of screens) await expectSameBoard(screens[0]!, screen, 10_000);
    const afterTypingUndone = await notes(screens[0]!);
    expect(afterTypingUndone.map((n) => n.text)).toEqual(start.map((n) => n.text));
    expect(afterTypingUndone.map((n) => Math.round(n.x))).toEqual(moved.map((n) => Math.round(n.x)));

    // Round two: the moves go back too, and every board ends where it began.
    for (const screen of screens) await pressUndo(screen);
    for (const screen of screens) await expectSameBoard(screens[0]!, screen, 10_000);
    expect(await notes(screens[0]!)).toEqual(start);
    for (const screen of screens) {
      expect(await boardSignature(screen)).toBe(await boardSignature(screens[0]!));
      expect(await liveNoteIds(screen)).toHaveLength(MAX_CONCURRENT_EDITORS);
    }
    // Each of the people who joined has run out of their own history (two steps
    // each), while the screen that seeded the board still has its own to go through.
    for (const screen of screens.slice(1)) {
      expect(await canUndo(screen)).toBe(false);
      expect(await canRedo(screen)).toBe(true);
    }
    expect(await canUndo(screens[0]!)).toBe(true);

    expect(errors).toEqual([]);
    await closeScreens(screens);
  });
});
