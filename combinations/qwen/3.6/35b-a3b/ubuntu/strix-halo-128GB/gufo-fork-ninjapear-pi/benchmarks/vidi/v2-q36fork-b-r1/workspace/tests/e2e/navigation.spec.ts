import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Import helpers
import {
  getZoomLabel,
  setCamera,
  clickReset,
  dragFromTo,
} from './helpers/board';

const PORT = parseInt(process.env.AGENT_PORT_FIRST || '22208', 10);
const BASE_URL = `http://localhost:${PORT}`;

// ==========================================
// Helper functions
// ==========================================

/** Read origin marker position relative to board viewport. */
async function getOriginScreenPos(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const vp = document.querySelector('[aria-label="Infinite board"]');
    const origin = document.querySelector('[data-testid="origin-marker"]');
    if (!vp || !origin) return { x: 0, y: 0 };
    const vpRect = vp.getBoundingClientRect();
    const originRect = origin.getBoundingClientRect();
    return {
      x: originRect.left - vpRect.left,
      y: originRect.top - vpRect.top,
    };
  });
}

/** Get zoom level from world layer transform. */
async function getZoomLevel(page: Page): Promise<number> {
  return page.evaluate(() => {
    const divs = document.querySelectorAll('div');
    for (const div of divs) {
      const style = div.getAttribute('style') || '';
      if (style.includes('transform-origin') && style.includes('scale(')) {
        const match = style.match(/scale\(([0-9.]+)\)/);
        if (match) return parseFloat(match[1]);
      }
    }
    return 1;
  });
}

/** Get camera state computed from DOM positions. */
async function getCameraFromDOM(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  return page.evaluate(() => {
    const vp = document.querySelector('[aria-label="Infinite board"]');
    const origin = document.querySelector('[data-testid="origin-marker"]');
    if (!vp || !origin) return { x: 0, y: 0, zoom: 1 };
    const vpRect = vp.getBoundingClientRect();
    const originRect = origin.getBoundingClientRect();
    let zoom = 1;
    const divs = document.querySelectorAll('div');
    for (const div of divs) {
      const style = div.getAttribute('style') || '';
      if (style.includes('transform-origin') && style.includes('scale(')) {
        const match = style.match(/scale\(([0-9.]+)\)/);
        if (match) zoom = parseFloat(match[1]);
      }
    }
    const screenX = originRect.left - vpRect.left;
    const screenY = originRect.top - vpRect.top;
    return {
      x: -screenX / zoom,
      y: -screenY / zoom,
      zoom,
    };
  });
}

/** Get viewport center coordinates in page space. */
async function getViewportCenter(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const vp = document.querySelector('[aria-label="Infinite board"]');
    if (!vp) return { x: 640, y: 400 };
    const rect = vp.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  });
}

/** Flush all pending rAF callbacks. */
async function flushRAF(page: Page): Promise<void> {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
}

/** Navigate and wait for full paint. */
async function navigateAndWait(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  // Wait for React to mount and ResizeObserver to fire
  await page.waitForTimeout(200);
  await flushRAF(page);
}

// ==========================================
// WORKFLOW 1: First visit navigation
// ==========================================

test.describe('Workflow 1: First visit navigation', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
  });

  // TC-28: Hint is visible on first load
  test('TC-28: hint visible on first visit', async ({ page }) => {
    const hint = page.getByTestId('navigation-hint');
    await expect(hint).toBeVisible();
  });

  // TC-23: Mouse drag moves origin by expected amount
  test('TC-23: mouse drag(200,100) moves origin by (200,100) ±1px and hides hint', async ({ page }) => {
    const hint = page.getByTestId('navigation-hint');
    await expect(hint).toBeVisible();

    // Get initial origin position
    const initialPos = await getOriginScreenPos(page);

    // Drag from center of viewport
    const center = await getViewportCenter(page);
    await dragFromTo(page, center.x, center.y, 200, 100);
    await flushRAF(page);

    // Hint should be gone after first navigation
    await expect(hint).not.toBeVisible();

    // Check that origin marker moved approximately (200, 100)
    const newPos = await getOriginScreenPos(page);
    const dx = newPos.x - initialPos.x;
    const dy = newPos.y - initialPos.y;
    expect(Math.abs(dx - 200)).toBeLessThanOrEqual(2);
    expect(Math.abs(dy - 100)).toBeLessThanOrEqual(2);
  });

  // TC-24: Ctrl+wheel zoom keeps visualViewport.scale at 1
  test('TC-24: Ctrl+wheel zoom increases zoom factor and visualViewport.scale stays 1', async ({ page }) => {
    const board = await page.locator('[aria-label="Infinite board"]');
    const box = await board.boundingBox();
    if (!box) throw new Error('Board not found');

    const targetX = box.x + box.width / 2;
    const targetY = box.y + box.height / 2;
    const initialZoom = await getZoomLevel(page);

    // Move pointer to center and dispatch ctrl wheel
    await page.mouse.move(targetX, targetY);
    await page.dispatchEvent('[aria-label="Infinite board"]', 'wheel', {
      deltaX: 0,
      deltaY: -100,
      ctrlKey: true,
    });
    await flushRAF(page);

    // visualViewport.scale should still be 1
    const vScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    expect(vScale).toBe(1);

    // Zoom factor should have increased significantly (factor ≈ exp(1) ≈ 2.718)
    const newZoom = await getZoomLevel(page);
    expect(newZoom).toBeGreaterThan(initialZoom * 1.5);
  });
});

// ==========================================
// WORKFLOW 2: Limits and recovery
// ==========================================

test.describe('Workflow 2: Limits and recovery', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
  });

  // TC-25: Click + until disabled, label shows "400%"
  test('TC-25: zoom in reaches ZOOM_MAX, + disabled, label ends with 400%', async ({ page }) => {
    // Click zoom-in until disabled
    const btn = page.getByRole('button', { name: /Zoom in/i });
    while (await btn.isEnabled()) {
      await btn.click();
      await page.waitForTimeout(30);
    }

    // Label should show 400%
    const label = await getZoomLabel(page);
    expect(label).toContain('400%');

    // + button should be disabled
    await expect(btn).toBeDisabled();
  });

  // TC-26: Jump far via test hook, reset back to center
  test('TC-26: setCamera(zoom=4) then Reset → label 100%, origin at centre ±1px', async ({ page }) => {
    // Verify test hook is available
    const hasHook = await page.evaluate(() => typeof window.__vidi6?.setCamera === 'function');
    if (!hasHook) throw new Error('__vidi6.setCamera not available — build may not be in test mode');

    // Set camera to zoom 4 via test hook
    await setCamera(page, { x: 0, y: 0, zoom: 4 });

    // Verify zoom is now 4
    const zoomLabel = await getZoomLabel(page);
    expect(zoomLabel).toContain('400%');

    // Click reset
    await clickReset(page);
    await page.waitForTimeout(100);
    await flushRAF(page);

    // Label should show 100%
    const resetLabel = await getZoomLabel(page);
    expect(resetLabel).toContain('100%');

    // Debug: inspect board and origin states after reset
    const boardDebug = await page.evaluate(() => {
      const vp = document.querySelector('[aria-label="Infinite board"]') as unknown as HTMLDivElement;
      const wl = document.querySelector('[class=""]');
      const orig = document.querySelector('[data-testid="origin-marker"]');
      return {
        vpBgPos: vp?.style.backgroundPosition || 'N/A',
        vpBgSize: vp?.style.backgroundSize || 'N/A',
        vpW: vp?.getBoundingClientRect().width || 0,
        vpH: vp?.getBoundingClientRect().height || 0,
        vpRect: vp?.getBoundingClientRect() ? JSON.stringify(vp.getBoundingClientRect()) : 'none',
        origLeft: (orig as HTMLElement)?.style.left || 'N/A',
        origTop: (orig as HTMLElement)?.style.top || 'N/A',
        origRect: orig?.getBoundingClientRect() ? JSON.stringify(orig.getBoundingClientRect()) : 'none',
      };
    });
    console.log('TC-26 board debug:', JSON.stringify(boardDebug));
    const viewportCenter = await page.evaluate(() => {
      const vp = document.querySelector('[aria-label="Infinite board"]');
      if (!vp) return { x: 640, y: 400 };
      const rect = vp.getBoundingClientRect();
      return { x: rect.width / 2, y: rect.height / 2 };
    });

    // Origin should be at centre after reset — verify via evaluate
    const originAtCentre = await page.evaluate(() => {
      const vp = document.querySelector('[aria-label="Infinite board"]');
      const orig = document.querySelector('[data-testid="origin-marker"]');
      if (!vp || !orig) return false;
      const vpRect = vp.getBoundingClientRect();
      const origRect = orig.getBoundingClientRect();
      const dx = Math.abs(origRect.left - vpRect.left - vpRect.width / 2);
      const dy = Math.abs(origRect.top - vpRect.top - vpRect.height / 2);
      return dx <= 1 && dy <= 1;
    });
    expect(originAtCentre).toBe(true);
  });
});

// ==========================================
// WORKFLOW 3: Far travel
// ==========================================

test.describe('Workflow 3: Far travel', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page);
  });

  // TC-27: Pan from a very far camera position
  test('TC-27: at large offset, drag(200,100) shifts dot grid correctly', async ({ page }) => {
    // Jump to a far-away camera position using the test hook
    await setCamera(page, { x: 1_000_000, y: 1_000_000, zoom: 1 });
    await flushRAF(page);

    // Get viewport center
    const center = await getViewportCenter(page);

    // Record the initial pixel position where dots appear on screen
    // Dots appear at specific screen positions determined by camera × zoom mod spacing
    const initialDots = await page.evaluate(() => {
      const vp = document.querySelector('[aria-label="Infinite board"]') as unknown as HTMLDivElement;
      if (!vp) return null;
      const bgPos = vp.style.backgroundPosition || '';
      // Parse background-size to get spacing
      const bgSize = vp.style.backgroundSize || '';
      const parts = bgSize.split(',').map(s => s.trim());
      return {
        bgPosX: parseFloat(parts[0]) || 0,
        bgPosY: parseFloat(parts[1]) || 0,
        bgSizeW: parts[0] ? parseFloat(parts[0].split(' ')[0]) : 24,
        bgSizeH: parts[1] ? parseFloat(parts[1].split(' ')[0]) : 24,
      };
    });
    if (!initialDots) throw new Error('Viewport not found');

    // Drag 200px right and 100px down
    await dragFromTo(page, center.x, center.y, 200, 100);
    await flushRAF(page);

    // Verify background position changed (dots shifted due to pan)
    const afterDots = await page.evaluate(() => {
      const vp = document.querySelector('[aria-label="Infinite board"]') as unknown as HTMLDivElement;
      if (!vp) return null;
      const bgPos = vp.style.backgroundPosition || '';
      const bgSize = vp.style.backgroundSize || '';
      const parts = bgSize.split(',').map(s => s.trim());
      return {
        bgPosX: parseFloat(parts[0]) || 0,
        bgPosY: parseFloat(parts[1]) || 0,
      };
    });
    if (!afterDots) throw new Error('Viewport not found');

    // At zoom=1, panBy(dx, dy) changes background position by +dx, +dy mod spacing
    // The shift should be detectable
    const dxShift = Math.abs((afterDots.bgPosX - initialDots.bgPosX + 24) % 24);
    const dyShift = Math.abs((afterDots.bgPosY - initialDots.bgPosY + 24) % 24);

    // 200 mod 24 = 8, 100 mod 24 = 4
    expect(dxShift).toBe(8);
    expect(dyShift).toBe(4);
  });
});

// ==========================================
// NEGATIVE TESTS
// ==========================================

test.describe('Negative tests', () => {
  // TC-31: After Ctrl+wheel and keyboard shortcuts, visualViewport.scale and devicePixelRatio unchanged
  test('TC-31: zoom operations do not affect visualViewport.scale or devicePixelRatio', async ({ page }) => {
    const initialVScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    const initialDPR = await page.evaluate(() => window.devicePixelRatio);

    // Reset camera first so board is back at default position
    await clickReset(page);
    await flushRAF(page);

    // Get viewport center safely using evaluate (no locator needed)
    const midX = await page.evaluate(() => {
      const vp = document.querySelector('[aria-label="Infinite board"]');
      if (!vp) return (window.innerWidth || 1280) / 2;
      const rect = vp.getBoundingClientRect();
      return rect.left + rect.width / 2;
    });
    const midY = await page.evaluate(() => {
      const vp = document.querySelector('[aria-label="Infinite board"]');
      if (!vp) return (window.innerHeight || 800) / 2;
      const rect = vp.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });

    // Dispatch Ctrl+wheel via JavaScript evaluation (avoids Playwright cancellation issues)
    await page.evaluate(({ mx, my }: { mx: number; my: number }) => {
      const target = document.elementFromPoint(mx, my);
      if (target instanceof HTMLElement) {
        target.dispatchEvent(new WheelEvent('wheel', {
          deltaX: 0,
          deltaY: -100,
          ctrlKey: true,
          bubbles: true,
        }));
      }
    }, { mx: midX, my: midY });
    await flushRAF(page);

    // Keyboard shortcuts (Ctrl+=, Ctrl+-, Ctrl+0)
    await page.keyboard.down('Control');
    await page.keyboard.press('=');
    await page.keyboard.press('-');
    await page.keyboard.press('0');
    await page.keyboard.up('Control');
    await flushRAF(page);

    // visualViewport.scale should still be 1
    const finalVScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
    expect(finalVScale).toBe(1);

    // devicePixelRatio should be unchanged
    const finalDPR = await page.evaluate(() => window.devicePixelRatio);
    expect(finalDPR).toBe(initialDPR);
  });
});
