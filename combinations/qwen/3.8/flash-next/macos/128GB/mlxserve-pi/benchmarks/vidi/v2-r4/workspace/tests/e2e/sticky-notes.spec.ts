import { expect, test } from '@playwright/test';

import { PROSE_AT_LIMIT, SHORT_PHRASE } from '../../tests/fixtures/texts';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { browserAvailable } from './helpers/browserAvailability';
import {
  expectCamera,
  farView,
  PIXEL_TOLERANCE,
  readCamera,
  screenToWorld,
  setCamera,
  settle,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
  worldToScreen,
  zoomedCamera,
  type Camera,
  type Point,
} from './helpers/board';
import {
  counter,
  createNote,
  dragNote,
  editor,
  expectNoteAtPoint,
  expectNoteCentre,
  fade,
  noteById,
  noteIds,
  notes,
  readNote,
  readNotes,
  stickyTool,
  swatch,
  fittedFontSize,
  textBoxMetrics,
  typeIntoNote,
  type NoteState,
} from './helpers/notes';

/**
 * E2E sticky note workflows: catch an idea where the pointer is, move it,
 * recolour it, delete it, and write more than fits in it. Distances are asserted
 * in screen pixels and in board units, because a note lives on the board: a
 * screen delta of (dx, dy) at zoom z is a board delta of (dx / z, dy / z).
 */

const CENTRE: Point = { x: VIEWPORT_WIDTH / 2, y: VIEWPORT_HEIGHT / 2 };
const centreOf = (note: NoteState): Point => ({
  x: note.x + STICKY_SIZE_WORLD / 2,
  y: note.y + STICKY_SIZE_WORLD / 2,
});
const onScreen = (camera: Camera, note: NoteState): Point => worldToScreen(camera, centreOf(note));

/**
 * Empty board space to click for "nothing selected". The zoom controls are in the
 * bottom right corner and the sticky note tool in the bottom left, so these points
 * are away from both and away from the notes each test uses.
 */
const EMPTY = {
  /** zoom 50%: notes are 100 px squares around (400, 300) and (1000, 600). */
  half: { x: 640, y: 120 },
  /** zoom 200%: notes are 400 px squares around (400, 300) and (650, 350). */
  double: { x: 100, y: 80 },
  /** zoom 100%: notes are 200 px squares around (300, 250) and (700, 250). */
  full: { x: 1000, y: 400 },
} satisfies Record<string, Point>;

test.beforeEach(async ({}, testInfo) => {
  const name = testInfo.project.name;
  test.skip(
    !browserAvailable(name),
    `${name} cannot be launched in this environment (probed by playwright.config.ts)`,
  );
});

test.describe('workflow — brainstorming with sticky notes', () => {
  test('TC-30 a double-click on empty board opens a note there and the typing goes into it', async ({
    page,
  }) => {
    await page.goto('/');
    const before = await readCamera(page);
    const point: Point = { x: 400, y: 300 };

    const created = await createNote(page, point);
    await typeIntoNote(page, 'Hello');

    const written = await readNote(page, 0);
    expect(written.id).toBe(created.id);
    expect(written.text).toBe('Hello');
    expect(written.selected).toBe(true);
    expect(written.color).toBe('yellow');
    // The note is centred on the point that was double-clicked.
    await expectNoteCentre(page, written, point);
    // Creating a note is not navigation: the board has not moved.
    await expectCamera(page, before);
    // It is open for typing, with the text in the box.
    await expect(editor(page)).toBeFocused();
    expect(await editor(page).inputValue()).toBe('Hello');
  });

  test('TC-31 at 50% zoom a dragged note keeps the grabbed point under the pointer, then its swatch recolours and Delete removes it', async ({
    page,
  }) => {
    await page.goto('/');
    await setCamera(page, zoomedCamera(0.5));

    const grabbed: Point = { x: 400, y: 300 };
    const idea = await createNote(page, grabbed);
    await typeIntoNote(page, SHORT_PHRASE);
    await page.keyboard.press('Escape');
    const other = await createNote(page, { x: 1000, y: 600 });
    // A click on empty board space puts both notes back to not selected.
    await page.mouse.click(EMPTY.half.x, EMPTY.half.y);
    expect((await readNotes(page)).every((note) => !note.selected)).toBe(true);

    const before = await noteById(page, idea.id);
    await dragNote(page, grabbed, { x: 100, y: 50 });

    const moved = await noteById(page, idea.id);
    expect(moved.dragging).toBe(false);
    expect(moved.selected).toBe(true);
    // Screen: the centre is under the pointer, 100 by 50 pixels from the grab.
    await expectNoteCentre(page, moved, { x: grabbed.x + 100, y: grabbed.y + 50 });
    // Board units at 50% zoom: twice as far as the pointer travelled.
    expect(moved.x - before.x).toBeCloseTo(200, 6);
    expect(moved.y - before.y).toBeCloseTo(100, 6);
    // The note kept its text through the move.
    expect(moved.text).toBe(SHORT_PHRASE);

    await swatch(page, 'Pink').click();
    await expect
      .poll(async () => {
        const recoloured = await noteById(page, idea.id);
        return [recoloured.color, recoloured.selected, recoloured.text] as const;
      })
      .toEqual(['pink', true, SHORT_PHRASE]);

    await page.keyboard.press('Delete');
    await expect.poll(async () => noteIds(page)).toEqual([other.id]);

    const survivor = await readNote(page, 0);
    expect(survivor.id).toBe(other.id);
    expect(survivor.color).toBe('yellow');
    expect(survivor.selected).toBe(false);
  });

  test('TC-32 at 200% zoom a drag moves the note half as far in board units and draws it above the note it overlaps', async ({
    page,
  }) => {
    await page.goto('/');
    await setCamera(page, zoomedCamera(2));

    const lower = await createNote(page, { x: 400, y: 300 });
    await page.keyboard.press('Escape');
    const upper = await createNote(page, { x: 650, y: 350 });
    await page.mouse.click(EMPTY.double.x, EMPTY.double.y); // nothing selected

    // The two notes overlap, and the one created later is drawn on top there.
    await expectNoteAtPoint(page, { x: 560, y: 320 }, upper.id);

    await dragNote(page, { x: 400, y: 300 }, { x: 100, y: 50 });

    const moved = await noteById(page, lower.id);
    // Screen: 100 by 50 pixels. Board units at 200% zoom: half of that.
    expect(moved.x - lower.x).toBeCloseTo(50, 6);
    expect(moved.y - lower.y).toBeCloseTo(25, 6);
    await expectNoteCentre(page, moved, { x: 500, y: 350 });
    // Now the dragged note is the one on top where they overlap.
    await expectNoteAtPoint(page, { x: 660, y: 350 }, lower.id);
    expect(moved.z).toBeGreaterThan(upper.z);
    // Both notes are still there with their text.
    expect((await readNotes(page)).map((note) => note.id).sort()).toEqual(
      [lower.id, upper.id].sort(),
    );
  });

  test('TC-33 a word is written at the largest font, a thousand characters shrink it and fade inside the note', async ({
    page,
  }) => {
    await page.goto('/');
    await createNote(page, { x: 400, y: 400 });

    await typeIntoNote(page, 'Design');
    expect(await fittedFontSize(page, 0)).toBeCloseTo(STICKY_FONT_MAX_PX, 3);

    // The 1000 character fixture goes in as one paste of the whole text.
    await editor(page).fill(PROSE_AT_LIMIT);

    const filled = await readNote(page, 0);
    expect(filled.text.length).toBe(STICKY_TEXT_MAX_CHARS);
    const fontSize = await fittedFontSize(page, 0);
    expect(fontSize).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(fontSize).toBeLessThan(STICKY_FONT_MAX_PX);

    // What does not fit is clipped inside the note and faded at the bottom.
    await expect(fade(page)).toBeVisible();
    expect(filled.overflow).toBe(true);
    const metrics = await textBoxMetrics(page, 0);
    expect(metrics.box.overflow).toBe('hidden');
    expect(metrics.box.scrollHeight).toBeGreaterThan(metrics.box.clientHeight);
    // Nothing of the note is drawn outside its own box.
    expect(metrics.note.width).toBeCloseTo(STICKY_SIZE_WORLD, 1);
    expect(metrics.note.height).toBeCloseTo(STICKY_SIZE_WORLD, 1);
    expect(metrics.box.height).toBeLessThan(metrics.note.height);
    expect(metrics.box.width).toBeLessThan(metrics.note.width);

    // The counter says the text is at its limit.
    await expect(counter(page)).toHaveText(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`);
  });

  test('TC-34 after being taken far away the tool still puts a note in the middle of the screen', async ({
    page,
  }) => {
    await page.goto('/');
    const camera = farView(500_000, 1);
    await setCamera(page, camera);

    await stickyTool(page).click();
    await settle(page);

    const created = await readNote(page, 0);
    // It is in the middle of what is on screen, which is 500000 board units out.
    expect(centreOf(created).x).toBeCloseTo(screenToWorld(camera, CENTRE).x, 6);
    expect(centreOf(created).y).toBeCloseTo(screenToWorld(camera, CENTRE).y, 6);
    await expectNoteCentre(page, created, CENTRE);

    const box = await notes(page).nth(0).boundingBox();
    if (!box) throw new Error('the new note has no bounding box');
    expect(Math.abs(box.x + box.width / 2 - CENTRE.x)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(box.y + box.height / 2 - CENTRE.y)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    // The board was not moved to bring the note into view.
    await expectCamera(page, camera);
    // The new note is open for typing.
    await expect(editor(page)).toBeFocused();
  });

  test('the tool and a double-click do the same thing, and neither moves the board', async ({
    page,
  }) => {
    await page.goto('/');
    await stickyTool(page).click();
    await settle(page);
    const first = await readNote(page, 0);
    await expectNoteCentre(page, first, CENTRE);

    await page.keyboard.press('Escape');
    const camera = await readCamera(page);
    const second = await createNote(page, { x: 900, y: 500 });
    await expectCamera(page, camera);
    expect(onScreen(camera, second)).toEqual({ x: 900, y: 500 });
    // Creating the second note took the selection with it: the new note is the
    // one that is selected and open for typing, the first is just a note again.
    expect((await readNotes(page)).map((note) => note.selected)).toEqual([false, true]);
  });

  test('a note stays at its board position while the board is zoomed', async ({ page }) => {
    await page.goto('/');
    const created = await createNote(page, { x: 400, y: 300 });
    await page.keyboard.press('Escape');

    await setCamera(page, zoomedCamera(2));
    const zoomedIn = await readNote(page, 0);
    expect(zoomedIn.id).toBe(created.id);
    expect(zoomedIn.x).toBe(created.x);
    expect(zoomedIn.y).toBe(created.y);
    // Same board units, twice the zoom: it has grown and moved away from the middle.
    const at200 = await readCamera(page);
    await expectNoteCentre(page, zoomedIn, onScreen(at200, zoomedIn));
    expect(at200.zoom).toBe(2);

    await setCamera(page, zoomedCamera(0.25));
    const at25 = await readCamera(page);
    const same = await readNote(page, 0);
    expect(same.x).toBe(created.x);
    expect(same.y).toBe(created.y);
    await expectNoteCentre(page, same, onScreen(at25, same));
  });

  test('notes keep their own text, colour and place, and stacking follows the last one moved', async ({
    page,
  }) => {
    await page.goto('/');
    const first = await createNote(page, { x: 300, y: 250 });
    await typeIntoNote(page, 'one');
    const second = await createNote(page, { x: 700, y: 250 });
    await typeIntoNote(page, 'two');
    // The note toolbar belongs to a selected note that is not being typed in.
    await page.keyboard.press('Escape');
    await swatch(page, 'Blue').click();

    await page.mouse.click(EMPTY.full.x, EMPTY.full.y); // empty board space
    const all = await readNotes(page);
    expect(all.map((note) => [note.text, note.color])).toEqual([
      ['one', 'yellow'],
      ['two', 'blue'],
    ]);
    expect(all.every((note) => !note.selected)).toBe(true);
    // The second note was created later, so it is the one on top of the board.
    expect(all.reduce((a, b) => (a.z > b.z ? a : b)).id).toBe(second.id);

    // The note created earlier is the one under the pointer at its own centre,
    // because the two do not overlap.
    await expectNoteAtPoint(page, { x: 300, y: 250 }, first.id);

    // Deleting the selected note leaves the other one and all of its text.
    await page.mouse.click(300, 250);
    await page.keyboard.press('Delete');
    expect(await noteIds(page)).toEqual([second.id]);
    const survivor = await readNote(page, 0);
    expect(survivor.text).toBe('two');
    expect(survivor.color).toBe('blue');
  });
});
