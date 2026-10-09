import { expect, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config';

export interface FlowIds {
  shapes: string[];
  connectors: string[];
}

export async function seedFlow(page: Page): Promise<FlowIds> {
  await expect
    .poll(() => page.evaluate(() => typeof window.__vidi6?.seedCheckoutFlow === 'function'), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS
    })
    .toBe(true);
  return page.evaluate(() => window.__vidi6!.seedCheckoutFlow!());
}

export async function boxOf(page: Page, testId: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.getByTestId(testId).boundingBox();
  if (box === null) throw new Error(`${testId} not visible`);
  return box;
}

export async function centerOf(page: Page, testId: string): Promise<{ x: number; y: number }> {
  const box = await boxOf(page, testId);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Real pointer drag used by the shape tool (the full-board overlay captures it).
export async function dragOn(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}

export async function clickOn(page: Page, at: { x: number; y: number }): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
}

// Screen-space endpoints of a connector, read from the renderer's data attrs.
export async function connectorEnds(page: Page, id: string): Promise<{ fx: number; fy: number; tx: number; ty: number }> {
  return page.getByTestId(`connector-${id}`).evaluate((el) => ({
    fx: Number(el.getAttribute('data-from-x')),
    fy: Number(el.getAttribute('data-from-y')),
    tx: Number(el.getAttribute('data-to-x')),
    ty: Number(el.getAttribute('data-to-y'))
  }));
}

export function countTestId(page: Page, prefix: string): () => Promise<number> {
  return () => page.locator(`[data-testid^="${prefix}"]`).count();
}
