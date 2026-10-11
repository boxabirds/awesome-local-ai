/**
 * Story 2 e2e: a real browser measures the notes, a real pointer drags them, and
 * long text is checked against the pixels it actually occupies.
 *
 * Fixtures are board input (clicks, drags, typing). The only test-only hook used
 * is the story 1 camera reader, which the test build exposes.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  DEFAULT_STICKY_COLOR,
  STICKY_COLORS,
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import {
  boardSize,
  clickZoomIn,
  clickZoomOut,
  currentCamera,
  dragBoard,
  openBoard,
  originCentre,
  setBoardCamera,
  settle,
  zoomLabel,
  type PointLike,
} from './helpers/board';

/** Long enough that 24px cannot fit it, short enough that 10px can. */
const LONG_TEXT =
  'Ideas need room to breathe, so every note stays readable inside its square: ' +
  'short notes stay crisp, long notes shrink to fit, and nothing ever spills ' +
  'past the edge of the paper.';

const OVER_LIMIT = 'x'.repeat(STICKY_TEXT_MAX_CHARS + 400);

interface Note {
  el: Locator;
  id: string;
  box: { x: number; y: number; width: number; height: number };
  centre: PointLike;
}

function hexToRgb(hex: string): string {
  const body = hex.replace('#', '');
  const values = [0, 2, 4].map((offset) => Number.parseInt(body.slice(offset, offset + 2), 16));
  return `rgb(${values[0]}, ${values[1]}, ${values[2]})`;
}

async function noteCount(page: Page): Promise<number> {
  return await page.getByTestId('sticky-note').count();
}

/** All notes, in z order, with the squares the browser actually painted. */
async function measureNotes(page: Page): Promise<Note[]> {
  const all = page.getByTestId('sticky-note');
  const total = await all.count();
  const out: Note[] = [];
  for (let index = 0; index < total; index += 1) {
    const el = all.nth(index);
    const box = await el.boundingBox();
    if (!box) {
      throw new Error(`note ${index} is not rendered`);
    }
    const id = await el.getAttribute('data-note-id');
    if (!id) {
      throw new Error(`note ${index} has no id`);
    }
    out.push({ el, id, box, centre: { x: box.x + box.width / 2, y: box.y + box.height / 2 } });
  }
  return out;
}

async function firstNote(page: Page): Promise<Note> {
  const notes = await measureNotes(page);
  const first = notes[0];
  if (!first) {
    throw new Error('no notes on the board');
  }
  return first;
}

/** The most recently created note (the top of the z order). */
async function lastNote(page: Page): Promise<Note> {
  const notes = await measureNotes(page);
  const last = notes[notes.length - 1];
  if (!last) {
    throw new Error('no notes on the board');
  }
  return last;
}

function noteWithId(notes: Note[], id: string): Note {
  const note = notes.find((candidate) => candidate.id === id);
  if (!note) {
    throw new Error(`note ${id} is no longer on the board`);
  }
  return note;
}

async function noteById(page: Page, id: string): Promise<Note> {
  return noteWithId(await measureNotes(page), id);
}

/** Close the editor that note creation opens, keeping the note selected. */
async function closeEditor(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await settle(page);
  await expect(page.getByTestId('sticky-textarea')).toHaveCount(0);
}

/** A note created at the viewport centre, selected and not being edited. */
async function createIdleAtCentre(page: Page): Promise<Note> {
  const note = await createAtCentre(page);
  await closeEditor(page);
  return await noteById(page, note.id);
}

/** A note created at a screen point, selected and not being edited. */
async function createIdleAtScreen(page: Page, at: PointLike): Promise<Note> {
  const note = await createAtScreen(page, at);
  await closeEditor(page);
  return await noteById(page, note.id);
}

/** The note whose centre is closest to a world point. */
async function noteAtWorld(page: Page, world: PointLike): Promise<Note> {
  const screen = await worldToScreen(page, world);
  const notes = await measureNotes(page);
  let best: Note | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const note of notes) {
    const distance = Math.hypot(note.centre.x - screen.x, note.centre.y - screen.y);
    if (distance < bestDistance) {
      best = note;
      bestDistance = distance;
    }
  }
  if (!best || bestDistance > 60) {
    throw new Error(`no note near world (${world.x}, ${world.y})`);
  }
  return best;
}

/** Window point -> world point, the inverse of `worldToScreen`. */
async function screenToWorldPoint(page: Page, at: PointLike): Promise<PointLike> {
  const origin = await originCentre(page);
  const camera = await currentCamera(page);
  return { x: (at.x - origin.x) / camera.zoom, y: (at.y - origin.y) / camera.zoom };
}

/** Put the world origin in the middle of the screen at `zoom` (story 1 test hook). */
async function centreCameraAtZoom(page: Page, zoom: number): Promise<void> {
  const size = await boardSize(page);
  await setBoardCamera(page, { x: -(size.width / 2) / zoom, y: -(size.height / 2) / zoom, zoom });
  await settle(page);
  const camera = await currentCamera(page);
  expect(camera.zoom).toBeCloseTo(zoom, 6);
}

/** World point -> window point, using the origin marker and the camera. */
async function worldToScreen(page: Page, world: PointLike): Promise<PointLike> {
  const origin = await originCentre(page);
  const camera = await currentCamera(page);
  return { x: origin.x + world.x * camera.zoom, y: origin.y + world.y * camera.zoom };
}

async function createAtCentre(page: Page): Promise<Note> {
  await page.getByTestId('create-sticky').click();
  await settle(page);
  return await lastNote(page);
}

async function createAtScreen(page: Page, at: PointLike): Promise<Note> {
  await page.mouse.dblclick(at.x, at.y);
  await settle(page);
  return await lastNote(page);
}

/** Press, move and release exactly like a pointer does. */
async function dragTo(page: Page, from: PointLike, to: PointLike): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + (to.x - from.x) * 0.4, from.y + (to.y - from.y) * 0.4, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await settle(page);
  await page.mouse.up();
  await settle(page);
}

async function dragNoteToScreen(page: Page, note: Note, to: PointLike): Promise<void> {
  await dragTo(page, note.centre, to);
}

async function dragNoteToWorld(page: Page, note: Note, world: PointLike): Promise<void> {
  await dragNoteToScreen(page, note, await worldToScreen(page, world));
}

async function selectNote(page: Page, note: Note): Promise<void> {
  await page.mouse.move(note.centre.x, note.centre.y);
  await page.mouse.down();
  await page.mouse.up();
  await settle(page);
}

async function openEditor(page: Page, note: Note): Promise<Locator> {
  await page.mouse.dblclick(note.centre.x, note.centre.y);
  await settle(page);
  const textarea = page.getByTestId('sticky-textarea');
  await expect(textarea).toBeVisible();
  return textarea;
}

async function editorState(page: Page): Promise<{ value: string; caret: number; fontPx: number; scroll: number; client: number } | null> {
  const textarea = page.getByTestId('sticky-textarea');
  if ((await textarea.count()) === 0) {
    return null;
  }
  return await textarea.evaluate((node: HTMLTextAreaElement) => ({
    value: node.value,
    caret: node.selectionStart ?? 0,
    fontPx: Number.parseFloat(getComputedStyle(node).fontSize),
    scroll: node.scrollHeight,
    client: node.clientHeight,
  }));
}

async function textState(page: Page, note: Note): Promise<{ text: string; fontPx: number; scroll: number; client: number; overflow: string; className: string }> {
  return await note.el.getByTestId('sticky-text').evaluate((node) => ({
    text: node.textContent ?? '',
    fontPx: Number.parseFloat(getComputedStyle(node).fontSize),
    scroll: node.scrollHeight,
    client: node.clientHeight,
    overflow: getComputedStyle(node).overflow,
    className: node.className,
  }));
}

async function counterState(page: Page): Promise<{ visible: boolean; text: string }> {
  const counter = page.getByTestId('sticky-counter');
  if ((await counter.count()) === 0) {
    return { visible: false, text: '' };
  }
  return { visible: await counter.isVisible(), text: (await counter.textContent()) ?? '' };
}

async function noteState(page: Page, note: Note): Promise<{ selected: string; dragging: string; editing: string; z: string; outlineWidth: number; color: string }> {
  return await note.el.evaluate((node) => ({
    selected: node.getAttribute('data-selected') ?? '',
    dragging: node.getAttribute('data-dragging') ?? '',
    editing: node.getAttribute('data-editing') ?? '',
    z: node.getAttribute('data-z') ?? '',
    outlineWidth: Number.parseFloat(getComputedStyle(node).outlineWidth),
    color: getComputedStyle(node).backgroundColor,
  }));
}

test.describe('sticky notes', () => {
  test.beforeEach(async ({ page }) => {
    await openBoard(page);
    await expect(page.getByTestId('navigation-hint')).toBeVisible();
  });

  test('TC-30: double-clicking empty board space creates a note centred on that point', async ({ page }) => {
    const click = { x: 940, y: 220 };
    const note = await createAtScreen(page, click);

    expect(await noteCount(page)).toBe(1);
    expect(note.centre.x).toBeCloseTo(click.x, 0);
    expect(note.centre.y).toBeCloseTo(click.y, 0);

    const camera = await currentCamera(page);
    expect(note.box.width).toBeCloseTo(STICKY_SIZE_WORLD * camera.zoom, 1);
    expect(note.box.height).toBeCloseTo(STICKY_SIZE_WORLD * camera.zoom, 1);

    // Editing is active straight away, so the first keystrokes land in the note.
    await expect(page.getByTestId('sticky-textarea')).toBeVisible();
    await page.keyboard.type('Hello');
    await settle(page);
    expect((await editorState(page))?.value).toBe('Hello');
    await page.keyboard.press('Escape');
    await settle(page);
    expect((await textState(page, await noteById(page, note.id))).text).toBe('Hello');
  });

  test('TC-31: one note per double-click, notes land apart, and panning creates none', async ({ page }) => {
    await createAtScreen(page, { x: 400, y: 240 });
    expect(await noteCount(page)).toBe(1);
    await createAtScreen(page, { x: 1000, y: 300 });
    expect(await noteCount(page)).toBe(2);

    const [left, right] = await measureNotes(page);
    if (!left || !right) {
      throw new Error('expected two notes on the board');
    }
    const distance = Math.hypot(left.centre.x - right.centre.x, left.centre.y - right.centre.y);
    expect(distance).toBeGreaterThan(STICKY_SIZE_WORLD);

    // A canvas drag is navigation, not a note.
    await page.mouse.move(640, 620);
    await page.mouse.down();
    await page.mouse.move(560, 560, { steps: 6 });
    await page.mouse.up();
    await settle(page);
    expect(await noteCount(page)).toBe(2);
  });

  test('TC-28: the sticky button places a note at the centre of the viewport', async ({ page }) => {
    const note = await createAtCentre(page);
    const size = await boardSize(page);
    expect(note.centre.x).toBeCloseTo(size.width / 2, 0);
    expect(note.centre.y).toBeCloseTo(size.height / 2, 0);
  });

  test('TC-18, TC-19, TC-32, TC-34: a dragged note follows the pointer, keeps its selection and leaves the others alone', async ({ page }) => {
    const first = await createIdleAtScreen(page, { x: 420, y: 260 });
    const second = await createIdleAtScreen(page, { x: 900, y: 520 });
    const before = await measureNotes(page);
    const draggedBefore = noteWithId(before, first.id);
    const otherBefore = noteWithId(before, second.id);

    await dragNoteToScreen(page, draggedBefore, {
      x: draggedBefore.centre.x + 180,
      y: draggedBefore.centre.y + 120,
    });

    const after = await measureNotes(page);
    const draggedAfter = noteWithId(after, first.id);
    const otherAfter = noteWithId(after, second.id);

    expect(draggedAfter.box.x - draggedBefore.box.x).toBeCloseTo(180, 1);
    expect(draggedAfter.box.y - draggedBefore.box.y).toBeCloseTo(120, 1);
    expect(otherAfter.box.x).toBeCloseTo(otherBefore.box.x, 1);
    expect(otherAfter.box.y).toBeCloseTo(otherBefore.box.y, 1);
    expect(otherAfter.box.width).toBeCloseTo(otherBefore.box.width, 2);
    expect(draggedAfter.box.width).toBeCloseTo(draggedBefore.box.width, 2);

    const dragged = await noteState(page, draggedAfter);
    const other = await noteState(page, otherAfter);
    expect(dragged.selected).toBe('true');
    expect(dragged.dragging).toBe('false');
    expect(dragged.editing).toBe('false');
    expect(dragged.outlineWidth).toBeGreaterThan(0);
    expect(Number(dragged.z)).toBeGreaterThan(Number(other.z));
    expect(other.selected).toBe('false');

    // The dragged note is now the top of the stack.
    expect((await measureNotes(page)).at(-1)?.id).toBe(first.id);
  });

  test('TC-20: a press under the drag threshold selects without moving', async ({ page }) => {
    const created = await createIdleAtCentre(page);
    const before = await noteById(page, created.id);

    await page.mouse.move(before.centre.x, before.centre.y);
    await page.mouse.down();
    await page.mouse.move(before.centre.x + 2, before.centre.y + 1, { steps: 2 });
    await page.mouse.up();
    await settle(page);

    const after = await firstNote(page);
    expect(after.box.x).toBeCloseTo(before.box.x, 1);
    expect(after.box.y).toBeCloseTo(before.box.y, 1);
    expect((await noteState(page, after)).selected).toBe('true');
  });

  test('TC-33: notes dragged to the board bounds stay fully rendered, at 100% and when zoomed out', async ({ page }) => {
    const size = await boardSize(page);
    const created = await createIdleAtCentre(page);
    const note = await noteById(page, created.id);
    const first = note;

    await dragNoteToScreen(page, first, { x: size.width - first.box.width / 2 - 2, y: size.height - first.box.height / 2 - 2 });
    let box = (await noteById(page, created.id)).box;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width + 2);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height + 2);
    await expect(note.el).toBeVisible();

    await clickZoomOut(page);
    await clickZoomOut(page);
    await settle(page);
    const small = await noteById(page, created.id);
    expect(small.box.width).toBeLessThan(first.box.width);

    await dragNoteToScreen(page, small, { x: small.box.width / 2 + 2, y: small.box.height / 2 + 2 });
    box = (await noteById(page, created.id)).box;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    await expect(note.el).toBeVisible();

    const middle = await noteById(page, created.id);
    await dragNoteToScreen(page, middle, { x: size.width / 2, y: size.height / 2 });
    box = (await noteById(page, created.id)).box;
    expect(box.x + box.width).toBeLessThanOrEqual(size.width + 2);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height + 2);
    await expect(note.el).toBeVisible();
  });

  test('TC-31: at 50% zoom a 100 x 50 drag moves the note 200 x 100 world units under the pointer', async ({ page }) => {
    await centreCameraAtZoom(page, 0.5);
    const created = await createIdleAtScreen(page, { x: 520, y: 320 });
    const before = await noteById(page, created.id);
    const worldBefore = await screenToWorldPoint(page, before.centre);
    expect(before.box.width).toBeCloseTo(STICKY_SIZE_WORLD * 0.5, 1);

    await dragNoteToScreen(page, before, { x: before.centre.x + 100, y: before.centre.y + 50 });

    const after = await noteById(page, created.id);
    // The grabbed point stays under the pointer.
    expect(after.centre.x).toBeCloseTo(before.centre.x + 100, 0);
    expect(after.centre.y).toBeCloseTo(before.centre.y + 50, 0);
    const worldAfter = await screenToWorldPoint(page, after.centre);
    expect(worldAfter.x - worldBefore.x).toBeCloseTo(200, 0);
    expect(worldAfter.y - worldBefore.y).toBeCloseTo(100, 0);
  });

  test('TC-32: at 200% zoom a 100 x 50 drag moves 50 x 25 world units and draws the note on top', async ({ page }) => {
    await centreCameraAtZoom(page, 2);
    const lower = await createIdleAtScreen(page, { x: 400, y: 300 });
    const upper = await createIdleAtScreen(page, { x: 700, y: 480 });
    const before = await noteById(page, lower.id);
    const worldBefore = await screenToWorldPoint(page, before.centre);
    expect(before.box.width).toBeCloseTo(STICKY_SIZE_WORLD * 2, 1);

    // Before the drag the later note is on top where they overlap.
    const overlapBefore = { x: 620, y: 400 };
    expect(await page.evaluate((at) => document.elementFromPoint(at.x, at.y)?.getAttribute('data-note-id'), overlapBefore))
      .toBe(upper.id);

    await dragNoteToScreen(page, before, { x: before.centre.x + 100, y: before.centre.y + 50 });

    const after = await noteById(page, lower.id);
    expect(after.centre.x).toBeCloseTo(before.centre.x + 100, 0);
    expect(after.centre.y).toBeCloseTo(before.centre.y + 50, 0);
    const worldAfter = await screenToWorldPoint(page, after.centre);
    expect(worldAfter.x - worldBefore.x).toBeCloseTo(50, 0);
    expect(worldAfter.y - worldBefore.y).toBeCloseTo(25, 0);

    // Dragging brings the note above the one it overlaps.
    const overlapAfter = { x: 620, y: 400 };
    expect(await page.evaluate((at) => document.elementFromPoint(at.x, at.y)?.getAttribute('data-note-id'), overlapAfter))
      .toBe(lower.id);
    const state = await noteState(page, after);
    expect(Number(state.z)).toBeGreaterThan(Number((await noteState(page, await noteById(page, upper.id))).z));
  });

  test('TC-27, TC-29, TC-36: the note toolbar recolours and deletes the selected note', async ({ page }) => {
    const note = await createIdleAtCentre(page);
    const before = await noteState(page, note);
    expect(before.color).toBe(hexToRgb(STICKY_COLORS[DEFAULT_STICKY_COLOR]));

    const swatch = page.getByTestId('swatch-pink');
    await expect(swatch).toHaveAttribute('aria-label', 'Pink colour');
    await expect(swatch).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('swatch-yellow')).toHaveAttribute('aria-pressed', 'true');

    await swatch.click();
    await settle(page);
    const after = await noteState(page, note);
    expect(after.color).toBe(hexToRgb(STICKY_COLORS.pink));
    expect(after.color).not.toBe(before.color);
    await expect(swatch).toHaveAttribute('aria-pressed', 'true');
    expect(await noteCount(page)).toBe(1);
    expect((await noteState(page, note)).selected).toBe('true');

    // The whole toolbar stays on screen and does not spill off the note.
    const toolbar = await page.getByTestId('note-toolbar').boundingBox();
    const size = await boardSize(page);
    expect(toolbar).not.toBeNull();
    expect(toolbar!.x).toBeGreaterThanOrEqual(0);
    expect(toolbar!.y).toBeGreaterThanOrEqual(0);
    expect(toolbar!.x + toolbar!.width).toBeLessThanOrEqual(size.width);
    expect(toolbar!.y + toolbar!.height).toBeLessThanOrEqual(size.height);

    await page.getByTestId('delete-note').click();
    await settle(page);
    expect(await noteCount(page)).toBe(0);
    expect(await page.getByTestId('note-toolbar').count()).toBe(0);
  });

  test('TC-35: double-clicking a note opens the editor with the caret at the end', async ({ page }) => {
    const created = await createAtCentre(page);
    const note = await firstNote(page);
    await openEditor(page, note);
    await page.getByTestId('sticky-textarea').fill('existing text');
    await page.keyboard.press('Escape');
    await settle(page);
    expect(await page.getByTestId('sticky-textarea').count()).toBe(0);

    const reopened = await firstNote(page);
    await openEditor(page, reopened);
    const state = await editorState(page);
    expect(state?.value).toBe('existing text');
    expect(state?.caret).toBe('existing text'.length);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('TEXTAREA');
    // The static text layer is replaced by the editor, so only one is editable.
    expect(await reopened.el.getByTestId('sticky-text').evaluate((node) => getComputedStyle(node).visibility)).toBe('hidden');
    void created;
  });

  test('Enter opens the editor on a selected note; Enter while editing types a newline', async ({ page }) => {
    const note = await createIdleAtCentre(page);
    await selectNote(page, note);
    await page.keyboard.press('Enter');
    await settle(page);
    await expect(page.getByTestId('sticky-textarea')).toBeVisible();

    await page.keyboard.type('line one');
    await page.keyboard.press('Enter');
    await page.keyboard.type('line two');
    await settle(page);
    expect((await editorState(page))?.value).toBe('line one\nline two');

    await page.keyboard.press('Escape');
    await settle(page);
    const text = await textState(page, await firstNote(page));
    expect(text.text).toBe('line one\nline two');
  });

  test('TC-13, TC-14: every keystroke lands in the note text as it is typed', async ({ page }) => {
    const note = await createAtCentre(page);
    await openEditor(page, note);

    await page.keyboard.type('Hello world');
    await settle(page);
    expect((await editorState(page))?.value).toBe('Hello world');

    // The note underneath already holds the same text.
    const shown = await note.el.getByTestId('sticky-text').evaluate((node) => node.textContent ?? '');
    expect(shown).toBe('Hello world');

    await page.keyboard.press('Escape');
    await settle(page);
    expect((await textState(page, await firstNote(page))).text).toBe('Hello world');
  });

  test('TC-24, TC-25, TC-26: Escape keeps the note; Delete and Backspace only delete when not editing', async ({ page }) => {
    const note = await createAtCentre(page);
    await openEditor(page, note);
    await page.keyboard.type('keep me');
    await settle(page);

    // Backspace edits the text; it does not delete the note.
    await page.keyboard.press('Backspace');
    await settle(page);
    expect((await editorState(page))?.value).toBe('keep m');
    expect(await noteCount(page)).toBe(1);

    // Delete is forward delete here: nothing to the right of the caret.
    await page.keyboard.press('Delete');
    await settle(page);
    expect((await editorState(page))?.value).toBe('keep m');
    expect(await noteCount(page)).toBe(1);

    await page.keyboard.press('Escape');
    await settle(page);
    const kept = await firstNote(page);
    expect((await textState(page, kept)).text).toBe('keep m');
    expect((await noteState(page, kept)).selected).toBe('true');

    await page.keyboard.press('Delete');
    await settle(page);
    expect(await noteCount(page)).toBe(0);
  });

  test('TC-28: clicking empty board space clears the selection, panning the board does not', async ({ page }) => {
    const note = await createIdleAtCentre(page);
    await selectNote(page, note);
    expect((await noteState(page, note)).selected).toBe('true');

    await page.mouse.click(220, 700);
    await settle(page);
    expect((await noteState(page, note)).selected).toBe('false');
    expect(await page.getByTestId('note-toolbar').count()).toBe(0);

    await selectNote(page, note);
    expect((await noteState(page, note)).selected).toBe('true');

    await page.mouse.move(220, 700);
    await page.mouse.down();
    await page.mouse.move(360, 760, { steps: 8 });
    await page.mouse.up();
    await settle(page);
    expect((await noteState(page, note)).selected).toBe('true');
  });

  test('TC-38: typing then clicking outside saves the text and clears the selection', async ({ page }) => {
    const note = await createAtCentre(page);
    await openEditor(page, note);
    await page.keyboard.type('clicked outside');
    await settle(page);

    await page.mouse.click(200, 200);
    await settle(page);
    expect(await page.getByTestId('sticky-textarea').count()).toBe(0);
    const kept = await firstNote(page);
    expect((await textState(page, kept)).text).toBe('clicked outside');
    expect((await noteState(page, kept)).selected).toBe('false');
  });

  test('TC-39: long text is fitted inside the square at any zoom and never overflows', async ({ page }) => {
    const note = await createAtCentre(page);
    await openEditor(page, note);
    await page.getByTestId('sticky-textarea').fill(LONG_TEXT);
    await settle(page);

    const editing = await editorState(page);
    expect(editing).not.toBeNull();
    expect(editing!.value).toBe(LONG_TEXT);
    expect(editing!.fontPx).toBeLessThan(STICKY_FONT_MAX_PX);
    expect(editing!.fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(editing!.scroll).toBeLessThanOrEqual(editing!.client + 1);

    const fitted = editing!.fontPx;
    await page.keyboard.press('Escape');
    await settle(page);

    const shown = await textState(page, await firstNote(page));
    expect(shown.text).toBe(LONG_TEXT);
    expect(shown.overflow).toBe('hidden');
    expect(shown.scroll).toBeLessThanOrEqual(shown.client + 1);
    expect(shown.fontPx).toBeCloseTo(fitted, 1);

    // The note scales with zoom; the fit ratio inside it does not change.
    await clickZoomIn(page);
    await settle(page);
    const zoomedNote = await firstNote(page);
    const zoomed = await textState(page, zoomedNote);
    expect(zoomed.text).toBe(LONG_TEXT);
    expect(zoomed.scroll).toBeLessThanOrEqual(zoomed.client + 1);
    expect(zoomed.fontPx).toBeCloseTo(shown.fontPx, 1);
    expect(zoomedNote.box.height / shown.client).toBeGreaterThan(1.1);
    expect(await zoomLabel(page)).toContain('125%');
  });

  test('short text keeps the largest board font and shows no counter', async ({ page }) => {
    const note = await createAtCentre(page);
    await openEditor(page, note);
    await page.keyboard.type('short');
    await settle(page);

    const editing = await editorState(page);
    expect(editing!.fontPx).toBe(STICKY_FONT_MAX_PX);
    expect((await counterState(page)).visible).toBe(false);

    await page.keyboard.press('Escape');
    await settle(page);
    const shown = await textState(page, await firstNote(page));
    expect(shown.text).toBe('short');
    expect(shown.fontPx).toBe(STICKY_FONT_MAX_PX);
  });

  test('TC-15, TC-16: text pasted or typed past the limit is clamped to exactly the limit', async ({ page }) => {
    const note = await createAtCentre(page);
    await openEditor(page, note);

    await page.getByTestId('sticky-textarea').fill(OVER_LIMIT);
    await settle(page);
    const editing = await editorState(page);
    expect(editing!.value.length).toBe(STICKY_TEXT_MAX_CHARS);

    const counter = await counterState(page);
    expect(counter.visible).toBe(true);
    expect(counter.text).toBe(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`);

    // Typing more while the note is full changes nothing.
    await page.keyboard.type('abc');
    await settle(page);
    expect((await editorState(page))!.value.length).toBe(STICKY_TEXT_MAX_CHARS);

    await page.keyboard.press('Escape');
    await settle(page);
    const shown = await textState(page, await firstNote(page));
    expect(shown.text.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(shown.text).toBe(OVER_LIMIT.slice(0, STICKY_TEXT_MAX_CHARS));
  });

  test('TC-39: the counter appears only when little of the limit is left', async ({ page }) => {
    const note = await createAtCentre(page);
    await openEditor(page, note);

    await page.getByTestId('sticky-textarea').fill('one short line');
    await settle(page);
    expect((await counterState(page)).visible).toBe(false);

    const below = STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS - 1;
    await page.getByTestId('sticky-textarea').fill('y'.repeat(below));
    await settle(page);
    expect((await counterState(page)).visible).toBe(false);

    const at = STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS;
    await page.getByTestId('sticky-textarea').fill('y'.repeat(at));
    await settle(page);
    const counter = await counterState(page);
    expect(counter.visible).toBe(true);
    expect(counter.text).toBe(`${at}/${STICKY_TEXT_MAX_CHARS}`);

    await page.keyboard.press('Backspace');
    await settle(page);
    expect((await counterState(page)).visible).toBe(false);
  });

  test('TC-40: dragging a note full of text moves it without touching its text or fit', async ({ page }) => {
    const note = await createAtCentre(page);
    await openEditor(page, note);
    await page.getByTestId('sticky-textarea').fill(LONG_TEXT);
    await page.keyboard.press('Escape');
    await settle(page);

    const before = await firstNote(page);
    const beforeText = await textState(page, before);
    const caretWasAt = beforeText.text.length;

    const target = { x: before.centre.x + 260, y: before.centre.y - 180 };
    await dragNoteToScreen(page, before, target);

    const after = await firstNote(page);
    const afterText = await textState(page, after);
    expect(after.box.x - before.box.x).toBeCloseTo(260, 1);
    expect(after.box.y - before.box.y).toBeCloseTo(-180, 1);
    expect(afterText.text).toBe(LONG_TEXT);
    expect(afterText.text.length).toBe(LONG_TEXT.length);
    expect(afterText.fontPx).toBeCloseTo(beforeText.fontPx, 1);
    expect(afterText.scroll).toBeLessThanOrEqual(afterText.client + 1);

    // Reopening keeps the text and puts the caret where the client left it.
    await openEditor(page, after);
    const state = await editorState(page);
    expect(state?.value).toBe(LONG_TEXT);
    expect(state?.caret).toBe(caretWasAt);
  });

  test('the note toolbar counter-scales so zoom does not grow it', async ({ page }) => {
    const note = await createIdleAtCentre(page);
    await selectNote(page, note);
    const small = await page.getByTestId('note-toolbar').boundingBox();
    expect(small).not.toBeNull();

    await clickZoomIn(page);
    await settle(page);
    const large = await page.getByTestId('note-toolbar').boundingBox();
    expect(large).not.toBeNull();
    expect(large!.width).toBeCloseTo(small!.width, 1);
    expect(large!.height).toBeCloseTo(small!.height, 1);
    expect(await zoomLabel(page)).toContain('125%');
  });

  test('the camera, the grid and the notes agree after sticky note work', async ({ page }) => {
    const note = await createIdleAtCentre(page);
    await dragNoteToWorld(page, note, { x: 180, y: 140 });
    const moved = await noteAtWorld(page, { x: 180, y: 140 });
    const screen = await worldToScreen(page, { x: 180, y: 140 });
    expect(moved.centre.x).toBeCloseTo(screen.x, 0);
    expect(moved.centre.y).toBeCloseTo(screen.y, 0);

    await openEditor(page, moved);
    await page.keyboard.type('grid check');
    await page.keyboard.press('Escape');
    await settle(page);
    await clickZoomIn(page);
    await settle(page);
    expect(await zoomLabel(page)).toContain('125%');
    const camera = await currentCamera(page);
    expect(camera.zoom).toBeCloseTo(1.25, 6);
    const again = await noteAtWorld(page, { x: 180, y: 140 });
    expect((await textState(page, again)).text).toBe('grid check');
  });

  test('TC-33: a full 1,000 character note stops at the smallest readable size and fades the clipped edge', async ({ page }) => {
    const created = await createAtCentre(page);
    const note = await noteById(page, created.id);

    // One word: the largest board font.
    await page.keyboard.type('one word');
    await settle(page);
    expect((await editorState(page))?.fontPx).toBe(STICKY_FONT_MAX_PX);
    expect((await textState(page, note)).fontPx).toBe(STICKY_FONT_MAX_PX);

    // Pasting the whole limit: text can no longer fit, so it stops at the
    // minimum size and the note clips the remainder with a fade.
    await page.getByTestId('sticky-textarea').fill('w'.repeat(STICKY_TEXT_MAX_CHARS));
    await settle(page);
    const editing = await editorState(page);
    expect(editing!.value.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(editing!.fontPx).toBe(STICKY_FONT_MIN_PX);
    expect(editing!.scroll).toBeGreaterThan(editing!.client);

    await page.keyboard.press('Escape');
    await settle(page);
    const shown = await textState(page, await noteById(page, created.id));
    expect(shown.text.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(shown.fontPx).toBe(STICKY_FONT_MIN_PX);
    expect(shown.scroll).toBeGreaterThan(shown.client);
    expect(shown.overflow).toBe('hidden');
    expect(shown.className).toContain('sticky-text--fade');
    expect(await noteById(page, created.id)).toBeTruthy();
    await expect(page.getByTestId('sticky-note')).toHaveAttribute('data-overflow', 'true');
    // Nothing escaped the square: the note is still its own size.
    const box = (await noteById(page, created.id)).box;
    const camera = await currentCamera(page);
    expect(box.width).toBeCloseTo(STICKY_SIZE_WORLD * camera.zoom, 1);
  });

  test('TC-34: created from the toolbar after panning far away, the note lands in the middle of the screen', async ({ page }) => {
    for (let round = 0; round < 3; round += 1) {
      await dragBoard(page, { x: 400, y: 400 }, { x: 1240, y: 780 });
      await settle(page);
    }
    const camera = await currentCamera(page);
    expect(Math.abs(camera.x)).toBeGreaterThan(1_000);
    expect(Math.abs(camera.y)).toBeGreaterThan(500);

    const note = await createAtCentre(page);
    const size = await boardSize(page);
    expect(note.centre.x).toBeCloseTo(size.width / 2, 0);
    expect(note.centre.y).toBeCloseTo(size.height / 2, 0);
    await expect(note.el).toBeVisible();
    // ...and it is world-wise far from the origin, exactly where the camera is.
    const world = await screenToWorldPoint(page, note.centre);
    expect(Math.abs(world.x)).toBeGreaterThan(1_000);
  });

  test('golden path: capture, arrange, recolour and discard a set of ideas', async ({ page }) => {
    // Capture where the idea appeared.
    const first = await createAtScreen(page, { x: 380, y: 260 });
    await page.keyboard.type('first idea');
    await page.keyboard.press('Escape');
    await settle(page);

    // Capture the next one from the toolbar and colour it.
    const second = await createAtCentre(page);
    await page.keyboard.type('second idea');
    await page.keyboard.press('Escape');
    await settle(page);
    await page.getByTestId('swatch-blue').click();
    await settle(page);
    expect((await noteState(page, await noteById(page, second.id))).color).toBe(hexToRgb(STICKY_COLORS.blue));

    // Arrange: move the first idea next to the second one.
    const moved = await noteById(page, first.id);
    const target = await noteById(page, second.id);
    await dragNoteToScreen(page, moved, { x: target.centre.x - 260, y: target.centre.y });
    const arranged = await noteById(page, first.id);
    const neighbour = await noteById(page, second.id);
    expect(arranged.centre.x).toBeCloseTo(neighbour.centre.x - 260, 0);
    expect(arranged.centre.y).toBeCloseTo(neighbour.centre.y, 0);
    expect((await textState(page, arranged)).text).toBe('first idea');
    expect((await textState(page, neighbour)).text).toBe('second idea');

    // Edit in place from the keyboard.
    await selectNote(page, neighbour);
    await page.keyboard.press('Enter');
    await settle(page);
    await page.keyboard.type(' (kept)');
    await settle(page);
    await page.keyboard.press('Escape');
    await settle(page);
    expect((await textState(page, await noteById(page, second.id))).text).toBe('second idea (kept)');

    // Discard the first idea.
    await selectNote(page, await noteById(page, first.id));
    await page.keyboard.press('Delete');
    await settle(page);
    expect(await noteCount(page)).toBe(1);
    expect(await page.getByTestId('note-toolbar').count()).toBe(0);
    expect((await textState(page, await noteById(page, second.id))).text).toBe('second idea (kept)');
  });
});
