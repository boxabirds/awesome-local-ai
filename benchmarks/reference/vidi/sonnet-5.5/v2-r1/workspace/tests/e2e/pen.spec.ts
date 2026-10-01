import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { setCamera } from './helpers/board';
import { closeAll, expectEventually, newNoteAt, noteView, openParticipants } from './helpers/participants';
import { handwrittenLoop } from '../fixtures/pen-paths';

const strokes = (page: Page) => page.locator('[data-stroke-object]');

/** Screen position of the start of the first stroke's line (always on the line). */
async function lineStart(page: Page) {
  return page.locator('[data-testid="stroke-path"]').first().evaluate((el) => {
    const path = el as unknown as SVGGeometryElement;
    const p = path.getPointAtLength(0);
    const m = path.getScreenCTM()!;
    return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
  });
}

async function selectionBox(page: Page) {
  const box = await page.getByTestId('selection-box').boundingBox();
  if (!box) throw new Error('nothing selected');
  return box;
}

test.describe('pen', () => {
  test('TC-17 the preview follows the drag frame by frame and the stroke persists after release', async ({ browser }) => {
    const [a] = await openParticipants(browser, 1);
    try {
      const page = a.page;
      await setCamera(page, { x: 0, y: 0, zoom: 1 });
      await page.keyboard.press('p');
      await expect(page.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');
      await page.evaluate(() => {
        const w = window as unknown as { __samples: string[] };
        w.__samples = [];
        const tick = () => {
          const p = document.querySelector('[data-testid="pen-preview"]');
          if (p) w.__samples.push(p.getAttribute('d') ?? '');
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const loop = handwrittenLoop();
      await page.mouse.move(loop[0].x, loop[0].y);
      await page.mouse.down();
      for (let i = 1; i < loop.length; i += 4) {
        await page.mouse.move(loop[i].x, loop[i].y);
        if (i % 40 === 1) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      }
      await expect(page.getByTestId('pen-preview')).toHaveCount(1);
      await page.mouse.up();
      const samples = await page.evaluate(() => (window as unknown as { __samples: string[] }).__samples);
      expect(samples.length).toBeGreaterThan(3);
      expect(new Set(samples).size).toBeGreaterThan(3);
      await expect(page.getByTestId('pen-preview')).toHaveCount(0);
      await expect(strokes(page)).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');
    } finally {
      await closeAll([a]);
    }
  });

  test('TC-18 others see a stroke only after it is finished', async ({ browser }) => {
    const [priya, sam] = await openParticipants(browser, 2);
    try {
      for (const p of [priya, sam]) await setCamera(p.page, { x: 0, y: 0, zoom: 1 });
      await priya.page.keyboard.press('p');
      const loop = handwrittenLoop();
      await priya.page.mouse.move(loop[0].x, loop[0].y);
      await priya.page.mouse.down();
      for (let i = 1; i < loop.length; i += 4) await priya.page.mouse.move(loop[i].x, loop[i].y);
      await priya.page.waitForTimeout(500);
      await expect(priya.page.getByTestId('pen-preview')).toHaveCount(1);
      await expect(strokes(sam.page)).toHaveCount(0);
      const releasedAt = Date.now();
      await priya.page.mouse.up();
      await expectEventually('pen.share finished stroke', async () => (await strokes(sam.page).count()) === 1, releasedAt);
      await expect(strokes(priya.page)).toHaveCount(1);
    } finally {
      await closeAll([priya, sam]);
    }
  });

  test('TC-19 scrolling pans while the pen is active; a drag starting on a sticky draws and does not move it', async ({ browser }) => {
    const [a] = await openParticipants(browser, 1);
    try {
      const page = a.page;
      await setCamera(page, { x: 0, y: 0, zoom: 1 });
      const id = await newNoteAt(page, 600, 300);
      await page.keyboard.press('Escape');
      await page.locator(`[data-note-id="${id}"]`).click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('p');
      const before = await page.evaluate(() => window.__vidi6!.getCamera());
      await page.mouse.move(300, 600);
      await page.mouse.wheel(0, 120);
      await expect.poll(async () => (await page.evaluate(() => window.__vidi6!.getCamera())).y).not.toBe(before.y);
      const note0 = await noteView(page, id);
      const box = (await page.locator(`[data-note-id="${id}"]`).boundingBox())!;
      const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const camera = await page.evaluate(() => window.__vidi6!.getCamera());
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 40, from.y + 30, { steps: 5 });
      await page.mouse.move(from.x + 80, from.y, { steps: 5 });
      await page.mouse.up();
      await expect(strokes(page)).toHaveCount(1);
      const note1 = await noteView(page, id);
      expect(note1?.left).toBe(note0?.left);
      expect(note1?.top).toBe(note0?.top);
      expect(await page.evaluate(() => window.__vidi6!.getCamera())).toEqual(camera);
    } finally {
      await closeAll([a]);
    }
  });

  test('TC-20 select by the line, resize in proportion, move and delete on both screens', async ({ browser }) => {
    const [priya, sam] = await openParticipants(browser, 2);
    try {
      const page = priya.page;
      for (const p of [priya, sam]) await setCamera(p.page, { x: 0, y: 0, zoom: 1 });
      await page.getByRole('button', { name: 'red pen' }).or(page.getByRole('button', { name: 'Pen (P)' })).first().click();
      await page.getByRole('button', { name: 'red pen' }).click();
      await page.getByRole('button', { name: 'Thick' }).click();
      const loop = handwrittenLoop();
      await page.mouse.move(loop[0].x, loop[0].y);
      await page.mouse.down();
      for (let i = 1; i < loop.length; i += 4) await page.mouse.move(loop[i].x, loop[i].y);
      await page.mouse.up();
      await expect(strokes(page)).toHaveCount(1);
      await expect(strokes(sam.page)).toHaveCount(1);

      await page.keyboard.press('v');
      // Inside the bounds but far from the line: not selected.
      await page.mouse.click(400, 300);
      await expect(page.getByTestId('selection-box')).toHaveCount(0);
      const start = await lineStart(page);
      await page.mouse.click(start.x, start.y);
      await expect(page.getByTestId('selection-box')).toHaveCount(1);

      const b0 = await selectionBox(page);
      const handle = (await page.getByRole('button', { name: 'Resize bottom-right' }).boundingBox())!;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x + 60, handle.y + 20, { steps: 6 });
      await page.mouse.move(handle.x + 120, handle.y + 30, { steps: 6 });
      await page.mouse.up();
      const b1 = await selectionBox(page);
      expect(b1.width).toBeGreaterThan(b0.width + 10);
      expect(Math.abs(b1.width / b1.height / (b0.width / b0.height) - 1)).toBeLessThan(0.01);
      await expect(page.getByTestId('stroke-path').first()).toHaveAttribute('stroke-width', '8');

      const s1 = await lineStart(page);
      await page.mouse.move(s1.x, s1.y);
      await page.mouse.down();
      await page.mouse.move(s1.x + 20, s1.y + 40, { steps: 5 });
      await page.mouse.move(s1.x + 50, s1.y + 80, { steps: 5 });
      await page.mouse.up();
      const b2 = await selectionBox(page);
      expect(Math.abs(b2.x - b1.x - 50)).toBeLessThanOrEqual(2);
      expect(Math.abs(b2.y - b1.y - 80)).toBeLessThanOrEqual(2);

      await page.keyboard.press('Delete');
      await expect(strokes(page)).toHaveCount(0);
      await expectEventually('stroke delete', async () => (await strokes(sam.page).count()) === 0);
    } finally {
      await closeAll([priya, sam]);
    }
  });
});
