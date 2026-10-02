import { test, expect, type Page } from '@playwright/test';
import { PROSE_1000, SHORT_PHRASE } from '../fixtures/texts';

const NOTE_SIZE = 200; // STICKY_SIZE_WORLD

type Camera = { x: number; y: number; zoom: number };

async function setCamera(page: Page, camera: Camera) {
  await page.evaluate((c) => {
    (window as unknown as { __vidi6: { setCamera(c: Camera): void } }).__vidi6.setCamera(c);
  }, camera);
  await page.waitForTimeout(50);
}

async function noteIds(page: Page): Promise<string[]> {
  return page.locator('[data-note-id]').evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.noteId as string),
  );
}

function note(page: Page, id: string) {
  return page.locator(`[data-note-id="${id}"]`);
}

async function noteBox(page: Page, id: string) {
  return note(page, id).boundingBox();
}

async function worldTransform(page: Page): Promise<string> {
  return (await page.locator('[data-testid="world-layer"]').getAttribute('style')) ?? '';
}

/** Press at `from`, drag to `to`, release. Returns the pointer delta. */
async function dragOn(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + (to.x - from.x) / 2, from.y + (to.y - from.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  return { dx: to.x - from.x, dy: to.y - from.y };
}

/** Create a note by double-clicking empty board space and leave it idle. */
async function createNoteAt(page: Page, at: { x: number; y: number }): Promise<string> {
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.locator('[data-testid="sticky-textarea"]')).toBeVisible();
  await page.keyboard.press('Escape');
  const ids = await noteIds(page);
  return ids[ids.length - 1];
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-testid="board-viewport"]')).toBeVisible();
});

test('TC-30: double-click creates a note centred on the point and takes the typed text', async ({
  page,
}) => {
  await page.mouse.dblclick(400, 300);

  const ids = await noteIds(page);
  expect(ids).toHaveLength(1);
  const box = await noteBox(page, ids[0]);
  // The note is centred on the double-clicked point, within a pixel.
  expect(box!.x + box!.width / 2).toBeCloseTo(400, 0);
  expect(box!.y + box!.height / 2).toBeCloseTo(300, 0);
  expect(box!.width).toBeCloseTo(NOTE_SIZE, 0);
  expect(box!.height).toBeCloseTo(NOTE_SIZE, 0);
  expect(await note(page, ids[0]).getAttribute('data-color')).toBe('yellow');

  // The new note is in edit mode straight away: whatever is typed lands on it.
  await expect(page.locator('[data-testid="sticky-textarea"]')).toBeFocused();
  await page.keyboard.type('Hello');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="sticky-note-text"]')).toHaveText('Hello');
});

test('TC-31: at 50% zoom a 100x50 px drag moves the note 200x100 world units', async ({
  page,
}) => {
  await setCamera(page, { x: 0, y: 0, zoom: 0.5 });
  const id = await createNoteAt(page, { x: 640, y: 400 });

  const before = await noteBox(page, id);
  const beforeWorld = await note(page, id).evaluate((el) => ({
    x: Number(el.dataset.x),
    y: Number(el.dataset.y),
  }));

  const from = { x: before!.x + 40, y: before!.y + 40 };
  await dragOn(page, from, { x: from.x + 100, y: from.y + 50 });

  const afterWorld = await note(page, id).evaluate((el) => ({
    x: Number(el.dataset.x),
    y: Number(el.dataset.y),
  }));
  expect(afterWorld.x - beforeWorld.x).toBeCloseTo(200, 1);
  expect(afterWorld.y - beforeWorld.y).toBeCloseTo(100, 1);

  // The grabbed point stayed under the pointer, within a pixel.
  const after = await noteBox(page, id);
  expect(after!.x + 40).toBeCloseTo(from.x + 100, 0);
  expect(after!.y + 40).toBeCloseTo(from.y + 50, 0);
});

test('TC-32: at 200% zoom a 100x50 px drag moves 50x25 world units and puts the note on top', async ({
  page,
}) => {
  await setCamera(page, { x: 0, y: 0, zoom: 2 });
  // A on the left, B on the right, already overlapping.
  const a = await createNoteAt(page, { x: 500, y: 400 });
  const b = await createNoteAt(page, { x: 700, y: 400 });

  const boxA = await noteBox(page, a);
  const boxB = await noteBox(page, b);
  expect(boxA!.x).toBeLessThan(boxB!.x);

  const beforeWorld = await note(page, a).evaluate((el) => ({
    x: Number(el.dataset.x),
    y: Number(el.dataset.y),
  }));

  const from = { x: boxA!.x + 30, y: boxA!.y + 30 };
  await dragOn(page, from, { x: from.x + 100, y: from.y + 50 });

  const afterWorld = await note(page, a).evaluate((el) => ({
    x: Number(el.dataset.x),
    y: Number(el.dataset.y),
  }));
  expect(afterWorld.x - beforeWorld.x).toBeCloseTo(50, 1);
  expect(afterWorld.y - beforeWorld.y).toBeCloseTo(25, 1);

  // The dragged note now covers B and is the topmost note there.
  const moved = await noteBox(page, a);
  const point = {
    x: Math.max(moved!.x, boxB!.x) + 5,
    y: Math.max(moved!.y, boxB!.y) + 5,
  };
  expect(point.x).toBeLessThan(Math.min(moved!.x + moved!.width, boxB!.x + boxB!.width));
  const topId = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return el?.closest('[data-note-id]')?.getAttribute('data-note-id') ?? null;
  }, point);
  expect(topId).toBe(a);
});

test('dragging a note never pans the board', async ({ page }) => {
  await setCamera(page, { x: 120, y: 60, zoom: 1 });
  const a = await createNoteAt(page, { x: 600, y: 400 });
  const b = await createNoteAt(page, { x: 950, y: 520 });

  const box = await noteBox(page, a);
  const otherBefore = await noteBox(page, b);
  const transformBefore = await worldTransform(page);

  const from = { x: box!.x + 30, y: box!.y + 30 };
  await dragOn(page, from, { x: from.x + 150, y: from.y + 100 });

  expect(await worldTransform(page)).toBe(transformBefore);
  const moved = await noteBox(page, a);
  expect(moved!.x).toBeCloseTo(box!.x + 150, 0);
  expect(moved!.y).toBeCloseTo(box!.y + 100, 0);
  // The other note never moved.
  expect(await noteBox(page, b)).toEqual(otherBefore);
});

test('TC-33: text is auto-fit — 24px for a word, at least 10px and clipped for 1,000 characters', async ({
  page,
}) => {
  await page.mouse.dblclick(640, 400);
  await expect(page.locator('[data-testid="sticky-textarea"]')).toBeVisible();

  await page.keyboard.type(SHORT_PHRASE);
  const textarea = page.locator('[data-testid="sticky-textarea"]');
  await expect(textarea).toHaveValue(SHORT_PHRASE);
  expect(await textarea.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(
    24,
    0,
  );

  await page.keyboard.insertText(` ${PROSE_1000.slice(0, 1000 - SHORT_PHRASE.length - 1)}`);
  const value = await textarea.inputValue();
  expect(value).toHaveLength(1000);
  expect(value.startsWith(`${SHORT_PHRASE} `)).toBe(true);
  const fitted = await textarea.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fitted).toBeGreaterThanOrEqual(10);
  expect(fitted).toBeLessThan(24);

  // Overflowing text is clipped and the fade marks it.
  await page.keyboard.press('Escape');
  const text = page.locator('[data-testid="sticky-note-text"]');
  const metrics = await text.evaluate((el) => ({
    fontSize: parseFloat(getComputedStyle(el).fontSize),
    clipped: el.scrollHeight > el.clientHeight + 1,
  }));
  expect(metrics.fontSize).toBeCloseTo(fitted, 0);
  expect(metrics.fontSize).toBeGreaterThanOrEqual(10);
  expect(metrics.clipped).toBe(true);
  await expect(page.locator('[data-testid="sticky-note-fade"]')).toBeVisible();
  await expect(page.locator('[data-note-id]')).toHaveAttribute('data-overflow', 'true');
});

test('TC-34: creating with the toolbar while panned far away puts the note on screen', async ({
  page,
}) => {
  await setCamera(page, { x: 42000, y: -31000, zoom: 1 });

  await page.getByRole('button', { name: 'Sticky note' }).click();

  const ids = await noteIds(page);
  expect(ids).toHaveLength(1);
  const box = await noteBox(page, ids[0]);
  // Visible and centred on the viewport.
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1280);
  expect(box!.y + box!.height).toBeLessThanOrEqual(800);
  expect(box!.x + box!.width / 2).toBeCloseTo(640, 0);
  expect(box!.y + box!.height / 2).toBeCloseTo(400, 0);
  await expect(note(page, ids[0])).toHaveAttribute('data-editing', 'true');
});

test('selection box and note toolbar keep their size on screen while zooming', async ({
  page,
}) => {
  const id = await createNoteAt(page, { x: 600, y: 400 });
  await note(page, id).click();
  await expect(note(page, id)).toHaveAttribute('data-selected', 'true');

  const outlineBefore = await note(page, id).evaluate((el) => getComputedStyle(el).outlineWidth);
  const toolbarBefore = await page.locator('[data-testid="note-toolbar"]').boundingBox();

  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.waitForTimeout(150);

  const box = await noteBox(page, id);
  expect(box!.width).toBeCloseTo(NOTE_SIZE * 0.64, 0);
  // The outline is drawn in screen pixels, so it does not shrink with the note.
  expect(await note(page, id).evaluate((el) => getComputedStyle(el).outlineWidth)).toBe(
    outlineBefore,
  );
  // The toolbar keeps its screen size, so the swatches stay clickable.
  const toolbarAfter = await page.locator('[data-testid="note-toolbar"]').boundingBox();
  expect(Math.abs(toolbarAfter!.height - toolbarBefore!.height)).toBeLessThan(1.5);
  const swatch = page.getByRole('button', { name: 'Violet colour' });
  await expect(swatch).toBeVisible();
  await swatch.click();
  await expect(note(page, id)).toHaveAttribute('data-color', 'violet');
});

test('workflow: brainstorm — create, type, move, recolour and delete', async ({ page }) => {
  await page.getByRole('button', { name: 'Sticky note' }).click();
  const id = (await noteIds(page))[0];
  await expect(note(page, id)).toHaveAttribute('data-editing', 'true');
  await page.keyboard.type('Try a shorter intro');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="sticky-note-text"]')).toHaveText('Try a shorter intro');

  const before = await noteBox(page, id);
  const from = { x: before!.x + 25, y: before!.y + 25 };
  await dragOn(page, from, { x: from.x + 175, y: from.y + 120 });
  const moved = await noteBox(page, id);
  expect(moved!.x).toBeCloseTo(before!.x + 175, 0);
  await expect(note(page, id)).toHaveAttribute('data-selected', 'true');
  await expect(note(page, id)).toHaveAttribute('data-color', 'yellow');
  await expect(page.locator('[data-testid="sticky-note-text"]')).toHaveText('Try a shorter intro');

  await page.getByRole('button', { name: 'Blue colour' }).click();
  await expect(note(page, id)).toHaveAttribute('data-color', 'blue');

  await page.getByRole('button', { name: 'Delete note' }).click();
  await expect(page.locator('[data-note-id]')).toHaveCount(0);
  await expect(page.locator('[data-testid="note-toolbar"]')).toHaveCount(0);
});
