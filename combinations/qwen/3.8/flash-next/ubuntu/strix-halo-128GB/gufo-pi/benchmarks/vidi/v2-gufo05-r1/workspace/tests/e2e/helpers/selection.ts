/**
 * Browser helpers for story 7: selecting, moving and resizing several objects.
 *
 * The board says what is selected in the DOM (`data-selected`, the outlines in
 * `SelectionOverlay`, the count in the selection bar), so a test reads the board rather
 * than the app's internals — the same approach stories 1 and 2 set.
 *
 * The marquee is a Shift-drag on empty board space, and the resize handles are real
 * buttons at the corners and edges of the selection's bounding box, so everything here
 * is a pointer gesture a person can actually make.
 */
import { expect, type Page } from '@playwright/test';

import type { HandleId } from '../../../src/shared/geometry';
import type { ScreenPoint } from './board';

export const OUTLINE = '[data-testid="selection-outline"]';
export const SELECTION_COUNT = '[data-testid="selection-count"]';
export const NOTE_TOOLBAR = '[aria-label="Sticky note tools"]';
export const HANDLE = '[data-testid="selection-handle"]';
export const MARQUEE = '[data-testid="marquee"]';

/** Ids of the objects the board marks as selected, in document order. */
export async function selectedIds(page: Page): Promise<string[]> {
  return page.$$eval('[data-object-id][data-selected="true"]', (elements) =>
    elements.map((element) => (element as HTMLElement).dataset.objectId ?? ''),
  );
}

/** What the selection bar says, or null when it is not showing a count. */
export async function selectionCountText(page: Page): Promise<string | null> {
  const element = page.locator(SELECTION_COUNT);
  if ((await element.count()) === 0) return null;
  return (await element.textContent()) ?? null;
}

/** Wait until exactly `count` objects are selected, and say what the bar reads. */
export async function expectSelectedCount(page: Page, count: number): Promise<void> {
  await expect
    .poll(() => selectedIds(page).then((ids) => ids.length), {
      message: `the board does not show ${String(count)} selected objects`,
      timeout: 10_000,
    })
    .toBe(count);
  if (count >= 2) {
    await expect(page.locator(SELECTION_COUNT)).toHaveText(`${String(count)} selected`);
  }
}

/** One outline per selected object, drawn in screen space above the board. */
export async function outlineCount(page: Page): Promise<number> {
  return (await page.$$(OUTLINE)).length;
}

export async function handleCount(page: Page): Promise<number> {
  return (await page.$$(HANDLE)).length;
}

/** Shift-drag as far as `to` and hold, so the rectangle itself can be looked at. */
export async function marqueeStart(page: Page, from: ScreenPoint, to: ScreenPoint): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
}

/** Let go of a marquee that `marqueeStart` began. */
export async function marqueeEnd(page: Page): Promise<void> {
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.locator(MARQUEE)).toHaveCount(0);
}

/**
 * Shift-drag a selection rectangle, and let go.
 *
 * The rectangle exists while the pointer is down, so the caller can look at it between
 * `marqueeStart` and `marqueeEnd`; a plain `dragMarquee` is the whole gesture.
 */
export async function dragMarquee(
  page: Page,
  from: ScreenPoint,
  to: ScreenPoint,
  options: { add?: boolean; steps?: number } = {},
): Promise<void> {
  await page.keyboard.down('Shift');
  try {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: options.steps ?? 12 });
    await page.mouse.up();
  } finally {
    await page.keyboard.up('Shift');
  }
}

/** The centre of one resize handle, in screen points. */
export async function handleCentre(page: Page, handle: HandleId): Promise<ScreenPoint> {
  const box = await page
    .locator(`${HANDLE}[data-handle="${handle}"]`)
    .boundingBox()
    .catch(() => null);
  if (!box) throw new Error(`the selection draws no ${handle} handle`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drag a resize handle by a screen delta. */
export async function dragHandle(
  page: Page,
  handle: HandleId,
  delta: ScreenPoint,
  options: { shift?: boolean; steps?: number } = {},
): Promise<void> {
  const from = await handleCentre(page, handle);
  if (options.shift) await page.keyboard.down('Shift');
  try {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps: options.steps ?? 12 });
    await page.mouse.up();
  } finally {
    if (options.shift) await page.keyboard.up('Shift');
  }
  // The writes are coalesced to one per animation frame; settle before a test reads.
  await page.waitForTimeout(80);
}

/**
 * The id of the object the browser paints uppermost at a point, or null when the point
 * shows bare board. This is the one thing only a real browser can say: what covers what.
 */
export async function objectIdAtPoint(page: Page, point: ScreenPoint): Promise<string | null> {
  return page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return element?.closest('[data-object-id]')?.getAttribute('data-object-id') ?? null;
  }, point);
}

/** Delete what is selected with the bar's own button. */
export async function deleteSelectionFromBar(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Delete selection' }).click();
}

/**
 * Put notes on the board at the given screen points, one per double-click, and leave
 * editing after each. The board opens at 100 % zoom, where a screen point and a world
 * point differ only by the view's centre, so spacing notes by 300 screen pixels spaces
 * them by 300 world units.
 */
export async function placeNotes(page: Page, points: ScreenPoint[]): Promise<string[]> {
  const ids: string[] = [];
  for (const point of points) {
    const before = new Set((await readObjects(page)).map((object) => object.id));
    await page.mouse.dblclick(point.x, point.y);
    await expect(page.locator('[data-testid="sticky-note-textarea"]')).toBeVisible();
    await page.keyboard.press('Escape');
    let fresh: string[] = [];
    await expect
      .poll(
        async () => {
          fresh = (await readObjects(page))
            .map((object) => object.id)
            .filter((id) => !before.has(id));
          return fresh.length;
        },
        { message: 'the double-click did not add exactly one note' },
      )
      .toBe(1);
    ids.push(fresh[0]!);
  }
  return ids;
}


/** The painted rectangle of the object with the given id. */
export async function objectBox(page: Page, id: string): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  const box = await page
    .locator(`[data-object-id="${id}"]`)
    .boundingBox()
    .catch(() => null);
  if (!box) throw new Error(`object ${id} is not on screen`);
  return box;
}

/** Where every object sits, from the document state the element reports. */
export async function readObjects(page: Page): Promise<
  { id: string; x: number; y: number; width: number; height: number; z: number }[]
> {
  return page.$$eval('[data-object-id]', (elements) =>
    elements.map((element) => {
      const node = element as HTMLElement;
      return {
        id: node.dataset.objectId ?? '',
        x: Number(node.dataset.noteX),
        y: Number(node.dataset.noteY),
        width: Number(node.dataset.noteWidth),
        height: Number(node.dataset.noteHeight),
        z: Number(node.dataset.noteZ),
      };
    }),
  );
}
