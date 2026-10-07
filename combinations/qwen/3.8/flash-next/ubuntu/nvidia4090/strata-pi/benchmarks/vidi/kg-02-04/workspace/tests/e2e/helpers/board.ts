import { expect, type Page } from "@playwright/test";
import { GRID_SPACING_WORLD } from "../../../src/shared/config";
import type { Camera } from "../../../src/client/canvas/camera";

export interface GridMetrics {
  /** Spacing between dot-grid dots in CSS pixels. */
  spacing: number;
  /** Screen x of the first tile origin (dot centres are at offsetX + spacing/2 + k*spacing). */
  offsetX: number;
  offsetY: number;
}

export interface XY {
  x: number;
  y: number;
}

export async function openBoard(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("board-viewport")).toBeVisible();
  // Wait for the test hook so tests can never race the app boot.
  await expect
    .poll(async () => page.evaluate(() => typeof window.__vidi6?.getCamera === "function"))
    .toBe(true);
}

export function boardArea(page: Page) {
  return page.getByTestId("board-viewport");
}

export async function boardBox(page: Page) {
  const box = await boardArea(page).boundingBox();
  if (!box) throw new Error("board area has no bounding box");
  return box;
}

export async function boardCentre(page: Page): Promise<XY> {
  const box = await boardBox(page);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function readCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => {
    if (!window.__vidi6) throw new Error("__vidi6 test hook is missing");
    return window.__vidi6.getCamera();
  });
}

/**
 * The camera as it is currently *rendered*: the world layer transform and the
 * dot-grid spacing. Camera state can lead the paint by one animation frame,
 * so pixel assertions must use this, not `readCamera`.
 */
export async function renderedCamera(page: Page): Promise<Camera> {
  const raw = await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>("[data-testid='board-grid']");
    const world = document.querySelector<HTMLElement>("[data-testid='board-world']");
    if (!grid || !world) throw new Error("board elements are missing");
    const style = window.getComputedStyle(grid);
    return {
      size: style.backgroundSize,
      transform: world.style.transform,
      computed: window.getComputedStyle(world).transform,
    };
  });

  const spacing = numbers(raw.size)[0] ?? 0;
  // Browsers serialise the inline transform slightly differently (Firefox
  // shortens translate(0px, 0px) to translate(0px)), so fall back to the
  // computed matrix.
  const scaleMatch = /scale\(([^)]*)\)/.exec(raw.transform);
  const translateMatch = /translate\(([^)]*)\)/.exec(raw.transform);
  let zoom: number;
  let tx: number;
  let ty: number;
  if (scaleMatch) {
    zoom = numbers(scaleMatch[1])[0] ?? 0;
    const parts = translateMatch ? numbers(translateMatch[1]) : [];
    tx = parts[0] ?? 0;
    ty = parts[1] ?? parts[0] ?? 0;
  } else {
    const matrix = /matrix\(([^)]*)\)/.exec(raw.computed);
    if (!matrix) throw new Error(`unexpected world transform: "${raw.transform}"`);
    const values = numbers(matrix[1]);
    zoom = values[0] ?? 0;
    tx = (values[4] ?? 0) / zoom;
    ty = (values[5] ?? 0) / zoom;
  }

  // The grid spacing is always GRID_SPACING_WORLD * zoom (computed styles are
  // rounded, hence the tolerance).
  if (Math.abs(spacing - GRID_SPACING_WORLD * zoom) > 1e-2) {
    throw new Error(`grid spacing ${spacing} does not match zoom ${zoom}`);
  }
  return { x: -tx, y: -ty, zoom };
}

/** Waits until the rendered board matches the camera state. */
export async function waitForRenderedBoard(page: Page) {
  await expect
    .poll(
      async () => {
        const state = await readCamera(page);
        const rendered = await renderedCamera(page);
        return Math.abs(state.x - rendered.x) + Math.abs(state.y - rendered.y) + Math.abs(state.zoom - rendered.zoom);
      },
      { timeout: 5000 },
    )
    .toBeLessThan(1e-3);
}

export async function setCamera(page: Page, camera: { x: number; y: number; zoom: number }) {
  await page.evaluate((value) => {
    if (!window.__vidi6) throw new Error("__vidi6 test hook is missing");
    window.__vidi6.setCamera(value);
  }, camera);
  await expect
    .poll(async () => {
      const cam = await readCamera(page);
      return [cam.x, cam.y, cam.zoom];
    })
    .toEqual([camera.x, camera.y, camera.zoom]);
  await waitForRenderedBoard(page);
}

export async function zoomLabel(page: Page): Promise<number> {
  const text = await page.getByTestId("zoom-label").textContent();
  return Number(String(text).replace("%", ""));
}

export async function originMarkerCentre(page: Page): Promise<XY> {
  const box = await page.getByTestId("origin-marker").boundingBox();
  if (!box) throw new Error("origin marker has no bounding box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function gridMetrics(page: Page): Promise<GridMetrics> {
  const raw = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("[data-testid='board-grid']");
    if (!el) throw new Error("board grid element is missing");
    const style = window.getComputedStyle(el);
    return { size: style.backgroundSize, position: style.backgroundPosition };
  });

  const sizes = numbers(raw.size);
  const positions = numbers(raw.position);
  if (sizes.length < 1 || positions.length < 2) {
    throw new Error(`unexpected grid style: ${JSON.stringify(raw)}`);
  }
  return { spacing: sizes[0], offsetX: positions[0], offsetY: positions[1] };
}

/** Centre of the dot-grid dot nearest to (x, y). */
export function nearestDot(metrics: GridMetrics, x: number, y: number): XY {
  const half = metrics.spacing / 2;
  const snap = (value: number, offset: number) => {
    const relative = value - offset - half;
    const k = Math.round(relative / metrics.spacing);
    return offset + half + k * metrics.spacing;
  };
  return { x: snap(x, metrics.offsetX), y: snap(y, metrics.offsetY) };
}

/** Distance from (x, y) to the centre of the nearest dot-grid dot. */
export function distanceToNearestDot(metrics: GridMetrics, x: number, y: number): XY {
  const dot = nearestDot(metrics, x, y);
  return { x: Math.abs(dot.x - x), y: Math.abs(dot.y - y) };
}

/** The offset a pan of (dx, dy) screen pixels should produce in the grid. */
export function expectedGridOffset(offset: number, delta: number, spacing: number): number {
  return ((offset + delta) % spacing + spacing) % spacing;
}

export async function dragBoard(page: Page, from: XY, dx: number, dy: number, steps = 5) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
  }
  await page.mouse.up();
  await waitForRenderedBoard(page);
}

export async function ctrlWheel(page: Page, at: XY, deltaY: number) {
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up("Control");
  await waitForRenderedBoard(page);
}

export async function pageZoomState(page: Page) {
  return page.evaluate(() => ({
    scale: window.visualViewport ? window.visualViewport.scale : 1,
    devicePixelRatio: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  }));
}

function numbers(css: string): number[] {
  return (css.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g) ?? []).map(Number);
}

// ---- story 2: sticky notes -------------------------------------------------

/** A note as the board document holds it. */
export interface NoteState {
  id: string;
  type: string;
  x: number;
  y: number;
  color: string;
  text: string;
  z: number;
}

/**
 * The board document, read through the test-only `window.__vidi6Board` hook:
 * assertions are about what was actually stored, not about what the DOM shows.
 */
export async function boardNotes(page: Page): Promise<NoteState[]> {
  const notes = await page.evaluate(() => {
    if (!window.__vidi6Board) throw new Error("__vidi6Board test hook is missing");
    return window.__vidi6Board.snapshot().map((note) => ({
      id: note.id,
      type: note.type,
      x: note.x,
      y: note.y,
      color: note.color,
      text: note.text,
      z: note.z,
    }));
  });
  return notes ?? [];
}

export async function waitForNoteCount(page: Page, count: number) {
  await expect.poll(async () => (await boardNotes(page)).length, { timeout: 5000 }).toBe(count);
}

/** Wait until the note text stored in the document is `text`. */
export async function waitForNoteText(page: Page, id: string, text: string) {
  await expect
    .poll(async () => (await boardNotes(page)).find((note) => note.id === id)?.text, { timeout: 5000 })
    .toBe(text);
}

export async function noteIdAt(page: Page, index = 0): Promise<string> {
  const notes = await boardNotes(page);
  const note = notes[index];
  if (!note) throw new Error(`expected a note at index ${index}`);
  return note.id;
}

export function noteArea(page: Page, id: string) {
  return page.locator(`[data-testid='sticky-note'][data-note-id='${id}']`);
}

/** Screen position and size of a note as it is painted. */
export async function noteBox(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await noteArea(page, id).boundingBox();
  if (!box) throw new Error(`note ${id} has no bounding box`);
  return box;
}

export async function noteCentre(page: Page, id: string): Promise<XY> {
  const box = await noteBox(page, id);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Paint order: DOM order of the notes inside the world layer. */
export async function notePaintOrder(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-testid='sticky-note']")).map(
      (el) => el.dataset.noteId ?? "",
    ),
  );
}

export async function selectedNoteIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-testid='sticky-note']"))
      .filter((el) => el.dataset.selected === "true")
      .map((el) => el.dataset.noteId ?? ""),
  );
}

/** Drag a note by (dx, dy) screen pixels, grabbing it at (grabX, grabY). */
export async function dragNote(
  page: Page,
  at: XY,
  dx: number,
  dy: number,
  steps = 8,
) {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(at.x + (dx * i) / steps, at.y + (dy * i) / steps);
  }
  await page.mouse.up();
  await expect
    .poll(async () => {
      const dragging = await page
        .locator("[data-testid='sticky-note'][data-dragging='true']")
        .count();
      return dragging;
    })
    .toBe(0);
}
