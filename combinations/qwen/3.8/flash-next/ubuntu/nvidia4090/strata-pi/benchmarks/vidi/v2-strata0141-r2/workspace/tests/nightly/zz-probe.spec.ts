import { test } from '@playwright/test';
import { createNote, openEditor } from '../e2e/helpers/participants';

test('probe clamp', async ({ page }) => {
  test.setTimeout(120_000);
  page.on('console', (message) => console.log(`  page: ${message.text()}`));
  await page.goto('/');
  await page.waitForSelector('[data-testid="board-root"]');
  const id = await createNote(page, { x: 640, y: 400 });
  await openEditor(page, id);
  const area = page.getByTestId('sticky-textarea');
  await area.fill('x'.repeat(5000));
  await page.waitForTimeout(400);
  console.log('[probe after fill] dom=', await area.inputValue().then((v) => v.length));
  await page.keyboard.type('abc');
  await page.waitForTimeout(300);
  console.log('[probe after type] dom=', (await area.inputValue()).length);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const shown = await page.locator(`[data-note-id=${JSON.stringify(id)}] [data-testid="sticky-text"]`).innerText();
  console.log('[probe after escape] shown=', shown.length, JSON.stringify(shown.slice(0, 20)));
});
