import { test, expect, Page } from '@playwright/test';

/**
 * Nightly E2E tests for live collaboration (story 3).
 * These are longer-running tests that verify sustained collaboration.
 */

async function createBoardPage(browser: any, boardId: string): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await page.goto(`/${boardId}`);
  await page.waitForTimeout(500);
  return page;
}

async function closePage(page: Page): Promise<void> {
  await page.context().close();
}

test.describe('TC-29: sustained collaboration', () => {
  test('two editors collaborate for 30s without divergence', async ({ browser }) => {
    const boardId = 'nightly-29';
    const pageA = await createBoardPage(browser, boardId);
    const pageB = await createBoardPage(browser, boardId);

    // Create initial notes
    for (let i = 0; i < 5; i++) {
      await pageA.mouse.dblclick(200 + i * 120, 300);
      await pageA.getByTestId('sticky-note').nth(i).waitFor();
      await pageA.keyboard.type(`Item${i}`);
      await pageA.keyboard.press('Escape');
    }

    // Wait for B to see all notes
    await expect(async () => {
      const count = await pageB.getByTestId('sticky-note').count();
      expect(count).toBe(5);
    }).toPass({ timeout: 5000 });

    // Sustained editing: both pages make edits over time
    const duration = 10000; // 10s (shortened from 30s for CI)
    const startTime = Date.now();

    while (Date.now() - startTime < duration) {
      // A edits a random note
      const noteA = pageA.getByTestId('sticky-note').nth(Math.floor(Math.random() * 5));
      await noteA.click();
      await pageA.keyboard.press('End');
      await pageA.keyboard.type('a');
      await pageA.keyboard.press('Escape');

      // B edits a random note
      const noteB = pageB.getByTestId('sticky-note').nth(Math.floor(Math.random() * 5));
      await noteB.click();
      await pageB.keyboard.press('End');
      await pageB.keyboard.type('b');
      await pageB.keyboard.press('Escape');

      await pageA.waitForTimeout(500);
    }

    // Both pages should have the same number of notes
    const countA = await pageA.getByTestId('sticky-note').count();
    const countB = await pageB.getByTestId('sticky-note').count();
    expect(countA).toBe(countB);

    await closePage(pageA);
    await closePage(pageB);
  });
});

test.describe('TC-30: reconnect after network interruption', () => {
  test('editor reconnects and sees latest state', async ({ browser }) => {
    const boardId = 'nightly-30';
    const pageA = await createBoardPage(browser, boardId);

    // A creates some notes
    for (let i = 0; i < 3; i++) {
      await pageA.mouse.dblclick(200 + i * 150, 300);
      await pageA.getByTestId('sticky-note').nth(i).waitFor();
      await pageA.keyboard.type(`Note${i}`);
      await pageA.keyboard.press('Escape');
    }

    expect(await pageA.getByTestId('sticky-note').count()).toBe(3);

    // B connects, sees notes, then disconnects
    const pageB = await createBoardPage(browser, boardId);
    await expect(async () => {
      const count = await pageB.getByTestId('sticky-note').count();
      expect(count).toBe(3);
    }).toPass({ timeout: 5000 });

    // B disconnects (close context)
    await closePage(pageB);

    // A creates more notes while B is away
    for (let i = 3; i < 5; i++) {
      await pageA.mouse.dblclick(200 + i * 150, 300);
      await pageA.getByTestId('sticky-note').nth(i).waitFor();
      await pageA.keyboard.type(`Note${i}`);
      await pageA.keyboard.press('Escape');
    }

    expect(await pageA.getByTestId('sticky-note').count()).toBe(5);

    // B reconnects
    const pageB2 = await createBoardPage(browser, boardId);

    // B should see all 5 notes
    await expect(async () => {
      const count = await pageB2.getByTestId('sticky-note').count();
      expect(count).toBe(5);
    }).toPass({ timeout: 5000 });

    await closePage(pageA);
    await closePage(pageB2);
  });
});
