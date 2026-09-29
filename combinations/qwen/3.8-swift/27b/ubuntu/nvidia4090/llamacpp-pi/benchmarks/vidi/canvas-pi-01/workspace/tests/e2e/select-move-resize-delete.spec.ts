// Story 7 e2e: select, move, resize and delete several objects at once
// (TC-32 to TC-36).
//
// Runs against `wrangler dev` (see playwright.config.ts) in Chromium,
// Firefox and WebKit. Fixtures place notes at exact world coordinates via
// the test-only hook; every assertion reads the world state back from the
// Y.Doc so camera rounding never matters.

import { expect, test, type Page } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { clampScale, resizeRect, scaleWithin, type Rect } from '../../src/shared/geometry';
import { settleCamera, setCamera } from './helpers/board';
import { closeParticipant, createFreshBoard, openParticipant, type Participant } from './helpers/participants';

const NOTE = '[data-testid="sticky-note"]';
const STICKY = 200; // sticky notes are 200x200 world units

/**
 * The home camera of a page (100%, world origin centred). Derived from the
 * page's actual viewport: `openParticipant` contexts do not inherit the
 * project's 800px-tall viewport, so hardcoding -400 would be wrong.
 */
async function homeCam(page: Page, zoom = 1): Promise<{ x: number; y: number; zoom: number }> {
  const { width, height } = page.viewportSize() ?? { width: 1280, height: 800 };
  return { x: -width / 2, y: -height / 2, zoom };
}

/** World (x,y) → screen px under a camera (screen = (world - cam) * zoom). */
function sx(cam: { x: number; y: number; zoom: number }, wx: number): number {
  return (wx - cam.x) * cam.zoom;
}
function sy(cam: { x: number; y: number; zoom: number }, wy: number): number {
  return (wy - cam.y) * cam.zoom;
}

interface WorldObject {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  z: number;
}

/** All objects in the page's Y.Doc, as plain world state. */
async function worldObjects(page: Page): Promise<WorldObject[]> {
  return page.evaluate(() => {
    const hook = window.__vidi6;
    if (hook === undefined) throw new Error('window.__vidi6 test hook is not available');
    const objects = hook.getDoc().getMap('objects');
    const out: WorldObject[] = [];
    for (const key of objects.keys()) {
      const o = objects.get(key) as import('yjs').Map<unknown>;
      out.push({
        id: String(key),
        type: o.get('type') as string,
        x: o.get('x') as number,
        y: o.get('y') as number,
        width: o.get('width') as number | undefined,
        height: o.get('height') as number | undefined,
        z: o.get('z') as number,
      });
    }
    return out;
  });
}

/** Create a sticky note with its top-left corner at world (x, y). */
async function placeNote(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(
    ({ x, y }) => {
      const hook = window.__vidi6;
      if (hook === undefined) throw new Error('window.__vidi6 test hook is not available');
      return hook.createNoteAt(x + 100, y + 100);
    },
    { x, y },
  );
}

/**
 * Shift+drag a marquee from world (x0,y0) to (x1,y1). The start point must
 * be on empty board space (the marquee only begins on the viewport itself).
 */
async function marquee(
  page: Page,
  cam: { x: number; y: number; zoom: number },
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(sx(cam, x0), sy(cam, y0));
  await page.mouse.down();
  await page.mouse.move(sx(cam, x1), sy(cam, y1), { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await settleCamera(page);
}

/** The ids of the currently selected notes, in DOM order. */
async function selectedIds(page: Page): Promise<string[]> {
  const els = page.locator(`${NOTE}[data-selected]`);
  const n = await els.count();
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const id = await els.nth(i).getAttribute('data-id');
    if (id !== null) ids.push(id);
  }
  return ids;
}

/**
 * Click the centre of the note at world (x, y), verifying the selection
 * took (WebKit + Playwright can drop a click under load; retry if so).
 */
async function clickNoteAt(
  page: Page,
  cam: { x: number; y: number; zoom: number },
  x: number,
  y: number,
  expectId?: string,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.mouse.click(sx(cam, x + 100), sy(cam, y + 100));
    await settleCamera(page);
    const sel = await selectedIds(page);
    if (expectId === undefined ? sel.length === 1 : sel.length === 1 && sel[0] === expectId) {
      return;
    }
  }
  throw new Error('clicking the note never selected it');
}

/** Drag (mouse down at the centre of a world rect, move by a world delta, up). */
async function dragWorld(
  page: Page,
  cam: { x: number; y: number; zoom: number },
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): Promise<void> {
  const px = sx(cam, cx);
  const py = sy(cam, cy);
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px + 5 * cam.zoom, py + 5 * cam.zoom, { steps: 2 });
  await page.mouse.move(px + dx * cam.zoom, py + dy * cam.zoom, { steps: 16 });
  await page.mouse.up();
  await settleCamera(page);
}

test.describe('story 7 e2e', () => {
  test('TC-32 marquee: A inside, B half inside, C outside → only A selected', async ({ browser, request }) => {
    const boardId = await createFreshBoard(request);
    const p = await openParticipant(browser, boardId);
    try {
      const cam = await homeCam(p.page);
      const a = await placeNote(p.page, 0, 0); // 0..200
      await placeNote(p.page, 150, 0); // 150..350: half inside
      await placeNote(p.page, 600, 0); // 600..800: outside

      // Marquee world (-50,-50) to (300,250): fully contains A, half of B.
      await marquee(p.page, cam, -50, -50, 300, 250);

      const selected = await selectedIds(p.page);
      expect(selected).toEqual([a]);
    } finally {
      await closeParticipant(p);
    }
  });

  test('TC-33 six notes move 300 units together above a 4th; corner resize scales sizes and gaps, notes stay square', async ({ browser, request }) => {
    const boardId = await createFreshBoard(request);
    const p = await openParticipant(browser, boardId);
    try {
      const cam = await homeCam(p.page, 0.8);
      await setCamera(p.page, cam);

      // 2x3 grid, 50-unit gaps, top-lefts at:
      const grid: [number, number][] = [
        [-600, -350],
        [-350, -350],
        [-100, -350],
        [-600, -100],
        [-350, -100],
        [-100, -100],
      ];
      const ids: string[] = [];
      for (const [x, y] of grid) ids.push(await placeNote(p.page, x, y));
      // A 4th note under where the grid will land.
      const fourth = await placeNote(p.page, 100, 250);

      // Select all six with a marquee.
      await marquee(p.page, cam, -620, -370, 120, 120);
      expect(await selectedIds(p.page)).toHaveLength(6);

      // Move the group 300 world units right and down.
      await dragWorld(p.page, cam, 0, 0, 300, 300);

      let objects = await worldObjects(p.page);
      for (let i = 0; i < grid.length; i += 1) {
        const o = objects.find((o) => o.id === ids[i]);
        expect(o?.x).toBe(grid[i]![0]! + 300);
        expect(o?.y).toBe(grid[i]![1]! + 300);
      }
      // The moved group is now above the 4th note.
      const zFourth = objects.find((o) => o.id === fourth)?.z ?? 0;
      for (const id of ids) {
        expect((objects.find((o) => o.id === id)?.z ?? 0)).toBeGreaterThan(zFourth);
      }

      // Corner-resize from the new group box, dragging the se handle by a
      // world delta of (150, 75). Aspect lock unifies the scale.
      const movedBox: Rect = { x: -300, y: -50, width: 700, height: 450 };
      const delta = { x: 150, y: 75 };
      const target = resizeRect(movedBox, 'se', delta, true);
      const scale = { x: target.width / movedBox.width, y: target.height / movedBox.height };
      const clamped = clampScale(scale, [movedBox], [STICKY], 20_000);
      const s = Math.min(clamped.x, clamped.y);
      const clampedBox: Rect = { x: movedBox.x, y: movedBox.y, width: movedBox.width * s, height: movedBox.height * s };

      const handle = p.page.locator('[data-handle="se"]');
      const box = (await handle.boundingBox()) ?? undefined;
      if (box === undefined) throw new Error('se handle not found');
      await p.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await p.page.mouse.down();
      await p.page.mouse.move(box.x + box.width / 2 + delta.x * cam.zoom, box.y + box.height / 2 + delta.y * cam.zoom, { steps: 16 });
      await p.page.mouse.up();
      await settleCamera(p.page);

      objects = await worldObjects(p.page);
      for (let i = 0; i < grid.length; i += 1) {
        const expected = scaleWithin(
          { x: grid[i]![0]! + 300, y: grid[i]![1]! + 300, width: STICKY, height: STICKY },
          movedBox,
          clampedBox,
        );
        const o = objects.find((o) => o.id === ids[i]);
        expect(o?.x).toBeCloseTo(expected.x, 3);
        expect(o?.y).toBeCloseTo(expected.y, 3);
        expect(o?.width).toBeCloseTo(expected.width, 3);
        expect(o?.height).toBeCloseTo(expected.height, 3);
        // Notes stay square.
        expect(o?.width).toBeCloseTo(o?.height ?? 0, 3);
      }
      // Gaps scaled too: the two notes in the top row kept their 250-unit
      // pitch, scaled by s.
      const top0 = objects.find((o) => o.id === ids[0])!;
      const top1 = objects.find((o) => o.id === ids[1])!;
      expect(top1.x - top0.x).toBeCloseTo(250 * s, 3);
    } finally {
      await closeParticipant(p);
    }
  });

  test('TC-34 arrows nudge the selection without scrolling or panning; Delete removes all', async ({ browser, request }) => {
    const boardId = await createFreshBoard(request);
    const p = await openParticipant(browser, boardId);
    try {
      const cam = await homeCam(p.page);
      const a = await placeNote(p.page, 0, 0);
      const b = await placeNote(p.page, 300, 0);
      const other = await placeNote(p.page, 0, 600);
      void other;

      await marquee(p.page, cam, -50, -50, 550, 250);
      expect(await selectedIds(p.page)).toHaveLength(2);

      const camBefore = (await p.page.evaluate(() => {
        const el = document.querySelector('[data-testid="board-world"]') as HTMLElement;
        return el.style.transform;
      })) as string;

      await p.page.keyboard.press('ArrowRight');
      await settleCamera(p.page);
      let objects = await worldObjects(p.page);
      expect(objects.find((o) => o.id === a)?.x).toBe(1);
      expect(objects.find((o) => o.id === b)?.x).toBe(301);

      await p.page.keyboard.press('Shift+ArrowUp');
      await settleCamera(p.page);
      objects = await worldObjects(p.page);
      expect(objects.find((o) => o.id === a)?.y).toBe(-10);
      expect(objects.find((o) => o.id === b)?.y).toBe(-10);

      // No page scroll, no board pan.
      expect(await p.page.evaluate(() => window.scrollY)).toBe(0);
      expect(await p.page.evaluate(() => (document.querySelector('[data-testid="board-world"]') as HTMLElement).style.transform)).toBe(camBefore);

      // Delete removes exactly the selection.
      await p.page.keyboard.press('Delete');
      await settleCamera(p.page);
      objects = await worldObjects(p.page);
      expect(objects.find((o) => o.id === a)).toBeUndefined();
      expect(objects.find((o) => o.id === b)).toBeUndefined();
      expect(objects.find((o) => o.id === other)).toBeDefined();
      expect(await selectedIds(p.page)).toEqual([]);
    } finally {
      await closeParticipant(p);
    }
  });

  test('TC-35 Sam deletes one of Lee\'s selected notes → Lee\'s selection drops by 1', async ({ browser, request }) => {
    const boardId = await createFreshBoard(request);
    const lee = await openParticipant(browser, boardId);
    const sam = await openParticipant(browser, boardId);
    try {
      const cam = await homeCam(lee.page);
      const keep = await placeNote(lee.page, 0, 0);
      const gone = await placeNote(lee.page, 300, 0);

      // Lee box-selects both.
      await marquee(lee.page, cam, -50, -50, 550, 250);
      expect(await selectedIds(lee.page)).toHaveLength(2);
      await expect(
        lee.page.locator('[data-testid="selection-count"]').textContent(),
      ).resolves.toBe('2 selected');

      // Sam selects and deletes one of them.
      await clickNoteAt(sam.page, cam, 300, 0, gone);
      await sam.page.keyboard.press('Delete');
      await settleCamera(sam.page);

      // Lee's selection prunes within the live-update budget.
      await expect
        .poll(async () => (await worldObjects(lee.page)).some((o) => o.id === gone), {
          timeout: 10_000,
        })
        .toBe(false);
      const remaining = await selectedIds(lee.page);
      expect(remaining).toEqual([keep]);
      await expect(
        lee.page.locator('[data-testid="selection-count"]').textContent(),
      ).resolves.toBe('1 selected');
    } finally {
      await closeParticipant(lee);
      await closeParticipant(sam);
    }
  });

  test(`TC-36 ${MAX_CONCURRENT_EDITORS} editors move different selections simultaneously → identical final positions`, async ({ browser, request }) => {
    const boardId = await createFreshBoard(request);
    const first = await openParticipant(browser, boardId);
    const spacing = 240;
    const ids: string[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
      ids.push(await placeNote(first.page, i * spacing, 0));
    }
    // Remaining editors join the same board.
    const rest: Participant[] = [];
    for (let i = 1; i < MAX_CONCURRENT_EDITORS; i += 1) {
      rest.push(await openParticipant(browser, boardId));
    }
    const all = [first, ...rest];
    try {
      const cam = await homeCam(first.page, 0.5);
      await Promise.all(all.map((pt) => setCamera(pt.page, cam)));

      // Each editor selects its own note and drags it down 400 units, all at
      // once. Under 5-way parallel load browsers drop input events (the other
      // specs retry for the same reason), so each editor self-heals: after a
      // drag, re-drag from wherever the note actually is until it reaches its
      // target.
      await Promise.all(
        all.map((pt, i) =>
          (async () => {
            await clickNoteAt(pt.page, cam, i * spacing, 0, ids[i]);
            await dragWorld(pt.page, cam, i * spacing + 100, 100, 0, 400);
            for (let attempt = 0; attempt < 5; attempt += 1) {
              const objects = await worldObjects(pt.page);
              const o = objects.find((q) => q.id === ids[i]);
              if (o !== undefined && o.x === i * spacing && o.y === 400) return;
              await dragWorld(pt.page, cam, (o?.x ?? i * spacing) + 100, (o?.y ?? 0) + 100, i * spacing - (o?.x ?? i * spacing), 400 - (o?.y ?? 0));
            }
          })(),
        ),
      );
      await Promise.all(all.map((pt) => settleCamera(pt.page)));

      // Every client converges on the identical final positions.
      for (const pt of all) {
        await expect
          .poll(async () => {
            const objects = await worldObjects(pt.page);
            if (objects.length !== ids.length) return false;
            return objects.every((o) => {
              const i = ids.indexOf(o.id);
              return i >= 0 && o.x === i * spacing && o.y === 400;
            });
          }, { timeout: 15_000 })
          .toBeTruthy();
      }
    } finally {
      await Promise.all(all.map((pt) => closeParticipant(pt)));
    }
  });
});
