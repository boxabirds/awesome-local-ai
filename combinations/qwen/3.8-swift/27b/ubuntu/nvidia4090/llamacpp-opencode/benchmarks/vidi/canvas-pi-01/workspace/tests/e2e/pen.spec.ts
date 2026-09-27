// Story 11 e2e: freehand pen (TC-17 to TC-20).
//
// Runs against `wrangler dev` (see playwright.config.ts) in Chromium, Firefox
// and WebKit. Participants are genuine y-websocket clients of the BoardRoom
// Durable Object; world state (strokes, stickies) is read back from each
// participant's Y.Doc so camera rounding never matters. The pen tool, pen
// toolbar, selection handles and the Delete key are driven through the real
// UI, and the stroke is drawn with a real pointer drag.

import { expect, test, type Page } from '@playwright/test';
import {
  closeParticipant,
  createFreshBoard,
  createNote,
  expectWithin,
  openParticipant,
} from './helpers/participants';
import { cameraFromRender } from './helpers/board';
import { PEN_THICKNESS_WORLD } from '../../src/shared/config';
import { HANDWRITTEN_LOOP } from '../fixtures/pen-paths';

/** The home camera of a page (100%, world origin centred). */
async function homeCam(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  const { width, height } = page.viewportSize() ?? { width: 1280, height: 800 };
  return { x: -width / 2, y: -height / 2, zoom: 1 };
}

/** World (x,y) → screen px under the given camera. */
function toScreen(cam: { x: number; y: number; zoom: number }, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - cam.x) * cam.zoom, y: (wy - cam.y) * cam.zoom };
}

interface WorldStroke {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  thickness: string;
  points: number[];
}

/** The stroke objects in the page's Y.Doc, as plain world state. */
async function worldStrokes(page: Page): Promise<WorldStroke[]> {
  return page.evaluate(() => {
    const hook = window.__vidi6;
    if (hook === undefined) throw new Error('window.__vidi6 test hook is not available');
    const objects = hook.getDoc().getMap('objects');
    const out: WorldStroke[] = [];
    for (const key of objects.keys()) {
      const o = objects.get(key) as import('yjs').Map<unknown>;
      if (o.get('type') !== 'stroke') continue;
      out.push({
        id: String(key),
        x: o.get('x') as number,
        y: o.get('y') as number,
        width: o.get('width') as number,
        height: o.get('height') as number,
        color: String(o.get('color')),
        thickness: String(o.get('thickness')),
        points: (o.get('points') as number[]) ?? [],
      });
    }
    return out;
  });
}

/** The sticky note's world position (first note). */
async function worldFirstSticky(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const hook = window.__vidi6;
    if (hook === undefined) throw new Error('window.__vidi6 test hook is not available');
    const objects = hook.getDoc().getMap('objects');
    for (const key of objects.keys()) {
      const o = objects.get(key) as import('yjs').Map<unknown>;
      if (o.get('type') !== 'sticky') continue;
      return { x: o.get('x') as number, y: o.get('y') as number };
    }
    return null;
  });
}

/** Activate the pen tool (P) and wait for its overlay. */
async function activatePen(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Pen (P)' }).click();
  await page.locator('[data-testid="pen-tool"]').waitFor({ state: 'visible' });
}

/** The preview path's `d` (null while not drawing). Reads via the DOM so it
resolves immediately when the preview element is absent (a locator `.evaluate`
would block on its default timeout). */
async function previewD(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="pen-preview"]');
    return el === null ? null : (el as SVGPathElement).getAttribute('d');
  });
}

/** Advance a couple of frames so a pending rAF preview flush renders. */
async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** A real pointer drag of the pen from (x0,y0) to (x1,y1) screen px. */
async function dragPen(page: Page, x0: number, y0: number, x1: number, y1: number, steps = 12): Promise<void> {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps });
  await page.mouse.up();
}

test.describe('story 11 — sketch freehand with a pen', () => {
  test('TC-17 drag a handwritten loop → preview updates live, one smoothed stroke lands', async ({
    browser,
    request,
  }) => {
    const boardId = await createFreshBoard(request);
    const p = await openParticipant(browser, boardId);
    try {
      await activatePen(p.page);
      const cam = await homeCam(p.page);

      // Replay a decimated version of the recorded loop as a real drag
      // (~60 points keeps the shape; a full 400-point replay is too slow
      // under the live per-move render loop).
      const stride = Math.max(1, Math.floor(HANDWRITTEN_LOOP.length / 40));
      const pts = HANDWRITTEN_LOOP.filter((_, i) => i % stride === 0).map((pt) => toScreen(cam, pt.x, pt.y));
      await p.page.mouse.move(pts[0]!.x, pts[0]!.y);
      await p.page.mouse.down();
      for (let i = 1; i < pts.length; i += 1) {
        await p.page.mouse.move(pts[i]!.x, pts[i]!.y);
      }

      // During the drag: the preview path exists and its `d` changes as new
      // points arrive (a fresh move queued between the two samples).
      const d1 = await previewD(p.page);
      expect(d1).not.toBeNull();
      await p.page.mouse.move(pts[pts.length - 1]!.x + 6, pts[pts.length - 1]!.y);
      await settleFrames(p.page);
      const d2 = await previewD(p.page);
      expect(d2).not.toBeNull();
      expect(d2).not.toBe(d1);

      await p.page.mouse.up();
      await settleFrames(p.page);

      // The preview is gone and exactly one stroke landed.
      expect(await previewD(p.page)).toBeNull();
      const strokes = await worldStrokes(p.page);
      expect(strokes).toHaveLength(1);
      // Simplified: far fewer points than the 400 raw samples.
      expect(strokes[0].points.length / 2).toBeLessThan(HANDWRITTEN_LOOP.length);
      // The rendered object is present.
      expect(await p.page.locator('[data-testid="stroke-object"]').count()).toBe(1);
    } finally {
      await closeParticipant(p);
    }
  });

  test('TC-18 Priya sketches; Sam sees it appear within the live-update budget', async ({
    browser,
    request,
  }) => {
    const boardId = await createFreshBoard(request);
    const priya = await openParticipant(browser, boardId);
    const sam = await openParticipant(browser, boardId);
    try {
      await activatePen(priya.page);
      const cam = await homeCam(priya.page);
      const a = toScreen(cam, -40, -30);
      const b = toScreen(cam, 60, 40);

      await priya.page.mouse.move(a.x, a.y);
      await priya.page.mouse.down();
      await priya.page.mouse.move(b.x, b.y, { steps: 8 });
      // Mid-drag: nothing committed on Sam's side yet.
      expect(await worldStrokes(sam.page)).toHaveLength(0);
      await priya.page.mouse.up();

      await expectWithin(async () => {
        return (await worldStrokes(sam.page)).length === 1;
      });
      // The stroke is rendered on Sam's screen too.
      expect(await sam.page.locator('[data-testid="stroke-object"]').count()).toBe(1);
    } finally {
      await closeParticipant(priya);
      await closeParticipant(sam);
    }
  });

  test('TC-19 wheel pans with the pen active; a later stroke lands and the note is unmoved', async ({
    browser,
    request,
  }) => {
    const boardId = await createFreshBoard(request);
    const p = await openParticipant(browser, boardId);
    try {
      // A sticky to annotate (created while the select tool is active).
      await createNote(p.page);
      await p.page.keyboard.press('Escape');
      const before = await worldFirstSticky(p.page);
      expect(before).not.toBeNull();

      await activatePen(p.page);
      const camBefore = await cameraFromRender(p.page);
      // Wheel on the board pans the camera even with the pen overlay active.
      await p.page.mouse.move(640, 400);
      await p.page.mouse.wheel(0, 240);
      await expectWithin(async () => {
        const cam = await cameraFromRender(p.page);
        return cam.y !== camBefore.y || cam.zoom !== camBefore.zoom;
      });

      // Drag the pen from the (now relocated) sticky centre by ~100px.
      const box = (await p.page.locator('[data-testid="sticky-note"]').first().boundingBox()) ?? undefined;
      if (box === undefined) throw new Error('sticky has no bounding box');
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await dragPen(p.page, cx, cy, cx + 100, cy + 40);
      await settleFrames(p.page);

      const strokes = await worldStrokes(p.page);
      expect(strokes).toHaveLength(1);
      const after = await worldFirstSticky(p.page);
      expect(after).not.toBeNull();
      expect(Math.abs(after!.x - before!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1);
    } finally {
      await closeParticipant(p);
    }
  });

  test('TC-20 tidy up: select, proportional resize (ratio + thickness held), move, delete both screens', async ({
    browser,
    request,
  }) => {
    const boardId = await createFreshBoard(request);
    const priya = await openParticipant(browser, boardId);
    const sam = await openParticipant(browser, boardId);
    try {
      await activatePen(priya.page);
      const cam = await homeCam(priya.page);
      const a = toScreen(cam, -80, -40);
      const b = toScreen(cam, 80, 40);
      await dragPen(priya.page, a.x, a.y, b.x, b.y);
      expect(await worldStrokes(priya.page)).toHaveLength(1);

      // Switch to Select and click the stroke's line to select it.
      await priya.page.keyboard.press('v');
      const mid = toScreen(cam, 0, 0);
      await priya.page.mouse.click(mid.x, mid.y);
      await expectWithin(async () =>
        (await priya.page.locator('[data-testid="stroke-object"][data-selected]').count()) === 1,
      );

      // Proportional resize: drag the SE corner; the width:height ratio and
      // the thickness are preserved.
      const stroke = (await worldStrokes(priya.page))[0]!;
      const ratioBefore = stroke.width / stroke.height;
      const thicknessBefore = stroke.thickness;
      const handle = priya.page.locator('[data-handle="se"]');
      const hb = (await handle.boundingBox()) ?? undefined;
      if (hb === undefined) throw new Error('se handle not rendered');
      await priya.page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await priya.page.mouse.down();
      await priya.page.mouse.move(hb.x + hb.width / 2 + 80, hb.y + hb.height / 2 + 40, { steps: 8 });
      await priya.page.mouse.up();
      const resized = (await worldStrokes(priya.page))[0]!;
      const ratioAfter = resized.width / resized.height;
      expect(Math.abs(ratioAfter / ratioBefore - 1)).toBeLessThanOrEqual(0.01);
      expect(resized.thickness).toBe(thicknessBefore);
      // The rendered ink thickness (world units) is the stored preset, not
      // scaled by the resize.
      const renderedWidth = await priya.page
        .locator('[data-testid="stroke-path"]')
        .evaluate((el) => Number(el.getAttribute('stroke-width')));
      expect(renderedWidth).toBe(PEN_THICKNESS_WORLD[resized.thickness as keyof typeof PEN_THICKNESS_WORLD]);

      // Move the body: drag it by (30, 40) screen px from its centre, which
      // lies on the (diagonal) line.
      const body = toScreen(cam, resized.x + resized.width / 2, resized.y + resized.height / 2);
      await priya.page.mouse.move(body.x, body.y);
      await priya.page.mouse.down();
      await priya.page.mouse.move(body.x + 30, body.y + 40, { steps: 6 });
      await priya.page.mouse.up();
      const moved = (await worldStrokes(priya.page))[0]!;
      expect(Math.abs(moved.x - resized.x - 30)).toBeLessThanOrEqual(2);
      expect(Math.abs(moved.y - resized.y - 40)).toBeLessThanOrEqual(2);

      // Delete: the stroke vanishes on Priya's screen and on Sam's within budget.
      await priya.page.keyboard.press('Delete');
      expect(await worldStrokes(priya.page)).toHaveLength(0);
      await expectWithin(async () => (await worldStrokes(sam.page)).length === 0);
    } finally {
      await closeParticipant(priya);
      await closeParticipant(sam);
    }
  });
});
