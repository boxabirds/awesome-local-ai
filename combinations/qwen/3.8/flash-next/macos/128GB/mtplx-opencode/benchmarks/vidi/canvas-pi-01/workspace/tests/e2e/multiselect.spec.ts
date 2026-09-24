/**
 * Story 7 · end-to-end multi-select (select / move / resize / delete several at
 * once), run in Chromium, Firefox and WebKit against the built app.
 *
 * These are the interaction truths the design reserves for e2e and that jsdom
 * cannot show: a real Shift+click that adds a note to the selection, a whole
 * *group* that translates when any member is dragged (one shared selection),
 * the group delete (both the toolbar button and the Delete key) removing every
 * member in one step, and a Shift+drag that box-selects the notes lying entirely
 * inside it without panning. As in the sticky suite we read facts the page shows
 * — each note's on-screen box and its world `data-x` / `data-y` stamp — so the
 * assertions are honest about what is actually rendered.
 */
import { expect, test, type Page } from '@playwright/test';
import { openFreshBoard } from './helpers/boards';
import { createNoteAt, readNotes, settle, type NoteReadout } from './helpers/sticky';

/** The two notes by id, keyed, from the live DOM. */
async function notesById(page: Page): Promise<Map<string, NoteReadout>> {
  const notes = await readNotes(page);
  return new Map(notes.map((n) => [n.id, n]));
}

/** `data-selected` for a note, straight from the group element. */
async function selected(page: Page, id: string): Promise<boolean> {
  const el = page.locator(`[data-note-id="${id}"]`).first();
  return el.evaluate((node) => (node as HTMLElement).dataset.selected === 'true');
}

/** Click a screen point, optionally holding Shift (adds to / toggles selection). */
async function clickAt(page: Page, x: number, y: number, shift = false): Promise<void> {
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(x, y);
  if (shift) await page.keyboard.up('Shift');
  await settle(page);
}

/** Press at `from`, drag by (dx,dy) past the threshold, release. */
async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await page.mouse.up();
  await settle(page);
}

/** A Shift+drag over empty space: box-select, not a pan. */
async function marquee(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await settle(page);
}

/** Camera stamp of the world layer, as a string ("x,y,zoom"). */
async function cameraStamp(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const layer = document.querySelector('[data-testid="world-layer"]') as HTMLElement | null;
    return layer?.dataset.camera;
  });
}

const BAR = '[data-testid="selection-bar"]';

test('Shift+click adds a note and the selection bar appears at two (criterion 1, 2)', async ({
  page,
}) => {
  await openFreshBoard(page);
  await settle(page);

  await createNoteAt(page, 360, 300);
  await page.keyboard.press('Escape');
  await settle(page);
  await createNoteAt(page, 900, 300);
  await page.keyboard.press('Escape');
  await settle(page);

  // Clear any lingering selection by clicking empty board space, then build the
  // two-note selection with a plain click followed by a Shift+click.
  await clickAt(page, 60, 700);
  const notes = await notesById(page);
  expect(notes.size).toBe(2);
  const [a, b] = [...notes.values()];

  await clickAt(page, a.cx, a.cy);
  expect(await selected(page, a.id)).toBe(true);
  expect(await selected(page, b.id)).toBe(false);
  // With one selected there is no selection bar (the per-note toolbar serves).
  await expect(page.locator(BAR)).toHaveCount(0);

  await clickAt(page, b.cx, b.cy, true);
  expect(await selected(page, a.id)).toBe(true);
  expect(await selected(page, b.id)).toBe(true);

  await expect(page.locator(BAR)).toHaveCount(1);
  await expect(page.locator(BAR)).toHaveAttribute('data-count', '2');
  await expect(page.getByTestId('selection-count')).toHaveText('2 selected');
});

test('dragging one selected note moves the whole group together (criterion 3, 4)', async ({
  page,
}) => {
  await openFreshBoard(page);
  await settle(page);

  await createNoteAt(page, 360, 300);
  await page.keyboard.press('Escape');
  await createNoteAt(page, 900, 300);
  await page.keyboard.press('Escape');
  await settle(page);

  await clickAt(page, 60, 700);
  const before = await notesById(page);
  const [a, b] = [...before.values()];

  // Build the group, then press on note A (already selected) and drag. The
  // shared-selection transform translates BOTH notes by the same delta.
  await clickAt(page, a.cx, a.cy);
  await clickAt(page, b.cx, b.cy, true);
  expect(await selected(page, a.id)).toBe(true);
  expect(await selected(page, b.id)).toBe(true);

  const dx = 140;
  const dy = 90;
  await dragBy(page, { x: a.cx, y: a.cy }, dx, dy);

  const after = await notesById(page);
  const a2 = after.get(a.id)!;
  const b2 = after.get(b.id)!;

  // The dragged note moved by the pointer delta (± the 1px design tolerance).
  expect(Math.abs(a2.cx - a.cx)).toBeGreaterThan(20);
  // The *other* member moved too, and by (almost) the same screen delta — the
  // group translated rigidly rather than only the grabbed note.
  expect(b2.cx - b.cx).toBeCloseTo(dx, 0);
  expect(b2.cy - b.cy).toBeCloseTo(dy, 0);
});

test('the selection bar deletes the whole group in one action (criterion 5)', async ({ page }) => {
  await openFreshBoard(page);
  await settle(page);

  await createNoteAt(page, 360, 300);
  await page.keyboard.press('Escape');
  await createNoteAt(page, 900, 300);
  await page.keyboard.press('Escape');
  await settle(page);

  await clickAt(page, 60, 700);
  const notes = await notesById(page);
  const [a, b] = [...notes.values()];
  await clickAt(page, a.cx, a.cy);
  await clickAt(page, b.cx, b.cy, true);
  await expect(page.locator(BAR)).toHaveAttribute('data-count', '2');

  // The bar floats over the full-bleed viewport, so dispatch the click directly
  // on the button (its onClick stops propagation) rather than via mouse hit-test.
  await page.getByTestId('selection-delete').dispatchEvent('click');
  await settle(page);

  // Both notes are gone in one action (a single document transaction).
  expect((await readNotes(page)).length).toBe(0);
});

test('the Delete key removes the whole group; Escape clears instead (criteria 5, 10)', async ({
  page,
}) => {
  await openFreshBoard(page);
  await settle(page);

  await createNoteAt(page, 360, 300);
  await page.keyboard.press('Escape');
  await createNoteAt(page, 900, 300);
  await page.keyboard.press('Escape');
  await settle(page);

  await clickAt(page, 60, 700);
  const notes = await notesById(page);
  const [a, b] = [...notes.values()];
  await clickAt(page, a.cx, a.cy);
  await clickAt(page, b.cx, b.cy, true);

  // Escape clears the selection first (nothing is deleted).
  await page.keyboard.press('Escape');
  await settle(page);
  expect((await readNotes(page)).length).toBe(2);
  expect(await selected(page, a.id)).toBe(false);
  expect(await selected(page, b.id)).toBe(false);

  // Re-select the pair and delete it with the keyboard in one press.
  await clickAt(page, a.cx, a.cy);
  await clickAt(page, b.cx, b.cy, true);
  await page.keyboard.press('Delete');
  await settle(page);
  expect((await readNotes(page)).length).toBe(0);
});

test('Shift+clicking a selected note removes only it from the group (criterion 1)', async ({
  page,
}) => {
  await openFreshBoard(page);
  await settle(page);

  await createNoteAt(page, 360, 300);
  await page.keyboard.press('Escape');
  await createNoteAt(page, 640, 300);
  await page.keyboard.press('Escape');
  await settle(page);

  await clickAt(page, 60, 700);
  const notes = await notesById(page);
  const [a, b] = [...notes.values()];
  await clickAt(page, a.cx, a.cy);
  await clickAt(page, b.cx, b.cy, true);
  expect(await selected(page, a.id)).toBe(true);
  expect(await selected(page, b.id)).toBe(true);

  // Shift+click the already-selected B: only B drops out, A stays selected and
  // with a single member the selection bar disappears.
  await clickAt(page, b.cx, b.cy, true);
  expect(await selected(page, b.id)).toBe(false);
  expect(await selected(page, a.id)).toBe(true);
  await expect(page.locator(BAR)).toHaveCount(0);
});

test('a Shift+drag over empty space box-selects the enclosed notes without panning (criterion 6)', async ({
  page,
}) => {
  await openFreshBoard(page);
  await settle(page);

  await createNoteAt(page, 360, 300);
  await page.keyboard.press('Escape');
  await createNoteAt(page, 900, 300);
  await page.keyboard.press('Escape');
  await settle(page);

  await clickAt(page, 60, 700);
  const notes = await notesById(page);
  expect(notes.size).toBe(2);
  const cameraBefore = await cameraStamp(page);

  // A generous box whose top-left is over empty board and whose bottom-right
  // clears both notes, drawn while holding Shift → a marquee, not a pan.
  await marquee(page, { x: 200, y: 150 }, { x: 1080, y: 470 });

  for (const note of notes.values()) {
    expect(await selected(page, note.id)).toBe(true);
  }

  // A marquee is a selection, never a pan: the camera stamp is untouched.
  const cameraAfter = await cameraStamp(page);
  expect(cameraAfter).toBe(cameraBefore);
});

test('Ctrl/Cmd+A selects every note; the bar shows the full count (criterion 2)', async ({
  page,
}) => {
  await openFreshBoard(page);
  await settle(page);

  await createNoteAt(page, 360, 260);
  await page.keyboard.press('Escape');
  await createNoteAt(page, 780, 260);
  await page.keyboard.press('Escape');
  await createNoteAt(page, 560, 520);
  await page.keyboard.press('Escape');
  await settle(page);

  await clickAt(page, 60, 700);
  expect(await readNotes(page)).toHaveLength(3);

  await page.keyboard.press('ControlOrMeta+a');
  await settle(page);

  await expect(page.locator(BAR)).toHaveCount(1);
  await expect(page.locator(BAR)).toHaveAttribute('data-count', '3');
});

test('arrow keys nudge the whole selection and do not pan the camera (criterion 8)', async ({
  page,
}) => {
  await openFreshBoard(page);
  await settle(page);

  await createNoteAt(page, 360, 300);
  await page.keyboard.press('Escape');
  await createNoteAt(page, 560, 300);
  await page.keyboard.press('Escape');
  await settle(page);

  await clickAt(page, 60, 700);
  const before = await notesById(page);
  const [a, b] = [...before.values()];
  const cameraBefore = await cameraStamp(page);

  // Select the pair, then nudge right with the large step (Shift+ArrowRight).
  await clickAt(page, a.cx, a.cy);
  await clickAt(page, b.cx, b.cy, true);

  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await settle(page);

  const after = await notesById(page);
  const a2 = after.get(a.id)!;
  const b2 = after.get(b.id)!;

  // Both notes moved right by the same world distance and the camera is still
  // put (arrows are consumed by nudge, never by panning).
  expect(a2.cx - a.cx).toBeGreaterThan(10);
  expect(b2.cx - b.cx).toBeGreaterThan(10);
  expect(Math.abs(a2.cx - a.cx - (b2.cx - b.cx))).toBeLessThan(1.5);
  expect(await cameraStamp(page)).toBe(cameraBefore);
});