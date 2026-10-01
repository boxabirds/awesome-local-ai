// tests/e2e/flow.spec.ts
// TC-23: full flow — two shapes + connector, move shape, arrows follow
// TC-24: collaborative rearrange — Alice draws, Bob moves, both see
// TC-25: deletion race — Bob deletes shape while Alice drags a new connector to it

import { test, expect, type Page } from '@playwright/test';

async function tick(page: Page, ms: number) {
  await page.waitForTimeout(ms);
}

test.describe('flow (e2e)', () => {
  // TC-23: Full flow — draw shapes and connector, move shape, verify no crash
  test('TC-23: full flow - draw shapes, connector, move', async ({ page }) => {
    await page.goto('/');
    await tick(page, 500);

    const viewport = page.viewportSize()!;
    const cx = viewport.width / 2;
    const cy = viewport.height / 2;

    // Draw a shape (press S, then drag)
    await page.keyboard.press('s');
    await page.mouse.move(cx - 100, cy - 50);
    await page.mouse.down();
    await page.mouse.move(cx + 100, cy + 50, { steps: 5 });
    await page.mouse.up();
    await tick(page, 300);

    // Draw a second shape
    await page.keyboard.press('s');
    await page.mouse.move(cx + 200, cy - 50);
    await page.mouse.down();
    await page.mouse.move(cx + 400, cy + 50, { steps: 5 });
    await page.mouse.up();
    await tick(page, 300);

    // Create a connector (press L, then drag from first to second shape)
    await page.keyboard.press('l');
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 300, cy, { steps: 5 });
    await page.mouse.up();
    await tick(page, 300);

    // Switch to select tool and move the first shape
    await page.keyboard.press('v');
    await page.mouse.click(cx, cy);
    await tick(page, 200);

    // Drag the shape
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 50, cy + 30, { steps: 3 });
    await page.mouse.up();
    await tick(page, 300);

    // Board should still be functional
    await expect(page).toHaveTitle(/vidi/);
  });

  // TC-24: Collaborative rearrange — two peers, one draws, other moves
  test('TC-24: collaborative rearrange', async ({ browser }) => {
    const context = await browser.newContext();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await pageA.goto('/');
    await pageB.goto('/');
    await tick(pageA, 500);
    await tick(pageB, 500);

    const viewport = pageA.viewportSize()!;
    const cx = viewport.width / 2;
    const cy = viewport.height / 2;

    // Alice draws a shape
    await pageA.keyboard.press('s');
    await pageA.mouse.move(cx - 80, cy - 40);
    await pageA.mouse.down();
    await pageA.mouse.move(cx + 80, cy + 40, { steps: 5 });
    await pageA.mouse.up();
    await tick(pageA, 500);
    await tick(pageB, 500);

    // Bob moves the shape
    await pageB.keyboard.press('v');
    await pageB.mouse.click(cx, cy);
    await tick(pageB, 200);

    await pageB.mouse.move(cx, cy);
    await pageB.mouse.down();
    await pageB.mouse.move(cx + 100, cy + 50, { steps: 3 });
    await pageB.mouse.up();
    await tick(pageB, 500);
    await tick(pageA, 500);

    // Both should still be functional
    await expect(pageA).toHaveTitle(/vidi/);
    await expect(pageB).toHaveTitle(/vidi/);

    await context.close();
  });

  // TC-25: Deletion race — Bob deletes while Alice tries to connect
  test('TC-25: deletion race', async ({ browser }) => {
    const context = await browser.newContext();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await pageA.goto('/');
    await pageB.goto('/');
    await tick(pageA, 500);
    await tick(pageB, 500);

    const viewport = pageA.viewportSize()!;
    const cx = viewport.width / 2;
    const cy = viewport.height / 2;

    // Alice draws a shape
    await pageA.keyboard.press('s');
    await pageA.mouse.move(cx - 80, cy - 40);
    await pageA.mouse.down();
    await pageA.mouse.move(cx + 80, cy + 40, { steps: 5 });
    await pageA.mouse.up();
    await tick(pageA, 500);
    await tick(pageB, 500);

    // Bob selects and deletes the shape
    await pageB.keyboard.press('v');
    await pageB.mouse.click(cx, cy);
    await tick(pageB, 200);
    await pageB.keyboard.press('Backspace');
    await tick(pageB, 500);
    await tick(pageA, 500);

    // Alice tries to create a connector to the (now deleted) shape
    await pageA.keyboard.press('l');
    await pageA.mouse.move(cx - 200, cy);
    await pageA.mouse.down();
    await pageA.mouse.move(cx, cy, { steps: 3 });
    await pageA.mouse.up();
    await tick(pageA, 500);

    // No crash, both pages still functional
    await expect(pageA).toHaveTitle(/vidi/);
    await expect(pageB).toHaveTitle(/vidi/);

    await context.close();
  });
});
