import { expect, type Locator, type Page } from '@playwright/test';
import type { ConnectorSnapshot, EndpointInput } from '../../../src/shared/objects/connector';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config';
import { getCamera, type ScreenPoint } from './board';
import { shapeScreenOf } from './shapes';

/**
 * Story 10 connector helpers (`connector.tool`, `connector.follow`, `connector.detach`).
 *
 * An arrow has two lives: the endpoints the document stores, and the two points
 * every screen resolves from them against the shapes that exist right now. Tests
 * read both - the stored end says what the board decided, the resolved point says
 * what a person is looking at.
 */

/** A world point, in board units. */
export interface WorldPoint {
  x: number;
  y: number;
}

export type AttachSide = 'left' | 'right' | 'top' | 'bottom';

interface ConnectorHooks {
  connectors(): ConnectorSnapshot[];
  createConnector(params: { from: EndpointInput; to: EndpointInput }): string;
}

export async function getConnectors(page: Page): Promise<ConnectorSnapshot[]> {
  return page.evaluate(() => {
    const api = (window as unknown as { __vidi6?: ConnectorHooks }).__vidi6;
    if (!api) {
      throw new Error('test hooks are not installed');
    }
    return api.connectors();
  });
}

export async function connectorOf(page: Page, id: string): Promise<ConnectorSnapshot> {
  const connectors = await getConnectors(page);
  const found = connectors.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`connector ${id} is not on the board`);
  }
  return found;
}

/** Put an arrow on the board through the model (test setup only). */
export async function createConnectorOnBoard(
  page: Page,
  from: EndpointInput,
  to: EndpointInput,
): Promise<string> {
  const id = await page.evaluate(
    (args) => {
      const api = (window as unknown as { __vidi6?: ConnectorHooks }).__vidi6;
      if (!api) {
        throw new Error('test hooks are not installed');
      }
      return api.createConnector({ from: args.from, to: args.to });
    },
    { from, to },
  );
  if (id === '') {
    throw new Error('the connector was not created');
  }
  await expect
    .poll(async () => (await getConnectors(page)).some((entry) => entry.id === id), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe(true);
  return id;
}

export async function waitForConnectorCount(
  page: Page,
  count: number,
): Promise<ConnectorSnapshot[]> {
  await expect
    .poll(async () => (await getConnectors(page)).length, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      message: `the board never showed ${count} connectors`,
    })
    .toBe(count);
  return getConnectors(page);
}

const connectorData = (entries: readonly ConnectorSnapshot[]): string =>
  JSON.stringify(
    entries.map((entry) => ({
      id: entry.id,
      from: entry.from,
      to: entry.to,
      points: {
        from: { x: Math.round(entry.points.from.x), y: Math.round(entry.points.from.y) },
        to: { x: Math.round(entry.points.to.x), y: Math.round(entry.points.to.y) },
      },
      z: entry.z,
    })),
  );

/**
 * Wait until every page holds the same arrows - stored endpoints and resolved
 * points alike - and return them.
 *
 * Resolved points are part of the comparison because that is the whole point of
 * the story: two screens that store the same arrow but draw it at different ends
 * are not showing the same board.
 */
export async function waitForSameConnectors(
  pages: readonly Page[],
): Promise<readonly ConnectorSnapshot[]> {
  let first = '[]';
  await expect
    .poll(
      async () => {
        const all = await Promise.all(
          pages.map(async (page) => connectorData(await getConnectors(page))),
        );
        first = all[0] ?? '[]';
        return all.every((entry) => entry === first);
      },
      { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: 'the boards never agreed on the connectors' },
    )
    .toBe(true);
  return getConnectors(pages[0] as Page);
}

export function connectorCard(page: Page, id: string): Locator {
  return page.locator(`[data-testid="connector-object-${id}"]`);
}

/** Hold the Connector tool (`connector.tool`). */
export async function pressConnectorTool(page: Page): Promise<void> {
  await page.keyboard.press('l');
  await page.waitForTimeout(40);
  await expect(page.locator('[data-testid="board"]')).toHaveAttribute('data-tool', 'connector');
}

/**
 * Drag an arrow between two world points, keeping the press alive.
 *
 * `onStart` runs while the pointer is still down, which is how a test puts a
 * second person's delete in the middle of an arrow that is being drawn.
 */
export async function dragConnectorBetween(
  page: Page,
  from: WorldPoint,
  to: WorldPoint,
  options: { onStart?: () => Promise<void> } = {},
): Promise<void> {
  const start = await shapeScreenOf(page, from);
  const finish = await shapeScreenOf(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(finish.x, finish.y, { steps: 10 });
  if (options.onStart) {
    await options.onStart();
  }
  await page.mouse.up();
  await page.waitForTimeout(120);
}

/** Press down on one shape and hold, so a remote action can land mid-drag. */
export async function pressConnectorOn(page: Page, at: WorldPoint): Promise<ScreenPoint> {
  const point = await shapeScreenOf(page, at);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 6, point.y + 6, { steps: 4 });
  await page.waitForTimeout(60);
  return point;
}

export async function releaseConnectorAt(page: Page, at: WorldPoint): Promise<void> {
  const point = await shapeScreenOf(page, at);
  await page.mouse.move(point.x, point.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

/** The four attach dots the tool shows over the shape it is hovering (`connector.anchors`). */
export async function connectorDots(page: Page): Promise<{ side: string | null; active: boolean }[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="connector-dot"]')).map(
      (dot) => ({
        side: dot.getAttribute('data-side'),
        active: dot.getAttribute('data-active') === 'true',
      }),
    ),
  );
}

/** The arrow as this page painted it: two world points. */
export async function drawnConnectorEnds(page: Page, id: string): Promise<{ from: WorldPoint; to: WorldPoint }> {
  const line = page.locator(`[data-testid="connector-line-${id}"]`);
  const local = await line.evaluate((el) => ({
    x1: Number(el.getAttribute('x1')),
    y1: Number(el.getAttribute('y1')),
    x2: Number(el.getAttribute('x2')),
    y2: Number(el.getAttribute('y2')),
  }));
  const entry = await connectorOf(page, id);
  return {
    from: { x: entry.x + local.x1, y: entry.y + local.y1 },
    to: { x: entry.x + local.x2, y: entry.y + local.y2 },
  };
}

/**
 * Which side of a shape an arrow's end is drawn at.
 *
 * The board never stores a side (`connector.endpoints`), so this reads the answer
 * off the geometry: the side whose midpoint the drawn point landed on.
 */
export async function drawnAttachSide(
  page: Page,
  connectorId: string,
  shapeId: string,
  end: 'from' | 'to',
): Promise<AttachSide | null> {
  const ends = await drawnConnectorEnds(page, connectorId);
  const point = ends[end];
  const shape = (await page.evaluate((id) => {
    const api = (window as unknown as { __vidi6?: { shapes(): { id: string; x: number; y: number; width: number; height: number }[] } }).__vidi6;
    if (!api) {
      throw new Error('test hooks are not installed');
    }
    return api.shapes().find((shape) => shape.id === id) ?? null;
  }, shapeId))!;
  if (!shape) {
    throw new Error(`shape ${shapeId} is not on the board`);
  }
  const candidates: [AttachSide, WorldPoint][] = [
    ['left', { x: shape.x, y: shape.y + shape.height / 2 }],
    ['right', { x: shape.x + shape.width, y: shape.y + shape.height / 2 }],
    ['top', { x: shape.x + shape.width / 2, y: shape.y }],
    ['bottom', { x: shape.x + shape.width / 2, y: shape.y + shape.height }],
  ];
  let best: { side: AttachSide; distance: number } | null = null;
  for (const [side, anchor] of candidates) {
    const distance = Math.hypot(point.x - anchor.x, point.y - anchor.y);
    if (!best || distance < best.distance) {
      best = { side, distance };
    }
  }
  // Only a point actually on the boundary counts as attached to that side.
  return best && best.distance <= 2 ? best.side : null;
}

/** Wait until this arrow's resolved end sits at (within a tolerance) a world point. */
export async function waitForConnectorEndNear(
  page: Page,
  id: string,
  end: 'from' | 'to',
  want: WorldPoint,
  tolerance = 2,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const entry = await connectorOf(page, id);
        const point = entry.points[end];
        return Math.hypot(point.x - want.x, point.y - want.y) <= tolerance;
      },
      { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: `connector ${id} end ${end} never reached the point` },
    )
    .toBe(true);
}

/** Wait until an arrow with this id is gone. */
export async function waitForConnectorGone(page: Page, id: string): Promise<void> {
  await expect
    .poll(async () => (await getConnectors(page)).some((entry) => entry.id === id), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      message: `connector ${id} never went away`,
    })
    .toBe(false);
}

/** Drag one of a selected arrow's end handles by (dx, dy) screen pixels. */
export async function dragConnectorHandle(
  page: Page,
  id: string,
  end: 'from' | 'to',
  dx: number,
  dy: number,
): Promise<void> {
  const handle = page.locator(`[data-testid="connector-handle-${end}"]`);
  const box = await handle.boundingBox();
  if (!box) {
    throw new Error(`connector ${id} is not showing its ${end} handle`);
  }
  const grab = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + dx / 2, grab.y + dy / 2, { steps: 8 });
  await page.mouse.move(grab.x + dx, grab.y + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

/** Select an arrow by clicking the line itself, at a world point along it. */
export async function clickConnectorAt(page: Page, at: WorldPoint): Promise<void> {
  const point = await shapeScreenOf(page, at);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(80);
}

export async function waitForConnectorSelected(page: Page, id: string): Promise<void> {
  await expect
    .poll(
      async () =>
        (await connectorCard(page, id).getAttribute('data-selected')) === 'true',
      { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: `connector ${id} was never selected` },
    )
    .toBe(true);
}

/** The camera zoom this page is on, which is what a screen tolerance divides by. */
export async function connectorZoom(page: Page): Promise<number> {
  return (await getCamera(page)).zoom;
}
