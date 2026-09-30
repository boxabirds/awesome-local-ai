import { test, expect } from '@playwright/test';
import {
  getCamera,
  getWorldLayer,
  getZoomLabel,
  getNavigationHint,
  getZoomInButton,
  getZoomOutButton,
  getResetButton,
  dragBoard,
  ctrlScrollBoard,
} from './helpers/board';

test.describe('Story 1: Pan and zoom around an infinite board (E2E)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="board-viewport"]');
    // Wait for test hooks to be registered
    await page.waitForFunction(() => !!(window as any).__vidi6);
  });

  // TC-31: Fresh load → origin, 100%, hint visible
  test('TC-31: fresh load shows origin at 100% with hint visible', async ({ page }) => {
    const camera = await getCamera(page);
    expect(camera.x).toBe(0);
    expect(camera.y).toBe(0);
    expect(camera.zoom).toBe(1);

    const label = await getZoomLabel(page);
    await expect(label).toHaveText('100%');

    const hint = await getNavigationHint(page);
    await expect(hint).toBeVisible();
  });

  // TC-32: Ctrl+wheel at centre → zoom > 100%
  test('TC-32: Ctrl+wheel zooms in', async ({ page }) => {
    await ctrlScrollBoard(page, -100, 640, 400);
    // Wait for rAF batched state update to render
    await page.waitForFunction(() => {
      const label = document.querySelector('[data-testid="zoom-label"]');
      return label && parseInt(label.textContent!) > 100;
    }, { timeout: 3000 });

    const camera = await getCamera(page);
    expect(camera.zoom).toBeGreaterThan(1);

    const label = await getZoomLabel(page);
    const text = await label.textContent();
    expect(parseInt(text!)).toBeGreaterThan(100);
  });

  // TC-33: drag 300px right, 200px down → camera moved
  test('TC-33: dragging moves the camera', async ({ page }) => {
    await dragBoard(page, 640, 400, 940, 600);
    await page.waitForTimeout(100);

    const camera = await getCamera(page);
    // Dragging right and down should move the camera left and up (negative x, negative y)
    expect(camera.x).toBeLessThan(0);
    expect(camera.y).toBeLessThan(0);
  });

  // TC-34: after any navigation → hint hidden
  test('TC-34: navigation hides the hint', async ({ page }) => {
    // Verify hint is visible initially
    const hint = await getNavigationHint(page);
    await expect(hint).toBeVisible();

    // Perform a navigation action (drag)
    await dragBoard(page, 640, 400, 740, 450);

    // Wait for hint to hide (rAF batched state update)
    await expect(hint).toBeHidden({ timeout: 3000 });
  });

  // TC-35: Zoom out to min → "10%", disabled; Zoom in → "13%"
  test('TC-35: zoom controls work with correct labels', async ({ page }) => {
    const zoomOut = await getZoomOutButton(page);
    const zoomIn = await getZoomInButton(page);
    const label = await getZoomLabel(page);

    // Click zoom out until disabled (max ~11 clicks from 100% to 10%)
    for (let i = 0; i < 15; i++) {
      if (await zoomOut.isDisabled()) break;
      await zoomOut.click();
      await page.waitForTimeout(30);
    }

    // At minimum zoom
    await expect(label).toHaveText('10%');
    expect(await zoomOut.isDisabled()).toBe(true);
    expect(await zoomIn.isDisabled()).toBe(false);

    // Click zoom in once
    await zoomIn.click();
    await page.waitForTimeout(50);
    await expect(label).toHaveText('13%');
  });

  // TC-36: Zoom in to 400%, zoom in disabled; zoom out → 320%
  test('TC-36: zoom in to max, then zoom out', async ({ page }) => {
    const zoomIn = await getZoomInButton(page);
    const zoomOut = await getZoomOutButton(page);
    const label = await getZoomLabel(page);

    // Click zoom in until disabled (max ~7 clicks from 100% to 400%)
    for (let i = 0; i < 10; i++) {
      if (await zoomIn.isDisabled()) break;
      await zoomIn.click();
      await page.waitForTimeout(30);
    }

    // At maximum zoom
    await expect(label).toHaveText('400%');
    expect(await zoomIn.isDisabled()).toBe(true);
    expect(await zoomOut.isDisabled()).toBe(false);

    // Click zoom out once
    await zoomOut.click();
    await page.waitForTimeout(50);
    await expect(label).toHaveText('320%');
  });

  // TC-37: Reset view → origin, 100%; hint NOT re-shown
  test('TC-37: reset view returns to origin at 100% without re-showing hint', async ({ page }) => {
    const hint = await getNavigationHint(page);

    // Navigate away
    await dragBoard(page, 640, 400, 940, 600);

    // Wait for hint to hide
    await expect(hint).toBeHidden({ timeout: 3000 });

    // Reset view using keyboard shortcut (Ctrl+0)
    await page.keyboard.down('Control');
    await page.keyboard.press('0');
    await page.keyboard.up('Control');

    // Wait for UI to update - zoom label should show 100%
    const label = await getZoomLabel(page);
    await expect(label).toHaveText('100%', { timeout: 3000 });

    // Hint should NOT re-appear
    await expect(hint).toBeHidden();
  });

  // TC-38: 50 drags of 1000px → no crash, camera stays in valid range
  test('TC-38: extreme pan does not crash', async ({ page }) => {
    // Perform many large drags
    for (let i = 0; i < 50; i++) {
      await dragBoard(page, 640, 400, 1640, 1400);
    }

    const camera = await getCamera(page);
    // Camera should still be a valid number (not NaN, Infinity)
    expect(Number.isFinite(camera.x)).toBe(true);
    expect(Number.isFinite(camera.y)).toBe(true);
    expect(Number.isFinite(camera.zoom)).toBe(true);
    expect(camera.zoom).toBeGreaterThanOrEqual(0.1);
    expect(camera.zoom).toBeLessThanOrEqual(4);
  });
});
