import { expect, test, type Page } from '@playwright/test';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { screenToWorld } from '../../src/client/canvas/camera';
import {
  board,
  readCamera,
  readNotes,
  screenPointOf,
  seedNotes,
  settle,
  setCamera,
} from './helpers/board';
import { LONG_PROSE, ONE_WORD, RETRO_ITEM } from '../fixtures/texts';

/**
 * Story 2 in a real browser: pixel-accurate placement, drag geometry at zoomed
 * scales, z order under overlap, and real font layout. None of these can be
 * checked in jsdom, which has no layout and no pointer capture.
 */

const HALF = STICKY_SIZE_WORLD / 2;

/** Press at a screen point, drag by (dx, dy), release, then let the board render. */
async function dragFrom(page: Page, x: number, y: number, dx: number, dy: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
  await settle(page);
}

/** Which note is the topmost thing at this viewport-relative point. */
async function hitNote(page: Page, x: number, y: number): Promise<string | null> {
  return page.evaluate(
    ([px, py]) =>
      document
        .elementFromPoint(px, py)
        ?.closest('[data-note-id]')
        ?.getAttribute('data-note-id') ?? null,
    [x, y],
  );
}

async function noteState(page: Page, id: string) {
  const note = (await readNotes(page)).find((row) => row.id === id);
  if (!note) throw new Error(`note ${id} is no longer on the board`);
  return note;
}

async function viewportPoint(page: Page, pagePoint: { x: number; y: number }) {
  const rect = await board(page).boundingBox();
  if (!rect) throw new Error('the board viewport has no bounding box');
  return { x: pagePoint.x - rect.x, y: pagePoint.y - rect.y };
}

test('TC-30 a double-click creates a note under the cursor, and the typing lands in it', async ({
  page,
}) => {
  await page.goto('/');
  await settle(page);

  await page.mouse.dblclick(400, 300);
  await expect(page.getByTestId('sticky-note')).toHaveCount(1);

  // The contract is "the note is centred on the point I clicked". Check it in
  // the model first: the click point, taken through the rendered camera.
  const camera = await readCamera(page);
  const rect = await board(page).boundingBox();
  const clicked = { x: 400 - (rect?.x ?? 0), y: 300 - (rect?.y ?? 0) };
  const world = screenToWorld(camera, clicked);
  const note = (await readNotes(page))[0];
  expect(note.x).toBeCloseTo(world.x - HALF, 1);
  expect(note.y).toBeCloseTo(world.y - HALF, 1);

  // Then in the paint: the rendered note is centred within a pixel of the
  // cursor, whatever the zoom.
  const box = await page.getByTestId('sticky-note').first().boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0) / 2).toBeCloseTo(400, 0);
  expect((box?.y ?? 0) + (box?.height ?? 0) / 2).toBeCloseTo(300, 0);

  // The new note opens in edit mode, caret already in the textarea.
  const editor = page.getByTestId('sticky-note-editor');
  await expect(editor).toHaveCount(1);
  await page.keyboard.type(ONE_WORD);
  await settle(page);

  expect((await readNotes(page))[0].text).toBe(ONE_WORD);
  await expect(editor).toHaveValue(ONE_WORD);
});

test('TC-30 a double-click on a note edits that note and does not create another one', async ({
  page,
}) => {
  await page.goto('/');
  await settle(page);
  const [id] = await seedNotes(page, [{ x: 0, y: 0, text: RETRO_ITEM }]);

  const centre = await screenPointOf(page, { x: 0, y: 0 });
  await page.mouse.dblclick(centre.x, centre.y);
  await settle(page);

  await expect(page.getByTestId('sticky-note')).toHaveCount(1);
  const editor = page.getByTestId('sticky-note-editor');
  await expect(editor).toHaveCount(1);
  await expect(editor).toHaveValue(RETRO_ITEM);
  expect((await noteState(page, id)).text).toBe(RETRO_ITEM);
});

test('TC-31 at 50% zoom a 100x50 drag moves the note 200x100 world units', async ({
  page,
}) => {
  await page.goto('/');
  await settle(page);
  await setCamera(page, { x: -300, y: -200, zoom: 0.5 });

  const [id] = await seedNotes(page, [{ x: 0, y: 0 }]);
  const before = await noteState(page, id);
  // Grab the note by its centre: 150,100 on screen at this camera.
  const pressWorld = { x: 0, y: 0 };
  const press = await screenPointOf(page, pressWorld);

  await dragFrom(page, press.x, press.y, 100, 50);

  const after = await noteState(page, id);
  // Screen pixels are world units times the zoom: 100 / 0.5 = 200.
  expect(after.x).toBeCloseTo(before.x + 200, 1);
  expect(after.y).toBeCloseTo(before.y + 100, 1);

  // The camera did not move: dragging a note never pans the board.
  expect(await readCamera(page)).toEqual({ x: -300, y: -200, zoom: 0.5 });

  // The grabbed point stayed under the pointer: the piece of the note that was
  // under the cursor at the start is under the cursor at the end.
  const grab = { x: pressWorld.x - before.x, y: pressWorld.y - before.y };
  const grabbed = await screenPointOf(page, { x: after.x + grab.x, y: after.y + grab.y });
  expect(grabbed.x).toBeCloseTo(press.x + 100, 0);
  expect(grabbed.y).toBeCloseTo(press.y + 50, 0);
});

test('TC-32 at 200% zoom a 100x50 drag moves the note 50x25 and puts it on top', async ({
  page,
}) => {
  await page.goto('/');
  await settle(page);
  await setCamera(page, { x: -420, y: -300, zoom: 2 });

  // Two overlapping notes; the second is painted over the first.
  const [bottomId, topId] = await seedNotes(page, [
    { x: 0, y: 0 },
    { x: 40, y: 20 },
  ]);
  expect((await readNotes(page)).map((note) => note.id)).toEqual([bottomId, topId]);

  // A 100x50 drag on screen is 50x25 in world units at 200%.
  const before = await noteState(page, bottomId);
  // Start on the strip of the lower note the upper one does not cover, and
  // check that the point really belongs to it before the drag.
  const grabWorld = { x: -80, y: 0 };
  const startViewport = await viewportPoint(page, await screenPointOf(page, grabWorld));
  expect(await hitNote(page, startViewport.x, startViewport.y)).toBe(bottomId);
  const start = await screenPointOf(page, grabWorld);

  await dragFrom(page, start.x, start.y, 100, 50);

  const after = await noteState(page, bottomId);
  expect(after.x).toBeCloseTo(before.x + 50, 1);
  expect(after.y).toBeCloseTo(before.y + 25, 1);
  expect(await readCamera(page)).toEqual({ x: -420, y: -300, zoom: 2 });

  // The point that was dragged is still under the pointer...
  const grab = { x: grabWorld.x - before.x, y: grabWorld.y - before.y };
  const grabbed = await viewportPoint(
    page,
    await screenPointOf(page, { x: after.x + grab.x, y: after.y + grab.y }),
  );
  // ...and where the two notes now overlap, it is the note that was dragged
  // that is under the pointer: it was raised when the drag began.
  expect(await hitNote(page, grabbed.x, grabbed.y)).toBe(bottomId);
  expect((await readNotes(page)).map((note) => note.id).at(-1)).toBe(bottomId);
});

test('TC-33 note text keeps the 24px size, then shrinks and clips at 1,000 characters', async ({
  page,
}) => {
  await page.goto('/');
  await settle(page);

  await page.mouse.dblclick(500, 300);
  const editor = page.getByTestId('sticky-note-editor');
  await expect(editor).toHaveCount(1);

  await page.keyboard.type(ONE_WORD);
  await settle(page);
  await expect(editor).toHaveValue(ONE_WORD);
  // One short word sits at the top of the size ladder.
  expect(await editor.evaluate((el) => getComputedStyle(el).fontSize)).toBe('24px');

  // A paste of 1,000 characters: the total is cut at the limit, the text drops
  // to the smallest size, and what no longer fits is clipped under a fade.
  await page.keyboard.insertText(LONG_PROSE);
  await settle(page);

  const note = (await readNotes(page))[0];
  expect(note.text).toHaveLength(1_000);
  const edited = await editor.evaluate((el) => ({
    fontSize: getComputedStyle(el).fontSize,
    clipped: el.scrollHeight > el.clientHeight,
    valueLength: el.value.length,
  }));
  expect(edited.valueLength).toBe(1_000);
  expect(Number.parseFloat(edited.fontSize)).toBeLessThanOrEqual(10);
  expect(Number.parseFloat(edited.fontSize)).toBeGreaterThanOrEqual(10);
  expect(edited.clipped).toBe(true);
  await expect(page.getByTestId('sticky-note-fade')).toHaveCount(1);

  await page.keyboard.press('Escape');
  await settle(page);
  const readout = page.getByTestId('sticky-note-text');
  expect(await readout.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect(page.getByTestId('sticky-note-fade')).toHaveCount(1);
  expect(await page.getByTestId('sticky-note').first().getAttribute('data-overflow')).toBe(
    'true',
  );
});

test('TC-34 the toolbar creates a note in the middle of the view a million units out', async ({
  page,
}) => {
  await page.goto('/');
  await settle(page);
  await setCamera(page, { x: 500_000, y: -300_000, zoom: 1 });

  await page.getByRole('button', { name: 'Sticky note' }).click();
  await expect(page.getByTestId('sticky-note')).toHaveCount(1);

  const box = await page.getByTestId('sticky-note').first().boundingBox();
  const viewport = await board(page).boundingBox();
  // "Visible at the centre of the screen", not at the world origin.
  expect((box?.x ?? 0) + (box?.width ?? 0) / 2).toBeCloseTo(
    (viewport?.x ?? 0) + (viewport?.width ?? 0) / 2,
    0,
  );
  expect((box?.y ?? 0) + (box?.height ?? 0) / 2).toBeCloseTo(
    (viewport?.y ?? 0) + (viewport?.height ?? 0) / 2,
    0,
  );

  // And it is ready to type in, wherever the board happens to be.
  await page.keyboard.type('Far away');
  expect((await readNotes(page))[0].text).toBe('Far away');
});

test('the golden path: create, type, recolour, move at 50%, delete', async ({ page }) => {
  await page.goto('/');
  await settle(page);

  await page.mouse.dblclick(400, 300);
  await page.keyboard.type('Faster onboarding');
  await page.keyboard.press('Escape');
  await settle(page);

  const created = (await readNotes(page))[0];
  expect(created.text).toBe('Faster onboarding');
  await expect(page.getByTestId('note-toolbar')).toHaveCount(1);

  await page.getByRole('button', { name: 'Pink colour' }).click();
  await settle(page);
  expect((await readNotes(page))[0].color).toBe('pink');
  await expect(page.getByTestId('note-toolbar')).toHaveCount(1);

  await setCamera(page, { x: -300, y: -200, zoom: 0.5 });
  const press = await screenPointOf(page, {
    x: created.x + HALF,
    y: created.y + HALF,
  });
  const before = await readNotes(page);
  await dragFrom(page, press.x, press.y, 60, 40);
  const after = (await readNotes(page))[0];
  expect(after.x).toBeCloseTo((before[0]?.x ?? 0) + 120, 1);

  // The keyboard route, with the pointer left wherever the drag ended.
  await page.keyboard.press('Delete');
  await settle(page);
  await expect(page.getByTestId('sticky-note')).toHaveCount(0);
  expect(await readNotes(page)).toEqual([]);

  // The mouse route does the same thing (TC-29 has the component version).
  await page.mouse.dblclick(400, 300);
  await page.keyboard.type('Second');
  await page.keyboard.press('Escape');
  await settle(page);
  await expect(page.getByTestId('sticky-note')).toHaveCount(1);
  await page.getByTestId('delete-note').click();
  await settle(page);
  await expect(page.getByTestId('sticky-note')).toHaveCount(0);
  expect(await readNotes(page)).toEqual([]);
});

test('500 notes: clicking one is a single cheap update', async ({ page }) => {
  await page.goto('/');
  await settle(page);

  // 25 x 20 notes, mixed colours and realistic texts, seeded in one page
  // evaluation and then waited for. Only part of the grid fits on screen at
  // this zoom, which is what makes it a real load rather than a demo.
  const colours = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'] as const;
  const texts = [ONE_WORD, RETRO_ITEM, LONG_PROSE];
  const camera = { x: -900, y: -520, zoom: 0.55 };
  await setCamera(page, camera);

  const fixture = [];
  for (let index = 0; index < 500; index += 1) {
    fixture.push({
      x: camera.x + (index % 25) * 220 + HALF,
      y: camera.y + Math.floor(index / 25) * 220 + HALF,
      color: colours[index % colours.length],
      text: texts[index % texts.length],
    });
  }

  const started = Date.now();
  await seedNotes(page, fixture);
  const seededIn = Date.now() - started;
  expect(await page.getByTestId('sticky-note').count()).toBe(500);
  expect(seededIn).toBeLessThan(60_000);

  // Click a note that is actually on screen, near the middle of the crowd.
  const target = { x: camera.x + 220 + HALF, y: camera.y + 220 + HALF };
  const point = await screenPointOf(page, target);
  expect(await hitNote(page, point.x, point.y)).not.toBeNull();

  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  const began = Date.now();
  await page.mouse.up();
  const elapsed = Date.now() - began;

  // The app's own budget is one frame (16 ms); this number also carries the
  // driver round trip, so the ceiling sits above it. A full re-render of 500
  // notes per click would land an order of magnitude higher.
  expect(elapsed).toBeLessThan(25);
  const selected = await page.evaluate(
    () => document.querySelectorAll('[data-selected="true"]').length,
  );
  expect(selected).toBe(1);

  // A second click elsewhere - deselect one note, select another - costs the
  // same, which is the point of "no lag with 500 notes".
  const other = { x: camera.x + 3 * 220 + HALF, y: camera.y + 220 + HALF };
  const second = await screenPointOf(page, other);
  expect(await hitNote(page, second.x, second.y)).not.toBeNull();
  const beganSecond = Date.now();
  await page.mouse.click(second.x, second.y);
  expect(Date.now() - beganSecond).toBeLessThan(25);
  expect(
    await page.evaluate(() => document.querySelectorAll('[data-selected="true"]').length),
  ).toBe(1);
});
