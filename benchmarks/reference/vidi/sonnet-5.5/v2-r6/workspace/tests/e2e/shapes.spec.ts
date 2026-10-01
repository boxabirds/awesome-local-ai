import { expect, test, type Locator, type Page } from '@playwright/test';
import { nextFrames, setCamera } from './helpers/board';
import { openParticipants } from './helpers/participants';

const shapes = (page: Page): Locator => page.locator('[data-shape-object]');

async function dragMouse(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(...to, { steps: 4 });
  await page.mouse.up();
  await nextFrames(page);
}

const worldBox = (l: Locator) => l.evaluate((el) => {
  const s = (el as HTMLElement).style;
  return { x: parseFloat(s.left), y: parseFloat(s.top), w: parseFloat(s.width), h: parseFloat(s.height) };
});

test.describe('Draw a flow', () => {
  test('TC-23 dragging with the Shape tool creates a shape exactly under the drag', async ({ browser }) => {
    const [dana] = await openParticipants(browser, 1);
    const p = dana.page;
    await p.keyboard.press('s');
    await expect(p.getByRole('menuitemradio', { name: 'Rectangle' })).toHaveAttribute('aria-checked', 'true');
    await dragMouse(p, [100, 100], [300, 220]);
    await expect(shapes(p)).toHaveCount(1);
    const box = await worldBox(shapes(p).first());
    expect(Math.abs(box.x - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.w - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.h - 120)).toBeLessThanOrEqual(1);
    await expect(shapes(p).first()).toHaveAttribute('data-selected', 'true');
    await expect(p.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
    expect(dana.errors).toEqual([]);
    await dana.context.close();
  });

  test('TC-24 a diamond dropped by a click at 200% wraps and centres its label, also after resizing', async ({ browser }) => {
    const [dana] = await openParticipants(browser, 1);
    const p = dana.page;
    await setCamera(p, 0, 0, 2);
    await p.keyboard.press('s');
    await p.getByRole('menuitemradio', { name: 'Diamond' }).click();
    await p.mouse.click(700, 400);
    await expect(shapes(p)).toHaveCount(1);
    const box = await worldBox(shapes(p).first());
    expect(box).toEqual({ x: 270, y: 120, w: 160, h: 160 }); // click at world (350,200)

    await shapes(p).first().dblclick();
    const editor = p.getByRole('textbox', { name: 'Shape label' });
    await editor.fill('Payment authorised today');
    await p.keyboard.press('Escape');
    const label = p.locator('.shape-label-text').first();
    await expect(label).toHaveText('Payment authorised today');

    const centred = async () => {
      const s = (await shapes(p).first().boundingBox())!;
      const l = (await label.boundingBox())!;
      expect(Math.abs(l.x + l.width / 2 - (s.x + s.width / 2))).toBeLessThanOrEqual(2);
      expect(Math.abs(l.y + l.height / 2 - (s.y + s.height / 2))).toBeLessThanOrEqual(2);
      expect(l.x).toBeGreaterThanOrEqual(s.x - 1);
      expect(l.x + l.width).toBeLessThanOrEqual(s.x + s.width + 1);
      expect(l.y).toBeGreaterThanOrEqual(s.y - 1);
      expect(l.y + l.height).toBeLessThanOrEqual(s.y + s.height + 1);
      return l;
    };
    const before = await centred();
    expect(before.height).toBeGreaterThan(30); // wrapped over several lines (16px text at 200%)

    const handle = p.getByRole('button', { name: 'Resize right' });
    const hb = (await handle.boundingBox())!;
    await dragMouse(p, [hb.x + hb.width / 2, hb.y + hb.height / 2], [hb.x + hb.width / 2 - 100, hb.y + hb.height / 2]);
    expect((await worldBox(shapes(p).first())).w).toBeCloseTo(110, 0);
    const after = await centred();
    expect(after.height).toBeGreaterThan(before.height);
    expect(dana.errors).toEqual([]);
    await dana.context.close();
  });
});
