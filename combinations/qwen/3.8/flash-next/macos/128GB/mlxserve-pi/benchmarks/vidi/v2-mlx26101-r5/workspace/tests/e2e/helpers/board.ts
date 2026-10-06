import { expect, type Locator, type Page } from '@playwright/test';

import {
  GRID_SPACING_WORLD,
  UNBOUNDED_PAN_TESTED_EXTENT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_FACTOR,
} from '../../../src/shared/config';
import { boardAddress, createBoard } from './boards';

export type Camera = { x: number; y: number; zoom: number };

/** Viewport size configured in playwright.config.ts. */
export const VIEWPORT = { width: 1280, height: 800 };
/** Pixel tolerance used by the PRD's "within 1 pixel" requirements. */
export const PIXEL_TOLERANCE = 1;
/** World-unit tolerance for far-away precision. */
export const WORLD_TOLERANCE = 1e-6;
export const FAR = UNBOUNDED_PAN_TESTED_EXTENT;
export const STEP = ZOOM_STEP_FACTOR;
export const MIN_ZOOM = ZOOM_MIN;
export const MAX_ZOOM = ZOOM_MAX;
export const GRID = GRID_SPACING_WORLD;
export const HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

export const board = (page: Page): Locator => page.getByTestId('board-viewport');
export const originMarker = (page: Page): Locator => page.getByTestId('origin-marker');
export const zoomLabel = (page: Page): Locator => page.getByTestId('zoom-label');
export const zoomInButton = (page: Page): Locator => page.getByRole('button', { name: 'Zoom in' });
export const zoomOutButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Zoom out' });
export const resetButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Reset view' });
export const hint = (page: Page): Locator => page.getByTestId('navigation-hint');

/**
 * Loads a board of this test's own and waits for the starting point to be centred.
 *
 * Since story 5 the board is reached through a link the service issued, so the test asks for a
 * board first — the same `POST /api/boards` the home page makes — and opens the address that comes
 * back. What this helper is *about* is the camera, and that is unchanged: a board made through the
 * API starts at the same starting point as the board that used to be there for the asking.
 */
export async function openBoard(page: Page): Promise<void> {
  const boardId = await createBoard();
  await page.goto(boardAddress(boardId));
  await expect(zoomLabel(page)).toHaveText('100%');
  await expectCamera(page, {
    x: -VIEWPORT.width / 2,
    y: -VIEWPORT.height / 2,
    zoom: 1,
  });
}

/** The camera as rendered in the DOM. */
export function readCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="board-viewport"]') as HTMLElement;
    return {
      x: Number(el.dataset['cameraX']),
      y: Number(el.dataset['cameraY']),
      zoom: Number(el.dataset['cameraZoom']),
    };
  });
}

/** Waits for the camera rendered in the DOM to reach the expected values. */
export async function expectCamera(page: Page, expected: Partial<Camera>): Promise<void> {
  const match: Record<string, unknown> = {};
  if (expected.x !== undefined) match['x'] = expect.closeTo(expected.x, 5);
  if (expected.y !== undefined) match['y'] = expect.closeTo(expected.y, 5);
  if (expected.zoom !== undefined) match['zoom'] = expect.closeTo(expected.zoom, 5);
  await expect
    .poll(() => readCamera(page), { message: `waiting for camera ${JSON.stringify(expected)}` })
    .toMatchObject(match);
}

/** Centre of the crosshair that marks the board's starting point (world 0,0). */
export async function markerCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await originMarker(page).boundingBox();
  if (!box) throw new Error('origin marker is not rendered');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Grid cell size in screen pixels, from the board's computed background. */
export function gridSpacingPx(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="board-viewport"]') as HTMLElement;
    const [width] = getComputedStyle(el).backgroundSize.split(' ');
    return Number.parseFloat(width ?? 'NaN');
  });
}

/** Grid background offset in screen pixels. */
export function gridOffsetPx(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="board-viewport"]') as HTMLElement;
    const [x, y] = getComputedStyle(el).backgroundPosition.split(' ');
    return { x: Number.parseFloat(x ?? 'NaN'), y: Number.parseFloat(y ?? 'NaN') };
  });
}

/** Camera delta the board applied for a drag of (dx, dy) screen pixels. */
export async function dragAndSettle(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
): Promise<Camera> {
  const before = await readCamera(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => readCamera(page), { message: 'waiting for the drag to pan the board' })
    .toMatchObject({
      x: expect.closeTo(before.x - dx / before.zoom, 5),
      y: expect.closeTo(before.y - dy / before.zoom, 5),
      zoom: expect.closeTo(before.zoom, 5),
    });
  return readCamera(page);
}

/** Scrolls (or pinches with Ctrl/Cmd held) over a screen point. */
export async function wheelAt(
  page: Page,
  point: { x: number; y: number },
  deltaY: number,
  options: { ctrlKey?: boolean; deltaX?: number } = {},
): Promise<void> {
  await page.mouse.move(point.x, point.y);
  if (options.ctrlKey) await page.keyboard.down('Control');
  await page.mouse.wheel(options.deltaX ?? 0, deltaY);
  if (options.ctrlKey) await page.keyboard.up('Control');
}

/** Jumps the camera somewhere else with the test-only window hook, and waits for the DOM to catch up. */
export async function setCamera(page: Page, patch: Partial<Camera>): Promise<void> {
  const available = await page.evaluate(() => typeof window.__vidi6?.setCamera === 'function');
  if (!available) throw new Error('window.__vidi6 test hook is missing from this build');
  await page.evaluate((value) => window.__vidi6?.setCamera(value), patch);
  // The patch is applied through React state, so the rendered camera lands one frame later.
  await expectCamera(page, patch);
}

/** Clicks a zoom button until it is disabled, collecting the labels seen. */
export async function zoomToLimit(page: Page, dir: 'in' | 'out'): Promise<string[]> {
  const button = dir === 'in' ? zoomInButton(page) : zoomOutButton(page);
  const labels: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    if (!(await button.isEnabled())) break;
    const previous = await zoomLabel(page).textContent();
    await button.click();
    await expect
      .poll(async () => zoomLabel(page).textContent(), { message: 'waiting for the label' })
      .not.toBe(previous);
    labels.push((await zoomLabel(page).textContent()) ?? '');
  }
  return labels;
}

/** The board's page-zoom signals: they must never change. */
export function pageZoomSignals(page: Page): Promise<{ scale: number; dpr: number }> {
  return page.evaluate(() => ({
    scale: window.visualViewport?.scale ?? 1,
    dpr: window.devicePixelRatio,
  }));
}

/** Grid offset the board should show for a camera position. */
export const gridOffsetFor = (value: number, spacing: number): number =>
  Number((((value % spacing) + spacing) % spacing).toFixed(6));

/* ------------------------------------------------------------------ story 2: sticky notes */

/** The note's locator. */
export const note = (page: Page, id: string): Locator => page.locator(`[data-note-id="${id}"]`);

/** The read-only text layer inside a note. */
export const noteTextLocator = (page: Page, id: string): Locator =>
  note(page, id).locator('.sticky-text');

/** The textarea of the note being edited (there is at most one). */
export const editorLocator = (page: Page): Locator => page.locator('.sticky-editor');

/** Ids of every rendered note, in document (stacking) order. */
export function noteIds(page: Page): Promise<string[]> {
  return page
    .locator('.sticky-note')
    .evaluateAll((els) => els.map((el) => el.dataset['noteId'] ?? ''));
}

/** Waits for exactly `count` notes and returns their ids in stacking order. */
export async function expectNoteCount(page: Page, count: number): Promise<string[]> {
  await expect(page.locator('.sticky-note')).toHaveCount(count);
  return noteIds(page);
}

/** The note's numbers as the document holds them, in world units. */
export function noteWorld(page: Page, id: string): Promise<{ x: number; y: number; z: number }> {
  return note(page, id).evaluate((el) => ({
    x: Number(el.dataset['x']),
    y: Number(el.dataset['y']),
    z: Number(el.dataset['z']),
  }));
}

/** The note's colour, as rendered. */
export function noteColor(page: Page, id: string): Promise<string> {
  return note(page, id).evaluate((el) => el.dataset['color'] ?? '');
}

/** The note's interaction state: unselected, pressed, dragging, selected, editing. */
export function noteInteraction(page: Page, id: string): Promise<string> {
  return note(page, id).evaluate((el) => el.dataset['interaction'] ?? 'unselected');
}

/** The note's box on screen, in screen pixels. */
export async function noteScreenBox(
  page: Page,
  id: string,
): Promise<{ x: number; y: number; width: number; height: number; cx: number; cy: number }> {
  const box = await note(page, id).boundingBox();
  if (!box) throw new Error(`note ${id} is not on screen`);
  return { ...box, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

/** Text of the note's read-only text layer (empty while it is being edited). */
export async function noteText(page: Page, id: string): Promise<string> {
  const el = noteTextLocator(page, id);
  if ((await el.count()) === 0) return '';
  return (await el.textContent()) ?? '';
}

/** What the editor holds. */
export function editorValue(page: Page): Promise<string> {
  return editorLocator(page).inputValue();
}

/** Computed font size in px of the note's text layer, or of the editor while editing. */
export async function noteFontPx(page: Page, id: string): Promise<number> {
  const editing = (await note(page, id).locator('.sticky-editor').count()) > 0;
  const selector = editing ? '.sticky-editor' : '.sticky-text';
  const size = await note(page, id)
    .locator(selector)
    .evaluate((el) => getComputedStyle(el).fontSize);
  return Number.parseFloat(size);
}

/** Screen position of the point grabbed on a note, i.e. where the pointer is on it. */
export async function grabPointOf(
  page: Page,
  id: string,
  world: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  const camera = await readCamera(page);
  const box = await noteScreenBox(page, id);
  return {
    x: box.x + (world.x - camera.x) * camera.zoom,
    y: box.y + (world.y - camera.y) * camera.zoom,
  };
}

/** Double-clicks empty board space and returns the id of the note that appeared. */
export async function doubleClickCreate(page: Page, x: number, y: number): Promise<string> {
  const before = await noteIds(page);
  await page.mouse.dblclick(x, y);
  await editorLocator(page).waitFor({ state: 'visible' });
  const added = (await noteIds(page)).filter((id) => !before.includes(id));
  expect(added).toHaveLength(1);
  const id = added[0];
  if (!id) throw new Error('no note was created');
  return id;
}

/** Clicks the toolbar's Sticky note button and returns the new note's id. */
export async function toolbarCreate(page: Page): Promise<string> {
  const before = await noteIds(page);
  await page.getByTestId('create-sticky').click();
  await editorLocator(page).waitFor({ state: 'visible' });
  const added = (await noteIds(page)).filter((id) => !before.includes(id));
  expect(added).toHaveLength(1);
  const id = added[0];
  if (!id) throw new Error('no note was created');
  return id;
}

/** Presses and releases on a note's centre without moving: a click. */
export async function clickNote(page: Page, id: string): Promise<void> {
  const box = await noteScreenBox(page, id);
  await page.mouse.move(box.cx, box.cy);
  await page.mouse.down();
  await page.mouse.up();
}

/** Presses on a note's centre, moves by (dx, dy) and leaves the button down. */
export async function pressNoteAndMove(
  page: Page,
  id: string,
  dx: number,
  dy: number,
): Promise<void> {
  const box = await noteScreenBox(page, id);
  await page.mouse.move(box.cx, box.cy);
  await page.mouse.down();
  await page.mouse.move(box.cx + dx, box.cy + dy, { steps: 5 });
}

/** Drags a note from its centre by (dx, dy) screen pixels and releases. */
export async function dragNote(page: Page, id: string, dx: number, dy: number): Promise<void> {
  await pressNoteAndMove(page, id, dx, dy);
  await page.mouse.up();
}

/** Waits until a note's world position stops changing, then returns it. */
export async function waitForNoteAtRest(
  page: Page,
  id: string,
): Promise<{ x: number; y: number; z: number }> {
  let last = await noteWorld(page, id);
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await page.waitForTimeout(20);
    const next = await noteWorld(page, id);
    if (next.x === last.x && next.y === last.y && next.z === last.z) return next;
    last = next;
  }
  return last;
}

/** Waits for the note's world position to reach the expected numbers. */
export async function expectNoteWorld(
  page: Page,
  id: string,
  expected: { x: number; y: number },
  precision = 5,
): Promise<void> {
  await expect
    .poll(() => noteWorld(page, id), { message: `waiting for note ${id} to land` })
    .toMatchObject({
      x: expect.closeTo(expected.x, precision),
      y: expect.closeTo(expected.y, precision),
    });
}

/** Whether a test id is in the page. */
export async function hasTestId(page: Page, testId: string): Promise<boolean> {
  return (await page.getByTestId(testId).count()) > 0;
}

/** Lets the browser finish layout and font loading. */
export async function settled(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(80);
}

/* ------------------------------------------------------------------ story 4: coming back to a board */

/** Everything the board is, as one page sees it: notes in stacking order, with what is on them. */
export interface NoteState {
  /** The note's identity, which the board keeps across a restart. */
  id: string;
  text: string;
  color: string;
  x: number;
  y: number;
  z: number;
}

/**
 * Every note as the page holds it, in the order the document holds them.
 *
 * One read of the DOM rather than four per note, because story 4's cases compare a board with
 * itself after the server that had it has been thrown away and built again — and a comparison
 * that takes a hundred round trips to make is a comparison that starts being timed out instead
 * of being passed.
 */
export function noteStates(page: Page): Promise<NoteState[]> {
  return page.locator('.sticky-note').evaluateAll((els) =>
    els.map((el) => ({
      id: el.dataset['noteId'] ?? '',
      text: el.querySelector('.sticky-text')?.textContent ?? '',
      color: el.dataset['color'] ?? '',
      x: Number(el.dataset['x']),
      y: Number(el.dataset['y']),
      z: Number(el.dataset['z']),
    })),
  );
}

/**
 * Creates `count` notes through the interface — a double-click, a typed line, a colour — laid
 * out in a grid so that no two of them are alike.
 *
 * Varied is the point. A board of identical notes is a board that a load which stopped halfway
 * through could return and nobody could tell from a count alone.
 *
 * Returns what the board holds when it is done, which is what the same board is expected to
 * hold after the server that had it has been thrown away and built again.
 */
export async function createNotesOnAGrid(
  page: Page,
  count: number,
  colors: readonly string[],
): Promise<NoteState[]> {
  const columns = 5;
  for (let index = 0; index < count; index += 1) {
    const x = 180 + (index % columns) * 200;
    const y = 140 + Math.floor(index / columns) * 130;
    const id = await doubleClickCreate(page, x, y);
    await page.keyboard.type(`Note ${index + 1}`);
    await closeEditor(page);
    const color = colors[index % colors.length];
    if (color) {
      await clickNote(page, id);
      await page.getByTestId(`color-${color}`).click();
    }
  }
  await settled(page);
  return noteStates(page);
}

/** Leaves editing, and waits until the editor is gone. */
async function closeEditor(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(editorLocator(page), 'waiting for the editor to close').toHaveCount(0);
}
