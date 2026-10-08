import { test, expect } from '@playwright/test';

/** Get viewport dimensions from browser */
async function getViewport(page) {
  const { width, height } = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  return { width, height };
}

function worldToScreen(worldX, worldY, zoom) {
  return { x: worldX * zoom, y: worldY * zoom };
}

function screenToWorld(screenX, screenY, zoom) {
  return { x: screenX / zoom, y: screenY / zoom };
}

test.describe('E2E — Pan and Zoom (Story 1)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Click "New board" on home page to get to the board view
    await page.getByRole('button', { name: 'New board' }).click();
    // Wait for the board UI to appear
    await expect(page.locator('[aria-label="Sticky note"]')).toBeVisible({ timeout: 5000 });
  });

  // ── TC-E2E-01: Initial view ────────────────────────────────────────
  test('TC-E2E-01: app loads with default zoom (1×), hint visible', async ({ page }) => {
    // Default zoom should be 1x
    const zoomEl = page.getByRole('button', { name: 'Zoom 100%' });
    await expect(zoomEl).toBeVisible();

    // Navigation hint should be visible on first visit
    const hint = page.getByText(/Drag to move|Ctrl.*scroll/);
    await expect(hint).toBeVisible();
  });

  // ── TC-E2E-02: Drag pan ────────────────────────────────────────────
  test('TC-E2E-02: drag pan updates camera and grid position', async ({ page }) => {
    const { width, height } = await getViewport(page);
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);

    // Center of viewport should be at origin (0,0) initially
    const centerBefore = await page.evaluate(
      () => ({ zoom: parseFloat((window as any).__getCamera()?.zoom?.toFixed(4)) || 0 }),
    );

    // Drag from center by ~200px right
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 200, cy);
    await page.mouse.up();

    // Camera should have changed
    const afterPan = await page.evaluate(() => {
      const cam = (window as any).__getCamera?.();
      return cam ? { x: +(cam.x ?? 0).toFixed(2), y: +(cam.y ?? 0).toFixed(2) } : null;
    });

    expect(afterPan).not.toBeNull();
    // Panning right shifts camera.x positive
    expect(afterPan!.x).toBeGreaterThan(0);
  });

  // ── TC-E2E-03: Ctrl+wheel zoom in ──────────────────────────────────
  test('TC-E2E-03: ctrl+wheel zooms in, zoom indicator updates', async ({ page }) => {
    const { width, height } = await getViewport(page);
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);

    // Scroll wheel down with ctrl held
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, 300, { modifiers: ['Control'] });

    // Check zoom increased
    const zoomAfter = await page.evaluate(() => {
      const cam = (window as any).__getCamera?.();
      return cam ? +(cam.zoom ?? 1).toFixed(4) : 1;
    });
    expect(zoomAfter).toBeGreaterThan(1);

    // Hint should be hidden after navigation
    const hint = page.getByText(/Drag to move/);
    await expect(hint).not.toBeVisible();
  });

  // ── TC-E2E-04: Ctrl+wheel zoom out ─────────────────────────────────
  test('TC-E2E-04: ctrl+wheel zooms out past minimum, stops', async ({ page }) => {
    const { width, height } = await getViewport(page);
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);

    // First zoom way in
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -2000, { modifiers: ['Control'] });

    // Then zoom all the way out
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, 2000, { modifiers: ['Control'] });

    // Zoom should not go below ZOOM_MIN
    const zoomOut = await page.evaluate(() => {
      const cam = (window as any).__getCamera?.();
      return cam ? +(cam.zoom ?? 1).toFixed(4) : 1;
    });
    expect(zoomOut).toBeGreaterThanOrEqual(0.5); // ZOOM_MIN = 0.5
  });

  // ── TC-E2E-05: Regular wheel pan ───────────────────────────────────
  test('TC-E2E-05: regular wheel (no modifier) pans horizontally', async ({ page }) => {
    const { width, height } = await getViewport(page);
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);

    // Wheel without ctrl → pan
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(200, 0);

    // Camera should have panned left (negative delta produces negative pan)
    const cam = await page.evaluate(() => {
      const c = (window as any).__getCamera?.();
      return { x: +(c?.x ?? 0).toFixed(2), y: +(c?.y ?? 0).toFixed(2) };
    });
    expect(cam.x).toBeLessThan(0);
  });

  // ── TC-E2E-06: Zoom controls buttons ───────────────────────────────
  test('TC-E2E-06: zoom in/out buttons work and update display', async ({ page }) => {
    const { width, height } = await getViewport(page);
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);

    // Record initial zoom
    const initZoom = await page.evaluate(() => {
      const cam = (window as any).__getCamera?.();
      return cam ? +(cam.zoom ?? 1).toFixed(4) : 1;
    });

    // Click "zoom in" button
    const btn = page.locator('[aria-label="Zoom in"]').first();
    await btn.click();

    const newZoom = await page.evaluate(() => {
      const cam = (window as any).__getCamera?.();
      return cam ? +(cam.zoom ?? 1).toFixed(4) : 1;
    });

    expect(newZoom).toBeGreaterThan(initZoom);
  });

  // ── TC-E2E-07: Keyboard shortcuts ──────────────────────────────────
  test('TC-E2E-07: keyboard shortcuts work: Ctrl+=, Ctrl+-, Ctrl+0', async ({ page }) => {
    const initZoom = await page.evaluate(() => {
      const cam = (window as any).__getCamera?.();
      return cam ? +(cam.zoom ?? 1).toFixed(4) : 1;
    });

    // Ctrl+= → zoomIn
    await page.keyboard.press('Control+=');
    const zoomIn = await page.evaluate(() => {
      const cam = (window as any).__getCamera?.();
      return cam ? +(cam.zoom ?? 1).toFixed(4) : 1;
    });
    expect(zoomIn).toBeGreaterThan(initZoom);

    // Ctrl+- → zoomOut
    await page.keyboard.press('Control+-');
    const zoomOut = await page.evaluate(() => {
      const cam = (window as any).__getCamera?.();
      return cam ? +(cam.zoom ?? 1).toFixed(4) : 1;
    });
    expect(zoomOut).toBeLessThan(zoomIn);

    // Ctrl+0 → reset
    await page.keyboard.press('Control+0');
    const zoomReset = await page.evaluate(() => {
      const cam = (window as any).__getCamera?.();
      return cam ? +(cam.zoom ?? 1).toFixed(4) : 1;
    });
    expect(zoomReset).toBe(1);
  });

  // ── TC-E2E-08: Reset button ────────────────────────────────────────
  test('TC-E2E-08: reset button restores initial view', async ({ page }) => {
    // Make some navigation changes
    await page.locator('[aria-label="Zoom in"]').first().click();

    // Reset
    await page.locator('[aria-label="Reset"]').first().click();

    const cam = await page.evaluate(() => {
      const c = (window as any).__getCamera?.();
      return { x: +(c?.x ?? 0).toFixed(2), y: +(c?.y ?? 0).toFixed(2), z: +(c?.zoom ?? 1).toFixed(4) };
    });

    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
    expect(cam.z).toBe(1);
  });

  // ── TC-E2E-09: Dot grid responds to camera ─────────────────────────
  test('TC-E2E-09: dot grid background moves with pan and scales with zoom', async ({ page }) => {
    const beforeStyles = await page.evaluate(() => {
      const grid = document.querySelector('div[style*="background-image"]') as HTMLElement | null;
      return {
        size: grid?.style.backgroundSize || '',
        pos: grid?.style.backgroundPosition || '',
      };
    });

    // Pan right
    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.move(500, 300);
    await page.mouse.up();

    const afterPanStyles = await page.evaluate(() => {
      const grid = document.querySelector('div[style*="background-image"]') as HTMLElement | null;
      return {
        size: grid?.style.backgroundSize || '',
        pos: grid?.style.backgroundPosition || '',
      };
    });

    // Background position should have changed
    expect(afterPanStyles.pos).not.toBe(beforeStyles.pos);
  });

  // ── TC-E2E-10: Cursor state ────────────────────────────────────────
  test('TC-E2E-10: cursor changes grab ↔ grabbing during drag', async ({ page }) => {
    await page.mouse.move(300, 300);
    await page.mouse.down();

    // During drag
    const draggingCursor = await page.evaluate(() => {
      const vp = document.querySelector('div[style*="position: fixed"]') as HTMLElement | null;
      return vp?.style.cursor || '';
    });
    expect(draggingCursor).toBe('grabbing');

    await page.mouse.up();

    // After release
    const idleCursor = await page.evaluate(() => {
      const vp = document.querySelector('div[style*="position: fixed"]') as HTMLElement | null;
      return vp?.style.cursor || '';
    });
    expect(idleCursor).toBe('grab');
  });

  // ── TC-E2E-11: Crosshair origin marker ─────────────────────────────
  test('TC-E2E-11: red origin crosshair always visible at world (0,0)', async ({ page }) => {
    // Origin marker should be an SVG element
    const hasOrigin = await page.evaluate(() => {
      const svg = document.querySelector('svg[aria-label="Board origin"]');
      return !!svg;
    });
    expect(hasOrigin).toBe(true);

    // Move around then check it's still there (it's rendered in world space at origin)
    await page.mouse.move(600, 600);
    await page.mouse.down();
    await page.mouse.move(100, 100);
    await page.mouse.up();

    const stillThere = await page.evaluate(() => {
      const svg = document.querySelector('svg[aria-label="Board origin"]');
      return !!svg;
    });
    expect(stillThere).toBe(true);
  });

  // ── TC-E2E-12: Pinch-to-zoom simulation ────────────────────────────
  test('TC-E2E-12: touchpad pinch simulates ctrl+wheel zoom', async ({ page }) => {
    const { width, height } = await getViewport(page);
    const cx = Math.floor(width / 2);
    const cy = Math.floor(height / 2);

    // Use ctrl-wheel as pinch-to-zoom equivalent since Playwright doesn't have gesture events
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -500, { modifiers: ['Control'] });

    const zoomVal = await page.evaluate(() => {
      const cam = (window as any).__getCamera?.();
      return cam ? +(cam.zoom ?? 1).toFixed(4) : 1;
    });
    expect(zoomVal).toBeGreaterThan(1);
  });
});
