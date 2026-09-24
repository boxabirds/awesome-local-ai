/**
 * Story 10 · task 15 — end-to-end shape drawing, run in Chromium, Firefox and
 * WebKit against the built app.
 *
 * These are the truths only a real browser can show: a real drag draws a shape
 * of the dragged size *at that position* (so the screen→world maths and the
 * painted box are checked together, not just the stored numbers), and a label
 * typed into a shape really wraps inside the shape and stays centred when the
 * shape's width changes. jsdom lays nothing out, which is exactly why the
 * design reserves these two for e2e.
 */
import { expect, test } from '@playwright/test';
import { openFreshBoard } from './helpers/boards';
import { setCamera } from './helpers/board';
import { drawShape, shapeLabels, shapes, settle, stickyCount } from './helpers/shapes';
import { readNotes } from './helpers/sticky';

/** A long label that cannot fit on one line inside a 200-unit-wide shape. */
const LONG_LABEL =
  'The payment is checked against the available stock before anything is reserved for this order.';

test('TC-23: a Shape-tool drag draws a 200x120 shape where it was dragged', async ({
  page,
}) => {
  await openFreshBoard(page);
  await settle(page);

  // Drag the exact rectangle the story names, in screen pixels at zoom 1.
  await drawShape(page, [100, 100], [300, 220]);

  const drawn = await shapes(page);
  expect(drawn).toHaveLength(1);
  const shape = drawn[0]!;
  expect(shape.kind).toBe('rect');
  // One for one at zoom 1, within the story's 1 px: the painted box *is* the
  // drag, which is only true if the pointer-to-world conversion is right.
  expect(Math.abs(shape.width - 200)).toBeLessThanOrEqual(1);
  expect(Math.abs(shape.height - 120)).toBeLessThanOrEqual(1);
  expect(Math.abs(shape.left - 100)).toBeLessThanOrEqual(1);
  expect(Math.abs(shape.top - 100)).toBeLessThanOrEqual(1);

  // The gesture made a shape and nothing else: no sticky note anywhere.
  expect(await stickyCount(page)).toBe(0);
});

test('TC-23b: Shift squares the shape and a Shape-tool drag never picks a note up', async ({
  page,
}) => {
  await openFreshBoard(page);
  // A sticky note to be left alone, placed by the app's own "N" shortcut. It
  // opens its editor when it lands, so Escape first — otherwise the letters
  // that follow are typing, not tool shortcuts (see the helper's note on this).
  await page.keyboard.press('n');
  await settle(page);
  await page.keyboard.press('Escape');
  await settle(page);
  expect(await stickyCount(page)).toBe(1);

  await page.keyboard.press('s');
  await settle(page);
  // The Shape tool really is the active tool now, or the rest proves nothing.
  await expect(page.getByTestId('tool-shape')).toHaveAttribute('aria-pressed', 'true');

  // A drag that *starts on the note*: the tool owns the gesture, so the note
  // must not move and a shape must appear.
  const note = (await readNotes(page))[0]!;
  const before = (await shapes(page)).length;
  await page.keyboard.down('Shift');
  await page.mouse.move(note.cx, note.cy);
  await page.mouse.down();
  await page.mouse.move(note.cx + 160, note.cy + 130, { steps: 10 });
  await settle(page);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await settle(page);

  const drawn = await shapes(page);
  expect(drawn.length).toBe(before + 1);
  const shape = drawn[drawn.length - 1]!;
  // Shift: the longer edge sets both sides, so the box is square on screen.
  expect(Math.abs(shape.width - shape.height)).toBeLessThanOrEqual(1);
  // Still exactly one note, and it never moved: the gesture belonged to the
  // tool, not to the note under it (TC-28).
  expect(await stickyCount(page)).toBe(1);
  const after = (await readNotes(page))[0]!;
  expect(Math.abs(after.left - note.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.top - note.top)).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('tool-shape')).toHaveAttribute('aria-pressed', 'false');
});

test('TC-24: at 200% a Diamond click places a 160-unit shape; its label wraps and stays centred', async ({
  page,
}) => {
  await openFreshBoard(page);
  await settle(page);

  // 200% zoom, centred on the world origin, so the painted box is twice the
  // world size and the maths can be checked against the screen.
  await setCamera(page, { x: -640, y: -400, zoom: 2 });
  expect(await page.getByTestId('zoom-label').innerText()).toBe('200%');

  // Diamond, then a single click: a default 160x160 shape, centred on the click.
  await page.keyboard.press('s');
  await page.getByTestId('shape-kind-diamond').click();
  await page.mouse.click(760, 420);
  await settle(page);

  let drawn = await shapes(page);
  expect(drawn).toHaveLength(1);
  expect(drawn[0]!.kind).toBe('diamond');
  expect(Math.abs(drawn[0]!.width - 320)).toBeLessThanOrEqual(2);
  expect(Math.abs(drawn[0]!.height - 320)).toBeLessThanOrEqual(2);
  expect(Math.abs(drawn[0]!.cx - 760)).toBeLessThanOrEqual(2);
  expect(Math.abs(drawn[0]!.cy - 420)).toBeLessThanOrEqual(2);

  // Type a label wider than the shape: it must wrap rather than overflow.
  await page.mouse.dblclick(760, 420);
  await page.waitForSelector('[data-testid^="shape-editor-"]', { timeout: 3000 });
  await page.keyboard.type(LONG_LABEL);
  await page.keyboard.press('Escape');
  await settle(page);

  const [wide] = await shapeLabels(page);
  expect(wide).toBeTruthy();
  expect(wide!.text.length).toBeGreaterThan(80);
  expect(wide!.lines).toBeGreaterThan(1);
  // Centred inside the shape it belongs to.
  const wideShape = (await shapes(page))[0]!;
  expect(Math.abs(wide!.left + wide!.width / 2 - wideShape.cx)).toBeLessThanOrEqual(2);

  // Now the same label in a *narrower* shape: it has to wrap into more lines
  // and stay centred, which is what "the label re-wraps when the box changes"
  // means to a user. (This build has no resize handle to drag — resizing is
  // controller-only — so the second shape is the honest way to change the box.)
  await drawShape(page, [300, 500], [420, 640]);
  await settle(page);
  const narrow = (await shapes(page)).find((shape) => shape.width < wideShape.width - 50);
  expect(narrow).toBeTruthy();

  await page.mouse.dblclick(narrow!.cx, narrow!.cy);
  await page.waitForSelector('[data-testid^="shape-editor-"]', { timeout: 3000 });
  await page.keyboard.type(LONG_LABEL);
  await page.keyboard.press('Escape');
  await settle(page);

  const labels = await shapeLabels(page);
  expect(labels).toHaveLength(2);
  const narrowLabel = labels.find((label) => label.id === narrow!.id)!;
  expect(narrowLabel.lines).toBeGreaterThan(wide!.lines);
  expect(Math.abs(narrowLabel.left + narrowLabel.width / 2 - narrow!.cx)).toBeLessThanOrEqual(2);
});
