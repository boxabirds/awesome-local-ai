import { type Page, type FrameLocator } from "@playwright/test";

export type Camera = { x: number; y: number; zoom: number };

/** Screen bounding box of the origin crosshair (world 0,0). */
export async function originBox(page: Page) {
  const box = await page.getByTestId("origin-marker").boundingBox();
  if (!box) throw new Error("origin marker not visible");
  return box;
}

/** Centre point of the origin crosshair. */
export async function originCentre(page: Page) {
  const b = await originBox(page);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

export async function zoomLabel(page: Page) {
  return (await page.getByTestId("zoom-label").textContent())?.trim() ?? "";
}

export async function setCamera(page: Page, cam: Camera) {
  await page.evaluate((c) => {
    const w = window as unknown as { __vidi6?: { setCamera(c: Camera): void } };
    w.__vidi6?.setCamera(c);
  }, cam);
  await page.waitForTimeout(50);
}

export async function readCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => {
    const w = window as unknown as { __vidi6?: { getCamera(): Camera | null } };
    return w.__vidi6?.getCamera() ?? { x: NaN, y: NaN, zoom: NaN };
  });
}

export async function readGridSpacingPx(page: Page): Promise<number> {
  const v = await page
    .getByTestId("board-surface")
    .evaluate((el) => getComputedStyle(el).backgroundSize);
  // e.g. "50px 50px"
  const m = /([\d.]+)px/.exec(v);
  return m ? parseFloat(m[1]) : NaN;
}

/** Dispatch a wheel event with the Control modifier held (Chromium CDP). */
export async function ctrlWheel(page: Page, x: number, y: number, deltaY: number) {
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x,
    y,
    deltaX: 0,
    deltaY,
    modifiers: 2, // Ctrl
  });
  await page.waitForTimeout(50);
  await session.detach();
}

export type { FrameLocator };
