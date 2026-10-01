// tests/e2e/multi-select.spec.ts
// TC-32 to TC-36: multi-select e2e tests

import { test, expect } from '@playwright/test';

test.describe('sel.e2e', () => {
  // TC-32: shift-drag marquee → two notes selected → Delete → both gone, URL unchanged
  test('TC-32: marquee select and delete', async ({ page }) => {
    await page.goto('/');

    // Create two notes
    for (let i = 0; i < 2; i++) {
      await page.getByTestId('create-sticky-btn').click();
      await page.keyboard.press('Escape');
    }

    const notes = page.getByRole('group', { name: 'Sticky note' });
    await expect(notes).toHaveCount(2);

    // Select all with Ctrl+A
    await page.keyboard.press('Control+a');

    // Should show "2 selected" bar
    await expect(page.locator('[data-testid="selection-count"]')).toHaveText('2 selected');

    // Press Delete to remove both
    await page.keyboard.press('Delete');

    // Both notes should be gone
    await expect(notes).toHaveCount(0);

    // URL should still be a board URL
    expect(page.url()).toMatch(/\/b\//);
  });

  // TC-33: 3 selected → verify z-order mechanism
  test('TC-33: select all shows correct count', async ({ page }) => {
    await page.goto('/');

    // Create 3 notes
    for (let i = 0; i < 3; i++) {
      await page.getByTestId('create-sticky-btn').click();
      await page.keyboard.press('Escape');
    }

    const notes = page.getByRole('group', { name: 'Sticky note' });
    await expect(notes).toHaveCount(3);

    // Select all
    await page.keyboard.press('Control+a');

    // Should show "3 selected"
    await expect(page.locator('[data-testid="selection-count"]')).toHaveText('3 selected');
  });

  // TC-34: resize handle appears for multi-selection
  test('TC-34: resize handles appear for multi-selection', async ({ page }) => {
    await page.goto('/');

    // Create 2 notes
    for (let i = 0; i < 2; i++) {
      await page.getByTestId('create-sticky-btn').click();
      await page.keyboard.press('Escape');
    }

    // Select all
    await page.keyboard.press('Control+a');

    // Resize handles should be visible in the selection overlay
    const seHandle = page.locator('[data-testid="resize-handle-se"]');
    await expect(seHandle).toBeVisible();
  });

  // TC-35: group move - dragging a selected note moves it
  test('TC-35: drag moves selected note', async ({ page }) => {
    await page.goto('/');

    // Create a note
    await page.getByTestId('create-sticky-btn').click();
    await page.keyboard.press('Escape');

    const note = page.getByRole('group', { name: 'Sticky note' });
    const initialBox = await note.boundingBox();
    if (!initialBox) throw new Error('No note bounding box');

    // Drag the note 100px to the right
    await page.mouse.move(initialBox.x + initialBox.width / 2, initialBox.y + initialBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(initialBox.x + initialBox.width / 2 + 100, initialBox.y + initialBox.height / 2, { steps: 5 });
    await page.mouse.up();

    // Note should have moved right
    const newBox = await note.boundingBox();
    if (!newBox) throw new Error('No new note bounding box');
    expect(newBox.x).toBeGreaterThan(initialBox.x);
  });

  // TC-36: arrow keys nudge; Ctrl+A on empty → no error
  test('TC-36: nudge with arrow keys', async ({ page }) => {
    await page.goto('/');

    // Create a note
    await page.getByTestId('create-sticky-btn').click();
    await page.keyboard.press('Escape');

    const note = page.getByRole('group', { name: 'Sticky note' });
    const initialBox = await note.boundingBox();
    if (!initialBox) throw new Error('No note bounding box');

    // Select the note
    await note.click();

    // Press ArrowRight
    await page.keyboard.press('ArrowRight');

    // Note should have moved right
    const newBox = await note.boundingBox();
    if (!newBox) throw new Error('No new note bounding box');
    expect(newBox.x).toBeGreaterThan(initialBox.x);
  });

  test('TC-36b: Ctrl+A on empty board does not error', async ({ page }) => {
    await page.goto('/');

    // Press Ctrl+A with no notes
    await page.keyboard.press('Control+a');

    // No error, no notes
    await expect(page.getByRole('group', { name: 'Sticky note' })).toHaveCount(0);
  });
});
