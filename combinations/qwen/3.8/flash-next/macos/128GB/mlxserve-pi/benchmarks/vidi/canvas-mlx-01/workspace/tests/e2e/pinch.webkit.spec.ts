import { expect, test } from '@playwright/test';
import {
  INITIAL_CAMERA,
  PX,
  distance,
  markerCentre,
  openBoard,
  pageZoomSignals,
  readCamera,
  screenToWorld,
  setCamera,
  zoomLabel,
} from './helpers/board';

interface GestureRun {
  startPrevented: boolean;
  changePrevented: boolean;
  endPrevented: boolean;
  scales: number[];
}

/**
 * Dispatch the Safari pinch event family over the board.
 *
 * Playwright has no trackpad pinch for WebKit, so this sends the events the browser
 * sends for a two-finger pinch: `gesturestart`, then `gesturechange` events whose
 * `scale` is cumulative from the start of the gesture, then `gestureend`. Scale and
 * coordinates are set on the events because Playwright cannot synthesize this gesture
 * at the input layer. Each change is followed by one animation frame so the board can
 * apply it before the next cumulative scale arrives, like a real pinch.
 */
async function pinch(
  page: import('@playwright/test').Page,
  at: { x: number; y: number },
  scales: number[],
): Promise<GestureRun> {
  return page.evaluate(
    async ({ point, steps }) => {
      const target = document.querySelector('[data-testid="board-viewport"]');
      if (!target) throw new Error('the board is missing');
      const frame = (): Promise<void> =>
        new Promise((resolve) => {
          requestAnimationFrame(() => resolve());
        });
      const fire = (type: string, scale: number): boolean => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.assign(event, {
          scale,
          clientX: point.x,
          clientY: point.y,
          screenX: point.x,
          screenY: point.y,
        });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      };
      const startPrevented = fire('gesturestart', 1);
      let changePrevented = true;
      for (const scale of steps) {
        changePrevented = fire('gesturechange', scale) && changePrevented;
        await frame();
      }
      const endPrevented = fire('gestureend', steps[steps.length - 1] ?? 1);
      await frame();
      return { startPrevented, changePrevented, endPrevented, scales: steps };
    },
    { point: at, steps: scales },
  );
}

test('TC-17: a Safari pinch zooms the board and never the page', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'gesturestart/change/end is a WebKit-only event family');

  await openBoard(page);
  await setCamera(page, INITIAL_CAMERA);

  const before = await readCamera(page);
  const browserBefore = await pageZoomSignals(page);
  const centre = { x: 640, y: 400 };
  const worldBefore = screenToWorld(before, centre);

  const run = await pinch(page, centre, [1.25, 1.5, 2]);

  // the board owns the gesture: none of it reaches the page
  expect(run.startPrevented).toBe(true);
  expect(run.changePrevented).toBe(true);
  expect(run.endPrevented).toBe(true);

  // the pinch zoomed the board by its cumulative scale, around its centre
  const after = await readCamera(page);
  expect(after.zoom).toBeCloseTo(before.zoom * 2, 6);
  expect(await zoomLabel(page)).toBe('200%');

  // the world point under the fingers never moved
  const worldAfter = screenToWorld(after, centre);
  expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
  expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);

  // ...and it is painted there: the board's starting point is still under the fingers
  expect(distance(await markerCentre(page), centre)).toBeLessThanOrEqual(PX);

  // the browser's own page zoom is untouched
  const browserAfter = await pageZoomSignals(page);
  expect(browserAfter.visualViewportScale).toBeCloseTo(browserBefore.visualViewportScale, 6);
  expect(browserAfter.devicePixelRatio).toBeCloseTo(browserBefore.devicePixelRatio, 6);
});

test('TC-17: a pinch clamps at the zoom limits like every other zoom', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'webkit', 'gesturestart/change/end is a WebKit-only event family');

  await openBoard(page);

  await pinch(page, { x: 640, y: 400 }, [4, 40, 4000]);
  expect(await zoomLabel(page)).toBe('400%');
  expect((await readCamera(page)).zoom).toBe(4);

  await pinch(page, { x: 640, y: 400 }, [0.001, 0.00001]);
  expect(await zoomLabel(page)).toBe('10%');
  expect((await readCamera(page)).zoom).toBe(0.1);
});
