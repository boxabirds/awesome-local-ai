// Story 9 e2e (TC-26…TC-31): the Text tool golden paths in a real browser —
// auto-width wrapping, fixed-width handle drags, size/move/delete/undo,
// concurrent typing on one text object, capacity, and delete-on-empty.

import { test, expect, type Page } from '@playwright/test';
import { getTexts, gotoBoard } from './helpers/board';
import {
  MAX_CONCURRENT_EDITORS,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import {
  eventually,
  openParticipants,
  closeParticipants,
} from './helpers/participants';

const SENTENCE_300 = Array(60)
  .fill('The quick brown fox jumps over the lazy dog again and again')
  .join(' ')
  .slice(0, 300);

async function dragFromTo(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(to[0], to[1], { steps: 4 });
  await page.mouse.up();
}

async function createTextViaTool(page: Page, x: number, y: number, content: string): Promise<void> {
  await page.keyboard.press('t');
  await expect(page.getByTestId('text-tool-catcher')).toBeVisible();
  await page.mouse.click(x, y);
  await expect(page.getByTestId('text-editor')).toBeVisible();
  await page.keyboard.insertText(content);
  await expect.poll(() => getTexts(page).then((t) => t[0]?.text)).toBe(content);
}

async function centerOfTestId(page: Page, testId: string, index = 0): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(testId).nth(index).boundingBox();
  if (!box) throw new Error(`${testId} has no bounding box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('TC-26: a long typed sentence caps the auto box at 600 and wraps into multiple lines', async ({
  page,
}) => {
  await gotoBoard(page);
  await createTextViaTool(page, 400, 300, SENTENCE_300);
  await page.keyboard.press('Escape');

  const texts = await getTexts(page);
  expect(texts).toHaveLength(1);
  expect(texts[0].text).toBe(SENTENCE_300);
  expect(texts[0].widthMode).toBe('auto');
  expect(texts[0].width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 2);
  expect(texts[0].width).toBeGreaterThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD - 40);
  // Multiple wrapped lines: far taller than a single M line.
  expect(texts[0].height).toBeGreaterThanOrEqual(TEXT_SIZES.M * TEXT_LINE_HEIGHT * 3);

  // The rendered element shows the wrapped content.
  await expect(page.getByTestId('text-content')).toHaveText(SENTENCE_300);
  const box = await page.getByTestId('text-object').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 2);
  expect(box!.height).toBeGreaterThan(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
});

test('TC-27: dragging the right handle narrower wraps words, grows the height, and only e/w handles exist', async ({
  page,
}) => {
  await gotoBoard(page);
  const phrase = 'wrap these words around and around they must';
  await createTextViaTool(page, 300, 300, phrase);
  await page.keyboard.press('Escape');
  await page.mouse.click(360, 305); // select the text
  await expect(page.getByTestId('handle-e')).toBeVisible();
  expect(await page.getByTestId('handle-n').count()).toBe(0);
  expect(await page.getByTestId('handle-s').count()).toBe(0);

  const before = (await getTexts(page))[0];
  expect(before.widthMode).toBe('auto');
  const center = await centerOfTestId(page, 'handle-e');
  await dragFromTo(page, [center.x, center.y], [center.x - Math.round(before.width) + 120, center.y]);

  const after = (await getTexts(page))[0];
  expect(after.widthMode).toBe('fixed');
  expect(after.width).toBeLessThan(before.width);
  expect(after.height).toBeGreaterThan(before.height); // wrapped lines stacked
  expect(after.y).toBeCloseTo(before.y, 1); // top-left anchor preserved
});

test('TC-28: golden path — XL heading, move, delete, and undo restores it', async ({ page }) => {
  await gotoBoard(page);
  await createTextViaTool(page, 400, 300, 'Big heading');

  await page.keyboard.press('Escape');
  await page.getByTestId('text-size-XL').click();
  await expect.poll(() => getTexts(page).then((t) => t[0]?.size)).toBe('XL');

  const before = (await getTexts(page))[0];
  const center = await centerOfTestId(page, 'text-object');
  await dragFromTo(page, [center.x, center.y], [center.x + 120, center.y + 80]);
  const moved = (await getTexts(page))[0];
  expect(moved.x).toBeGreaterThan(before.x + 100);
  expect(moved.y).toBeGreaterThan(before.y + 40);

  await page.keyboard.press('Delete');
  await expect.poll(() => getTexts(page)).toHaveLength(0);

  await page.keyboard.press('Control+z');
  const restored = await getTexts(page);
  expect(restored).toHaveLength(1);
  expect(restored[0].text).toBe('Big heading');
  expect(restored[0].size).toBe('XL');
});

test('TC-29: both users typing into one text object converge to identical text with every character', async ({
  browser,
}) => {
  const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam']);
  try {
    await createTextViaTool(alex.page, 400, 300, 'shared');
    await alex.page.keyboard.press('Escape');
    // Sam starts editing the same object; then both keep typing at once.
    const center = await centerOfTestId(sam.page, 'text-object');
    await sam.page.mouse.dblclick(center.x, center.y);
    await expect(sam.page.getByTestId('text-editor')).toBeVisible();

    await sam.page.keyboard.insertText('BBBB');
    await alex.page.bringToFront();
    // Alex's editor re-opens; type while Sam is still editing.
    await alex.page.mouse.dblclick(center.x, center.y);
    await expect(alex.page.getByTestId('text-editor')).toBeVisible();
    await alex.page.keyboard.insertText('AAAA');

    function hasAllChars(t: Awaited<ReturnType<typeof getTexts>>): boolean {
      const text = t.length === 1 ? t[0].text : '';
      return (
        text.length === 'shared'.length + 8 &&
        (text.match(/A/g)?.length ?? 0) === 4 &&
        (text.match(/B/g)?.length ?? 0) === 4 &&
        text.startsWith('shared')
      );
    }
    await eventually(
      'Alex sees every character',
      () => getTexts(alex.page).then((v) => hasAllChars(v)),
      true,
    );
    await eventually(
      'Sam sees every character',
      () => getTexts(sam.page).then((v) => hasAllChars(v)),
      true,
    );
    const [alexText, samText] = [
      (await getTexts(alex.page))[0]?.text,
      (await getTexts(sam.page))[0]?.text,
    ];
    expect(alexText).toBe(samText);
  } finally {
    await closeParticipants([alex, sam]);
  }
});

test('TC-30: every one of five concurrent editors creates a heading and all see all headings', async ({
  browser,
}) => {
  const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `Editor${i + 1}`);
  const parties = await openParticipants(browser, names);
  try {
    for (const [i, p] of parties.entries()) {
      await p.page.keyboard.press('t');
      await p.page.mouse.click(260 + i * 60, 220 + i * 30);
      await expect(p.page.getByTestId('text-editor')).toBeVisible();
      await p.page.keyboard.insertText(`Heading ${i + 1}`);
      await p.page.keyboard.press('Escape');
    }
    for (const p of parties) {
      await eventually(
        `${p.name} sees all headings`,
        () =>
          getTexts(p.page).then(
            (t) => names.every((_, i) => t.some((o) => o.text === `Heading ${i + 1}`)) && t.length === MAX_CONCURRENT_EDITORS,
          ),
        true,
      );
    }
  } finally {
    await closeParticipants(parties);
  }
});

test('TC-31: clicking with the Text tool then Escape without typing leaves no object', async ({
  page,
}) => {
  await gotoBoard(page);
  await page.keyboard.press('t');
  await page.mouse.click(400, 300);
  await expect(page.getByTestId('text-editor')).toBeVisible();
  await page.keyboard.press('Escape');

  await expect.poll(() => getTexts(page)).toHaveLength(0);
  await expect(page.getByTestId('text-object')).toHaveCount(0);

  // A marquee dragged over the click area selects nothing.
  await page.keyboard.down('Shift');
  await dragFromTo(page, [340, 240], [480, 380]);
  await page.keyboard.up('Shift');
  await expect(page.getByTestId('selection-box')).toHaveCount(0);
});
