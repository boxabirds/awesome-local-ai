/**
 * E2E helpers: the origin marker is the board's own pixel target, the zoom
 * label is the zoom readout, and `window.__vidi6` jumps the camera (test builds
 * only) so a test can travel UNBOUNDED_PAN_TESTED_EXTENT units without dragging
 * a million pixels.
 */

import { expect, request as playwrightRequest, type Locator, type Page } from '@playwright/test';
import { BASE_URL } from '../../../playwright.config';
import {
  screenToWorld,
  worldToScreen,
  type Camera,
  type Point,
  type Size
} from '../../../src/client/canvas/camera';
import type { ObjectSnapshot, StickySnapshot } from '../../../src/shared/board-model';
import type { ConnectorSnap } from '../../../src/shared/objects/connector';
import type { ShapeSnap } from '../../../src/shared/objects/shape';
import { UNBOUNDED_PAN_TESTED_EXTENT, ZOOM_MAX } from '../../../src/shared/config';

export const BOARD_SIZE: Size = { width: 1280, height: 800 };
export const BOARD_CENTRE: Point = { x: BOARD_SIZE.width / 2, y: BOARD_SIZE.height / 2 };

/**
 * Make a board the way the app does — `POST /api/boards` — and hand back its id.
 *
 * Story 5 made an address mean "somebody made this", so a test can no longer invent an id and
 * expect a board to be there: it has to ask for one first. `openBoard` and `openSession` both do.
 */
export async function createBoardOn(origin: string = BASE_URL): Promise<string> {
  // Its own request context, pointed at whichever server the caller means; the persistence
  // specs run a server of their own.
  const context = await playwrightRequest.newContext({ baseURL: origin });
  try {
    const response = await context.post('/api/boards');
    if (!response.ok()) {
      throw new Error(`could not create a board (${response.status()})`);
    }
    const body = (await response.json()) as { id?: unknown };
    if (typeof body.id !== 'string') {
      throw new Error('the create response held no board id');
    }
    return body.id;
  } finally {
    await context.dispose();
  }
}

/**
 * The board is on screen, and the world and the screen agree about where it is.
 *
 * The camera starts at the world origin and the viewport's own size arrives a frame later,
 * with the first `ResizeObserver` report. A test that double-clicks inside that gap is clicking
 * at a world point worked out from a viewport of no size at all, and the note lands half a
 * viewport away. Nobody's hand is fast enough to do that; Playwright's mouse is, and story 5
 * widened the gap by mounting the board after a fetch rather than on document load. So "the
 * board is open" now includes the frame in which it found out how big it is.
 */
export async function waitForBoard(page: Page): Promise<void> {
  const viewport = page.locator('[data-vidi6="viewport"]');
  await expect(viewport).toBeVisible();
  await expect
    .poll(
      async () => {
        const camera = await getCamera(page);
        const size = await viewport.evaluate((element) => ({
          width: element.clientWidth,
          height: element.clientHeight
        }));
        return camera.x === -size.width / 2 && camera.y === -size.height / 2
          ? true
          : `camera ${JSON.stringify(camera)} against a ${size.width}x${size.height} viewport`;
      },
      { message: 'the board should be drawn with its camera centred on the viewport' }
    )
    .toBe(true);
}

/**
 * A board of this test's own, open on screen, and its id.
 *
 * Story 5 made the address mean something, so "open a board" is now two steps: ask for one,
 * then go where it is. Every older spec gets its board this way, which is also how the oldest
 * of them (story 1's camera) was always meant to have one.
 */
export async function openBoard(page: Page): Promise<string> {
  const boardId = await createBoardOn();
  await page.goto(`/b/${boardId}`);
  await waitForBoard(page);
  return boardId;
}

export function marker(page: Page) {
  return page.getByTestId('origin-marker');
}

/** Screen-space centre of the board's starting point, in CSS pixels. */
export async function markerCentre(page: Page): Promise<Point> {
  const box = await marker(page).boundingBox();
  if (!box) throw new Error('origin marker has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}


/** The zoom readout, as a locator so assertions auto-wait for the board. */
export function zoomLabel(page: Page) {
  return page.getByTestId('zoom-percent');
}

export async function getCamera(page: Page): Promise<Camera> {
  const camera = await page.evaluate(() => window.__vidi6?.getCamera());
  if (!camera) throw new Error('window.__vidi6 test hook is not available in this build');
  return camera;
}

/**
 * What the board document holds: every note, bottom to top. Reading the document
 * rather than the screen is what makes assertions about stored positions and text
 * exact. (Test builds only, through `window.__vidi6`.)
 */
export async function getBoard(page: Page): Promise<StickySnapshot[]> {
  const notes = await page.evaluate(() => window.__vidi6?.getBoard());
  if (!notes) throw new Error('window.__vidi6 test hook is not available in this build');
  return [...notes];
}

/** Move the camera somewhere directly, then wait for the board to show it. */
export async function setCamera(page: Page, camera: Camera): Promise<void> {
  await page.evaluate((next) => window.__vidi6?.setCamera(next), camera);
  await expect
    .poll(() => getCamera(page), { message: `camera should become ${JSON.stringify(camera)}` })
    .toEqual(camera);
}

/** Pan far away and zoom in, so Reset view has something to undo. */
export async function goToFarAwayMaxZoom(page: Page): Promise<void> {
  await setCamera(page, {
    x: UNBOUNDED_PAN_TESTED_EXTENT,
    y: -UNBOUNDED_PAN_TESTED_EXTENT,
    zoom: ZOOM_MAX
  });
}

/** Drag the board with a real mouse, from one screen point to another. */
export async function dragBoard(page: Page, from: Point, to: Point): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 4;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps
    );
  }
  await page.mouse.up();
}

/** Ctrl/Cmd + wheel (a trackpad pinch) at a screen point. */
export async function pinchAt(page: Page, point: Point, deltaY: number): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
}

/** Computed background geometry of the dot grid. */
export async function gridStyle(page: Page): Promise<{ size: string; position: string }> {
  return page.locator('[data-vidi6="viewport"]').evaluate((el) => {
    const style = getComputedStyle(el);
    return { size: style.backgroundSize, position: style.backgroundPosition };
  });
}

/** How big the zoom control renders — proof the browser page zoom did not change. */
export async function zoomControlBox(page: Page): Promise<{ width: number; height: number }> {
  const box = await page.locator('[data-vidi6="zoom-controls"]').boundingBox();
  if (!box) throw new Error('zoom control has no bounding box');
  return { width: box.width, height: box.height };
}

/** Page-level zoom signals that must never change when the board zooms. */
export async function pageZoomSignals(page: Page): Promise<{ scale: number; dpr: number }> {
  return page.evaluate(() => ({
    scale: window.visualViewport?.scale ?? 1,
    dpr: window.devicePixelRatio
  }));
}

/* ------------------------------------------------------------------ story 2 */

/** The sticky notes on screen, in the order the document draws them. */
export function notes(page: Page): Locator {
  return page.locator('[data-vidi6="sticky"]');
}

/** The nth sticky note. */
export function note(page: Page, index: number): Locator {
  return notes(page).nth(index);
}

/** The text a note shows (not the editor). */
export function noteText(page: Page, index: number): Locator {
  return note(page, index).locator('[data-testid="sticky-text"]');
}

/** The textarea of the note being edited. */
export function stickyInput(page: Page): Locator {
  return page.locator('[data-testid="sticky-input"]');
}

/** The floating toolbar of a note. */
export function noteToolbar(page: Page, index = 0): Locator {
  return note(page, index).locator('[data-vidi6="note-toolbar"]');
}

/** A colour swatch in a note's toolbar. */
export function swatch(page: Page, colour: string, index = 0): Locator {
  return noteToolbar(page, index).locator(`[data-vidi6="note-swatch"][data-color="${colour}"]`);
}

/** The bin button of a note's toolbar. */
export function deleteButton(page: Page, index = 0): Locator {
  return noteToolbar(page, index).locator('[data-vidi6="note-delete"]');
}

/** The left-side tool palette. */
export function stickyToolButton(page: Page): Locator {
  return page.locator('[data-vidi6="tool-sticky"]');
}

/** Double-click empty board space, which creates a note centred there. */
export async function doubleClickBoard(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.dblclick(x, y);
}

/** Press, move in steps and release, as a drag of the mouse does. */
export async function dragByMouse(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 10
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * step) / steps,
      from.y + ((to.y - from.y) * step) / steps
    );
  }
  await page.mouse.up();
}

/** Drag a note by its centre by a screen delta. */
export async function dragNote(
  page: Page,
  index: number,
  deltaX: number,
  deltaY: number
): Promise<void> {
  const box = await note(page, index).boundingBox();
  if (!box) throw new Error('note has no box to grab');
  await dragByMouse(
    page,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    { x: box.x + box.width / 2 + deltaX, y: box.y + box.height / 2 + deltaY }
  );
}

/** A rendered length in CSS pixels, e.g. the font size of a note's text. */
export async function cssPixels(
  page: Page,
  selector: string,
  property: string
): Promise<number> {
  const value = await page.locator(selector).first().evaluate((element, name) => {
    const declared = getComputedStyle(element)[name as keyof CSSStyleDeclaration];
    // jsdom-free browsers always resolve lengths to px.
    return String(declared);
  }, property);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${property} of ${selector} is not a length: ${value}`);
  }
  return parsed;
}

/** The character counter of the note being edited, or null. */
export function counter(page: Page): Locator {
  return page.locator('[data-testid="sticky-counter"]');
}

/* ------------------------------------------------------------------ story 7 */

/**
 * Story 7 helpers: the selection, its box, its handles and its bar.
 *
 * These speak `[data-object-id]` rather than `[data-note-id]` on purpose. A selection is
 * not a sticky-note thing — story 9 will put its own type in one — so the e2e layer is kept
 * as type-blind as the code it drives.
 */

/** Every object on screen, whatever type it is, bottom to top. */
export function objects(page: Page): Locator {
  return page.locator('[data-object-id]');
}

/** The objects the board says are selected. */
export function selectedObjects(page: Page): Locator {
  return page.locator('[data-object-id][data-selected="true"]');
}

/** How many objects are selected, as the screen shows it. */
export async function selectedCount(page: Page): Promise<number> {
  return selectedObjects(page).count();
}

/** The bar that appears above a selection of two or more. */
export function selectionBar(page: Page): Locator {
  return page.locator('[data-vidi6="selection-bar"]');
}

/** What the bar says how many are selected. */
export function selectionCountLabel(page: Page): Locator {
  return page.locator('[data-testid="selection-count"]');
}

/** The polite live region that announces the count. */
export function selectionLive(page: Page): Locator {
  return page.locator('[data-testid="selection-live"]');
}

/** The bar's bin. */
export function selectionDeleteButton(page: Page): Locator {
  return page.locator('[data-vidi6="selection-delete"]');
}

/** One resize handle of the selection's box, by placement (`se`, `e`, …). */
export function resizeHandle(page: Page, placement: string): Locator {
  return page.locator(`[data-vidi6="resize-handle"][data-handle="${placement}"]`);
}

/** The box being dragged out with Shift, or nothing when there is none. */
export function marqueeBox(page: Page): Locator {
  return page.locator('[data-vidi6="marquee"]');
}

/** The world point a screen point stands for, on the page as it is now. */
export async function worldOf(page: Page, screen: Point): Promise<Point> {
  return screenToWorld(await getCamera(page), screen);
}

/** The screen point a world point is drawn at, on the page as it is now. */
export async function screenOf(page: Page, world: Point): Promise<Point> {
  return worldToScreen(await getCamera(page), world);
}

/** The middle of one object, in screen pixels, as drawn. */
export async function objectCentreOnScreen(page: Page, objectId: string): Promise<Point> {
  const box = await page.locator(`[data-object-id="${objectId}"]`).boundingBox();
  if (!box) throw new Error(`object ${objectId} is not on screen`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Press, move in steps and release with a key held down the whole time. */
export async function dragWithKey(
  page: Page,
  from: Point,
  to: Point,
  key: 'Shift' | 'Control' | 'Meta' = 'Shift',
  steps = 10
): Promise<void> {
  await page.keyboard.down(key);
  try {
    await dragByMouse(page, from, to, steps);
  } finally {
    await page.keyboard.up(key);
  }
}

/** Drag a resize handle of the current selection by a screen delta. */
export async function dragResizeHandleBy(
  page: Page,
  placement: string,
  deltaX: number,
  deltaY: number
): Promise<void> {
  const handle = resizeHandle(page, placement);
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  if (!box) throw new Error(`the ${placement} resize handle has no box to grab`);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await dragByMouse(page, from, { x: from.x + deltaX, y: from.y + deltaY });
}

/** Select everything on the board the way the keyboard does. */
export async function selectAllWithKeyboard(page: Page): Promise<void> {
  await page.keyboard.press('Control+a');
}

/** Click one object, optionally adding it to the selection instead of replacing. */
export async function clickObject(page: Page, objectId: string, additive = false): Promise<void> {
  const centre = await objectCentreOnScreen(page, objectId);
  if (additive) await page.keyboard.down('Shift');
  try {
    await page.mouse.click(centre.x, centre.y);
  } finally {
    if (additive) await page.keyboard.up('Shift');
  }
}

/** The whole board as one comparable string: id, place, size and layer, bottom to top. */
export async function boardShape(page: Page): Promise<string> {
  const stored = await getBoard(page);
  return JSON.stringify(
    stored.map((note) => [
      note.id,
      round6(note.x),
      round6(note.y),
      round6(note.width ?? 0),
      round6(note.height ?? 0),
      note.z
    ])
  );
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Story 9: the tool palette, and free text.
 *
 * The palette is no longer one button that makes a note: it says which tool the board is
 * in, and a test needs to be able to read that back rather than infer it from whether a
 * text appeared. The text locators mirror the note ones, and the same rule applies — an
 * assertion about *stored* state goes through `boardObjects`, one about the screen through
 * these.
 */

/** One of the palette's tools, by name. */
export function toolButton(page: Page, name: 'select' | 'sticky' | 'text' | 'shape' | 'connector'): Locator {
  return page.locator(`[data-vidi6="tool-${name}"]`);
}

/** Which tool the palette says is lit, or null when none is. */
export async function pressedTool(page: Page): Promise<string | null> {
  for (const name of ['select', 'sticky', 'text', 'shape', 'connector'] as const) {
    const pressed = await toolButton(page, name).getAttribute('aria-pressed');
    if (pressed === 'true') return name;
  }
  return null;
}

/** What tool the board itself says it is in. */
export function toolMode(page: Page): Promise<string | null> {
  return page.locator('[data-vidi6="viewport"]').getAttribute('data-tool');
}

/** Every object the document holds, of whatever type, bottom to top. */
export async function boardObjects(page: Page): Promise<ObjectSnapshot[]> {
  const held = await page.evaluate(() => window.__vidi6?.getObjects());
  if (!held) throw new Error('window.__vidi6 test hook is not available in this build');
  return [...held];
}

/** Every free text on screen, bottom to top. */
export function textElements(page: Page): Locator {
  return page.locator('[data-object-type="text"]');
}

/** One free text on screen. */
export function textElement(page: Page, index = 0): Locator {
  return textElements(page).nth(index);
}

/** The words a free text shows, as the browser renders them. */
export function textWords(page: Page, index = 0): Locator {
  return textElement(page, index).locator('[data-testid="text-content"]');
}

/** The textarea of the text being typed right now. */
export function textEditor(page: Page): Locator {
  return page.locator('[data-testid="text-input"]');
}

/** The character counter a long text shows (`text.limit`). */
export function textCounter(page: Page): Locator {
  return page.locator('[data-testid="text-input-counter"]');
}

/** The size toolbar of one free text. */
export function textToolbar(page: Page, index = 0): Locator {
  return textElement(page, index).locator('[data-vidi6="text-toolbar"]');
}

/** One size button of one free text. */
export function textSizeButton(page: Page, size: string, index = 0): Locator {
  return textToolbar(page, index).locator(`[data-vidi6="text-size"][data-size="${size}"]`);
}

/** The bin of one free text's toolbar. */
export function textDeleteButton(page: Page, index = 0): Locator {
  return textToolbar(page, index).locator('[data-vidi6="text-delete"]');
}

/**
 * Press T and click where the top-left of the new text should go, and hand back the id of
 * the text this page is now writing.
 *
 * The id comes from the editor itself rather than from "how many texts are on the board
 * now", because on a board other people are using, the number goes up for reasons that have
 * nothing to do with this click.
 */
export async function placeTextAt(page: Page, screen: Point): Promise<string> {
  await page.keyboard.press('t');
  expect(await toolMode(page)).toBe('text');
  await page.mouse.click(screen.x, screen.y);
  await expect(textEditor(page)).toBeVisible();
  const id = await textEditor(page).evaluate((element) =>
    element.closest('[data-object-id]')?.getAttribute('data-object-id')
  );
  if (typeof id !== 'string' || id === '') throw new Error('the editor is not inside a text object');
  return id;
}

/**
 * Story 10: shapes, and the arrows that follow what they are tied to.
 *
 * A shape and an arrow are both made by dragging a tool across the board, so the helpers do
 * exactly that with a real mouse, and hand back the object that appeared. They find it by
 * comparing what the document held before with what it holds after, rather than by counting:
 * on a board two people are using, the count goes up for reasons this test did not cause.
 */

/** Every shape on screen, bottom to top. */
export function shapeElements(page: Page): Locator {
  return page.locator('[data-object-type="shape"]');
}

/** The shape with a given id. */
export function shapeElement(page: Page, id: string): Locator {
  return page.locator(`[data-vidi6="shape"][data-object-id="${id}"]`);
}

/** Every arrow on screen. */
export function connectorElements(page: Page): Locator {
  return page.locator('[data-vidi6="connector"]');
}

/** The one arrow with this id, as it is drawn. */
export function connectorElement(page: Page, id: string): Locator {
  return page.locator(`[data-vidi6="connector"][data-object-id="${id}"]`);
}

/** The side dots the Connector tool offers for the object under the pointer. */
export function connectorDots(page: Page): Locator {
  return page.locator('[data-vidi6="connector-dot"]');
}

/** The Connector tool's preview of the arrow being dragged. */
export function connectorPreview(page: Page): Locator {
  return page.locator('[data-testid="connector-preview"]');
}

/** One end handle of a selected arrow. */
export function connectorEndHandle(page: Page, end: 'from' | 'to'): Locator {
  return page.locator(`[data-vidi6="connector-end"][data-end="${end}"]`);
}

/** The kind of shape the Shape tool will draw. */
export async function currentShapeKind(page: Page): Promise<string | null> {
  return toolButton(page, 'shape').getAttribute('data-kind');
}

/** Choose which shape the Shape tool draws, and hold the tool. */
export async function chooseShapeKind(page: Page, kind: 'rect' | 'ellipse' | 'diamond'): Promise<void> {
  await toolButton(page, 'shape').click();
  await shapeKindButton(page).click();
  await page.locator(`[data-vidi6="shape-kind"][data-kind="${kind}"]`).click();
  expect(await currentShapeKind(page)).toBe(kind);
  expect(await toolMode(page)).toBe('shape');
}

function shapeKindButton(page: Page): Locator {
  return page.locator('[data-vidi6="tool-shape-kind"]');
}

/** The one object of `type` that was not on the board a moment ago. */
async function appeared<T extends ObjectSnapshot>(
  page: Page,
  type: string,
  before: readonly string[]
): Promise<T> {
  await expect
    .poll(async () => (await freshOf(page, type, before)).length, {
      message: `exactly one new ${type} should appear`
    })
    .toBe(1);
  const found = await freshOf(page, type, before);
  if (found.length !== 1) throw new Error(`expected one new ${type}, found ${found.length}`);
  return found[0] as T;
}

function freshOf(page: Page, type: string, before: readonly string[]): Promise<ObjectSnapshot[]> {
  return boardObjects(page).then((held) => held.filter((o) => o.type === type && !before.includes(o.id)));
}

/** Press S and click once: the standard shape, centred where it was clicked. */
export async function drawShapeByClick(page: Page, world: Point): Promise<ShapeSnap> {
  const before = (await boardObjects(page)).map((object) => object.id);
  // The kind is chosen beside the tool, which already puts the tool in hand; pressing S again
  // would only be a second thought.
  if ((await toolMode(page)) !== 'shape') await page.keyboard.press('s');
  expect(await toolMode(page)).toBe('shape');
  const at = await screenOf(page, world);
  await page.mouse.click(at.x, at.y);
  return appeared<ShapeSnap>(page, 'shape', before);
}

/** Press L and drag from one board point to another: the arrow between them. */
export async function drawArrowByDrag(page: Page, fromWorld: Point, toWorld: Point): Promise<ConnectorSnap> {
  const before = (await boardObjects(page)).map((object) => object.id);
  await page.keyboard.press('l');
  expect(await toolMode(page)).toBe('connector');
  await dragByMouse(page, await screenOf(page, fromWorld), await screenOf(page, toWorld));
  return appeared<ConnectorSnap>(page, 'connector', before);
}

/** The shapes the document holds, bottom to top. */
export async function shapesOn(page: Page): Promise<ShapeSnap[]> {
  return (await boardObjects(page)).filter((object) => object.type === 'shape') as ShapeSnap[];
}

/** The arrows the document holds. */
export async function arrowsOn(page: Page): Promise<ConnectorSnap[]> {
  return (await boardObjects(page)).filter((object) => object.type === 'connector') as ConnectorSnap[];
}

/** The arrow with a given id, as this page holds it now. */
export async function arrowOn(page: Page, id: string): Promise<ConnectorSnap> {
  const found = (await arrowsOn(page)).find((arrow) => arrow.id === id);
  if (!found) throw new Error(`arrow ${id} is not on this page's board`);
  return found;
}

/** Where an arrow's two ends are drawn, in screen pixels. */
/**
 * Where an arrow is drawn, as the browser laid it out. Compared against the two ends the model
 * resolved, this is the check that a screen is drawing the arrow it holds rather than the one it
 * drew a moment ago: the group's box runs from one end to the other, through the camera.
 */
export async function arrowBoxOnScreen(page: Page, id: string): Promise<Box> {
  const box = await connectorElement(page, id).boundingBox();
  if (!box) throw new Error(`arrow ${id} is not drawn on this page`);
  return box;
}

/** A shape's box on the screen, and the middle of its label, both in CSS pixels. */
export async function shapeLabelBox(page: Page, id: string): Promise<{ shape: Box; label: Box; words: string }> {
  const element = shapeElement(page, id);
  const shape = await element.boundingBox();
  const label = element.locator('[data-testid="shape-label"]');
  const box = await label.boundingBox();
  const words = (await label.innerText()).trim();
  if (!shape || !box) throw new Error(`shape ${id} is not drawn with a label`);
  return { shape, label: box, words };
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
