// Story 2 e2e: sticky notes on a real board (TC-30 to TC-34 + golden path).
//
// Runs against `wrangler dev` (see playwright.config.ts) in Chromium,
// Firefox and WebKit. Workflows follow the design's "E2E workflows".

import { expect, test, type Page } from '@playwright/test';
import type * as Y from 'yjs';
import { THOUSAND_CHAR_PARAGRAPH } from '../fixtures/texts';
import { createBoardViaHook, openBoard, settleCamera, setCamera } from './helpers/board';

const NOTE = '[data-testid="sticky-note"]';
/** Pixel tolerance for "exact" pointer tracking (spec: within 1 pixel). */
const EXACT_PX = 1;

/** The rendered sticky notes, in DOM (z) order. */
function notes(page: Page) {
  return page.locator(NOTE);
}

async function noteCenter(page: Page, nth = 0): Promise<{ x: number; y: number }> {
  const box = (await notes(page).nth(nth).boundingBox()) ?? undefined;
  if (box === undefined) throw new Error(`sticky note ${nth} has no bounding box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** World-space top-left position of the first sticky note in the Y.Doc. */
async function firstNoteWorld(page: Page): Promise<{ x: number; y: number }> {
  const pos = await page.evaluate(() => {
    const hook = window.__vidi6;
    if (hook === undefined) throw new Error('window.__vidi6 test hook is not available');
    for (const item of hook.getDoc().getMap('objects').values()) {
      const o = item as Y.Map<unknown>;
      if (o.get('type') === 'sticky') {
        return { x: o.get('x') as number, y: o.get('y') as number };
      }
    }
    throw new Error('no sticky note in the document');
  });
  return pos;
}

/** The data-id of the note rendered on top at screen point (x, y). */
async function topNoteIdAt(page: Page, x: number, y: number): Promise<string> {
  const id = await page.evaluate(
    ({ px, py }) => {
      const el = document.elementFromPoint(px, py)?.closest('[data-testid="sticky-note"]');
      if (el === null || el === undefined) throw new Error('no note at the expected point');
      return el.getAttribute('data-id');
    },
    { px: x, py: y },
  );
  if (id === null) throw new Error('top note has no data-id');
  return id;
}

/**
 * Drag the note under (x, y) by (dx, dy) screen pixels, verifying the drag
 * actually started (WebKit + Playwright can drop the pointerdown; retry if
 * so). A 3px probe move puts the note into its drag phase (threshold 3px).
 */
async function dragNote(page: Page, x: number, y: number, dx: number, dy: number): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 3, y + 3, { steps: 2 });
    await settleCamera(page);
    const started = await page.evaluate(
      ({ px, py }) => {
        const el = document.elementFromPoint(px, py)?.closest('[data-testid="sticky-note"]');
        return el?.getAttribute('data-dragging') === 'true';
      },
      { px: x + 3, py: y + 3 },
    );
    if (started) {
      await page.mouse.move(x + dx, y + dy, { steps: 10 });
      await page.mouse.up();
      await settleCamera(page);
      return;
    }
    // pointerdown was lost: release and retry.
    await page.mouse.up();
    await settleCamera(page);
  }
  throw new Error('the note drag never started');
}

/**
 * Drag the note under (x, y) and, if the browser dropped move events, make up
 * the shortfall so the net movement is exactly (dx, dy).
 */
async function dragNoteExactly(
  page: Page,
  x: number,
  y: number,
  dx: number,
  dy: number,
  nth = 0,
): Promise<{ x: number; y: number }> {
  const before = await noteCenter(page, nth);
  await dragNote(page, x, y, dx, dy);
  let after = await noteCenter(page, nth);
  let shortfall = { x: dx - (after.x - before.x), y: dy - (after.y - before.y) };
  if (Math.abs(shortfall.x) > 0.5 || Math.abs(shortfall.y) > 0.5) {
    await dragNote(page, after.x, after.y, shortfall.x, shortfall.y);
    after = await noteCenter(page, nth);
    shortfall = { x: dx - (after.x - before.x), y: dy - (after.y - before.y) };
  }
  if (Math.abs(shortfall.x) > EXACT_PX || Math.abs(shortfall.y) > EXACT_PX) {
    throw new Error(`drag short by (${shortfall.x}, ${shortfall.y})`);
  }
  return after;
}

async function createNoteViaButton(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sticky note' }).click();
}

test.describe('sticky notes (story 2)', () => {
  test('TC-30 double-click creates a note centred on the pointer; typing fills it', async ({    page,
    request,
  }) => {
    await openBoard(page, await createBoardViaHook(request));

    await page.mouse.dblclick(400, 300);
    await expect(notes(page)).toHaveCount(1);

    const centre = await noteCenter(page);
    expect(Math.abs(centre.x - 400)).toBeLessThanOrEqual(EXACT_PX);
    expect(Math.abs(centre.y - 300)).toBeLessThanOrEqual(EXACT_PX);

    // The new note is immediately editable.
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="sticky-text"]')).toHaveText('Hello');
  });

  test('TC-31 at 50%: a 100,50 screen-px drag moves the note +200,+100 world', async ({    page,
    request,
  }) => {
    await openBoard(page, await createBoardViaHook(request));
    // screen = zoom * (world - camera): keep world (0,0) at screen (640,400).
    await setCamera(page, { x: -1280, y: -800, zoom: 0.5 });
    await createNoteViaButton(page);
    const before = await noteCenter(page);

    const after = await dragNoteExactly(page, before.x, before.y, 100, 50);

    // The grabbed point stays under the pointer.
    expect(Math.abs(after.x - before.x - 100)).toBeLessThanOrEqual(EXACT_PX);
    expect(Math.abs(after.y - before.y - 50)).toBeLessThanOrEqual(EXACT_PX);
    // World space: the note started at top-left (-100,-100) → (+100, 0).
    const world = await firstNoteWorld(page);
    expect(world.x).toBeCloseTo(100, 6);
    expect(world.y).toBeCloseTo(0, 6);
  });

  test('TC-32 at 200%: a 100,50 screen-px drag moves +50,+25 world and brings the note to the front', async ({    page,
    request,
  }) => {
    await openBoard(page, await createBoardViaHook(request));
    // Keep world (0,0) at screen (640,400) at 200%.
    await setCamera(page, { x: -320, y: -200, zoom: 2 });

    await createNoteViaButton(page); // note A (z 1)
    await page.keyboard.press('Escape');
    await createNoteViaButton(page); // note B (z 2) on top of A
    await page.keyboard.press('Escape');
    const [idA, idB] = [
      await notes(page).nth(0).getAttribute('data-id'),
      await notes(page).nth(1).getAttribute('data-id'),
    ];
    if (idA === null || idB === null) throw new Error('notes have no data-id');

    // Move B (the top note) by the same (100, 50) screen drag.
    const bBefore = await noteCenter(page, 1);
    await dragNoteExactly(page, bBefore.x, bBefore.y, 100, 50, 1);

    // Drag A by (100, 50) — grabbing it in a corner region B no longer
    // covers (at 200% zoom the notes are 400px wide on screen). A spans
    // (440,200)-(840,600); B now spans (540,300)-(940,700).
    await dragNoteExactly(page, 470, 230, 100, 50);

    // A's world position at 200% zoom: top-left (-100,-100) + (50,25).
    const world = await firstNoteWorld(page);
    expect(world.x).toBeCloseTo(-50, 6);
    expect(world.y).toBeCloseTo(-75, 6);

    // Both notes now overlap; the dragged note (A) must be drawn on top.
    const shared = { x: 640 + 2 * 50, y: 400 + 2 * 25 };
    expect(await topNoteIdAt(page, shared.x, shared.y)).toBe(idA);
  });

  test('TC-33 short text fits at 24px; 1,000 pasted chars fit at 10px with a clipped fade', async ({    page,
    request,
  }) => {
    await openBoard(page, await createBoardViaHook(request));
    await createNoteViaButton(page);

    const font = async () =>
      page.evaluate(
        () =>
          getComputedStyle(
            document.querySelector('[data-testid="sticky-editor"] textarea') as HTMLElement,
          ).fontSize,
      );

    await page.keyboard.type('Hello');
    expect(await font()).toBe('24px');

    // Paste past the limit: the text clamps to exactly 1,000 characters.
    await page.keyboard.insertText(THOUSAND_CHAR_PARAGRAPH);
    expect(await font()).toBe('10px');
    // The counter shows the full limit is used.
    await expect(page.locator('[data-testid="sticky-counter"]')).toHaveText('1000/1000');
    // The text overflows at the minimum size: clipped, with the fade visible.
    const clipped = await page.evaluate(
      () => {
        const ta = document.querySelector(
          '[data-testid="sticky-editor"] textarea',
        ) as HTMLTextAreaElement;
        return ta.scrollHeight > ta.clientHeight;
      },
    );
    expect(clipped).toBe(true);
    await expect(page.locator('[data-testid="sticky-fade"]')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="sticky-fade"]')).toBeVisible();
    await expect(page.locator('[data-testid="sticky-text"]')).toBeVisible();
  });

  test('TC-34 creating from the toolbar while panned far away lands at the screen centre', async ({    page,
    request,
  }) => {
    await openBoard(page, await createBoardViaHook(request));
    await setCamera(page, { x: -5000, y: -4000, zoom: 1 });
    expect(await notes(page).count()).toBe(0);

    await createNoteViaButton(page);

    const centre = await noteCenter(page);
    expect(Math.abs(centre.x - 640)).toBeLessThanOrEqual(2);
    expect(Math.abs(centre.y - 400)).toBeLessThanOrEqual(2);
  });

  test('golden path: create, type, move at 50%, recolour pink, delete', async ({ page, request }) => {
    await openBoard(page, await createBoardViaHook(request));

    // Create by double-click and type.
    await page.mouse.dblclick(400, 300);
    await expect(notes(page)).toHaveCount(1);
    await page.keyboard.type('Brainstorm');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="sticky-text"]')).toHaveText('Brainstorm');

    // Move at 50% zoom (world (0,0) stays at screen (640,400)).
    await setCamera(page, { x: -1280, y: -800, zoom: 0.5 });
    const before = await noteCenter(page);
    await dragNoteExactly(page, before.x, before.y, 100, 50);
    const world = await firstNoteWorld(page);
    // Centre started at world (-240, -100) → top-left (-140, -100) after +200,+100.
    expect(world.x).toBeCloseTo(-140, 6);
    expect(world.y).toBeCloseTo(-100, 6);

    // Recolour to pink from the note toolbar (the note is selected after the drag).
    await page.getByRole('button', { name: 'Pink colour' }).click();
    const colour = await page.evaluate(() => {
      const hook = window.__vidi6;
      if (hook === undefined) throw new Error('window.__vidi6 test hook is not available');
      for (const item of hook.getDoc().getMap('objects').values()) {
        const o = item as Y.Map<unknown>;
        if (o.get('type') === 'sticky') return o.get('color') as string;
      }
      throw new Error('no sticky note in the document');
    });
    expect(colour).toBe('pink');
    const bg = await notes(page).first().evaluate((el) => el.style.backgroundColor);
    expect(bg).toBe('rgb(244, 143, 177)'); // #F48FB1

    // Delete.
    await page.keyboard.press('Delete');
    await expect(notes(page)).toHaveCount(0);
  });
});
