import type { Page } from '@playwright/test';

export interface Box {
  x: number;
  y: number;
}

/**
 * Open a board the way a person does: home page, `New board`, and wait until the
 * app and its test hook are ready. Story 5 made the home page the only place a
 * board starts, so every test that wants a board of its own comes through here.
 */
export async function gotoBoard(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('new-board-button').click();
  await page.waitForSelector('[data-testid="board-viewport"]');
  await page.waitForFunction(() => typeof (window as any).__vidi6 !== 'undefined');
}

/** Open an existing board at its exact address (no home page, no new id). */
export async function gotoBoardUrl(page: Page, boardId: string): Promise<void> {
  await page.goto(`/b/${boardId}`);
  await page.waitForSelector('[data-testid="board-viewport"]');
  await page.waitForFunction(() => typeof (window as any).__vidi6 !== 'undefined');
}

/** Screen position of the world (0,0) origin crosshair (works off-screen too). */
export async function markerCenter(page: Page): Promise<Box> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="origin-marker"]');
    if (!el) throw new Error('origin marker missing');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
}

/** Current zoom label text, e.g. "125%". */
export function zoomLabel(page: Page) {
  return page.getByTestId('zoom-label');
}

/** Numeric grid spacing in CSS pixels from the viewport background-size. */
export async function gridSpacingPx(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="board-viewport"]');
    const size = getComputedStyle(el as Element).backgroundSize; // "24px 24px"
    return parseFloat(size);
  });
}

/** Jump the camera through the test-only hook (used to travel far away). */
export async function setCamera(
  page: Page,
  cam: { x: number; y: number; zoom: number },
): Promise<void> {
  await page.evaluate((c) => {
    (window as any).__vidi6.setCamera(c);
  }, cam);
}

/** A real mouse drag across empty board space. */
export async function dragBoard(
  page: Page,
  from: Box,
  to: Box,
  steps = 8,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

/**
 * Dispatch a Ctrl + wheel over the board at a client point. jsdom-free (real
 * browser), but Playwright cannot hold a keyboard modifier while synthesising a
 * wheel cross-browser, so we dispatch a cancelable WheelEvent the board handles.
 */
export async function ctrlWheel(
  page: Page,
  at: Box,
  deltaY: number,
): Promise<void> {
  await page.evaluate(
    ({ x, y, deltaY }) => {
      const el = document.querySelector('[data-testid="board-viewport"]') as Element;
      const ev = new WheelEvent('wheel', {
        clientX: x,
        clientY: y,
        deltaX: 0,
        deltaY,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(ev);
    },
    { x: at.x, y: at.y, deltaY },
  );
}

/** Read page-zoom signals used to prove board gestures never zoom the page. */
export async function pageZoomSignals(page: Page): Promise<{ scale: number; dpr: number }> {
  return page.evaluate(() => ({
    scale: window.visualViewport ? window.visualViewport.scale : 1,
    dpr: window.devicePixelRatio,
  }));
}
