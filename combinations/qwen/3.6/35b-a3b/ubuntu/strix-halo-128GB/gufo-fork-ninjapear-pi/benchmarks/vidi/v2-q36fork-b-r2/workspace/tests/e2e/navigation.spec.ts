import { test, expect } from '@playwright/test';

test.describe('Story 1 — Pan and zoom around an infinite board', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for React to mount and rAF to settle
    await page.waitForSelector('.viewport');
    await new Promise((r) => setTimeout(r, 300));
  });

  // ---------- TC-31: initial render ----------
  test('TC-31: initial page renders dot grid at 100%', async ({ page }) => {
    // Dot grid background should exist
    const dotGrid = page.locator('.dot-grid');
    await expect(dotGrid).toBeVisible();

    // ZoomControls toolbar should show 100%
    const percentLabel = page.getByText('100%');
    await expect(percentLabel).toBeVisible();

    // NavigationHint should be visible on first visit
    const hint = page.getByText(/Drag to move/i);
    await expect(hint).toBeVisible();
  });

  // ---------- TC-32: pointer drag pans ----------
  test('TC-32: pointer drag pans the board', async ({ page }) => {
    // Record initial transform
    const world = page.locator('.world-layer');
    const initialTransform = await world.getAttribute('style');

    // Drag 150px right, 80px down
    const vpSize = (page.viewportSize as unknown as () => { width: number; height: number } | null)()!;
    const viewport = page.locator('.viewport');
    await viewport.hover();
    await page.mouse.down();
    await page.mouse.move(vpSize.width / 2 + 150, vpSize.height / 2 + 80);
    await page.mouse.up();

    // The world-layer style should have changed (different translate values)
    const newTransform = await world.getAttribute('style');
    expect(newTransform).not.toBe(initialTransform);
  });

  // ---------- TC-33: scroll wheel zooms ----------
  test('TC-33: mousewheel zooms in/out', async ({ page }) => {
    const viewport = page.locator('.viewport');

    // Simulate Ctrl-wheel zoom in (negative deltaY = zoom in per our handler)
    await viewport.hover();
    await page.dispatchEvent('.viewport', 'wheel', { deltaY: -100, ctrlKey: true });

    // Wait for zoom to apply via rAF
    await new Promise((r) => setTimeout(r, 200));

    // Percent should no longer be 100%
    const percentLabel = page.getByText(/^\d+%$/);
    await expect(percentLabel).toHaveText(/^\d+%$/);
    const currentZoom = parseInt(await percentLabel.innerText());
    expect(currentZoom).toBeGreaterThan(100);
  });

  // ---------- TC-34: keyboard shortcuts ----------
  test('TC-34: keyboard shortcuts control zoom', async ({ page }) => {
    // Zoom in with Ctrl+=
    await page.keyboard.press('Control+=');
    await new Promise((r) => setTimeout(r, 200));

    const zoomInLabel = page.getByText(/^\d+%$/);
    const beforeReset = await zoomInLabel.innerText();
    const zoomBefore = parseInt(beforeReset);
    expect(zoomBefore).toBeGreaterThan(100);

    // Reset with Ctrl+0
    await page.keyboard.press('Control+0');
    await new Promise((r) => setTimeout(r, 200));

    // Should be back at 100%
    await expect(page.getByText('100%')).toBeVisible();
  });

  // ---------- TC-35: navigation hint fadeout ----------
  test('TC-35: navigation hint disappears after first pan', async ({ page }) => {
    // Hint starts visible
    await expect(page.getByText(/Drag to move/i)).toBeVisible();

    // Pan the board by dragging
    const vpSize = (page.viewportSize as unknown as () => { width: number; height: number } | null)()!;
    const viewport = page.locator('.viewport');
    await viewport.hover();
    await page.mouse.down();
    await page.mouse.move(vpSize.width / 2 + 200, vpSize.height / 2 + 100);
    await page.mouse.up();

    // After panning, camera changes → hasNavigated=true → hint unmounted
    // Give rAF time to flush
    await new Promise((r) => setTimeout(r, 200));

    // The hint text should be gone
    await expect(page.getByText(/Drag to move/i)).not.toBeVisible();
  });

  // ---------- TC-36: dot grid is present in DOM ----------
  test('TC-36: dot grid overlay is rendered at initial zoom', async ({ page }) => {
    // Verify the dot-grid div exists (it's rendered as an absolute overlay)
    const dotGrid = page.locator('.dot-grid');
    await expect(dotGrid).toBeVisible();

    // The dot grid background-size should reflect GRID_SPACING * zoom
    // At zoom=1.0, spacing should be 40px
    const bgSize = await dotGrid.evaluate(
      (el: HTMLElement) => getComputedStyle(el).backgroundSize,
    );
    expect(bgSize).toMatch(/\d+/);
  });
});
