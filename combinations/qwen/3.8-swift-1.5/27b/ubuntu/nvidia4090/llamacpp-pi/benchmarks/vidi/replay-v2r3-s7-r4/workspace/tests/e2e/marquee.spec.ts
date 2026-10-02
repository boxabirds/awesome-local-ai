import { test, expect, type Page } from '@playwright/test';
import { createBoard, openBoardInPage } from './helpers/board';

/**
 * TC-32 (sel.marquee_ui): notes A fully inside, B half inside, C outside a
 * Shift+drag rectangle → only A selected.
 *
 * Runs in chromium, firefox and webkit (the only story-7 E2E that must be
 * cross-browser).
 */

async function createNotes(page: Page, positions: { x: number; y: number }[]): Promise<string[]> {
  return page.evaluate((positions) => {
    const hook = (window as any).__VIDI_DEBUG__;
    if (!hook) throw new Error('Debug hook not available');
    const Y = (window as any).__VIDI_Y__;
    const doc = hook.doc;
    const objects = doc.getMap('objects');
    let maxZ = 0;
    objects.forEach((m: any) => {
      const z = m.get('z');
      if (typeof z === 'number' && z > maxZ) maxZ = z;
    });
    const ids: string[] = [];
    for (const p of positions) {
      const id = `n${Math.random().toString(36).slice(2, 10)}`;
      maxZ += 1;
      const m = new Y.Map();
      m.set('id', id);
      m.set('type', 'sticky');
      m.set('x', p.x);
      m.set('y', p.y);
      m.set('color', 'yellow');
      m.set('z', maxZ);
      m.set('createdAt', Date.now());
      m.set('text', new Y.Text());
      objects.set(id, m);
      ids.push(id);
    }
    return ids;
  }, positions);
}

async function shiftDrag(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await page.keyboard.down('Shift');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(x1 + ((x2 - x1) * i) / 10, y1 + ((y2 - y1) * i) / 10);
  }
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

test.describe('TC-32: marquee selects only the fully-contained note', () => {
  test('A fully inside, B half inside, C outside → only A selected', async ({ browser }) => {
    const boardId = await createBoard();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await openBoardInPage(page, boardId);

    // 200×200 notes: A 100..300, B 350..550, C 700..900 (all y 100..300).
    const [a, b, c] = await createNotes(page, [
      { x: 100, y: 100 },
      { x: 350, y: 100 },
      { x: 700, y: 100 },
    ]);

    // Marquee 50..450 × 50..450: A fully in, B half in, C out.
    await shiftDrag(page, 50, 50, 450, 450);

    await expect(page.getByTestId(`sticky-note-${a}`)).toHaveAttribute('data-selected', 'true');
    await expect(page.getByTestId(`sticky-note-${b}`)).not.toHaveAttribute('data-selected');
    await expect(page.getByTestId(`sticky-note-${c}`)).not.toHaveAttribute('data-selected');
  });
});
