import { expect, type APIRequestContext, type Page, type Locator } from '@playwright/test';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface StickySnapshot {
  id: string;
  x: number;
  y: number;
  color: string;
  text: string;
}

/** One board object as the test hook reports it: notes AND text blocks. */
export interface BoardObject {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  size?: string;
  widthMode?: string;
}

declare global {
  interface Window {
    __vidi6?: {
      getCamera(): Camera;
      setCamera(c: Camera): void;
      reset(): void;
      zoomStep(dir: 'in' | 'out'): void;
      worldToScreen(p: { x: number; y: number }): { x: number; y: number };
      seedSticky(x: number, y: number, color?: string): string;
      seedText(x: number, y: number): string | null;
      tool(): string;
      textBlock(id: string): { text: string; size: string; widthMode: string; width: number; height: number } | null;
      selection(): string[];
      snapshot(): BoardObject[];
    };
  }
}

/** Wait until the app has mounted AND this client is CONNECTED: the test
 * hook exists, the socket is up and the first sync landed (state
 * 'connected'/'confirmed'). Story 5 made that a hard requirement: a board id
 * that was never created now gets 404, so a page can only reach 'connected'
 * on a board that actually exists. */
export async function waitForBoardReady(page: Page, timeout = 20_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __vidi6?: { getState(): { connectionState: string } };
      };
      const s = w.__vidi6?.getState()?.connectionState;
      return s === 'connected' || s === 'confirmed';
    },
    null,
    { timeout },
  );
}

/** Create a real, EMPTY board through the shipped API and return its id.
 *
 * Story 5 removed implicit board creation, so a fixture must create the board
 * it wants to test on. The `x-test-ignore-limit` header keeps a 23-test suite
 * from throttling itself (it is honoured only when the dev server runs with
 * TEST_HOOKS=1); the share spec tests the limiter with the header left off. */
export async function createBoard(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/boards', {
    headers: { 'x-test-ignore-limit': '1' },
  });
  if (!response.ok()) {
    throw new Error(`createBoard failed: ${response.status()} ${await response.text()}`);
  }
  const body = (await response.json()) as { id: string };
  return body.id;
}

/** Create `count` boards; each one is its own Durable Object. */
export async function createBoards(request: APIRequestContext, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) ids.push(await createBoard(request));
  return ids;
}

/** Open a FRESH board (created for this test) and wait until it is ready.
 * Returns the board id, so a spec can also address it directly. */
export async function openBoard(page: Page): Promise<string> {
  const id = await createBoard(page.request);
  await openRoom(page, id);
  return id;
}

/** Open an existing board by id and wait until the app is connected to it. */
export async function openRoom(page: Page, id: string): Promise<void> {
  await page.goto(`/b/${id}`);
  await waitForBoardReady(page);
}

export function getCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => window.__vidi6!.getCamera());
}

export async function setCamera(page: Page, cam: Camera) {
  await page.evaluate((c) => window.__vidi6!.setCamera(c), cam);
}

/** Centre of the origin crosshair (the stable pixel target). */
export async function markerCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('origin-marker').boundingBox();
  if (!box) throw new Error('origin marker not found');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The zoom percentage label text, e.g. "150%". */
export async function zoomLabel(page: Page): Promise<string | null> {
  return page.getByTestId('zoom-controls').locator('output').textContent();
}

/** The computed dot-grid spacing in CSS pixels (from background-size). */
export async function gridSpacingPx(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="board-viewport"]') as HTMLElement;
    const size = getComputedStyle(el).backgroundSize; // e.g. "48px 48px"
    return parseFloat(size.split(' ')[0]);
  });
}

export async function visualScale(page: Page): Promise<number> {
  return page.evaluate(() => window.visualViewport?.scale ?? 1);
}

export async function expectPixelClose(actual: number, expected: number, tol = 1) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

// ---- Sticky-note (story 2) helpers ----

/** Read the full board model snapshot (sorted by z then id). */
export function snapshot(page: Page): Promise<StickySnapshot[]> {
  return page.evaluate(() => window.__vidi6!.snapshot() as unknown as StickySnapshot[]);
}

/** Seed a sticky note at a world point through the test hook. Returns its id. */
export function seedSticky(page: Page, x: number, y: number, color?: string): Promise<string> {
  return page.evaluate((a) => window.__vidi6!.seedSticky(a.x, a.y, a.c), { x, y, c: color });
}

/** Convert a world point to page (CSS) pixels via the exposed camera. */
export function worldToScreen(page: Page, pt: { x: number; y: number }): Promise<{ x: number; y: number }> {
  return page.evaluate((p) => window.__vidi6!.worldToScreen(p), pt);
}

/** Locate a specific sticky note by id. */
export function stickyByld(page: Page, id: string): Locator {
  return page.locator(`[data-note-id="${id}"]`);
}

/** Wait until a seeded note is actually rendered in the DOM. */
export async function waitSticky(page: Page, id: string): Promise<void> {
  await expect(stickyByld(page, id)).toBeVisible({ timeout: 5_000 });
}

/** Page-space centre of a specific sticky note (already in page CSS pixels). */
export async function stickyCenter(page: Page, id: string): Promise<{ x: number; y: number }> {
  await waitSticky(page, id);
  const box = await stickyByld(page, id).boundingBox();
  if (!box) throw new Error(`sticky ${id} has no bounding box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A real Playwright mouse drag starting at a page-space point. */
export async function mouseDrag(page: Page, sx: number, sy: number, dx: number, dy: number) {
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + dx, sy + dy, { steps: 4 });
  await page.mouse.up();
}

// ---- Free-text (story 9) helpers ----

/** Every board object (notes and text blocks), in paint order. */
export function objectsSnapshot(page: Page): Promise<BoardObject[]> {
  return page.evaluate(() => window.__vidi6!.snapshot());
}

/** The text blocks only. */
export async function textBlocks(page: Page): Promise<BoardObject[]> {
  return (await objectsSnapshot(page)).filter((o) => o.type === 'text');
}

/** The board's active tool: 'select' or 'text'. */
export function toolState(page: Page): Promise<string> {
  return page.evaluate(() => window.__vidi6!.tool());
}

/** The selected ids (the whole selection, not just the primary one). */
export function selectionIds(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__vidi6!.selection());
}

/** Seed a text block at a WORLD point (its top-left corner). Test-only hook. */
export function seedText(page: Page, x: number, y: number): Promise<string | null> {
  return page.evaluate((a) => window.__vidi6!.seedText(a.x, a.y), { x, y });
}

/** Locate a rendered text block by id. */
export function textByld(page: Page, id: string): Locator {
  return page.locator(`[data-block-id="${id}"]`);
}

/** Page-space box of a rendered text block (CSS pixels, zoom applied). */
export async function textBox(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const el = textByld(page, id);
  await el.waitFor({ state: 'visible', timeout: 5_000 });
  const box = await el.boundingBox();
  if (!box) throw new Error(`text block ${id} has no bounding box`);
  return box;
}

/** Page-space centre of a rendered text block. */
export async function textCenter(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = await textBox(page, id);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Convert a page-space point to world coordinates through the live camera. */
export async function screenToWorld(page: Page, pt: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const cam = await getCamera(page);
  const zoom = cam.zoom || 1;
  return { x: pt.x / zoom + cam.x, y: pt.y / zoom + cam.y };
}

/**
 * Type into a text block the real way: double-click to open the in-place
 * editor, fill the textarea, then Escape to close it.
 */
export async function typeText(page: Page, id: string, text: string): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(30);
  const c = await textCenter(page, id);
  await page.mouse.dblclick(c.x, c.y);
  const editor = page.getByTestId('text-editor');
  await editor.waitFor({ state: 'visible', timeout: 3_000 });
  await editor.fill(text);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(30);
}

/**
 * Arm the Text tool the keyboard way (the shortcut the PRD describes) and
 * place a block with a real click, so the whole path runs through the shipped
 * pointer and key handlers.
 */
export async function placeTextByTool(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.press('t');
  await page.mouse.click(x, y);
}

/** A Shift+drag over empty board: the marquee gesture. */
export async function marqueeDrag(page: Page, sx: number, sy: number, dx: number, dy: number) {
  await page.keyboard.down('Shift');
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + dx, sy + dy, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/**
 * Type into a text block the real way: double-click to open the in-place
 * editor, fill the textarea, then Escape to close it.
 */
export async function typeText(page: Page, id: string, text: string): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(30);
  const c = await textCenter(page, id);
  await page.mouse.dblclick(c.x, c.y);
  const editor = page.getByTestId('text-editor');
  await editor.waitFor({ state: 'visible', timeout: 3_000 });
  await editor.fill(text);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(30);
}
