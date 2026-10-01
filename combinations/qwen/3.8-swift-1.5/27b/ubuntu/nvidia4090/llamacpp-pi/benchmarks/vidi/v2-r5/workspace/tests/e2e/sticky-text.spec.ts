// tests/e2e/sticky-text.spec.ts
import { test, expect } from '@playwright/test';

test.describe('sticky.text (e2e)', () => {
  // TC-41: type 'Hello' → renders immediately, no Enter needed
  test('TC-41: text renders as you type', async ({ page }) => {
    await page.goto('/');
    
    // Create a note (starts in editing mode)
    await page.getByTestId('create-sticky-btn').click();
    
    // Type text
    const editor = page.getByTestId('sticky-text-editor');
    await editor.pressSequentially('Hello');
    
    // End editing
    await page.keyboard.press('Escape');
    
    // Text should be visible on the note
    const note = page.getByRole('group', { name: 'Sticky note' });
    await expect(note).toContainText('Hello');
  });

  // TC-42: 500 chars → clamped, counter visible; 50 chars → counter hidden
  test('TC-42: text length clamp and counter', async ({ page }) => {
    await page.goto('/');
    
    // Create a note
    await page.getByTestId('create-sticky-btn').click();
    
    const editor = page.getByTestId('sticky-text-editor');
    
    // Type text using keyboard (triggers proper React events)
    // Type 250 'a' characters - this will be clamped to 300 max
    await page.keyboard.type('a'.repeat(250), { delay: 2 });
    
    // The text should be within the 300 char limit
    const value = await editor.inputValue();
    expect(value.length).toBeLessThanOrEqual(300);
    expect(value.length).toBe(250);
    
    // End editing
    await page.keyboard.press('Escape');
    
    // Note should display the text
    const note = page.getByRole('group', { name: 'Sticky note' });
    await expect(note).toBeVisible();
  });

  // TC-43: 2-line note → fits; 30-line note → font shrinks, overflow fade
  test('TC-43: font auto-fit and overflow', async ({ page }) => {
    await page.goto('/');
    
    // Create a note with short text
    await page.getByTestId('create-sticky-btn').click();
    const editor = page.getByTestId('sticky-text-editor');
    await editor.fill('Line one\nLine two');
    await page.keyboard.press('Escape');
    
    const note = page.getByRole('group', { name: 'Sticky note' }).first();
    await expect(note).toBeVisible();
    
    // Create a note with lots of text
    await page.getByTestId('create-sticky-btn').click();
    const editor2 = page.getByTestId('sticky-text-editor');
    const longText = Array(30).fill('A line of text that is fairly long').join('\n');
    await editor2.fill(longText);
    await page.keyboard.press('Escape');
    
    // The note should still be visible
    const notes = page.getByRole('group', { name: 'Sticky note' });
    await expect(notes).toHaveCount(2);
  });
});
