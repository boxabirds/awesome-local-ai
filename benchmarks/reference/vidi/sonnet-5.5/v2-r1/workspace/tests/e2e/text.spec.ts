import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS, TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_SIZES } from '../../src/shared/config';
import { closeAll, expectEventually, openParticipants } from './helpers/participants';

const ANNOTATION =
  'A good retrospective gives every person on the team a chance to say what slowed them down, what helped, and what they would like to try next sprint. ' +
  'Everyone is invited to add a short note under the heading so that we can group the ideas and vote on them together at the end of the session.';

const texts = (page: Page) => page.locator('[data-text-object]');
const undoKey = 'ControlOrMeta+z';

async function placeText(page: Page, x: number, y: number) {
  await page.keyboard.press('t');
  await expect(page.getByRole('button', { name: 'Text (T)' })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(x, y);
  await expect(page.getByRole('textbox')).toBeFocused();
}

async function box(page: Page, index = 0) {
  return texts(page).nth(index).evaluate((el) => {
    const e = el as HTMLElement;
    return { left: parseFloat(e.style.left), top: parseFloat(e.style.top), width: parseFloat(e.style.width), height: parseFloat(e.style.height) };
  });
}

async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  await page.mouse.up();
}

test.describe('text', () => {
  test('TC-26 a long annotation grows to the maximum width then wraps', async ({ browser }) => {
    const [a] = await openParticipants(browser, 1);
    try {
      const page = a.page;
      await placeText(page, 300, 200);
      await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.insertText(ANNOTATION.slice(0, 300));
      await page.keyboard.press('Escape');
      const b = await box(page);
      expect(Math.abs(b.width - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(2);
      expect(b.height).toBeGreaterThan(TEXT_SIZES.M * 1.3 * 1.5);
      const lineHeight = TEXT_SIZES.M * 1.3;
      expect(Math.round(b.height / lineHeight)).toBeGreaterThanOrEqual(2);
    } finally {
      await closeAll([a]);
    }
  });

  test('TC-27 dragging the right handle rewraps; there are no top or bottom handles', async ({ browser }) => {
    const [a] = await openParticipants(browser, 1);
    try {
      const page = a.page;
      await placeText(page, 300, 200);
      await page.keyboard.insertText('Went well and then some more words');
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-handle]')).toHaveCount(2);
      await expect(page.locator('[data-handle="n"]')).toHaveCount(0);
      await expect(page.locator('[data-handle="s"]')).toHaveCount(0);
      const before = await box(page);
      const handle = await page.locator('[data-handle="e"]').boundingBox();
      if (!handle) throw new Error('no handle');
      await dragBy(page, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, -(before.width - 100), 0);
      await expect.poll(async () => (await box(page)).width).toBeCloseTo(100, 0);
      const after = await box(page);
      expect(after.height).toBeGreaterThan(before.height);
      expect(after.left).toBeCloseTo(before.left, 0);
    } finally {
      await closeAll([a]);
    }
  });

  test('TC-28 title a retro section: size, move, delete, undo', async ({ browser }) => {
    const [a] = await openParticipants(browser, 1);
    try {
      const page = a.page;
      await placeText(page, 300, 200);
      await page.keyboard.type('Went well');
      await page.keyboard.press('Escape');
      await expect(texts(page).first()).toHaveAttribute('data-selected', 'true');
      const m = await box(page);
      await page.getByRole('button', { name: 'XL', exact: true }).click();
      await expect(page.getByRole('button', { name: 'XL', exact: true })).toHaveAttribute('aria-pressed', 'true');
      const xl = await box(page);
      expect(xl.left).toBe(m.left);
      expect(xl.top).toBe(m.top);
      expect(xl.height).toBeGreaterThan(m.height * 2);
      expect(xl.width).toBeGreaterThan(m.width * 2);

      const from = (await texts(page).first().boundingBox())!;
      await dragBy(page, { x: from.x + from.width / 2, y: from.y + from.height / 2 }, 120, 60);
      await expect.poll(async () => (await box(page)).left).toBeCloseTo(xl.left + 120, 0);

      await page.keyboard.press('Delete');
      await expect(texts(page)).toHaveCount(0);
      await page.keyboard.press(undoKey);
      await expect(texts(page)).toHaveCount(1);
      expect((await box(page)).left).toBeCloseTo(xl.left + 120, 0);
      expect(a.errors).toEqual([]);
    } finally {
      await closeAll([a]);
    }
  });

  test('TC-29 two people typing in one text keep every character', async ({ browser }) => {
    const [a, b] = await openParticipants(browser, 2);
    try {
      await placeText(a.page, 300, 200);
      await a.page.keyboard.type('Start ');
      await a.page.keyboard.press('Escape');
      await expectEventually('text visible', async () => (await texts(b.page).count()) === 1);
      await b.page.locator('[data-text-object]').first().dblclick();
      await a.page.locator('[data-text-object]').first().dblclick();
      await Promise.all([
        a.page.keyboard.type('AAAAAAAAAA', { delay: 20 }),
        b.page.keyboard.type('BBBBBBBBBB', { delay: 20 }),
      ]);
      const content = (p: Page) => texts(p).first().evaluate((el) => el.textContent ?? '');
      await expectEventually('same text', async () => (await content(a.page)) === (await content(b.page)) && (await content(a.page)).length === 26);
      const final = await content(a.page);
      expect(final.split('A').length - 1).toBe(10);
      expect(final.split('B').length - 1).toBe(10);
    } finally {
      await closeAll([a, b]);
    }
  });

  test('TC-30 everyone adds a heading at once', async ({ browser }) => {
    const people = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
    try {
      await Promise.all(
        people.map(async (p, i) => {
          await placeText(p.page, 150 + i * 200, 150 + i * 40);
          await p.page.keyboard.type(`Heading ${i + 1}`);
          await p.page.keyboard.press('Escape');
        }),
      );
      for (const p of people) {
        await expectEventually(`${p.name} sees all headings`, async () => (await texts(p.page).count()) === MAX_CONCURRENT_EDITORS);
      }
      const seen = await Promise.all(people.map((p) => texts(p.page).evaluateAll((els) => els.map((e) => e.textContent).sort())));
      for (const s of seen) expect(s).toEqual(seen[0]);
    } finally {
      await closeAll(people);
    }
  });

  test('TC-31 abandoned text leaves nothing behind', async ({ browser }) => {
    const [a, b] = await openParticipants(browser, 2);
    try {
      await placeText(a.page, 400, 300);
      await a.page.keyboard.press('Escape');
      await expect(texts(a.page)).toHaveCount(0);
      await expectEventually('nothing remote', async () => (await texts(b.page).count()) === 0);
      await a.page.keyboard.down('Shift');
      await a.page.mouse.move(350, 250);
      await a.page.mouse.down();
      await a.page.mouse.move(600, 400, { steps: 5 });
      await a.page.mouse.up();
      await a.page.keyboard.up('Shift');
      await expect(a.page.getByTestId('selection-overlay')).toHaveCount(0);
      // Undo does not bring an invisible object back.
      await a.page.keyboard.press(undoKey);
      await expect(texts(a.page)).toHaveCount(0);
    } finally {
      await closeAll([a, b]);
    }
  });
});
