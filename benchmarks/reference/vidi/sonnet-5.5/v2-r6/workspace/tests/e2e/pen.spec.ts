import { expect, test, type Locator, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { handwrittenLoop } from '../fixtures/pen-paths';
import { markerCentre, nextFrames } from './helpers/board';
import { expectEventually, openParticipants } from './helpers/participants';

const strokes = (page: Page): Locator => page.locator('[data-stroke-object]');
const box = (l: Locator) => l.evaluate((el) => {
  const s = (el as HTMLElement).style;
  return { x: parseFloat(s.left), y: parseFloat(s.top), w: parseFloat(s.width), h: parseFloat(s.height) };
});

async function startDrag(page: Page, p: Point): Promise<void> {
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
}

async function drawPath(page: Page, pts: Point[]): Promise<void> {
  await startDrag(page, pts[0]);
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y);
  await page.mouse.up();
  await nextFrames(page);
}

test.setTimeout(120_000);

test.describe('Annotate a cluster', () => {
  test('TC-17 the preview follows a real drag frame by frame and the stroke persists after release', async ({ browser }) => {
    const [priya] = await openParticipants(browser, 1);
    const p = priya.page;
    await p.keyboard.press('p');
    await expect(p.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(p.getByRole('button', { name: 'black pen' })).toHaveAttribute('aria-pressed', 'true');
    await expect(p.getByRole('button', { name: 'Medium' })).toHaveAttribute('aria-pressed', 'true');

    const loop = handwrittenLoop().filter((_, i) => i % 3 === 0);
    await startDrag(p, loop[0]);
    const seen: string[] = [];
    for (let i = 1; i < loop.length; i++) {
      await p.mouse.move(loop[i].x, loop[i].y);
      if (i % 12 === 0) {
        await nextFrames(p);
        seen.push((await p.getByTestId('pen-preview').getAttribute('d')) ?? '');
      }
    }
    expect(seen.length).toBeGreaterThan(5);
    expect(new Set(seen).size).toBe(seen.length); // the path changed on every sampled frame
    await expect(strokes(p)).toHaveCount(0);
    await p.mouse.up();
    await expect(strokes(p)).toHaveCount(1);
    await expect(p.getByTestId('pen-preview')).toHaveCount(0);
    await nextFrames(p);
    await expect(strokes(p)).toHaveCount(1);
    await expect(p.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');
    expect(priya.errors).toEqual([]);
    await priya.context.close();
  });

  test('TC-19 scrolling pans while Pen is active, and a drag starting on a sticky draws without moving it', async ({ browser }) => {
    const [priya] = await openParticipants(browser, 1);
    const p = priya.page;
    await p.mouse.dblclick(400, 300);
    await p.keyboard.press('Escape');
    const note = p.locator('[data-sticky-note]').first();
    await expect(note).toBeVisible();
    await p.mouse.click(900, 700); // empty space: deselect
    await p.keyboard.press('p');

    const before = await markerCentre(p);
    await p.mouse.move(700, 400);
    await p.mouse.wheel(0, 120);
    await expect.poll(async () => (await markerCentre(p)).y).toBeLessThan(before.y);
    await nextFrames(p);

    const panned = await markerCentre(p);
    const nb = (await note.boundingBox())!;
    const start = { x: nb.x + 60, y: nb.y + 60 };
    await drawPath(p, [start, { x: start.x + 40, y: start.y + 20 }, { x: start.x + 90, y: start.y + 30 }]);
    await expect(strokes(p)).toHaveCount(1);
    const after = (await note.boundingBox())!;
    expect(Math.abs(after.x - nb.x)).toBeLessThan(0.5);
    expect(Math.abs(after.y - nb.y)).toBeLessThan(0.5);
    expect(await markerCentre(p)).toEqual(panned);
    await expect(note).toHaveAttribute('data-selected', 'false');
    await priya.context.close();
  });
});

test.describe('Shared sketch', () => {
  test('TC-18 Sam sees nothing while Priya draws, and the finished stroke after release', async ({ browser }) => {
    const [priya, sam] = await openParticipants(browser, 2);
    const p = priya.page;
    await p.keyboard.press('p');
    const loop = handwrittenLoop().filter((_, i) => i % 4 === 0);
    await startDrag(p, loop[0]);
    for (const pt of loop.slice(1, 70)) await p.mouse.move(pt.x, pt.y);
    await p.waitForTimeout(1500);
    await expect(strokes(sam.page)).toHaveCount(0);
    await expect(p.getByTestId('pen-preview')).toHaveCount(1);
    const releasedAt = Date.now();
    await p.mouse.up();
    await expectEventually('stroke visible for Sam', () => strokes(sam.page).count(), 1, releasedAt);
    await expect(strokes(sam.page).first()).toHaveAttribute('aria-label', 'Drawing', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    expect(priya.errors).toEqual([]);
    expect(sam.errors).toEqual([]);
    await priya.context.close();
    await sam.context.close();
  });
});

test.describe('Tidy up', () => {
  test('TC-20 select by the line, resize in proportion, move, delete on both screens', async ({ browser }) => {
    const [priya, sam] = await openParticipants(browser, 2);
    const p = priya.page;
    await p.keyboard.press('p');
    await p.getByRole('button', { name: 'red pen' }).click();
    await p.getByRole('button', { name: 'Thick' }).click();
    // a quarter circle: its box has a big empty inside (bottom-right corner)
    const arc = (a: number): Point => ({ x: 700 + 200 * Math.cos(a), y: 400 + 200 * Math.sin(a) });
    await drawPath(p, Array.from({ length: 25 }, (_, i) => arc(Math.PI + (i / 24) * (Math.PI / 2))));
    await expect(strokes(p)).toHaveCount(1);
    await expect(strokes(sam.page)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await p.keyboard.press('v');

    // inside the bounds but far from the line: nothing selected
    await p.mouse.click(680, 380);
    await expect(strokes(p).first()).toHaveAttribute('data-selected', 'false');
    // on the line: selected
    const onLine = arc(Math.PI * 1.25);
    await p.mouse.click(onLine.x, onLine.y);
    await expect(strokes(p).first()).toHaveAttribute('data-selected', 'true');

    const b0 = await box(strokes(p).first());
    const handle = p.getByRole('button', { name: 'Resize bottom-right' });
    const hb = (await handle.boundingBox())!;
    const hx = hb.x + hb.width / 2;
    const hy = hb.y + hb.height / 2;
    await p.mouse.move(hx, hy);
    await p.mouse.down();
    await p.mouse.move(hx + 60, hy + 40, { steps: 5 });
    await p.mouse.move(hx + 120, hy + 60, { steps: 5 });
    await p.mouse.up();
    await nextFrames(p);
    const b1 = await box(strokes(p).first());
    expect(b1.w).toBeGreaterThan(b0.w);
    expect(Math.abs(b1.w / b1.h - b0.w / b0.h) / (b0.w / b0.h)).toBeLessThan(0.01);
    await expect(strokes(p).first().getByTestId('stroke-path')).toHaveAttribute('stroke-width', '8');

    // move by dragging the line
    const k = b1.w / b0.w;
    const grab = { x: b1.x + (onLine.x - b0.x) * k, y: b1.y + (onLine.y - b0.y) * k };
    await p.mouse.move(grab.x, grab.y);
    await p.mouse.down();
    await p.mouse.move(grab.x, grab.y + 25, { steps: 4 });
    await p.mouse.move(grab.x, grab.y + 50, { steps: 4 });
    await p.mouse.up();
    await nextFrames(p);
    const b2 = await box(strokes(p).first());
    expect(Math.abs(b2.y - b1.y - 50)).toBeLessThan(1.5);
    expect(Math.abs(b2.x - b1.x)).toBeLessThan(1.5);
    await expectEventually('moved stroke for Sam', async () => Math.round((await box(strokes(sam.page).first())).y), Math.round(b2.y));

    await p.keyboard.press('Delete');
    await expect(strokes(p)).toHaveCount(0);
    await expect(strokes(sam.page)).toHaveCount(0, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    expect(priya.errors).toEqual([]);
    await priya.context.close();
    await sam.context.close();
  });
});
