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

// ---- sticky notes (story 2) -------------------------------------------------

export interface NoteView {
  id: string;
  /** World-space top-left, read from the element's own inline geometry. */
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  background: string;
  fontPx: number;
  selected: boolean;
  dragging: boolean;
  overflow: boolean;
  /** Paint order: a note later in the board layer is drawn above earlier ones. */
  order: number;
  counter: string | null;
}

/** Waits for a painted frame plus a macrotask, so React state has landed. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))),
      ),
  );
}

export async function notes(page: Page): Promise<NoteView[]> {
  return page.$$eval("[data-note-id]", (elements) =>
    elements.map((element, index) => {
      const el = element as HTMLElement;
      const text = el.querySelector<HTMLElement>(".sticky-text");
      const counter = el.querySelector("[data-testid='sticky-counter']");
      return {
        id: el.dataset.noteId as string,
        x: Number.parseFloat(el.style.left),
        y: Number.parseFloat(el.style.top),
        width: Number.parseFloat(el.style.width),
        height: Number.parseFloat(el.style.height),
        text: text ? (text.textContent ?? "") : "",
        background: window.getComputedStyle(el).backgroundColor,
        fontPx: text ? Number.parseFloat(window.getComputedStyle(text).fontSize) : 0,
        selected: el.dataset.selected === "true",
        dragging: el.dataset.dragging === "true",
        overflow: el.dataset.overflow === "true",
        order: index,
        counter: counter ? (counter.textContent ?? null) : null,
      };
    }),
  );
}

export async function noteCount(page: Page): Promise<number> {
  return page.getByTestId("sticky-note").count();
}

export async function noteCentre(page: Page, id: string): Promise<XY> {
  const box = await page.locator(`[data-note-id='${id}']`).boundingBox();
  if (!box) throw new Error(`note ${id} has no bounding box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drag a note by (dx, dy) screen pixels, one animation frame per step. */
export async function dragNote(page: Page, id: string, dx: number, dy: number, steps = 4) {
  const from = await noteCentre(page, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
    await settle(page);
  }
  await page.mouse.up();
  await settle(page);
}

export async function clickNote(page: Page, id: string) {
  const at = await noteCentre(page, id);
  await page.mouse.click(at.x, at.y);
  await settle(page);
}

export async function doubleClickBoard(page: Page, at: XY) {
  await page.mouse.dblclick(at.x, at.y);
  await settle(page);
}

export async function createNoteByButton(page: Page) {
  await page.getByRole("button", { name: "Sticky note" }).click();
  await settle(page);
}

export function noteEditor(page: Page) {
  return page.getByRole("textbox", { name: "Sticky note text" });
}

/** Types into the open editor (the note must already be in the editing state). */
export async function fillNoteText(page: Page, text: string) {
  const box = noteEditor(page);
  await expect(box).toBeVisible();
  await box.fill(text);
  await settle(page);
}

export async function endEditing(page: Page) {
  await page.keyboard.press("Escape");
  await settle(page);
}

export function colourSwatch(page: Page, name: string) {
  return page.getByRole("button", { name: `${name} colour` });
}

export function deleteNoteButton(page: Page) {
  return page.getByRole("button", { name: "Delete note" });
}
