// tests/e2e/sticky-delete.spec.ts
import { test, expect } from '@playwright/test';

test.describe('sticky.delete (e2e)', () => {
  // TC-45: Delete key removes selected note
  test('TC-45: delete via keyboard', async ({ page }) => {
    await page.goto('/');
    
    // Create a note
    await page.getByTestId('create-sticky-btn').click();
    await page.keyboard.press('Escape');
    
    const notes = page.getByRole('group', { name: 'Sticky note' });
    await expect(notes).toHaveCount(1);
    
    // Select the note
    await notes.first().click();
    
    // Press Delete
    await page.keyboard.press('Delete');
    
    // Note should be gone
    await expect(notes).toHaveCount(0);
  });

  // TC-46: bin button removes selected note
  test('TC-46: delete via bin button', async ({ page }) => {
    await page.goto('/');
    
    // Create a note
    await page.getByTestId('create-sticky-btn').click();
    await page.keyboard.press('Escape');
    
    const notes = page.getByRole('group', { name: 'Sticky note' });
    await expect(notes).toHaveCount(1);
    
    // Select the note
    await notes.first().click();
    
    // Click the delete button
    await page.getByTestId('delete-note-btn').click();
    
    // Note should be gone
    await expect(notes).toHaveCount(0);
  });
});
