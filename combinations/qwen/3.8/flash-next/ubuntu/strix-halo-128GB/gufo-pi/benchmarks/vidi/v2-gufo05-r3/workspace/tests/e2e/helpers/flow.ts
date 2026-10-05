/**
 * Shared e2e helpers for story 10's shape and connector specs.
 *
 * Two things every flow test needs and neither belongs in a spec twice: reading the
 * board back out of the page as *typed* snapshots, and turning a world point into a
 * screen point without assuming where the camera happens to be. The camera comes from
 * what the board itself shows — the origin marker's painted position and the zoom
 * label — so a spec that says "press on the middle of the shape" stays true even if the
 * default camera one day starts somewhere else.
 */
import type { Page } from '@playwright/test';

import type { Endpoint } from '../../../src/shared/objects/connector';
import type { Point } from '../../../src/client/canvas/camera';
import { markerCenter, zoomLabelValue } from './board';

/** Any board object, with the fields the flow specs read. */
export interface FlowObject {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z?: number;
  kind?: string;
  label?: string;
  text?: string;
  from?: Endpoint;
  to?: Endpoint;
  ends?: { from: Point; to: Point };
}

export function objectsOn(page: Page): Promise<FlowObject[]> {
  return page.evaluate(
    () =>
      (
        window as unknown as { __vidi6?: { getBoard?: () => FlowObject[] } }
      ).__vidi6?.getBoard?.() ?? [],
  );
}

export const shapesOn = (page: Page): Promise<FlowObject[]> =>
  objectsOn(page).then((all) => all.filter((o) => o.type === 'shape'));

export const connectorsOn = (page: Page): Promise<FlowObject[]> =>
  objectsOn(page).then((all) => all.filter((o) => o.type === 'connector'));

/** One object by id, or `undefined` when it is no longer on the board. */
export async function objectOf(page: Page, id: string): Promise<FlowObject | undefined> {
  return (await objectsOn(page)).find((o) => o.id === id);
}

const originAndZoom = async (page: Page): Promise<{ origin: Point; zoom: number }> => ({
  origin: await markerCenter(page),
  zoom: (await zoomLabelValue(page)) / 100,
});

/** Screen pixels for a world point, as the board is currently looking. */
export async function screenOfWorld(page: Page, world: Point): Promise<Point> {
  const { origin, zoom } = await originAndZoom(page);
  return { x: origin.x + world.x * zoom, y: origin.y + world.y * zoom };
}

/** The world point under a screen point. */
export async function worldOfPoint(page: Page, screen: Point): Promise<Point> {
  const { origin, zoom } = await originAndZoom(page);
  return { x: (screen.x - origin.x) / zoom, y: (screen.y - origin.y) / zoom };
}

/** The middle of a shape, in screen pixels. */
export async function centreOfShapeOnScreen(page: Page, id: string): Promise<Point> {
  const shape = await objectOf(page, id);
  if (!shape) throw new Error(`shape ${id} is not on the board`);
  return screenOfWorld(page, { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 });
}

/** Press, travel in steps the way a hand moves, let go. */
export async function dragOnBoard(page: Page, from: Point, to: Point, steps = 6): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  }
  await page.mouse.up();
}

/**
 * Drag a shape by its middle to a **world** point.
 *
 * The press point comes from the model (where the shape is) and the destination is
 * where the shape's middle should end up, both in board units: the conversion to
 * screen pixels happens here, because a helper that took one in each system is a
 * trap — the drag would land somewhere else entirely, and the shape would still move.
 */
export async function dragShapeToWorld(page: Page, id: string, to: Point): Promise<void> {
  await dragOnBoard(page, await centreOfShapeOnScreen(page, id), await screenOfWorld(page, to));
}

/** Is this number within `tolerance` of that one? (Named, so failures explain themselves.) */
export const within = (actual: number, expected: number, tolerance: number): boolean =>
  Math.abs(actual - expected) <= tolerance;
