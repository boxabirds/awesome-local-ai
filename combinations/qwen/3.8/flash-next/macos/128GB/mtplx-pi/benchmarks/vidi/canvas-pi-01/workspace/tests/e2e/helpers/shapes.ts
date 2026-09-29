/**
 * Story 10 · task 15 — e2e helpers for shapes and arrows.
 *
 * Everything here reads what the page has actually *painted*: each shape's
 * on-screen box, and each arrow's line box plus its two stored ends. Geometry
 * comes from `getBoundingClientRect()` (already transformed by the world layer,
 * so it is in CSS pixels) and from the `data-*` attributes the renderers stamp,
 * so a test can say "the arrow is still attached to B, and its end moved to
 * B's other side" without reaching into React.
 */
import type { Page } from '@playwright/test';

export interface ShapeReadout {
  id: string;
  kind: string;
  left: number;
  top: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

export interface ArrowReadout {
  id: string;
  /** `attached:<id>` or `free`, straight from the painted element. */
  from: string;
  to: string;
  /** The painted line's box, in CSS pixels. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** True when the line runs left → right (checked before any transform). */
  leftToRight: boolean;
  /** True when the line runs top → bottom. */
  topToBottom: boolean;
}

/** Every shape currently painted, in paint order. */
export async function shapes(page: Page): Promise<ShapeReadout[]> {
  return page.evaluate(() => {
    const out: ShapeReadout[] = [];
    document.querySelectorAll<HTMLElement>('[data-shape-id]').forEach((node) => {
      const rect = node.getBoundingClientRect();
      out.push({
        id: node.dataset.shapeId ?? '',
        kind: node.dataset.kind ?? '',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
      });
    });
    return out;
  });
}

/** Every arrow currently painted, in paint order. */
export async function arrows(page: Page): Promise<ArrowReadout[]> {
  return page.evaluate(() => {
    const out: ArrowReadout[] = [];
    document.querySelectorAll<HTMLElement>('[data-connector-id]').forEach((node) => {
      const line = node.querySelector('[data-testid="connector-line"]');
      if (!line) return;
      const rect = line.getBoundingClientRect();
      const x1 = Number.parseFloat(line.getAttribute('x1') ?? '0');
      const x2 = Number.parseFloat(line.getAttribute('x2') ?? '0');
      const y1 = Number.parseFloat(line.getAttribute('y1') ?? '0');
      const y2 = Number.parseFloat(line.getAttribute('y2') ?? '0');
      out.push({
        id: node.dataset.connectorId ?? '',
        from: node.dataset.from ?? '',
        to: node.dataset.to ?? '',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        leftToRight: x2 >= x1,
        topToBottom: y2 >= y1,
      });
    });
    return out;
  });
}

/** Every shape label currently painted, with the box of its shape. */
export async function shapeLabels(page: Page): Promise<
  Array<{ id: string; text: string; left: number; top: number; width: number; height: number; lines: number }>
> {
  return page.evaluate(() => {
    const out: Array<{
      id: string;
      text: string;
      left: number;
      top: number;
      width: number;
      height: number;
      lines: number;
    }> = [];
    document.querySelectorAll<HTMLElement>('[data-shape-id]').forEach((node) => {
      const label = node.querySelector<HTMLElement>('[data-testid="shape-label"]');
      if (!label) return;
      const rect = label.getBoundingClientRect();
      const lineHeight = Number.parseFloat(getComputedStyle(label).lineHeight) || 16;
      // `scrollHeight`, not the box height: the label box is `overflow: hidden`
      // and sized to the shape, so its rect says how tall the *shape* is. The
      // content height is what says how many lines the text needed.
      out.push({
        id: node.dataset.shapeId ?? '',
        text: label.textContent ?? '',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        lines: Math.max(1, Math.round(label.scrollHeight / lineHeight)),
      });
    });
    return out;
  });
}

/** Paint a shape by dragging with the Shape tool, then wait for the paint. */
export async function drawShape(
  page: Page,
  from: [number, number],
  to: [number, number],
  kind: 'rect' | 'ellipse' | 'diamond' = 'rect',
): Promise<void> {
  // Escape first: a gesture that leaves a text editor open (a fresh note, a
  // shape being labelled) would otherwise swallow the tool shortcut, because
  // single letters are deliberately ignored while an editor has focus.
  await page.keyboard.press('Escape');
  await page.keyboard.press('s');
  await page.getByTestId(`shape-kind-${kind}`).click();
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 8 });
  await page.mouse.up();
  await settle(page);
}

/** Draw an arrow with the Connector tool, pausing for a repaint each step. */
export async function drawArrow(
  page: Page,
  from: [number, number],
  to: [number, number],
): Promise<void> {
  await page.keyboard.press('l');
  await settle(page);
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 6 });
  await settle(page);
  await page.mouse.move(to[0], to[1], { steps: 6 });
  await settle(page);
  await page.mouse.up();
  await settle(page);
}

/**
 * Move a shape by dragging it, in short pulls.
 *
 * Each pull starts on the shape itself and moves the pointer no further than
 * the shape's own shorter side. That is not shyness about the distance: one
 * long mouse move lets the pointer outrun the object it grabbed, and once the
 * pointer is no longer over the object the remaining moves go elsewhere — with
 * an arrow lying across the gap, the pull dies a few steps in. Re-pressing
 * over the object keeps every pull's pointer inside what it is dragging.
 */
export async function moveShape(
  page: Page,
  from: [number, number],
  to: [number, number],
): Promise<void> {
  await page.keyboard.press('v');
  await settle(page);

  const under = (list: ShapeReadout[], x: number, y: number): ShapeReadout | undefined =>
    list.find((shape) => x >= shape.left && x <= shape.left + shape.width && y >= shape.top && y <= shape.top + shape.height);

  const grabbed = under(await shapes(page), from[0], from[1]);
  if (grabbed === undefined) return;

  for (let pulls = 0; pulls < 24; pulls += 1) {
    // Re-find the shape we are dragging by id: it moves, so the point it was
    // under when the drag began stops being over it after the first pull.
    const target = (await shapes(page)).find((shape) => shape.id === grabbed.id);
    if (target === undefined) return;

    const dx = to[0] - target.cx;
    const dy = to[1] - target.cy;
    const distance = Math.hypot(dx, dy);
    if (distance <= 2) return;

    // Start on the object, pull toward the goal, staying inside it.
    const start: [number, number] = [target.cx, target.cy];
    const pull = Math.min(distance, Math.min(target.width, target.height) * 0.45);
    const end: [number, number] = [start[0] + (dx / distance) * pull, start[1] + (dy / distance) * pull];

    await page.mouse.move(start[0], start[1]);
    await page.mouse.down();
    await page.mouse.move(end[0], end[1], { steps: 6 });
    await settle(page);
    await page.mouse.up();
    await settle(page);
  }
}

/** The number of sticky notes painted (used to prove a gesture made no note). */
export async function stickyCount(page: Page): Promise<number> {
  return page.locator('[data-note-id]').count();
}

/** Wait for a paint commit (camera and DOM writes are rAF-batched). */
export async function settle(page: Page, frames = 3): Promise<void> {
  for (let frame = 0; frame < frames; frame += 1) {
    await page.evaluate(
      () =>
        new Promise<null>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)));
        }),
    );
  }
}
