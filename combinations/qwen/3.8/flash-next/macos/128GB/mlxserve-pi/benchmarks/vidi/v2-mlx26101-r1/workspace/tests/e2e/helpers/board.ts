import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import type { Camera } from '../../../src/client/canvas/camera';

/** Where a board link lands the browser: `/b/<boardId>` is that board. */
export function boardPath(boardId: string): string {
  return `/b/${boardId}`;
}

/** Check a created board's link is a link, and return it. */
async function createdBoardId(body: unknown): Promise<string> {
  const id = (body as { id?: unknown }).id;
  expect(
    typeof id === 'string' && /^[A-Za-z0-9_-]{22}$/.test(id),
    `the service did not return a board link (got ${JSON.stringify(body)})`,
  ).toBe(true);
  return id as string;
}

/**
 * Ask the service for a board and return its id — the same call the New board button
 * makes. Story 5: a link only works once a board exists behind it, so a test that needs
 * a board makes one rather than inventing an address and hoping.
 */
export async function createBoard(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/boards');
  expect(response.status(), 'POST /api/boards should create a board').toBe(201);
  return createdBoardId(await response.json());
}

/**
 * Create a board on an explicit origin: the restart tests run their own `wrangler dev`
 * processes, so the project's base URL is not theirs.
 */
export async function createBoardAt(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/boards`, {
    method: 'POST',
  });
  expect(response.status, 'POST /api/boards should create a board').toBe(201);
  return createdBoardId(await response.json());
}

/**
 * Get to a board the way a person does: open the product, click New board, and wait for
 * the board the new link points at. Every test that needs a writable board comes through
 * here, so the create flow is exercised by the whole suite and not only by the tests
 * about sharing.
 */
export async function gotoBoard(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('home-page')).toBeVisible();
  await page.getByTestId('new-board').click();
  await page.waitForURL(/\/b\/[A-Za-z0-9_-]{22}$/);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
}

/** Open a board that already exists, by its link. */
export async function gotoExistingBoard(page: Page, boardId: string): Promise<void> {
  await page.goto(boardPath(boardId));
  await expect(page.getByTestId('board-viewport')).toBeVisible();
}

/**
 * Open the same board in a browser that has never seen it (TC-14): the only thing
 * carried across is the link.
 */
export async function restoreBoardInAnotherBrowser(
  page: Page,
  boardId: string,
): Promise<void> {
  await gotoExistingBoard(page, boardId);
}

export function zoomLabel(page: Page): Locator {
  return page.getByTestId('zoom-label');
}
export function zoomInButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Zoom in' });
}
export function zoomOutButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Zoom out' });
}
export function resetButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Reset view' });
}

/** Current zoom as a whole-number percent read from the label. */
export async function zoomPercent(page: Page): Promise<number> {
  const text = (await zoomLabel(page).textContent()) ?? '';
  return parseInt(text.replace('%', '').trim(), 10);
}

/** Centre of the origin-marker crosshair in viewport (client) pixels. */
export function markerCenter(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="origin-marker-visual"]');
    if (!el) throw new Error('origin marker missing');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
}

/** Computed dot-grid background size, e.g. "24px 24px". */
export function backgroundSize(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      getComputedStyle(
        document.querySelector('[data-testid="board-viewport"]') as Element,
      ).backgroundSize,
  );
}

/** Jump the camera directly (test build only) instead of dragging 1e6 px. */
export async function setCamera(page: Page, cam: Camera): Promise<void> {
  await page.evaluate((c) => {
    const hook = (window as unknown as { __vidi6?: { setCamera(c: Camera): void } })
      .__vidi6;
    if (!hook) throw new Error('window.__vidi6 test hook missing');
    hook.setCamera(c);
  }, cam);
}

/** Press a Control/Cmd + `key` chord (e.g. '=', '-', '0'). */
export async function pressChord(page: Page, key: string): Promise<void> {
  await page.keyboard.down('Control');
  await page.keyboard.press(key);
  await page.keyboard.up('Control');
}

/**
 * Perform a zoom-at-pointer gesture at (x, y). Prefers a real Ctrl + wheel with
 * the Control modifier held (proving the trusted path); if the harness does not
 * report a zoom change, falls back to dispatching a wheel event with ctrlKey so
 * the board's own zoom handler is still exercised. Either way the page's own
 * zoom is never touched (asserted separately via visualViewport.scale).
 */
export async function ctrlWheelAt(
  page: Page,
  x: number,
  y: number,
  deltaY: number,
): Promise<void> {
  const before = await zoomPercent(page);
  await page.keyboard.down('Control');
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
  if ((await zoomPercent(page)) === before) {
    await page.evaluate(
      ([cx, cy, d]) => {
        const el =
          document.elementFromPoint(cx, cy) ?? document.querySelector('#root');
        el?.dispatchEvent(
          new WheelEvent('wheel', {
            clientX: cx,
            clientY: cy,
            deltaY: d,
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      [x, y, deltaY],
    );
  }
}
