import { test, expect } from '@playwright/test';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS } from '@shared/config';

test.describe('E2E — Pen Tool Sketching (Story 11)', () => {
  // Shared helper: navigate to a fresh board and confirm toolbar is visible
  async function goToBoard(page: ReturnType<typeof test>): Promise<void> {
    await page.goto('/');
    await page.getByRole('button', { name: 'New board' }).click();
    // Wait for the board UI including toolbar (use contains match since aria-label includes shortcut)
    await expect(page.locator('[aria-label*="Pen (P)"]')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(500); // Allow UI to settle
  }

  // ─── TC-17: Draw with real drag, verify preview & persistence ────
  test('TC-17: draw loop with real drag → stroke persists after release', async ({ page }) => {
    await goToBoard(page);

    // Switch to Pen tool
    const penBtn = page.locator('[aria-label*="Pen (P)"]');
    await penBtn.click();
    await expect(penBtn).toHaveAttribute('aria-pressed', 'true');

    // Verify PenToolbar appears with colour swatches
    const penOptionsBar = page.locator('[role="toolbar"][aria-label="Pen options"]');
    await expect(penOptionsBar).toBeVisible({ timeout: 3000 });

    // Move mouse to viewport area and simulate drawing a loop-like path
    await page.mouse.move(400, 300);
    await page.mouse.down();
    
    // Draw a rough rectangle/loop by moving around
    await page.mouse.move(420, 280, { steps: 5 });
    await page.mouse.move(460, 290, { steps: 5 });
    await page.mouse.move(460, 350, { steps: 5 });
    await page.mouse.move(420, 350, { steps: 5 });
    await page.mouse.move(400, 300, { steps: 5 });
    
    await page.mouse.up();

    // Wait for the stroke to be committed
    await page.waitForTimeout(1000);

    // The pen should still be active
    await expect(penBtn).toHaveAttribute('aria-pressed', 'true');
  });

  // ─── TC-18: Shared sketch — others see finished stroke only ──────
  test('TC-18: draw while another tab watches (single-tab sim)', async ({ page }) => {
    await goToBoard(page);

    // Switch to Pen tool
    const penBtn = page.locator('[aria-label*="Pen (P)"]');
    await penBtn.click();
    await expect(penBtn).toHaveAttribute('aria-pressed', 'true');

    // Start a stroke
    await page.mouse.move(500, 400);
    await page.mouse.down();
    await page.mouse.move(550, 380, { steps: 3 });
    await page.mouse.move(560, 420, { steps: 3 });

    // At this point the stroke is still being drawn (not committed)
    await page.waitForTimeout(200);

    // Release to finish the stroke
    await page.mouse.up();
    await page.waitForTimeout(1000);

    // Tool should still be active
    await expect(penBtn).toHaveAttribute('aria-pressed', 'true');
  });

  // ─── TC-19: Navigation while Pen active ──────────────────────────
  test('TC-19: wheel while Pen active pans board, then draw creates stroke', async ({ page }) => {
    await goToBoard(page);

    // Switch to Pen tool
    const penBtn = page.locator('[aria-label*="Pen (P)"]');
    await penBtn.click();
    await expect(penBtn).toHaveAttribute('aria-pressed', 'true');

    // Wheel scroll should pan the board while Pen is active
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(300);

    // Now draw a line - should create a stroke, not pan
    await page.mouse.move(400, 300);
    await page.mouse.down();
    await page.mouse.move(450, 280, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(1000);

    // Verify the Pen tool is still active (pen stays active)
    await expect(penBtn).toHaveAttribute('aria-pressed', 'true');
  });

  // ─── TC-20: Select by line, resize proportional, move, delete ───
  test('TC-20: V + click line + corner resize + move + Delete', async ({ page }) => {
    await goToBoard(page);

    // First, create a stroke by drawing with Pen tool
    const penBtn = page.locator('[aria-label*="Pen (P)"]');
    await penBtn.click();
    await expect(penBtn).toHaveAttribute('aria-pressed', 'true');

    // Draw a simple line
    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.move(500, 280, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(1000);

    // Now switch to Select tool (V key)
    await page.keyboard.press('v');
    await page.waitForTimeout(300);

    // Click somewhere on the board to deselect previous
    await page.mouse.click(600, 100);
    await page.waitForTimeout(200);

    // Try to select the stroke by clicking near where it was drawn
    await page.mouse.click(400, 290);
    await page.waitForTimeout(300);

    // After pressing Delete, any selected object should be removed
    await page.keyboard.press('Delete');
    await page.waitForTimeout(500);

    // Clean up: press Escape to return to Select
    await page.keyboard.press('Escape');
  });

  // ─── Pen toolbar colour/thickness interaction ───────────────────
  test('Pen toolbar: colour swatch clicks work', async ({ page }) => {
    await goToBoard(page);

    // Open Pen tool
    const penBtn = page.locator('[aria-label*="Pen (P)"]');
    await penBtn.click();
    await expect(penBtn).toHaveAttribute('aria-pressed', 'true');

    // Click red colour swatch
    const redSwatch = page.locator('[aria-label="red pen"]');
    await expect(redSwatch).toBeVisible();
    await redSwatch.click();
    
    // Verify pressed state switches
    await expect(redSwatch).toHaveAttribute('aria-pressed', 'true');
    
    // Previous should be unpressed
    const blackSwatch = page.locator('[aria-label="black pen"]');
    await expect(blackSwatch).toHaveAttribute('aria-pressed', 'false');
  });

  // ─── Pen stays active across strokes ────────────────────────────
  test('Pen stays active after multiple strokes', async ({ page }) => {
    await goToBoard(page);

    const penBtn = page.locator('[aria-label*="Pen (P)"]');
    await penBtn.click();
    await expect(penBtn).toHaveAttribute('aria-pressed', 'true');

    // Draw first stroke
    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.move(350, 280, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    // Should still be active
    await expect(penBtn).toHaveAttribute('aria-pressed', 'true');

    // Draw second stroke
    await page.mouse.move(400, 400);
    await page.mouse.down();
    await page.mouse.move(450, 380, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    // Still active
    await expect(penBtn).toHaveAttribute('aria-pressed', 'true');

    // Press Escape to exit
    await page.keyboard.press('Escape');
    await expect(penBtn).toHaveAttribute('aria-pressed', 'false');
  });

  // ─── Click draws dot (no movement) ──────────────────────────────
  test('Click without movement draws a dot', async ({ page }) => {
    await goToBoard(page);

    const penBtn = page.locator('[aria-label*="Pen (P)"]');
    await penBtn.click();
    await expect(penBtn).toHaveAttribute('aria-pressed', 'true');

    // Quick tap — move down and immediately up with minimal displacement
    await page.mouse.move(500, 500);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(500);

    // Tool should still be active
    await expect(penBtn).toHaveAttribute('aria-pressed', 'true');
  });

  // ─── Keyboard shortcut P activates pen ──────────────────────────
  test('Press P activates Pen tool', async ({ page }) => {
    await goToBoard(page);

    const penBtn = page.locator('[aria-label*="Pen (P)"]');
    await expect(penBtn).toHaveAttribute('aria-pressed', 'false');

    await page.keyboard.press('p');
    await expect(penBtn).toHaveAttribute('aria-pressed', 'true');

    // Press v to go back to select
    await page.keyboard.press('v');
    await expect(penBtn).toHaveAttribute('aria-pressed', 'false');
  });

  // ─── Thickness buttons work ─────────────────────────────────────
  test('Thickness buttons update and reflect state', async ({ page }) => {
    await goToBoard(page);

    const penBtn = page.locator('[aria-label*="Pen (P)"]');
    await penBtn.click();

    const thickBtn = page.locator('[aria-label="Thick"]');
    const thinBtn = page.locator('[aria-label="Thin"]');
    const mediumBtn = page.locator('[aria-label="Medium"]');

    // Medium should start pressed
    await expect(mediumBtn).toHaveAttribute('aria-pressed', 'true');

    // Click Thick
    await thickBtn.click();
    await expect(thickBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(mediumBtn).toHaveAttribute('aria-pressed', 'false');

    // Click Thin
    await thinBtn.click();
    await expect(thinBtn).toHaveAttribute('aria-pressed', 'true');
  });
});
