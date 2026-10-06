/**
 * Arrows, seen from a browser.
 *
 * An arrow is the one object on this board that is not drawn from its own numbers: it stores what its two
 * ends are *attached to*, and the line, the box and the handles are worked out again from where the shapes
 * currently are. So this file reads two different things, and keeps them apart on purpose:
 *
 * — **what the document holds**: which end is on which shape, or fixed at which point. That is the
 *   element's `data-from` / `data-to`, which say either the id of a shape or `free`.
 * — **what the page shows**: where the line is actually drawn, and where its point is. That is read out of
 *   the line's own coordinates plus the box it is drawn inside, in world units, so a test can say "the
 *   arrow's point is at the middle of B's left side" and mean the pixels.
 *
 * A test that only read the first would pass on an arrow drawn in the wrong place; a test that only read
 * the second could not tell an arrow that follows from an arrow that was rewritten. Story 10 is the
 * difference between those two, so both are here.
 *
 * The tool letters come from `helpers/shapes.ts` and are re-exported below, so a spec about arrows reads
 * as a spec about arrows.
 */

import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { settled } from './board';

export { enterTool, shapeCentre, shapeScreenBox, toolOnScreen } from './shapes';

/** One arrow, by id. */
export const connector = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="connector-object"][data-object-id="${id}"]`);

/** Every arrow on the board. */
export const allConnectors = (page: Page): Locator => page.locator('[data-testid="connector-object"]');

/** The line of one arrow, and the head on its end. */
export const connectorLine = (page: Page, id: string): Locator =>
  connector(page, id).locator('[data-testid="connector-line"]');

/** The four dots the Connector tool draws on the shape the pointer is over. */
export const connectorDots = (page: Page): Locator => page.getByTestId('connector-dots');

/** The rubber band drawn while an arrow is being pulled out. */
export const connectorPreview = (page: Page): Locator => page.getByTestId('connector-preview');

/** Ids of every arrow on the board, in stacking order. */
export function connectorIds(page: Page): Promise<string[]> {
  return allConnectors(page).evaluateAll((els) => els.map((el) => el.dataset['objectId'] ?? ''));
}

/** How many arrows are on the board. */
export function connectorCount(page: Page): Promise<number> {
  return allConnectors(page).count();
}

/** Waits for the board to have drawn this many arrows, and returns their ids. */
export async function expectConnectorCount(page: Page, count: number): Promise<string[]> {
  await expect(allConnectors(page), `waiting for ${count} arrows`).toHaveCount(count);
  return connectorIds(page);
}

/** The one arrow on a board that has exactly one arrow on it. */
export async function onlyConnectorId(page: Page): Promise<string> {
  const ids = await expectConnectorCount(page, 1);
  return ids[0] as string;
}

/**
 * What the two ends are, as the document holds them: the id of the shape each is attached to, or `free`.
 *
 * This is not where the end is drawn — it is which shape the end belongs to, which is the thing that
 * survives a shape being moved and the thing that a delete changes.
 */
export function connectorEnds(
  page: Page,
  id: string,
): Promise<{ from: string; to: string; selected: boolean; z: number }> {
  return connector(page, id).evaluate((el) => ({
    from: el.dataset['from'] ?? '',
    to: el.dataset['to'] ?? '',
    selected: el.dataset['selected'] === 'true',
    z: Number(el.dataset['z']),
  }));
}

/** Where an arrow's two ends are, in world units: the point it starts at, the point it stops at, its point. */
export interface DrawnArrow {
  from: { x: number; y: number };
  to: { x: number; y: number };
  tip: { x: number; y: number };
  box: { x: number; y: number; width: number; height: number };
  /** The invisible wide stroke's width, in world units: six screen pixels either side, whatever the zoom. */
  hitWidth: number;
}

/**
 * Where the arrow is drawn, in world units, read off the page.
 *
 * The line's numbers are local to the object's box — the world layer is what scales and moves them — so
 * the box's own `data-x`/`data-y` are added back here. The point of the arrow is the first corner of the
 * head: the line stops short of it on purpose, so asking the line for the tip would ask the wrong element.
 */
export async function drawnArrow(page: Page, id: string): Promise<DrawnArrow> {
  const read = await connector(page, id).evaluate((el) => {
    const box = {
      x: Number(el.dataset['x']),
      y: Number(el.dataset['y']),
      width: Number(el.dataset['width']),
      height: Number(el.dataset['height']),
    };
    const line = el.querySelector('[data-testid="connector-line"]');
    const head = el.querySelector('[data-testid="connector-head"]');
    const hit = el.querySelector('[data-testid="connector-hit"]');
    const number = (value: string | null | undefined): number => Number(value);
    const first = (head?.getAttribute('points') ?? '').split(' ')[0]?.split(',') ?? [];
    return {
      box,
      x1: number(line?.getAttribute('x1')),
      y1: number(line?.getAttribute('y1')),
      x2: number(line?.getAttribute('x2')),
      y2: number(line?.getAttribute('y2')),
      tipX: number(first[0]),
      tipY: number(first[1]),
      hitWidth: number(hit?.getAttribute('data-stroke-width')),
      drawable: line !== null && head !== null,
    };
  });
  if (!read.drawable) throw new Error(`arrow ${id} is drawn without a line or a head`);
  return {
    from: { x: read.box.x + read.x1, y: read.box.y + read.y1 },
    // Where the line stops, which is the base of the head rather than its point.
    to: { x: read.box.x + read.x2, y: read.box.y + read.y2 },
    tip: { x: read.box.x + read.tipX, y: read.box.y + read.tipY },
    box: read.box,
    hitWidth: read.hitWidth,
  };
}

/** Which shape the dots are on, from the layer that draws them; null when the pointer is over nothing. */
export async function dottedShape(page: Page): Promise<string | null> {
  const dots = connectorDots(page);
  if ((await dots.count()) === 0) return null;
  return await dots.getAttribute('data-hover-object-id');
}

/** Which of the four dots is lit: the side an arrow would go to, or none while the pointer is not dragging. */
export async function litDots(page: Page): Promise<string[]> {
  const dots = connectorDots(page);
  if ((await dots.count()) === 0) return [];
  return dots
    .locator('[data-active="true"]')
    .evaluateAll((els) => els.map((el) => el.dataset['side'] ?? ''));
}

/**
 * Pulls an arrow from one screen point to another with the Connector tool, and hands back its id.
 *
 * The two points are screen pixels. Releasing over a shape attaches that end to the shape and the tool
 * hands the pointer back to Select with the new arrow in its hand; releasing over nothing fixes that end
 * at that point; a drag too short to be an arrow leaves nothing at all, which the caller finds out because
 * no new arrow appears.
 */
export async function drawConnector(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { whileDown?: () => Promise<void> } = {},
): Promise<string | null> {
  const before = await connectorIds(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  if (options.whileDown) await options.whileDown();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await settled(page);
  const after = await connectorIds(page);
  const made = after.filter((id) => !before.includes(id));
  if (made.length > 1) throw new Error(`one gesture made ${made.length} arrows`);
  return made[0] ?? null;
}

/** The rubber band as drawn, from the start of the drag to where the pointer is now, in screen pixels. */
export async function previewArrow(page: Page): Promise<{ x1: number; y1: number; x2: number; y2: number } | null> {
  const line = connectorPreview(page).locator('line');
  if ((await line.count()) === 0) return null;
  return line.evaluate((el) => ({
    x1: Number(el.getAttribute('x1')),
    y1: Number(el.getAttribute('y1')),
    x2: Number(el.getAttribute('x2')),
    y2: Number(el.getAttribute('y2')),
  }));
}

/** The handles a selected arrow offers, by end. */
export function handleNames(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid="connector-object"] [data-handle]')
    .evaluateAll((els) => els.map((el) => el.dataset['handle'] ?? ''));
}

/** Where one end's handle sits on the screen. */
export async function handleScreen(page: Page, which: 'from' | 'to'): Promise<{ x: number; y: number }> {
  const handle = page.locator(`[data-testid="connector-object"] [data-handle="connector-${which}"]`);
  const box = await handle.boundingBox();
  if (!box) throw new Error(`the arrow offers no ${which} handle`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Drags one end of a selected arrow to a screen point, and lets go.
 *
 * Over a shape, that end goes on the shape; over nothing, it stays at that point; over the shape the other
 * end is already on, the model refuses and the handle goes back where it came from — which is a refusal a
 * person can see, and what the caller checks afterwards by asking where the arrow is drawn.
 */
export async function dragHandleTo(
  page: Page,
  which: 'from' | 'to',
  to: { x: number; y: number },
): Promise<void> {
  const start = await handleScreen(page, which);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + to.x) / 2, (start.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await settled(page);
}

/** Clicks the arrow's line where it is drawn, which is how an arrow is selected. */
export async function clickArrow(page: Page, at: { x: number; y: number }): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
  await settled(page);
}

/** Waits for the arrow's drawn ends to stop moving, then returns them: an arrow follows in frames, not at once. */
export async function waitForArrowAtRest(page: Page, id: string): Promise<DrawnArrow> {
  let last = await drawnArrow(page, id);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await page.waitForTimeout(20);
    const next = await drawnArrow(page, id);
    if (JSON.stringify(next) === JSON.stringify(last)) return next;
    last = next;
  }
  return last;
}
