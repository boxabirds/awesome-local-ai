// E2E tests for free text objects (story 9): TC-26 to TC-31.
// Two-participant tests run against `wrangler dev` (BoardRoom Durable Object).

import { expect, test, type Page } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
  TEXT_MAX_AUTO_WIDTH_WORLD,
} from '../../src/shared/config';
import { LONG_PROSE } from '../fixtures/texts';
import {
  closeParticipant,
  joinBoard,
  openParticipant,
  type Participant,
} from './helpers/participants';
import { gotoFreshBoard } from './helpers/goto-board';
import { marqueeSelect, selectionCountText } from './helpers/board';

const TOLERANCE_PX = 2;
const textLocator = (page: Page) => page.locator('[data-testid="text-object"]');
const textEditor = (page: Page) => page.locator('textarea[aria-label="Text"]');

/** Activate the Text tool and create a text object at screen (x, y). */
async function createTextAt(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.press('t');
  await page.mouse.click(x, y);
  await textEditor(page).waitFor({ timeout: 5000 });
}

/** Type into the focused text editor, then end editing (selection kept). */
async function typeAndEnd(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

/** Select the n-th text object by clicking its centre. */
async function selectText(page: Page, index = 0): Promise<void> {
  const box = (await textLocator(page).nth(index).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('story 9: write free text anywhere on the board', () => {
  test.beforeEach(async ({ page }) => {
    await gotoFreshBoard(page);
  });

  // TC-26: T, click, type a 300-char sentence → box width 600 ±2, multiple lines.
  test('TC-26 long text wraps to the 600-wide auto cap across multiple lines', async ({ page }) => {
    const sentence = LONG_PROSE.slice(0, 300);
    await createTextAt(page, 300, 200);
    await page.keyboard.type(sentence);
    await page.keyboard.press('Escape');

    const obj = textLocator(page).first();
    await expect(obj).toBeVisible();
    const box = (await obj.boundingBox())!;
    expect(Math.abs(box.width - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(TOLERANCE_PX);

    // Multiple lines: the rendered height must exceed a single line (~20px * 1.3).
    expect(box.height).toBeGreaterThan(40);
    // The full text is present.
    expect((await obj.locator('[data-testid="text-content"]').textContent()) ?? '').toContain(
      sentence.slice(0, 40),
    );
  });

  // TC-27: drag the right handle narrower → words wrap, height grows, no top/bottom handles.
  test('TC-27 narrowing the east handle wraps text and grows the height', async ({ page }) => {
    await createTextAt(page, 300, 200);
    // ~44 chars: one line at M (~440px), so narrowing forces a wrap.
    await page.keyboard.type('The quick brown fox jumps over the lazy dog');
    await page.keyboard.press('Escape');

    const obj = textLocator(page).first();
    const before = (await obj.boundingBox())!;

    // Select it (it is already selected after Escape, but click to be sure).
    await selectText(page);
    // Only e/w handles exist for a lone text.
    await expect(page.locator('[data-testid="resize-handle-e"]')).toBeVisible();
    expect(await page.locator('[data-testid="resize-handle-n"]').count()).toBe(0);
    expect(await page.locator('[data-testid="resize-handle-s"]').count()).toBe(0);

    // Drag the east handle to the left (narrower) by 120px.
    const handle = (await page.locator('[data-testid="resize-handle-e"]').boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x - 120, handle.y + handle.height / 2, { steps: 10 });
    await page.mouse.up();

    const after = (await obj.boundingBox())!;
    // Narrower and taller (the words wrapped).
    expect(after.width).toBeLessThan(before.width - 40);
    expect(after.height).toBeGreaterThan(before.height);
  });

  // TC-28: golden path — XL heading, drag, Delete, Ctrl+Z restores.
  test('TC-28 golden path: XL heading, move, delete, undo restores', async ({ page }) => {
    await createTextAt(page, 300, 200);
    await page.keyboard.type('Retro heading');
    await page.keyboard.press('Escape');

    // Select and enlarge to XL.
    await selectText(page);
    await expect(page.locator('[data-testid="text-toolbar"]')).toBeVisible();
    await page.locator('[data-testid="text-size-XL"]').click();
    const afterXl = (await textLocator(page).first().boundingBox())!;
    expect(afterXl.height).toBeGreaterThan(26); // taller than an M line

    // Move it.
    const beforeMove = (await textLocator(page).first().boundingBox())!;
    await page.mouse.move(beforeMove.x + 20, beforeMove.y + 10);
    await page.mouse.down();
    await page.mouse.move(beforeMove.x + 90, beforeMove.y + 60, { steps: 8 });
    await page.mouse.up();
    const afterMove = (await textLocator(page).first().boundingBox())!;
    expect(Math.abs(afterMove.x - (beforeMove.x + 70))).toBeLessThanOrEqual(TOLERANCE_PX + 2);

    // Delete it.
    await page.keyboard.press('Delete');
    await expect(textLocator(page)).toHaveCount(0);

    // Ctrl+Z restores it.
    await page.keyboard.press('Control+z');
    await expect(textLocator(page)).toHaveCount(1);
    expect(
      (await textLocator(page).first().locator('[data-testid="text-content"]').textContent()) ?? '',
    ).toContain('Retro heading');
  });

  // TC-29: two users type into one text simultaneously → identical text, all characters.
  test('TC-29 simultaneous typing into one text merges to identical text', async ({ browser }) => {
    test.setTimeout(90_000);
    const alex = await openParticipant(browser);
    const sam = await openParticipant(browser);
    try {
      // Alex creates a text with a seed word; Sam joins.
      await createTextAt(alex.page, 400, 300);
      await alex.page.keyboard.type('plan');
      await alex.page.keyboard.press('Escape');
      await joinBoard(sam.page, alex.boardId);
      await expect
        .poll(() => textLocator(sam.page).count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(1);

      // Both start editing the same text, then type at the same time.
      const startEdit = async (page: Page) => {
        const box = (await textLocator(page).first().boundingBox())!;
        await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
        await textEditor(page).waitFor();
      };
      await Promise.all([startEdit(alex.page), startEdit(sam.page)]);
      await Promise.all([alex.page.waitForTimeout(200), sam.page.waitForTimeout(200)]);

      await Promise.all([
        alex.page.keyboard.type(' alpha', { delay: 30 }),
        sam.page.keyboard.type(' beta', { delay: 30 }),
      ]);
      await Promise.all([
        alex.page.keyboard.press('Escape'),
        sam.page.keyboard.press('Escape'),
      ]);

      const expectedChars = [...('plan' + ' alpha' + ' beta')].sort().join('');
      const display = async (page: Page) =>
        (await page.locator('[data-testid="text-content"]').first().textContent()) ?? '';
      let finalText = '';
      await expect
        .poll(async () => {
          const a = await display(alex.page);
          const b = await display(sam.page);
          if (a === b) {
            finalText = a;
            return true;
          }
          return false;
        }, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(true);
      expect([...finalText].sort().join('')).toBe(expectedChars);
    } finally {
      await closeParticipant(alex);
      await closeParticipant(sam);
    }
  });

  // TC-30: each context creates a heading at once → all headings visible on all screens.
  test('TC-30 every participant creates a heading; all are visible on all screens', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const participants: Participant[] = [];
    try {
      const host = await openParticipant(browser);
      participants.push(host);
      for (let i = 1; i < MAX_CONCURRENT_EDITORS; i++) {
        const p = await openParticipant(browser);
        await joinBoard(p.page, host.boardId);
        participants.push(p);
      }

      // Each participant creates a heading at its own row.
      for (let i = 0; i < participants.length; i++) {
        const page = participants[i].page;
        await createTextAt(page, 200, 120 + i * 120);
        await page.keyboard.type(`Heading ${i}`);
        await page.keyboard.press('Escape');
      }

      // All headings visible on every screen.
      for (const p of participants) {
        await expect
          .poll(() => textLocator(p.page).count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
          .toBe(MAX_CONCURRENT_EDITORS);
      }
    } finally {
      for (const p of participants) await closeParticipant(p);
    }
  });

  // TC-31: T, click, Escape without typing → no object in the doc.
  test('TC-31 abandoning an empty text leaves no object behind', async ({ page }) => {
    await createTextAt(page, 400, 300);
    // Escape immediately, without typing.
    await page.keyboard.press('Escape');

    // No text object remains.
    await expect(textLocator(page)).toHaveCount(0);

    // A marquee over the area selects nothing.
    await marqueeSelect(page, 300, 200, 500, 400);
    const count = await selectionCountText(page);
    expect(count === null || count === '0 selected').toBe(true);
  });
});
