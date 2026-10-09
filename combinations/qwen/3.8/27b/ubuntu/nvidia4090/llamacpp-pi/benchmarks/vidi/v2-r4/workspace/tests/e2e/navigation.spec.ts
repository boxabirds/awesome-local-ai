/**
 * Story 1 e2e workflows (design "E2E workflows"), run against `wrangler dev`
 * serving the client build (built with `--mode test`, which enables the
 * `window.__vidi6` camera hook).
 *
 *  1. First visit navigation: TC-28 → TC-23 → TC-24 (hint, exact drag,
 *     pointer-anchored wheel zoom, page zoom untouched)
 *  2. Limits and recovery: TC-25 → TC-26 (zoom to max, reset to 100% centred)
 *  3. Far travel: TC-27 (exact pan at 1,000,000 units, stable grid spacing)
 *  Plus TC-31: zoom gestures never change page zoom.
 *
 * The app coalesces camera updates per animation frame, so DOM assertions
 * wait for the rendered state (label text / world transform / camera hook)
 * to settle before measuring pixels.
 */
import { expect, test, type JSHandle } from "@playwright/test";
import { GRID_SPACING_WORLD, ZOOM_MAX } from "../../src/shared/config";
import {
  CENTER,
  ctrlWheel,
  drag,
  getCamera,
  gridBackgroundSize,
  originMarkerCenter,
  pageZoom,
  setCamera,
  zoomLabelText,
} from "./helpers/board";

/** One ctrl-wheel notch (deltaY -100 px) multiplies the zoom by e^(0.01*100). */
const WHEEL_NOTCH_FACTOR = Math.exp(0.01 * 100);

/** Wait until the world layer's CSS transform reports the given matrix. */
function worldTransformSettled(
  page: import("@playwright/test").Page,
  expected: string,
): Promise<unknown> {
  return page.waitForFunction(
    (want: string) =>
      getComputedStyle(document.querySelector('[data-testid="board-world"]')!)
        .transform === want,
    expected,
  );
}

test.describe("story 1: pan and zoom around an infinite board", () => {
  test("workflow 1: first visit — hint shows, drag moves the board exactly, pointer zoom keeps the point fixed", async ({
    page,
  }) => {
    await page.goto("/");

    // TC-28: the hint is visible on first load.
    const hint = page.getByTestId("navigation-hint");
    await expect(hint).toBeVisible();

    // TC-23: drag 200,100 — the origin marker (and with it the dot grid)
    // moves exactly 200,100 px (±1). Initial camera is (-640,-400,1); a
    // 200,100 drag leaves it at (-840,-500,1) → the world layer transform is
    // exactly matrix(1, 0, 0, 1, 840, 500).
    const before = await originMarkerCenter(page);
    await drag(page, CENTER, 200, 100);
    await worldTransformSettled(page, "matrix(1, 0, 0, 1, 840, 500)");
    const after = await originMarkerCenter(page);
    expect(Math.abs(after.x - before.x - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y - 100)).toBeLessThanOrEqual(1);

    // TC-28: the hint is gone after the first navigation and does not return.
    await expect(hint).toBeHidden();

    // TC-24: ctrl-wheel over a dot keeps the dot under the pointer (±1 px)
    // and leaves the page zoom at 1. After the drag the camera is
    // (-840,-500,1), so world (0,0) — a grid dot — is exactly at (840,500).
    const dotOnScreen = { x: 840, y: 500 };
    const dotCheck = await originMarkerCenter(page);
    expect(Math.abs(dotCheck.x - dotOnScreen.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(dotCheck.y - dotOnScreen.y)).toBeLessThanOrEqual(1);

    const pageZoomBefore = await pageZoom(page);
    await ctrlWheel(page, dotOnScreen, -100);
    await expect(page.getByTestId("zoom-label")).not.toHaveText("100%");
    const cam = await getCamera(page);
    // Zoomed by the expected factor.
    expect(cam.zoom).toBeCloseTo(WHEEL_NOTCH_FACTOR, 6);
    // The world point under the pointer stayed under the pointer.
    const marker = await originMarkerCenter(page);
    expect(Math.abs(marker.x - dotOnScreen.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(marker.y - dotOnScreen.y)).toBeLessThanOrEqual(1);
    // The page itself did not zoom.
    const pageZoomAfter = await pageZoom(page);
    expect(pageZoomAfter.scale).toBe(1);
    expect(pageZoomAfter.dpr).toBe(pageZoomBefore.dpr);
  });

  test("workflow 2: zoom to the maximum via +, then Reset view recovers", async ({
    page,
  }) => {
    await page.goto("/");

    // TC-25: click + until it is disabled; the label sequence ends at 400%.
    // After each click we wait for the label to settle (the app coalesces
    // updates per frame), which also keeps the enabled-state checks stable.
    const plus = page.getByRole("button", { name: "Zoom in" });
    const label = page.getByTestId("zoom-label");
    const labels: string[] = [await zoomLabelText(page)];
    for (let i = 0; i < 50; i++) {
      if (!(await plus.isEnabled())) break;
      const previous = await zoomLabelText(page);
      await plus.click();
      await expect(label).not.toHaveText(previous);
      labels.push(await zoomLabelText(page));
    }
    expect(await plus.isDisabled()).toBe(true);
    expect(labels[labels.length - 1]).toBe("400%");
    // The expected whole sequence from 100% in 1.25 steps, clamped at max.
    const expected: string[] = [];
    let zoom = 1;
    while (zoom < ZOOM_MAX) {
      zoom = Math.min(ZOOM_MAX, zoom * 1.25);
      expected.push(`${Math.round(zoom * 100)}%`);
    }
    expect(labels).toEqual(["100%", ...expected]);

    // TC-26: from maximum zoom far away (1,000,000 units via the test hook),
    // Reset view returns to 100% centred on the origin.
    await setCamera(page, { x: 1_000_000, y: 1_000_000, zoom: ZOOM_MAX });
    await page.getByRole("button", { name: "Reset view" }).click();
    await expect(label).toHaveText("100%");
    const centre = await originMarkerCenter(page);
    expect(Math.abs(centre.x - CENTER.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(centre.y - CENTER.y)).toBeLessThanOrEqual(1);
  });

  test("workflow 3: far travel — at 1,000,000 units the board still pans exactly", async ({
    page,
  }) => {
    await page.goto("/");
    // Far away via the test hook (dragging a million pixels is impractical).
    await setCamera(page, { x: 1_000_000, y: 1_000_000, zoom: 1 });
    const camBefore = await getCamera(page);
    const gridBefore = await gridBackgroundSize(page);
    expect(gridBefore).toBe(`${GRID_SPACING_WORLD}px ${GRID_SPACING_WORLD}px`);

    await drag(page, CENTER, 200, 100);

    // Wait for the frame that applied the pan, then assert exact movement.
    await page.waitForFunction(
      (before: { x: number; y: number }) => {
        const cam = window.__vidi6!.getCamera();
        return cam.x === before.x - 200 && cam.y === before.y - 100;
      },
      { x: camBefore.x, y: camBefore.y },
    );
    const camAfter = await getCamera(page);
    expect(camAfter.x).toBe(camBefore.x - 200);
    expect(camAfter.y).toBe(camBefore.y - 100);
    expect(camAfter.zoom).toBe(1);
    // Grid spacing is still GRID_SPACING_WORLD * zoom screen pixels.
    const gridAfter = await gridBackgroundSize(page);
    expect(gridAfter).toBe(gridBefore);
  });

  test("TC-31: repeated zoom gestures (wheel and shortcuts) never change page zoom", async ({
    page,
  }) => {
    await page.goto("/");
    const before = await pageZoom(page);

    // Ctrl-wheel notches in...
    for (let i = 0; i < 5; i++) {
      await ctrlWheel(page, CENTER, -100);
    }
    // ...then the Ctrl/Cmd + = / - / 0 keyboard shortcuts...
    await page.keyboard.down("Control");
    await page.keyboard.press("=");
    await page.keyboard.press("=");
    await page.keyboard.press("-");
    await page.keyboard.press("0"); // reset back to 100% centred
    await page.keyboard.up("Control");
    // ...and wheel notches out.
    for (let i = 0; i < 3; i++) {
      await ctrlWheel(page, CENTER, 100);
    }

    const after = await pageZoom(page);
    expect(after.scale).toBe(1);
    expect(after.dpr).toBe(before.dpr);
    // ...while the board zoom actually changed (reset, then three steps out).
    await expect(page.getByTestId("zoom-label")).not.toHaveText("100%");
  });
});
