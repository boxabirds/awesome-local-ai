/** e2e helpers for story 10 (shapes and arrows). */
import { expect, type Locator, type Page } from '@playwright/test';
import { nextFrames } from './board';

const DRAG_STEPS = 10;
const HALF = 2;

export interface Pt {
  x: number;
  y: number;
}
export interface RectState {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShapeState extends RectState {
  id: string;
  kind: string;
  label: string;
  fill: string;
  stroke: string;
}

export interface ArrowState {
  id: string;
  from: { kind: string; objectId?: string; x?: number; y?: number; fallback?: Pt };
  to: { kind: string; objectId?: string; x?: number; y?: number; fallback?: Pt };
  fromPoint: Pt;
  toPoint: Pt;
}

export async function shapes(page: Page): Promise<ShapeState[]> {
  return page.evaluate(() =>
    window
      .__vidi6!.getObjects()
      .filter((o) => o.type === 'shape')
      .map((o) => ({
        id: o.id,
        kind: o.kind ?? '',
        label: o.label ?? '',
        fill: o.fill ?? '',
        stroke: o.stroke ?? '',
        x: o.x,
        y: o.y,
        width: o.width ?? 0,
        height: o.height ?? 0,
      })),
  );
}

export async function arrows(page: Page): Promise<ArrowState[]> {
  return page.evaluate(() =>
    window
      .__vidi6!.getObjects()
      .filter((o) => o.type === 'connector')
      .map((o) =>
        JSON.parse(JSON.stringify({ id: o.id, from: o.from, to: o.to, fromPoint: o.fromPoint, toPoint: o.toPoint })),
      ),
  );
}

/** The ends of an arrow as drawn in this page's DOM (world units), or null when it is not drawn. */
export async function drawnArrow(page: Page, id: string): Promise<{ from: Pt; to: Pt } | null> {
  const el = page.locator(`[data-testid="connector-object"][data-id="${id}"]`);
  if ((await el.count()) === 0) return null;
  return el.evaluate((e: HTMLElement) => ({
    from: { x: Number(e.dataset.x1), y: Number(e.dataset.y1) },
    to: { x: Number(e.dataset.x2), y: Number(e.dataset.y2) },
  }));
}

export function shapeLocator(page: Page, id: string): Locator {
  return page.locator(`[data-testid="shape-object"][data-id="${id}"]`);
}

export async function dragBetween(page: Page, a: Pt, b: Pt, opts: { shift?: boolean } = {}): Promise<void> {
  await page.mouse.move(a.x, a.y);
  if (opts.shift) await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: DRAG_STEPS });
  await page.mouse.up();
  if (opts.shift) await page.keyboard.up('Shift');
  await nextFrames(page);
}

export async function centreOf(locator: Locator): Promise<Pt> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not rendered');
  return { x: box.x + box.width / HALF, y: box.y + box.height / HALF };
}

export function rectCentre(r: RectState): Pt {
  return { x: r.x + r.width / HALF, y: r.y + r.height / HALF };
}

/** Screen position of a world point (the board fills the page). */
export async function worldToPage(page: Page, p: Pt): Promise<Pt> {
  const cam = await page.evaluate(() => window.__vidi6!.getCamera());
  return { x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom };
}

export async function chooseTool(page: Page, key: 's' | 'l', name: 'Shape (S)' | 'Connector (L)'): Promise<void> {
  await page.keyboard.press(key);
  await expect(page.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
}
