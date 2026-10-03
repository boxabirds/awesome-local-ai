import { expect, type Page, type APIRequestContext } from '@playwright/test';

export const ORIGIN_MARKER_SELECTOR = '[data-testid="origin-marker"]';
export const ZOOM_LABEL_SELECTOR = '[data-testid="zoom-label"]';

/** Centre of the origin crosshair (world 0,0) in viewport coordinates. */
export async function originMarkerCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator(ORIGIN_MARKER_SELECTOR).boundingBox();
  if (!box) throw new Error('origin marker not found');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The zoom percentage label text, e.g. "100%". */
export async function zoomLabelText(page: Page): Promise<string> {
  return (await page.locator(ZOOM_LABEL_SELECTOR).textContent())?.trim() ?? '';
}

/**
 * Jump the camera directly via the test-only hook (test builds only).
 * Waits for the hook to be available, then jumps and waits for re-render.
 */
interface CameraJump { x: number; y: number; zoom: number }

export async function setCamera(page: Page, cam: CameraJump): Promise<void> {
  // Wait for the test hook to be registered (useEffect runs after render)
  await page.waitForFunction(() => {
    return !!(window as { __vidi6?: unknown }).__vidi6;
  }, { timeout: 10_000 });

  await page.evaluate(async (c) => {
    const hook = (window as { __vidi6?: { setCamera(c: CameraJump): void } }).__vidi6;
    if (!hook) throw new Error('window.__vidi6 test hook missing (not a test build?)');
    hook.setCamera(c);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }, cam);
}

/** Drag the board from the viewport centre by (dx, dy) pixels. */
export async function dragBoard(page: Page, dx: number, dy: number): Promise<void> {
  const size = page.viewportSize();
  if (!size) throw new Error('viewport size unavailable');
  const { width, height } = size;
  const start = { x: width / 2, y: height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 10 });
  await page.mouse.up();
}

/**
 * Create a real board through the worker API (story 5: rooms are only
 * accepted for boards that exist) and return its id.
 */
export async function createBoardViaApi(context: APIRequestContext): Promise<string> {
  const res = await context.post('/api/boards');
  if (res.status() !== 201) {
    throw new Error(`board creation failed: ${res.status()}`);
  }
  const body = (await res.json()) as { id: string };
  expect(body.id).toMatch(/^[\w-]{22}$/);
  return body.id;
}

/** URL of a board page. */
export function boardUrl(id: string): string {
  return `/b/${id}`;
}

/**
 * Create a board through the API and open its page (the standard flow for
 * the existing stories 1–4 e2e specs, which predate the home page).
 */
export async function createBoardAndOpen(page: Page): Promise<string> {
  const id = await createBoardViaApi(page.request);
  await page.goto(boardUrl(id));
  return id;
}
