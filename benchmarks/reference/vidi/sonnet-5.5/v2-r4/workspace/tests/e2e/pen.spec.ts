import { expect, test, type Page } from '@playwright/test';
import { openNewBoard, setCamera } from './helpers/board';
import { closeAll, expectEventually, openParticipants } from './helpers/participants';

const drawings = (page: Page) => page.getByRole('group', { name: 'Drawing' });

async function loop(page: Page, cx: number, cy: number, r = 80) {
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
}

test.describe('pen', () => {
  test('TC-17 a preview follows the drag and the stroke persists after release', async ({ page }) => {
    await openNewBoard(page);
    await setCamera(page, -640, -400, 1);
    await page.keyboard.press('p');
    await expect(page.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'black pen' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Medium' })).toHaveAttribute('aria-pressed', 'true');
    await loop(page, 640, 400);
    await expect(page.getByTestId('pen-preview')).toBeVisible();
    await expect(drawings(page)).toHaveCount(0);
    await page.mouse.up();
    await expect(drawings(page)).toHaveCount(1);
    await expect(page.getByTestId('pen-preview')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pen (P)' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('TC-18 others see the stroke only once it is finished', async ({ browser }) => {
    const { people } = await openParticipants(browser, 2);
    const [priya, sam] = people;
    await setCamera(priya.page, -640, -400, 1);
    await setCamera(sam.page, -640, -400, 1);
    await priya.page.keyboard.press('p');
    await loop(priya.page, 640, 400);
    await sam.page.waitForTimeout(1500);
    await expect(drawings(sam.page)).toHaveCount(0);
    await priya.page.mouse.up();
    await expectEventually('stroke', () => drawings(sam.page).count(), 1);
    expect(priya.consoleErrors).toEqual([]);
    expect(sam.consoleErrors).toEqual([]);
    await closeAll(people);
  });

  test('TC-19 wheel pans while the pen is active; dragging from a sticky draws instead of moving it', async ({ page }) => {
    await openNewBoard(page);
    await setCamera(page, -640, -400, 1);
    await page.mouse.dblclick(640, 400);
    await page.keyboard.press('Escape');
    const note = page.getByRole('group', { name: 'Sticky note' });
    await expect(note).toHaveCount(1);
    const before = (await note.boundingBox())!;
    await page.keyboard.press('p');
    await page.mouse.move(100, 100);
    await page.mouse.wheel(0, 100);
    await expect.poll(async () => (await note.boundingBox())!.y).not.toBe(before.y);
    const panned = (await note.boundingBox())!;
    await page.mouse.move(panned.x + 40, panned.y + 40);
    await page.mouse.down();
    await page.mouse.move(panned.x + 120, panned.y + 90, { steps: 6 });
    await page.mouse.move(panned.x + 60, panned.y + 140, { steps: 6 });
    await page.mouse.up();
    await expect(drawings(page)).toHaveCount(1);
    const after = (await note.boundingBox())!;
    expect(after.x).toBeCloseTo(panned.x, 0);
    expect(after.y).toBeCloseTo(panned.y, 0);
  });

  test('TC-20 select by the line, resize proportionally, move and delete reach both screens', async ({ browser }) => {
    const { people } = await openParticipants(browser, 2);
    const [priya, sam] = people;
    await setCamera(priya.page, -640, -400, 1);
    await setCamera(sam.page, -640, -400, 1);
    const page = priya.page;
    await page.keyboard.press('p');
    await page.mouse.move(500, 300);
    await page.mouse.down();
    await page.mouse.move(600, 360, { steps: 8 });
    await page.mouse.move(700, 300, { steps: 8 });
    await page.mouse.up();
    await expectEventually('stroke', () => drawings(sam.page).count(), 1);

    await page.keyboard.press('v');
    // empty space inside the bounds does not select
    await page.mouse.click(600, 310);
    await expect(drawings(page)).toHaveAttribute('data-selected', 'false');
    await page.mouse.click(550, 330); // on the first segment (500,300)-(600,360)
    await expect(drawings(page)).toHaveAttribute('data-selected', 'true');

    const b0 = (await drawings(page).locator('[data-testid="stroke-path"]').boundingBox())!;
    const handle = page.getByRole('button', { name: 'Resize bottom-right' });
    {
      const hb = (await handle.boundingBox())!;
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await page.mouse.down();
      await page.mouse.move(hb.x + hb.width / 2 + 120, hb.y + hb.height / 2 + 120, { steps: 6 });
      await page.mouse.up();
      const b1 = (await drawings(page).locator('[data-testid="stroke-path"]').boundingBox())!;
      expect(b1.width).toBeGreaterThan(b0.width);
      expect(Math.abs(b1.width / b1.height - b0.width / b0.height) / (b0.width / b0.height)).toBeLessThan(0.05);
    }

    const m0 = (await drawings(page).locator('[data-testid="stroke-path"]').boundingBox())!;
    await page.mouse.move(550, 330);
    await page.mouse.down();
    await page.mouse.move(550, 430, { steps: 6 });
    await page.mouse.up();
    const m1 = (await drawings(page).locator('[data-testid="stroke-path"]').boundingBox())!;
    expect(m1.y - m0.y).toBeGreaterThan(50);
    await expectEventually(
      'moved',
      async () => Math.round(((await drawings(sam.page).locator('[data-testid="stroke-path"]').boundingBox())!).y),
      Math.round(m1.y),
    );

    await page.keyboard.press('Delete');
    await expect(drawings(page)).toHaveCount(0);
    await expectEventually('delete', () => drawings(sam.page).count(), 0);
    await closeAll(people);
  });
});
