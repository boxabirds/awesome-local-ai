/**
 * Story 11 e2e — pen (design TC-17 to TC-20).
 *
 * Real Chromium against the real Worker, participants driving the real UI
 * (keyboard shortcuts + mouse drags) and observing through the test-only
 * window.__vidi6 hooks. The default camera renders the world origin at
 * screen (640,400) at zoom 1, so screen = world + (640,400).
 */
import { expect, test } from '@playwright/test';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';
import { handwrittenLoop, underline } from '../fixtures/pen-paths';
import { expectWithinPx, originPosition, settle, setCamera } from './helpers/board';
import { allObjects, type FlowObject } from './helpers/flow-objects';
import {
  createBoard,
  LatencyLog,
  Participant,
  sharedServerUrl,
} from './helpers/participants';

/** World → screen at the default camera (origin at (640,400), zoom 1). */
function toScreen(world: { x: number; y: number }): { x: number; y: number } {
  return { x: world.x + 640, y: world.y + 400 };
}

/** The first stroke on the board, waiting for it to appear. */
async function firstStroke(p: Participant, what: string): Promise<FlowObject> {
  const objs = await p.waitFor(
    (o) => o.some((x) => (x as unknown as FlowObject).type === 'stroke'),
    what,
  );
  return (objs as unknown as FlowObject[]).find((o) => o.type === 'stroke')!;
}

test('TC-17: a real drag drawing a loop: the preview updates during the drag and the stroke persists after release', async ({ browser }) => {
  const boardId = await createBoard(sharedServerUrl());
  const ctx = await browser.newContext();
  const priya = await Participant.join(ctx, boardId);
  const page = priya.page;
  try {
    await page.keyboard.press('p');
    await page.getByTestId('pen-toolbar').waitFor({ timeout: 5_000 });

    // The handwritten loop fixture (world → screen at the default camera).
    const pts = handwrittenLoop().map(toScreen);

    // Sample the preview path on every animation frame while we draw.
    await page.evaluate(() => {
      const w = window as unknown as { __previewSamples: string[] };
      w.__previewSamples = [];
      const rec = (): void => {
        const el = document.querySelector('[data-testid="pen-preview"]');
        w.__previewSamples.push(
          el === null ? '' : ((el as SVGPathElement).getAttribute('d') ?? ''),
        );
        requestAnimationFrame(rec);
      };
      requestAnimationFrame(rec);
    });

    await page.mouse.move(pts[0].x, pts[0].y);
    await page.mouse.down();
    const step = Math.ceil(pts.length / 40);
    for (let i = step; i < pts.length; i += step) {
      await page.mouse.move(pts[i].x, pts[i].y, { steps: 3 });
    }
    await page.mouse.move(pts[pts.length - 1].x, pts[pts.length - 1].y, { steps: 1 });

    // Still pressed: the preview is visible and has changed across frames.
    const samples = await page.evaluate(
      () => (window as unknown as { __previewSamples: string[] }).__previewSamples,
    );
    const distinct = new Set(samples.filter((s) => s !== ''));
    expect(distinct.size, 'the preview should update across frames').toBeGreaterThan(1);

    await page.mouse.up();
    await settle(page, 150);
    // The preview is gone once the stroke is committed.
    expect(await page.locator('[data-testid="pen-preview"]').count()).toBe(0);

    // The stroke persisted with the session defaults.
    const stroke = await firstStroke(priya, 'the finished stroke');
    expect(stroke.thickness).toBe('medium');
    expect(stroke.color).toBe('black');
    expect(stroke.points, 'the path is stored').toBeDefined();
    expect((stroke.points?.length ?? 0) / 2).toBeGreaterThan(1);
    expect(priya.hasErrors()).toBe(false);
  } finally {
    await ctx.close();
  }
});

test('TC-18: Priya draws while Sam watches: Sam sees nothing during the drag and the finished stroke after release', async ({ browser }) => {
  const boardId = await createBoard(sharedServerUrl());
  const ctx = await browser.newContext();
  const priya = await Participant.join(ctx, boardId);
  const sam = await Participant.join(ctx, boardId);
  const latency = new LatencyLog();
  try {
    await priya.page.keyboard.press('p');
    const pts = underline().map(toScreen);

    await priya.page.mouse.move(pts[0].x, pts[0].y);
    await priya.page.mouse.down();
    const mid = Math.floor(pts.length / 2);
    for (let i = 4; i <= mid; i += 4) {
      await priya.page.mouse.move(pts[i].x, pts[i].y, { steps: 2 });
    }

    // While the stroke is in flight, Sam’s board must not contain it
    // (pen.share: the preview is local, never written to the document).
    // Allow ample time for any (unexpected) propagation to land.
    await priya.page.waitForTimeout(500);
    const samDuring = await sam.objects();
    expect(
      samDuring.some((o) => (o as unknown as FlowObject).type === 'stroke'),
      'Sam must not see an in-progress stroke',
    ).toBe(false);

    // Finish the underline.
    for (let i = mid + 4; i < pts.length; i += 4) {
      await priya.page.mouse.move(pts[i].x, pts[i].y, { steps: 2 });
    }
    const t0 = Date.now();
    await priya.page.mouse.up();
    const stroke = await firstStroke(sam, 'the finished stroke');
    latency.record('pen.stroke→sam', Date.now() - t0);
    expect(stroke.thickness).toBe('medium');
    // Wall-clock delivery is reported, never asserted (shared machine).
    latency.report('TC-18', LIVE_UPDATE_LATENCY_BUDGET_MS);

    // Both boards agree on the stroke’s presence.
    const priyaObjs = await allObjects(priya.page);
    expect(priyaObjs.some((o) => o.id === stroke.id)).toBe(true);
    expect(priya.hasErrors()).toBe(false);
    expect(sam.hasErrors()).toBe(false);
  } finally {
    await ctx.close();
  }
});

test('TC-19: the wheel pans while the Pen is active; a drag starting on a sticky creates a stroke, not a move', async ({ browser }) => {
  const boardId = await createBoard(sharedServerUrl());
  const ctx = await browser.newContext();
  const priya = await Participant.join(ctx, boardId);
  const page = priya.page;
  try {
    // A sticky that a pen drag will start on top of.
    const stickyId = await priya.createNote({ x: 100, y: 100 }, 'S19');
    const before = await priya.object(stickyId);
    expect(before, 'the sticky exists').not.toBeNull();

    await page.keyboard.press('p');
    await page.getByTestId('pen-toolbar').waitFor({ timeout: 5_000 });

    // Wheel pans the board even though the Pen owns the pointer (pen.navigation).
    const originBefore = await originPosition(page);
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 400);
    await settle(page, 250);
    const originAfterWheel = await originPosition(page);
    expect(
      Math.hypot(
        originAfterWheel.x - originBefore.x,
        originAfterWheel.y - originBefore.y,
      ) > 10,
      'the wheel should pan the board',
    ).toBe(true);
    // The wheel created no stroke.
    expect(
      (await allObjects(page)).some((o) => o.type === 'stroke'),
    ).toBe(false);

    // Back to the default camera so the sticky is where it was created.
    await setCamera(page, { x: 0, y: 0, zoom: 1 });

    // A drag that STARTS on the sticky: the pen owns the gesture — the
    // sticky does not move and a stroke is created instead.
    const c = await priya.noteCenter(stickyId);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 80, c.y + 40, { steps: 6 });
    await page.mouse.up();

    await firstStroke(priya, 'the stroke drawn over the sticky');
    const after = await priya.object(stickyId);
    expect(after, 'the sticky still exists').not.toBeNull();
    expect(after!.x, 'the sticky was not moved').toBe(before!.x);
    expect(after!.y, 'the sticky was not moved').toBe(before!.y);
    expect(priya.hasErrors()).toBe(false);
  } finally {
    await ctx.close();
  }
});

test('TC-20: click the line to select, aspect-locked corner resize, move, then delete on both screens', async ({ browser }) => {
  const boardId = await createBoard(sharedServerUrl());
  const ctx = await browser.newContext();
  const priya = await Participant.join(ctx, boardId);
  const sam = await Participant.join(ctx, boardId);
  const page = priya.page;
  try {
    // Draw a straight stroke: world (-100,0) → (100,0) at the default camera.
    await page.keyboard.press('p');
    await page.getByTestId('pen-toolbar').waitFor({ timeout: 5_000 });
    await page.mouse.move(540, 400);
    await page.mouse.down();
    await page.mouse.move(740, 400, { steps: 10 });
    await page.mouse.up();
    const s0 = await firstStroke(priya, 'the drawn stroke');
    const w0 = s0.width ?? 0;
    const h0 = s0.height ?? 0;
    expect(w0 > 0 && h0 > 0, 'the stroke has a bounding box').toBe(true);

    // V → Select; click the line at its midpoint (world (0,0) → (640,400)).
    await page.keyboard.press('v');
    await page.mouse.click(640, 400);
    await page
      .locator(`[data-stroke-object="${s0.id}"][data-selected="true"]`)
      .waitFor({ timeout: 5_000 });

    // Drag the SE corner handle by +100,+50 (screen px = world at zoom 1).
    const se = await page
      .locator('[data-testid="resize-handle"][data-handle="se"]')
      .boundingBox();
    expect(se, 'the SE handle should render').not.toBeNull();
    const hx = se!.x + se!.width / 2;
    const hy = se!.y + se!.height / 2;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx + 100, hy + 50, { steps: 8 });
    await page.mouse.up();

    const all1 = await priya.waitFor((objs) => {
      const s = (objs as unknown as FlowObject[]).find((o) => o.id === s0.id);
      return s !== undefined && (s.width ?? 0) > w0 + 50;
    }, 'the aspect-locked resize');
    const s1 = (all1 as unknown as FlowObject[]).find((o) => o.id === s0.id)!;
    // The aspect ratio is preserved within 1%.
    const r0 = w0 / h0;
    const r1 = (s1.width ?? 0) / (s1.height ?? 0);
    expect(Math.abs(r1 - r0) / r0, 'aspect ratio within 1%').toBeLessThan(0.01);
    // The thickness is untouched by the resize.
    expect(s1.thickness).toBe('medium');

    // Drag the body: a drag starting on the line moves the whole object.
    // Start at 25% of the width — the selection overlay's edge handles are
    // 12px boxes centred on the bbox edges, and for a thin stroke they cover
    // the line near the centre (and the corners), so the drag must begin on
    // a point of the line that is not under a handle.
    const sx = 640 + s1.x + (s1.width ?? 0) * 0.25;
    const sy = 400 + s1.y + (s1.height ?? 0) / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 60, sy + 40, { steps: 6 });
    await page.mouse.up();

    const all2 = await priya.waitFor((objs) => {
      const s = (objs as unknown as FlowObject[]).find((o) => o.id === s0.id);
      return s !== undefined && Math.abs(s.x - (s1.x + 60)) < 2;
    }, 'the moved stroke');
    const s2 = (all2 as unknown as FlowObject[]).find((o) => o.id === s0.id)!;
    expectWithinPx(s2.x, s1.x + 60, 'moved x');
    expectWithinPx(s2.y, s1.y + 40, 'moved y');

    // Delete: removed on both screens.
    await page.keyboard.press('Delete');
    await priya.waitFor(
      (objs) => objs.every((o) => o.id !== s0.id),
      'Priya’s deletion',
    );
    await sam.waitFor(
      (objs) => objs.every((o) => o.id !== s0.id),
      'Sam’s deletion',
    );
    expect(priya.hasErrors()).toBe(false);
    expect(sam.hasErrors()).toBe(false);
  } finally {
    await ctx.close();
  }
});
