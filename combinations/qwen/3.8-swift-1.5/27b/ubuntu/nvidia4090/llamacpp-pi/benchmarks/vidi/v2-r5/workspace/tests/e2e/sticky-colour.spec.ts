// tests/e2e/sticky-colour.spec.ts
import { test, expect } from '@playwright/test';

test.describe('sticky.colour (e2e)', () => {
  // TC-44: default yellow, click pink → pink
  test('TC-44: change colour via swatch', async ({ page }) => {
    await page.goto('/');
    
    // Create a note
    await page.getByTestId('create-sticky-btn').click();
    await page.keyboard.press('Escape');
    
    // After Escape, the note is selected and NoteToolbar should be visible
    const note = page.getByRole('group', { name: 'Sticky note' });
    await expect(note).toHaveAttribute('data-selected', 'true');
    await expect(page.getByTestId('note-toolbar')).toBeVisible();
    
    // Click the pink swatch
    await page.getByTestId('swatch-pink').click();
    
    // Note should still be selected
    await expect(note).toHaveAttribute('data-selected', 'true');
    
    // Pink swatch should be pressed
    await expect(page.getByTestId('swatch-pink')).toHaveAttribute('aria-pressed', 'true');
  });
});
