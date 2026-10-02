import { test, expect } from '@playwright/test';
import { setCamera, getBoardSnapshot, TEST_CAMERA } from './helpers/camera';

test.describe('empty board performance', () => {
  test('TC-39 60 stickies + 120-char text each → doc has exactly 60 stickies, each text length 120', async ({ page }) => {
    await page.goto('/');
    await setCamera(page, TEST_CAMERA);

    const ids = await page.evaluate(() => {
      const hook = window.__vidi6!;
      const created: string[] = [];
      for (let i = 0; i < 60; i++) {
        const id = hook.createStickyAtWorld({ x: (i % 10) * 260, y: Math.floor(i / 10) * 260 });
        if (id) created.push(id);
      }
      for (const id of created) {
        hook.setStickyText(id, 'x'.repeat(120));
      }
      return created;
    });
    expect(ids).toHaveLength(60);

    const snap = await getBoardSnapshot(page);
    // Exactly 60 stickies in the doc (plus the single root map — not listed)
    expect(snap).toHaveLength(60);
    for (const n of snap) {
      expect(n.text.length).toBe(120);
    }
    // All 60 are rendered
    expect(await page.locator('[data-testid="sticky-note"]').count()).toBe(60);
  });
});
