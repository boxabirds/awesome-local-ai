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

/**
 * Opens a board the way story 5 says a board is opened: create one, then go to
 * its link. Returns the id, so a test can name the board it is looking at.
 *
 * (`page.goto("/")` would land on the home page, which is no longer a board.)
 */
export async function openBoard(page: Page): Promise<string> {
  const boardId = await createBoardThroughApi(page);
  await openBoardLink(page, boardId);
  return boardId;
}

/** Opens one specific board link and waits for the board to be on screen. */
export async function openBoardLink(page: Page, boardId: string): Promise<void> {
  await page.goto(`/b/${boardId}`);
  await expect(page.getByTestId("board-viewport")).toBeVisible();
  // Wait for the test hook so tests can never race the app boot.
  await expect
    .poll(async () => page.evaluate(() => typeof window.__vidi6?.getCamera === "function"))
    .toBe(true);
}

/** `POST /api/boards` from the page's own request context (config baseURL). */
async function createBoardThroughApi(page: Page): Promise<string> {
  const response = await page.request.post("/api/boards");
  if (!response.ok()) {
    throw new Error(`POST /api/boards answered ${response.status()}: ${await response.text()}`);
  }
  const body = (await response.json()) as { id?: unknown };
  if (typeof body.id !== "string") throw new Error(`POST /api/boards returned no id: ${JSON.stringify(body)}`);
  return body.id;
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
