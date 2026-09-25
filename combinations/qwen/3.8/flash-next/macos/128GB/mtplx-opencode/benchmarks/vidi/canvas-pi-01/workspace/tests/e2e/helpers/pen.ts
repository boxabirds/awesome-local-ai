/**
 * Story 11 · e2e helpers for the Pen tool and sketches.
 *
 * A hand-drawn line is the one thing in the app that cannot be checked from the
 * stored numbers alone: the requirement is what a person *sees* and *can grab*.
 * So everything here reads the painted page — the stroke's box, the box of its
 * ink, and the width of its ink — through `getBoundingClientRect()` and the
 * `data-*` stamps the renderers add. Nothing is recomputed in test code, which
 * is the point: a mismatch between the model and the pixels is a failure here.
 */
import type { Page } from '@playwright/test';
import { settle } from './board';

export interface StrokeReadout {
  id: string;
  /** The stroke's own box, in CSS pixels. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** The box of the painted ink inside it (the visible path only). */
  inkLeft: number;
  inkTop: number;
  inkWidth: number;
  inkHeight: number;
  /** The painted ink width, in user units (CSS pixels at zoom 1). */
  strokeWidth: number;
  /** The stored ink token (`black`, `red`, …). */
  color: string;
  /** The stored width token (`thin`, `medium`, `thick`). */
  thickness: string;
  selected: boolean;
}

/** Every sketch currently painted, in paint order. */
export async function strokes(page: Page): Promise<StrokeReadout[]> {
  return page.evaluate(() => {
    const out: StrokeReadout[] = [];
    document.querySelectorAll<HTMLElement>('[data-stroke-id]').forEach((node) => {
      const rect = node.getBoundingClientRect();
      const visible = node.querySelector<SVGPathElement>('[data-testid="stroke-visible"]');
      const ink = visible ? visible.getBoundingClientRect() : rect;
      out.push({
        id: node.dataset.strokeId ?? '',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        inkLeft: ink.left,
        inkTop: ink.top,
        inkWidth: ink.width,
        inkHeight: ink.height,
        strokeWidth: visible ? Number.parseFloat(visible.getAttribute('stroke-width') ?? '0') : 0,
        color: node.dataset.color ?? '',
        thickness: node.dataset.width ?? '',
        selected: node.dataset.selected === 'true',
      });
    });
    return out;
  });
}

/**
 * Draw one sketch with the Pen tool.
 *
 * The pointer is moved in short segments with a repaint between them, the same
 * reason the arrow helper pauses: a single long move lets the pointer outrun the
 * line being drawn. `settle` between segments also means the preview SVG is
 * repainted, so the committed stroke matches what was on screen while drawing.
 */
export async function drawStroke(page: Page, points: Array<[number, number]>): Promise<void> {
  // Escape first: a letter is a tool shortcut only when no editor has focus.
  await page.keyboard.press('Escape');
  await page.keyboard.press('p');
  await settle(page);
  const [first, ...rest] = points;
  if (first === undefined) return;
  await page.mouse.move(first[0], first[1]);
  await page.mouse.down();
  for (const [x, y] of rest) {
    await page.mouse.move(x, y, { steps: 8 });
    await settle(page);
  }
  await page.mouse.up();
  await settle(page, 4);
}

/** Select the Select tool and press once at a screen point. */
export async function tapAt(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await settle(page);
  await page.mouse.click(x, y);
  await settle(page, 4);
}

/**
 * Drag a stroke's resize handle, by its `data-testid`, from its own centre.
 *
 * Select comes first, deliberately: while the Pen tool is active its overlay owns
 * every press on the board (that is what lets a second sketch start anywhere), so
 * a handle under it is unreachable until the tool goes back to Select — the same
 * tool model the shape tests work in.
 */
export async function dragHandle(
  page: Page,
  handle: string,
  dx: number,
  dy: number,
): Promise<boolean> {
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await settle(page);
  const box = await page.getByTestId(`stroke-handle-${handle}`).boundingBox();
  if (box === null) return false;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx * 0.5, from.y + dy * 0.5, { steps: 6 });
  await settle(page);
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
  await settle(page);
  await page.mouse.up();
  await settle(page, 4);
  return true;
}
