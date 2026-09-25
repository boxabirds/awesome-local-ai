// Story 9 in real browsers against wrangler dev: the Text tool, real font layout (grow then wrap, fixed width),
// the golden path, and live editing by several people.
import { expect, test } from '@playwright/test';
import { openBoard, setCamera, settle } from './helpers/board';
import { dragBy } from './helpers/notes';
import { closeAll, expectWithin, openParticipants } from './helpers/participants';
import { handleCentre, marquee, seedBoard, selectedIds, toScreen } from './helpers/selection';
import { createBoardAt } from './helpers/boards-api';
import { centreOfText, placeText, textById, textEditor, texts } from './helpers/texts';
import { clusterBoard } from '../fixtures/boards';
import { ANNOTATION, HEADINGS } from '../fixtures/texts';
import {
  MAX_CONCURRENT_EDITORS,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';

const CAM = { x: 0, y: 0, zoom: 1 };

test.describe('Workflow "Long annotation"', () => {
  test('TC-26 a 300-character sentence makes a box as wide as the maximum with several lines; TC-27 a narrower fixed width rewraps it', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, CAM);
    await settle(page);
    const id = await placeText(page, { x: 200, y: 150 });
    await page.keyboard.insertText(ANNOTATION);
    await page.keyboard.press('Escape');
    await expect(textEditor(page)).toHaveCount(0);

    const [t] = await texts(page);
    expect(t.text).toBe(ANNOTATION);
    expect(Math.abs(t.width - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(2);
    const lineHeight = TEXT_SIZES.M * TEXT_LINE_HEIGHT;
    const lines = Math.round(t.height / lineHeight);
    expect(lines).toBeGreaterThan(2);
    // What the browser draws matches the stored box (within one line of rounding).
    const rendered = await textById(page, id).locator('.text-object__content').evaluate((el) => el.getBoundingClientRect().height);
    expect(Math.abs(rendered - t.height)).toBeLessThanOrEqual(lineHeight / 2);
    expect(await selectedIds(page)).toEqual([id]);

    // TC-27: only side handles; dragging the right one narrower fixes the width and the text grows downwards.
    await expect(page.getByRole('button', { name: 'Resize right' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resize left' })).toBeVisible();
    for (const h of ['top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      await expect(page.getByRole('button', { name: `Resize ${h}` })).toHaveCount(0);
    }
    await dragBy(page, await handleCentre(page, 'right'), -300, 0);
    await expect.poll(async () => (await texts(page))[0].widthMode).toBe('fixed');
    const narrow = (await texts(page))[0];
    expect(Math.abs(narrow.width - 300)).toBeLessThanOrEqual(2);
    expect(narrow.height).toBeGreaterThan(t.height);
    expect({ x: narrow.x, y: narrow.y }).toEqual({ x: t.x, y: t.y });
    const renderedNarrow = await textById(page, id)
      .locator('.text-object__content')
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(Math.abs(renderedNarrow - narrow.height)).toBeLessThanOrEqual(lineHeight / 2);
  });
});

test.describe('Workflow "Title a retro section"', () => {
  test('TC-28 T, click above a cluster, "Went well", XL, drag over the cluster, Delete, undo restores it', async ({
    page,
  }) => {
    const board = clusterBoard();
    const boardId = await createBoardAt();
    await seedBoard(boardId, board.doc);
    await page.goto(`/b/${boardId}`);
    await expect(page.locator('[data-note-id]')).toHaveCount(20);
    await page.waitForFunction(() => window.__vidi6?.setCamera !== undefined);
    const cam = { x: -100, y: -300, zoom: 0.5 };
    await setCamera(page, cam);
    await settle(page);

    await page.keyboard.press('t');
    await expect(page.getByRole('button', { name: 'Text (T)' })).toHaveAttribute('aria-pressed', 'true');
    const viewport = page.getByTestId('board-viewport');
    await expect(viewport).toHaveCSS('cursor', 'text');
    const at = toScreen(cam, { x: 300, y: -150 });
    await page.mouse.click(at.x, at.y);
    await expect(textEditor(page)).toBeFocused();
    await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.type('Went well');
    await page.keyboard.press('Escape');

    const [created] = await texts(page);
    expect(created).toMatchObject({ text: 'Went well', size: 'M', widthMode: 'auto' });
    expect(created.x).toBeCloseTo(300, 0);
    expect(created.y).toBeCloseTo(-150, 0);
    expect(await selectedIds(page)).toEqual([created.id]);

    await page.getByRole('button', { name: 'Size XL' }).click();
    await expect(page.getByRole('button', { name: 'Size XL' })).toHaveAttribute('aria-pressed', 'true');
    const big = (await texts(page))[0];
    expect(big).toMatchObject({ size: 'XL', x: created.x, y: created.y });
    expect(big.width).toBeGreaterThan(created.width * 2);
    expect(big.height).toBeCloseTo(TEXT_SIZES.XL * TEXT_LINE_HEIGHT, 1);

    await dragBy(page, await centreOfText(page, created.id), 100, 50);
    const moved = (await texts(page))[0];
    expect(moved.x).toBeCloseTo(created.x + 200, 0);
    expect(moved.y).toBeCloseTo(created.y + 100, 0);

    await page.keyboard.press('Delete');
    await expect(textById(page, created.id)).toHaveCount(0);
    expect(await texts(page)).toHaveLength(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(textById(page, created.id)).toBeVisible();
    const restored = (await texts(page))[0];
    expect(restored).toMatchObject({ text: 'Went well', size: 'XL', x: moved.x, y: moved.y });
    await expect(page.locator('[data-note-id]')).toHaveCount(20);
  });
});

test.describe('Workflow "Abandoned text"', () => {
  test('TC-31 T, click, Escape without typing leaves no object; a marquee over the spot selects nothing', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, CAM);
    await settle(page);
    await placeText(page, { x: 500, y: 300 });
    await page.keyboard.press('Escape');
    await expect(textEditor(page)).toHaveCount(0);
    await expect(page.locator('[data-text-id]')).toHaveCount(0);
    expect(await texts(page)).toHaveLength(0);
    await marquee(page, { x: 450, y: 250 }, { x: 650, y: 400 });
    expect(await selectedIds(page)).toEqual([]);
    // Undo has nothing of it to bring back.
    await page.keyboard.press('ControlOrMeta+z');
    await settle(page);
    expect(await texts(page)).toHaveLength(0);
  });
});

test.describe('Workflow "Two people edit one heading"', () => {
  test('TC-29 both type into the same text at once: identical text with every character', async ({ browser }) => {
    const { people } = await openParticipants(browser, ['Ava', 'Ben']);
    const [ava, ben] = people;
    try {
      for (const p of people) {
        await setCamera(p.page, CAM);
        await settle(p.page);
      }
      const id = await placeText(ava.page, { x: 300, y: 200 });
      await ava.page.keyboard.type('Heading');
      await expectWithin(async () => (await texts(ben.page))[0]?.text).toBe('Heading');
      // Ben opens the same text for editing (double-click); Ava is still editing it.
      await textById(ben.page, id).dblclick();
      await expect(textEditor(ben.page)).toBeFocused();
      await Promise.all([
        ava.page.keyboard.type(' ava1ava2', { delay: 25 }),
        ben.page.keyboard.type(' ben1ben2', { delay: 25 }),
      ]);
      for (const p of people) await p.page.keyboard.press('Escape');
      await expect
        .poll(async () => {
          const [a] = await texts(ava.page);
          const [b] = await texts(ben.page);
          return a && b && a.text === b.text ? a.text : null;
        })
        .not.toBeNull();
      const [final] = await texts(ava.page);
      expect(final.text.startsWith('Heading')).toBe(true);
      const count = (s: string, c: string) => [...s].filter((x) => x === c).length;
      const typed = 'Heading' + ' ava1ava2' + ' ben1ben2';
      expect(final.text).toHaveLength(typed.length);
      for (const c of new Set(typed)) expect(count(final.text, c), `count of "${c}"`).toBe(count(typed, c));
      await expect(textById(ben.page, id)).toHaveAccessibleName(final.text);
      for (const p of people) expect(p.errors).toEqual([]);
    } finally {
      await closeAll(people);
    }
  });
});

test.describe('Workflow "Everyone adds headings"', () => {
  test('TC-30 MAX_CONCURRENT_EDITORS people each place a heading at once: all headings on every screen', async ({
    browser,
  }) => {
    const names = HEADINGS.slice(0, MAX_CONCURRENT_EDITORS);
    const { people } = await openParticipants(browser, names);
    try {
      for (const p of people) {
        await setCamera(p.page, CAM);
        await settle(p.page);
      }
      await Promise.all(
        people.map(async (p, i) => {
          await placeText(p.page, { x: 150 + (i % 3) * 300, y: 150 + Math.floor(i / 3) * 200 });
          await p.page.keyboard.type(p.name);
          await p.page.keyboard.press('Escape');
        }),
      );
      for (const p of people) {
        await expect
          .poll(async () => (await texts(p.page)).map((t) => t.text).sort(), { timeout: 5000 })
          .toEqual([...names].sort());
        for (const name of names) await expect(p.page.getByRole('group', { name, exact: true })).toBeVisible();
        expect(p.errors).toEqual([]);
      }
    } finally {
      await closeAll(people);
    }
  });
});
