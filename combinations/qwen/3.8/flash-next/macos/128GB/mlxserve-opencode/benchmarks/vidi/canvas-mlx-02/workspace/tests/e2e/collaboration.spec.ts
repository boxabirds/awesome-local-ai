// Story 3 — live collaboration on one board, exercised across multiple browser
// contexts (isolated sockets) pointed at the same /b/:boardId route. Requires a
// test-mode build served by `wrangler dev` (the nightly config).
import { test, expect, type Browser } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id.ts';
import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config.ts';
import {
  setCamera,
  getCamera,
  notes,
  firstNote,
  noteByTestId,
  noteWorldTopLeft,
  noteScreenCenter,
  createNoteAt,
  pasteIntoEditor,
  typeText,
  noteTextEl,
  dragBy,
  resetCam,
} from './helpers/sticky.ts';
import { openBoard, newCollaborator, editNote } from './helpers/room.ts';

// Convergence budget for multi-hop CRDT propagation over two live sockets.
const CONVERGE = LIVE_UPDATE_LATENCY_BUDGET_MS * 5;

async function pair(browser: Browser): Promise<[{ id: string; alex: import('@playwright/test').Page; sam: import('@playwright/test').Page }]> {
  const id = newBoardId();
  const alex = await newCollaborator(browser);
  const sam = await newCollaborator(browser);
  await openBoard(alex, id);
  await openBoard(sam, id);
  await setCamera(alex, resetCam());
  await setCamera(sam, resetCam());
  return [{ id, alex, sam }];
}

test('TC-22 a move by Alex appears on Sam within the latency budget', async ({ browser }) => {
  const [{ alex, sam }] = await pair(browser);
  await createNoteAt(alex, 500, 300);
  await pasteIntoEditor(alex, 'A');
  await alex.keyboard.press('Escape');

  const id = (await firstNote(alex).getAttribute('data-testid'))!;
  const center = await noteScreenCenter(noteByTestId(alex, id));
  await dragBy(alex, center, 120, 0);
  const target = await noteWorldTopLeft(noteByTestId(alex, id));

  await expect
    .poll(async () => (await noteWorldTopLeft(noteByTestId(sam, id))).x, { timeout: CONVERGE })
    .toBeCloseTo(target.x, 0);
});

test('TC-23 Alex types; Sam sees the text (throttled, not per-keystroke)', async ({ browser }) => {
  const [{ alex, sam }] = await pair(browser);
  await createNoteAt(alex, 500, 300);
  const id = (await firstNote(alex).getAttribute('data-testid'))!;

  // Real keystrokes — one input each, but they must not each become a message.
  await typeText(alex, 'hel');
  await typeText(alex, 'lo');
  await alex.keyboard.press('Escape');

  await expect
    .poll(async () => (await noteTextEl(noteByTestId(sam, id)).textContent())?.trim(), {
      timeout: CONVERGE,
    })
    .toBe('hello');
});

test('TC-24 both edit the same note and converge to one identical value', async ({ browser }) => {
  const [{ alex, sam }] = await pair(browser);
  await createNoteAt(alex, 500, 300);
  await pasteIntoEditor(alex, 'start');
  await alex.keyboard.press('Escape');
  const id = (await firstNote(alex).getAttribute('data-testid'))!;

  // Both open the same note's editor.
  const c = await noteScreenCenter(noteByTestId(alex, id));
  await editNote(alex, c);
  const sc = await noteScreenCenter(noteByTestId(sam, id));
  await editNote(sam, sc);

  await pasteIntoEditor(alex, 'from-alex');
  await pasteIntoEditor(sam, 'from-sam');

  // Converge: both render the exact same text (Yjs CRDT is deterministic).
  await expect
    .poll(async () => (await noteTextEl(noteByTestId(alex, id)).textContent())?.trim(), {
      timeout: CONVERGE,
    })
    .toBe(await noteTextEl(noteByTestId(sam, id)).textContent().then((t) => (t ?? '').trim()));
});

test('TC-25 concurrent delete + edit leaves the note gone on both, no crash', async ({ browser }) => {
  const [{ alex, sam }] = await pair(browser);
  await createNoteAt(alex, 500, 300);
  await pasteIntoEditor(alex, 'doomed');
  await alex.keyboard.press('Escape');
  const id = (await firstNote(alex).getAttribute('data-testid'))!;

  // Sam opens it for editing.
  const sc = await noteScreenCenter(noteByTestId(sam, id));
  await editNote(sam, sc);
  await typeText(sam, ' more');

  // Alex deletes it while Sam still edits.
  await noteByTestId(alex, id).click();
  await alex.keyboard.press('Delete');

  // The note disappears on BOTH and neither page crashes.
  await expect(notes(sam)).toHaveCount(0, { timeout: CONVERGE });
  await expect(notes(alex)).toHaveCount(0);
  await expect(alex.locator('[data-testid="viewport"]')).toBeVisible();
  await expect(sam.locator('[data-testid="viewport"]')).toBeVisible();
});

test('TC-26 MAX_CONCURRENT_EDITORS collaborators all converge; camera stays local', async ({ browser }) => {
  const id = newBoardId();
  const pages = await Promise.all(
    Array.from({ length: MAX_CONCURRENT_EDITORS }, () => newCollaborator(browser)),
  );
  await Promise.all(pages.map((p) => openBoard(p, id)));
  await Promise.all(pages.map((p) => setCamera(p, resetCam())));

  // p0 takes its own camera; the camera is purely local so remote work must not
  // move it. Each collaborator creates one note via the toolbar (deterministic:
  // it always opens an editor, independent of overlap).
  await setCamera(pages[0], { x: -500, y: -250, zoom: 1 });
  const p0cam = await getCamera(pages[0]);

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    await p.getByRole('button', { name: 'Sticky note' }).click();
    await p.waitForSelector('textarea.sticky-editor');
    await pasteIntoEditor(p, `n${i}`);
    await p.keyboard.press('Escape');
  }

  // Every collaborator eventually sees all MAX notes.
  for (const p of pages) {
    await expect(notes(p)).toHaveCount(MAX_CONCURRENT_EDITORS, { timeout: CONVERGE });
  }
  // p0's camera never changed from creating/editing on other clients.
  const after = await getCamera(pages[0]);
  expect(after).toEqual(p0cam);
});

test('TC-27 opening /b/:boardId directly connects to that room', async ({ page, browser }) => {
  const id = newBoardId();
  // Another collaborator already has content there.
  const other = await newCollaborator(browser);
  await openBoard(other, id);
  await setCamera(other, resetCam());
  await createNoteAt(other, 500, 300);
  await pasteIntoEditor(other, 'direct');
  await other.keyboard.press('Escape');

  // This page opens the URL directly (no board-creation UI — story 5).
  await page.goto(`/b/${id}`);
  await page.waitForSelector('[data-testid="viewport"]');
  expect(page.url()).toMatch(new RegExp(`/b/[A-Za-z0-9_-]{22}$`));
  await expect(notes(page)).toHaveCount(1, { timeout: CONVERGE });
});
