import { expect, test, type Page } from '@playwright/test';
import { dragBy, openBoard, type ViewportPoint } from './helpers/board';
import { openParticipants, waitForSynced } from './helpers/participants';
import { PROSE_1000 } from '../fixtures/texts';
import { MAX_CONCURRENT_EDITORS, TEXT_MAX_AUTO_WIDTH_WORLD } from '../../src/shared/config';

interface TextState {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text: string;
  size: string;
  widthMode: string;
}

async function getTexts(page: Page): Promise<TextState[]> {
  return page.evaluate(() => [...(window.__vidi6?.getTexts() ?? [])]);
}

function textLocator(page: Page, id: string) {
  return page.locator(`[data-testid="text-object"][data-id="${id}"]`);
}

async function createText(page: Page, at: ViewportPoint): Promise<string> {
  await page.keyboard.press('t');
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('[data-testid="text-editor"]')).toBeVisible();
  const texts = await getTexts(page);
  if (texts.length === 0) throw new Error('text was not created');
  return texts[texts.length - 1].id;
}

function near(actual: number, expected: number, tolerance = 2): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

test.describe('free text workflows', () => {
  test.beforeEach(async ({ page }) => {
    await openBoard(page);
    await expect(page.getByTestId('board-viewport')).toBeVisible();
  });

  test('TC-26 long annotation caps at the auto width and wraps into lines', async ({
    page
  }) => {
    await createText(page, { x: 400, y: 300 });
    const sentence = PROSE_1000.slice(0, 300);
    await page.keyboard.type(sentence, { delay: 0 });
    await page.keyboard.press('Escape');

    const texts = await getTexts(page);
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toBe(sentence);
    expect(near(texts[0].width ?? 0, TEXT_MAX_AUTO_WIDTH_WORLD)).toBe(true);
    // Several wrapped lines at M: each line is 20 × 1.3 = 26 world units.
    expect(texts[0].height ?? 0).toBeGreaterThanOrEqual(26 * 3);

    const box = await textLocator(page, texts[0].id).boundingBox();
    expect(box).not.toBeNull();
    expect(near(box!.width, TEXT_MAX_AUTO_WIDTH_WORLD)).toBe(true);
  });

  test('TC-27 dragging the right handle rewraps: fixed width, taller box, no vertical handles', async ({
    page
  }) => {
    await createText(page, { x: 400, y: 300 });
    await page.keyboard.type('alpha bravo charlie delta echo foxtrot golf hotel india', {
      delay: 0
    });
    await page.keyboard.press('Escape');
    const before = (await getTexts(page))[0];

    const tb = await textLocator(page, (await getTexts(page))[0].id).boundingBox();
    expect(tb).not.toBeNull();
    await page.mouse.click(tb!.x + 30, tb!.y + tb!.height / 2);
    await expect(page.getByLabel('Resize right')).toBeVisible();
    await expect(page.getByLabel('Resize top')).toHaveCount(0);
    await expect(page.getByLabel('Resize bottom')).toHaveCount(0);

    const handle = await page.getByLabel('Resize right').boundingBox();
    expect(handle).not.toBeNull();
    await dragBy(page, { x: handle!.x + handle!.width / 2, y: handle!.y + handle!.height / 2 }, -200, 0);

    const after = (await getTexts(page))[0];
    expect(after.widthMode).toBe('fixed');
    expect(near(after.width ?? 0, (before.width ?? 0) - 200, 5)).toBe(true);
    expect(after.height ?? 0).toBeGreaterThan(before.height ?? 0);
  });

  test('TC-28 title a retro section: XL heading, drag over cluster, delete, undo', async ({
    page
  }) => {
    // A sticky note as the "cluster".
    await page.mouse.dblclick(700, 500);
    await expect(page.locator('[data-testid="sticky-textarea"]')).toBeVisible();
    await page.keyboard.press('Escape');

    const id = await createText(page, { x: 700, y: 250 });
    await page.keyboard.type('Went well');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Size XL' }).click();
    expect((await getTexts(page))[0].size).toBe('XL');

    const box = await textLocator(page, id).boundingBox();
    expect(box).not.toBeNull();
    await dragBy(page, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }, 0, 250);

    await page.keyboard.press('Delete');
    expect(await getTexts(page)).toHaveLength(0);

    await page.keyboard.press('Control+z');
    const texts = await getTexts(page);
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toBe('Went well');
  });

  test('TC-31 abandoned text leaves nothing and cannot be selected', async ({ page }) => {
    await page.keyboard.press('t');
    await page.mouse.click(400, 300);
    await expect(page.locator('[data-testid="text-editor"]')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await getTexts(page)).toHaveLength(0);

    await page.keyboard.down('Shift');
    await page.mouse.move(330, 240);
    await page.mouse.down();
    await page.mouse.move(520, 420, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect(page.getByTestId('selection-overlay')).toHaveCount(0);
    expect(await getTexts(page)).toHaveLength(0);
  });
});

test.describe('free text collaboration', () => {
  test('TC-29 two people typing into one text converge with every character', async ({
    browser
  }) => {
    test.setTimeout(180_000);
    const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam']);
    try {
      await createText(alex.page, { x: 500, y: 300 });
      await alex.page.keyboard.type('seed', { delay: 0 });
      await alex.page.keyboard.press('Escape');
      await waitForSynced(sam);
      await expect.poll(async () => (await getTexts(sam.page)).at(0)?.text).toBe('seed');

      // Both open the editor on the same text (default camera → same viewport).
      for (const p of [alex, sam]) {
        await p.page.mouse.dblclick(500, 300);
        await expect(p.page.locator('[data-testid="text-editor"]')).toBeVisible();
      }
      await Promise.all([
        alex.page.keyboard.type('aaaaa', { delay: 20 }),
        sam.page.keyboard.type('bbbbb', { delay: 20 })
      ]);
      await alex.page.keyboard.press('Escape');
      await sam.page.keyboard.press('Escape');

      let final: TextState[] = [];
      for (const p of [alex, sam]) {
        await expect
          .poll(async () => {
            const texts = await getTexts(p.page);
            return texts.length === 1 && texts[0].text.length === 14;
          })
          .toBe(true);
        final = await getTexts(p.page);
      }
      const merged = final[0].text;
      expect(merged).toBe(await (await getTexts(sam.page))[0].text);
      expect((merged.match(/a/g) ?? []).length).toBe(5);
      expect((merged.match(/b/g) ?? []).length).toBe(5);
      expect(merged.startsWith('seed')).toBe(true);
    } finally {
      await Promise.all([alex.context.close(), sam.context.close()]);
    }
  });

  test('TC-30 every concurrent editor creates a heading and all see all headings', async ({
    browser
  }) => {
    test.setTimeout(240_000);
    const names = ['Alex', 'Bea', 'Cy', 'Dee', 'Eli'].slice(0, MAX_CONCURRENT_EDITORS);
    const participants = await openParticipants(browser, names);
    try {
      await Promise.all(
        participants.map(async (p, i) => {
          const at = { x: 450 + i * 40, y: 220 + i * 60 };
          await createText(p.page, at);
          await p.page.keyboard.type(`Head ${i}`, { delay: 0 });
          await p.page.keyboard.press('Escape');
        })
      );
      for (const p of participants) {
        await expect
          .poll(async () => {
            const texts = await getTexts(p.page);
            return texts.map((t) => t.text).sort().join('|');
          })
          .toBe(names.map((_, i) => `Head ${i}`).sort().join('|'));
      }
      for (const p of participants) {
        await expect(p.page.getByText('Head 0')).toBeVisible();
      }
    } finally {
      await Promise.all(participants.map((p) => p.context.close()));
    }
  });
});
