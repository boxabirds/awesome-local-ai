import { expect, test, type Locator, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import {
  MAX_CONCURRENT_EDITORS,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { SELECTION_CLUSTER_X, SELECTION_CLUSTER_Y, selectionRetroBoard } from '../fixtures/boards';
import { ANNOTATION_300, HEADINGS } from '../fixtures/texts';
import { getCamera, nextFrames, openBoard, setCamera, type CameraState } from './helpers/board';
import { closeParticipants, openParticipants, waitConnected } from './helpers/participants';
import { seedBoard } from './helpers/seed';

/**
 * Story 9 e2e (text.tool_ui, text.object): real fonts, real wrapping and the real sync server.
 * TC-26 to TC-31.
 */

/** Stored width tolerance for real-font measurement (design: ±2 units). */
const WIDTH_TOLERANCE = 2;
const HALF = 2;
const DRAG_STEPS = 10;
const MULTI_CONTEXT_TIMEOUT_MS = 120_000;
/** Where new text is placed on an empty board (screen px). */
const SPOT = { x: 320, y: 240 } as const;
/** TC-27: how far (screen px) the right handle is dragged left. */
const NARROW_BY_PX = 300;
/** TC-29: per-keystroke delay so both people's typing interleaves. */
const TYPING_DELAY_MS = 40;
/** Cluster 1 of the retro fixture fills the left of the screen at 100%. */
const RETRO_CAMERA: CameraState = { x: SELECTION_CLUSTER_X[0] - 100, y: SELECTION_CLUSTER_Y - 250, zoom: 1 };

interface TextState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  size: string;
  widthMode: string;
  z: number;
}

async function texts(page: Page): Promise<TextState[]> {
  return page.evaluate(() =>
    window
      .__vidi6!.getObjects()
      .filter((o) => o.type === 'text')
      .map((o) => ({
        id: o.id,
        x: o.x,
        y: o.y,
        width: o.width ?? 0,
        height: o.height ?? 0,
        text: o.text ?? '',
        size: o.size ?? '',
        widthMode: o.widthMode ?? '',
        z: o.z,
      })),
  );
}

async function onlyText(page: Page): Promise<TextState> {
  const all = await texts(page);
  expect(all).toHaveLength(1);
  return all[0]!;
}

function textEditor(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Text', exact: true });
}

function textObject(page: Page, id?: string): Locator {
  return id === undefined
    ? page.getByTestId('text-object')
    : page.locator(`[data-testid="text-object"][data-id="${id}"]`);
}

async function selectionOf(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__vidi6!.getSelection().sort());
}

/** T, click at `at`, then (optionally) type. The new text is being edited afterwards. */
async function placeText(page: Page, at: { x: number; y: number }, content = ''): Promise<void> {
  await page.keyboard.press('t');
  await expect(page.getByRole('button', { name: 'Text (T)' })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(at.x, at.y);
  await expect(textEditor(page)).toBeFocused();
  await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
  if (content) await page.keyboard.type(content);
}

/** Height of the rendered text block (the real browser's wrapping), in world units. */
async function renderedTextHeight(page: Page, id: string): Promise<number> {
  const zoom = (await getCamera(page)).zoom;
  const box = await textObject(page, id).getByTestId('text-content').boundingBox();
  if (!box) throw new Error('text not rendered');
  return box.height / zoom;
}

function lineHeight(size: keyof typeof TEXT_SIZES): number {
  return TEXT_SIZES[size] * TEXT_LINE_HEIGHT;
}

async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: DRAG_STEPS });
  await page.mouse.up();
  await nextFrames(page);
}

async function centreOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not rendered');
  return { x: box.x + box.width / HALF, y: box.y + box.height / HALF };
}

test.describe('text.object: long annotation (TC-26, TC-27)', () => {
  test('TC-26 a 300-character sentence grows to TEXT_MAX_AUTO_WIDTH_WORLD and wraps onto several lines', async ({
    page,
  }) => {
    await openBoard(page);
    await expect(page.getByTestId('board-viewport')).toHaveAttribute('data-tool', 'select');
    await page.keyboard.press('t');
    // The pointer is a text cursor over the board while the Text tool is active.
    await expect(page.getByTestId('board-viewport')).toHaveCSS('cursor', 'text');
    await page.keyboard.press('Escape');
    await placeText(page, SPOT, ANNOTATION_300);
    await expect.poll(async () => (await onlyText(page)).text).toBe(ANNOTATION_300);
    const t = await onlyText(page);
    expect(Math.abs(t.width - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(WIDTH_TOLERANCE);
    expect(t.widthMode).toBe('auto');
    const lines = Math.round(t.height / lineHeight('M'));
    expect(lines).toBeGreaterThan(1);
    // The rendered text (real browser wrapping) matches the stored height: several lines.
    await page.keyboard.press('Escape');
    const rendered = await renderedTextHeight(page, t.id);
    expect(Math.abs(rendered - t.height)).toBeLessThanOrEqual(WIDTH_TOLERANCE);
    expect(rendered).toBeGreaterThan(lineHeight('M') * 1.5);
  });

  test('TC-26 short text: the box is just wider than the words', async ({ page }) => {
    await openBoard(page);
    await placeText(page, SPOT, HEADINGS[0]);
    await page.keyboard.press('Escape');
    const t = await onlyText(page);
    const words = await textObject(page, t.id).getByTestId('text-content').evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect().width;
    });
    const zoom = (await getCamera(page)).zoom;
    expect(t.width).toBeGreaterThanOrEqual(words / zoom - WIDTH_TOLERANCE);
    expect(t.width).toBeLessThan(words / zoom + TEXT_SIZES.M);
    expect(t.height).toBeCloseTo(lineHeight('M'), 6);
  });

  test('TC-27 dragging the right handle narrower rewraps the words; height grows; no top/bottom handles', async ({
    page,
  }) => {
    await openBoard(page);
    await placeText(page, SPOT, ANNOTATION_300);
    await page.keyboard.press('Escape');
    const before = await onlyText(page);
    await expect(page.locator('[data-handle]')).toHaveCount(2);
    for (const h of ['n', 's', 'ne', 'nw', 'se', 'sw']) await expect(page.locator(`[data-handle="${h}"]`)).toHaveCount(0);

    const handle = page.getByRole('button', { name: 'Resize right' });
    await dragBy(page, await centreOf(handle), -NARROW_BY_PX, 0);
    const zoom = (await getCamera(page)).zoom;
    const after = await onlyText(page);
    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBeCloseTo(before.width - NARROW_BY_PX / zoom, 0);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.height).toBeGreaterThan(before.height);
    const rendered = await renderedTextHeight(page, after.id);
    expect(Math.abs(rendered - after.height)).toBeLessThanOrEqual(WIDTH_TOLERANCE);
    await expect(page.locator('[data-handle]')).toHaveCount(2);

    // The width never goes below TEXT_MIN_WIDTH_WORLD.
    await dragBy(page, await centreOf(handle), -after.width * zoom * 2, 0);
    expect((await onlyText(page)).width).toBeCloseTo(TEXT_MIN_WIDTH_WORLD, 6);
  });
});

test.describe('text.object: title a retro section (TC-28)', () => {
  test('TC-28 XL heading above a cluster: size, drag, Delete, and Ctrl/Cmd+Z restores it', async ({ page, baseURL }) => {
    const boardId = newBoardId();
    await seedBoard(baseURL!, boardId, selectionRetroBoard());
    await page.goto(`/b/${boardId}`);
    await waitConnected(page);
    await setCamera(page, RETRO_CAMERA);
    await nextFrames(page);

    // Above cluster 1 (its top row starts at SELECTION_CLUSTER_Y).
    const at = { x: 150, y: 100 };
    await placeText(page, at, HEADINGS[0]);
    await page.keyboard.press('Escape');
    const created = await onlyText(page);
    expect(await selectionOf(page)).toEqual([created.id]);
    expect(created).toMatchObject({ x: at.x / RETRO_CAMERA.zoom + RETRO_CAMERA.x, y: at.y + RETRO_CAMERA.y, size: 'M' });

    await page.getByRole('toolbar', { name: 'Text' }).getByRole('button', { name: 'XL', exact: true }).click();
    await expect.poll(async () => (await onlyText(page)).size).toBe('XL');
    const xl = await onlyText(page);
    expect(xl).toMatchObject({ x: created.x, y: created.y });
    expect(xl.width).toBeGreaterThan(created.width * 2);
    expect(xl.height).toBeCloseTo(lineHeight('XL'), 6);
    await expect(textObject(page, xl.id)).toHaveCSS('font-size', `${TEXT_SIZES.XL}px`);

    // Drag it to centre it over the cluster.
    const DX = 240;
    const DY = 30;
    await dragBy(page, await centreOf(textObject(page, xl.id)), DX, DY);
    const moved = await onlyText(page);
    expect(moved).toMatchObject({ x: xl.x + DX, y: xl.y + DY, size: 'XL', text: HEADINGS[0] });

    await page.keyboard.press('Delete');
    await expect(textObject(page)).toHaveCount(0);
    expect(await texts(page)).toHaveLength(0);

    await page.keyboard.press('ControlOrMeta+z');
    await expect(textObject(page)).toHaveCount(1);
    expect(await onlyText(page)).toMatchObject({ id: moved.id, x: moved.x, y: moved.y, size: 'XL', text: HEADINGS[0] });
  });
});

test.describe('text.object: abandoned text (TC-31)', () => {
  test('TC-31 T, click, Escape without typing leaves no object; a marquee over the spot selects nothing', async ({
    page,
  }) => {
    await openBoard(page);
    await placeText(page, SPOT);
    await expect(textObject(page)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(textObject(page)).toHaveCount(0);
    expect(await texts(page)).toHaveLength(0);
    expect(await page.evaluate(() => window.__vidi6!.getObjects().length)).toBe(0);

    const MARGIN = 60;
    await page.keyboard.down('Shift');
    await page.mouse.move(SPOT.x - MARGIN, SPOT.y - MARGIN);
    await page.mouse.down();
    await page.mouse.move(SPOT.x + MARGIN * 2, SPOT.y + MARGIN, { steps: DRAG_STEPS });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    expect(await selectionOf(page)).toEqual([]);
  });
});

test.describe('text.object: live collaboration (TC-29, TC-30)', () => {
  test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);

  test('TC-29 two people typing in one text at the same time: identical text with every character', async ({
    browser,
  }) => {
    const people = await openParticipants(browser, ['Ava', 'Ben']);
    try {
      const ava = people[0]!;
      const ben = people[1]!;
      await placeText(ava.page, SPOT, HEADINGS[0]);
      await ava.page.keyboard.press('Escape');
      const { id } = await onlyText(ava.page);
      await expect(textObject(ben.page, id)).toHaveText(HEADINGS[0]);

      // Both open the same text and type at the same time.
      await textObject(ava.page, id).dblclick();
      await textObject(ben.page, id).dblclick();
      await expect(textEditor(ava.page)).toBeFocused();
      await expect(textEditor(ben.page)).toBeFocused();
      const avaTypes = ' this sprint';
      const benTypes = ' and on time';
      await Promise.all([
        ava.page.keyboard.type(avaTypes, { delay: TYPING_DELAY_MS }),
        ben.page.keyboard.type(benTypes, { delay: TYPING_DELAY_MS }),
      ]);
      await ava.page.keyboard.press('Escape');
      await ben.page.keyboard.press('Escape');

      const expectedChars = [...`${HEADINGS[0]}${avaTypes}${benTypes}`].sort().join('');
      await expect
        .poll(async () => {
          const [a, b] = await Promise.all([onlyText(ava.page), onlyText(ben.page)]);
          return a.text === b.text ? [...a.text].sort().join('') : 'different';
        })
        .toBe(expectedChars);
      const final = (await onlyText(ava.page)).text;
      expect(final.startsWith(HEADINGS[0])).toBe(true);
      await expect(textObject(ava.page, id).getByTestId('text-content')).toHaveText(final);
      await expect(textObject(ben.page, id).getByTestId('text-content')).toHaveText(final);
      for (const p of people) expect(p.errors).toEqual([]);
    } finally {
      await closeParticipants(people);
    }
  });

  test('TC-30 MAX_CONCURRENT_EDITORS people each add a heading at once: all headings on every screen', async ({
    browser,
  }) => {
    const names = ['Ava', 'Ben', 'Cho', 'Dev', 'Eli'].slice(0, MAX_CONCURRENT_EDITORS);
    const people = await openParticipants(browser, names);
    try {
      const SPACING_Y = 90;
      await Promise.all(
        people.map(async (p, i) => {
          await placeText(p.page, { x: SPOT.x, y: SPOT.y - 150 + i * SPACING_Y }, `Heading by ${p.name}`);
          await p.page.keyboard.press('Escape');
        }),
      );
      const expected = names.map((n) => `Heading by ${n}`).sort();
      for (const p of people) {
        await expect.poll(async () => (await texts(p.page)).map((t) => t.text).sort()).toEqual(expected);
        for (const heading of expected) {
          await expect(p.page.getByTestId('text-content').filter({ hasText: heading })).toHaveCount(1);
        }
        expect(p.errors).toEqual([]);
      }
    } finally {
      await closeParticipants(people);
    }
  });
});
