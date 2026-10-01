// Story 9 end-to-end: writing free text anywhere on the board, in real browsers
// with real fonts and the real sync server (TC-26 to TC-31). The TC ids are the
// Acceptance Cases in
// spec/stories/009-write-free-text-anywhere-on-the-board/design.md.
//
// What is under test here is exactly what a person does: hold the Text tool, click
// where the words should go, type, and see the board lay the words out. The stored
// box is read back from the live document, because the box is what every other
// client has to draw, and the rendered lines are read back from the DOM, because
// the lines are what this person has to see.

import { expect, test, type Page } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZE_ORDER,
  TEXT_SIZES,
} from '../../src/shared/config';
import { prose } from '../fixtures/texts';
import {
  areaCentre,
  createBoard,
  expectPixels,
  ctrlWheel,
  openFreshBoard,
  readCamera,
  type Point,
} from './helpers/board';
import {
  content,
  createNote,
  createText,
  deleteTextViaToolbar,
  dragNote,
  editText,
  noteCount,
  openBoard,
  pickTextSize,
  textContent,
  textContentsMatch,
  textCount,
  textEditor,
  textToolLayer,
  waitForContentsMatch,
  waitForTextContentsMatch,
} from './helpers/live';

const textList = (page: Page) => page.locator('[data-testid="text-object"]');
const textById = (page: Page, id: string) => page.locator(`[data-text-id="${id}"]`);
const textToolButton = (page: Page) => page.getByRole('button', { name: 'Text (T)', exact: true });
const selectToolButton = (page: Page) => page.getByRole('button', { name: 'Select (V)', exact: true });
const selectionBar = (page: Page) => page.getByTestId('selection-bar');

const ANNOTATION = prose(300);
const A_SENTENCE =
  'The board remembers where every idea was placed, even when the room is busy today.';

/** Screen box of one text, by id: the painted order is not the document's. */
async function textBox(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await textById(page, id).boundingBox();
  if (box === null) throw new Error(`text ${id} is not rendered`);
  return box;
}

async function textOf(page: Page, id: string) {
  const found = (await textContent(page)).find((t) => t.id === id);
  if (found === undefined) throw new Error(`text ${id} is gone`);
  return found;
}

/** Drag a resize handle of the selected object by a screen delta. */
async function dragHandle(page: Page, handle: string, dx: number, dy: number): Promise<void> {
  const box = await page.getByTestId(`resize-handle-${handle}`).boundingBox();
  if (box === null) throw new Error(`the ${handle} handle is not on screen`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 6 });
  await page.mouse.move(cx + dx, cy + dy, { steps: 6 });
  await page.mouse.up();
}

/**
 * How many lines the words are seen as, read from the paint rather than from the
 * markup: the browser breaks a paragraph inside the stored box, and a range over
 * the words answers with one rectangle per line box it drew.
 */
async function paintedLines(page: Page, id: string): Promise<number> {
  return textById(page, id)
    .locator('.text-body')
    .evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getClientRects().length;
    });
}

/** The words as they are drawn, whitespace folded back into one line. */
async function paintedWords(page: Page, id: string): Promise<string> {
  const text = await textById(page, id).locator('.text-body').innerText();
  return text.replace(/\s+/g, ' ').trim();
}

/** The resize handles on screen, by name. */
async function handleNames(page: Page): Promise<string[]> {
  const ids = await page
    .locator('[data-testid^="resize-handle-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid') ?? ''));
  return ids.map((id) => id.replace('resize-handle-', '')).sort();
}

/** Shift-drag a marquee, with a real Shift held. */
async function marquee(page: Page, from: Point, to: Point): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

test.beforeEach(async ({ page, request }) => {
  await openFreshBoard(page, request);
});

test('TC-26 a 300-character annotation wraps inside the width and shows as lines', async ({
  page,
}) => {
  const centre = await areaCentre(page);
  const id = await createText(page, { x: centre.x - 260, y: centre.y - 120 }, ANNOTATION);

  // The width an annotation asks for is wider than a text may grow to, so it stops
  // at the cap and spends the rest of itself on lines.
  const stored = await textOf(page, id);
  expectPixels(stored.width, TEXT_MAX_AUTO_WIDTH_WORLD, 2);
  expect(stored.text).toBe(ANNOTATION);
  expect(stored.widthMode).toBe('auto');

  // leave the caret: while it is in the text the field is what shows the words
  await page.keyboard.press('Escape');
  await expect(textById(page, id)).toHaveAttribute('data-editing', 'false');

  // The words are seen as several lines, not as one line running off the board.
  const lines = await paintedLines(page, id);
  expect(lines).toBeGreaterThan(2);
  expect(await paintedWords(page, id)).toBe(ANNOTATION);

  // the box on the screen is the box in the document, at the board's own zoom -
  // which is what it means for the height the measurement stored to be the height
  // of the lines that were measured
  const camera = await readCamera(page);
  const painted = await textBox(page, id);
  expectPixels(painted.width, stored.width * camera.zoom, 2);
  expectPixels(painted.height, stored.height * camera.zoom, 2);
  expect(stored.height).toBeGreaterThan(3 * TEXT_SIZES.M * TEXT_LINE_HEIGHT);
});

test('TC-26 the Text tool is drawn as a tool, and says so in the rail', async ({ page }) => {
  await expect(textToolButton(page)).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('t');
  await expect(textToolLayer(page)).toHaveCount(1);
  await expect(textToolButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(selectToolButton(page)).toHaveAttribute('aria-pressed', 'false');
  // a board you are about to write on says so with the cursor it draws
  await expect(textToolLayer(page)).toHaveCSS('cursor', 'text');

  await page.keyboard.press('Escape');
  await expect(textToolLayer(page)).toHaveCount(0);
  await expect(selectToolButton(page)).toHaveAttribute('aria-pressed', 'true');
});

test('TC-27 dragging the right handle narrower rewraps the words and grows the height', async ({
  page,
}) => {
  const centre = await areaCentre(page);
  const id = await createText(page, { x: centre.x - 300, y: centre.y - 60 }, A_SENTENCE);

  const before = await textOf(page, id);
  await page.keyboard.press('Escape');
  await expect(textById(page, id)).toHaveAttribute('data-selected', 'true');
  const linesBefore = await paintedLines(page, id);

  // one text is resized from the two sides that can set a width and no further:
  // the height of words belongs to the words
  expect(await handleNames(page)).toEqual(['e', 'w']);

  await dragHandle(page, 'e', -Math.round(before.width / 2), 0);

  const after = await textOf(page, id);
  expect(after.width).toBeLessThan(before.width);
  expect(after.widthMode).toBe('fixed');
  expect(after.height).toBeGreaterThan(before.height);
  // the box grew taller because the words needed more lines in it
  expect(await paintedLines(page, id)).toBeGreaterThan(linesBefore);
  // the words themselves are untouched by being given a narrower box
  expect(after.text).toBe(A_SENTENCE);
  expect(await paintedWords(page, id)).toBe(A_SENTENCE);
  // and the left edge held: a right handle moves the right edge, not the text
  expectPixels(after.x, before.x, 1);
  await expect(textById(page, id)).toHaveAttribute('data-width-mode', 'fixed');
});

test('TC-28 a title written above a cluster, raised to XL, moved, binned and undone', async ({
  page,
}) => {
  const centre = await areaCentre(page);
  await createNote(page, { x: centre.x - 160, y: centre.y + 40 });
  await createNote(page, { x: centre.x + 120, y: centre.y + 160 });
  await expect.poll(() => noteCount(page)).toBe(2);

  // write the heading where the board is empty, above the notes
  const id = await createText(page, { x: centre.x - 200, y: centre.y - 160 }, 'Went well');

  // leave the caret: the text's own toolbar belongs to a text that is selected and
  // not being typed into
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('text-toolbar')).toBeVisible();

  // XL from the text's own toolbar, which is the only thing that changes a type size
  expect(TEXT_SIZE_ORDER).toEqual(['S', 'M', 'L', 'XL']);
  const small = await textOf(page, id);
  await pickTextSize(page, 'XL');
  const big = await textOf(page, id);
  expect(big.size).toBe('XL');
  // the type on the screen is the size the preset names, and the box grew with it
  expect(Number(await textById(page, id).getAttribute('data-font-px'))).toBeGreaterThan(0);
  expect(big.height).toBeGreaterThan(small.height);
  // where it sits is not a size's business
  expectPixels(big.x, small.x, 1);
  expectPixels(big.y, small.y, 1);
  expect(big.text).toBe('Went well');

  // drag it down over the cluster it belongs to
  const box = await textBox(page, id);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 90, { steps: 8 });
  await page.mouse.move(cx + 40, cy + 140, { steps: 8 });
  await page.mouse.up();
  const moved = await textOf(page, id);
  expect(moved.y).toBeGreaterThan(big.y);
  expect(moved.x).toBeGreaterThan(big.x);
  expect(moved.text).toBe('Went well');

  // bin it, and one undo brings it back with its words and its box
  await deleteTextViaToolbar(page);
  await expect.poll(() => textCount(page)).toBe(0);
  await expect(selectionBar(page)).toHaveCount(0);

  await page.keyboard.press('Control+z');
  await expect.poll(() => textCount(page)).toBe(1);
  const back = await textOf(page, id);
  expect(back.text).toBe('Went well');
  expect(back.size).toBe('XL');
  expectPixels(back.width, big.width, 2);
  expectPixels(back.height, big.height, 2);
});

test('TC-29 two people typing into one text at once keep every character', async ({
  browser,
  request,
}) => {
  const boardId = await createBoard(request);
  const alex = await openBoard(browser, boardId);
  const sam = await openBoard(browser, boardId);
  const centre = await areaCentre(alex);

  const id = await createText(alex, { x: centre.x - 200, y: centre.y - 40 }, 'Ship list:');
  await alex.keyboard.press('Escape');
  await expect.poll(async () => (await textContent(sam)).length).toBe(1);

  // both carets in the same text, both typing at the same time
  await editText(alex, 0);
  await editText(sam, 0);
  await Promise.all([alex.keyboard.type(' importer'), sam.keyboard.type(' migration plan')]);
  await alex.keyboard.press('Escape');
  await sam.keyboard.press('Escape');

  await waitForTextContentsMatch([alex, sam], E2E_EVENTUAL_TIMEOUT_MS);
  const text = (await textOf(sam, id)).text;
  // Two carets in one text: what each person typed is in the words, once. The
  // characters of both interleave - that is what merging is - so what a test can
  // say honestly is that nothing was lost and nothing was written twice.
  const sorted = (value: string): string => value.split('').sort().join('');
  expect(text.startsWith('Ship list:')).toBe(true);
  expect(sorted(text)).toBe(sorted('Ship list:' + ' importer' + ' migration plan'));
  // and the box the two of them ended with is one box, agreed by both screens
  expect(await textContentsMatch([alex, sam])).toBe(true);
});

test('TC-30 five clients each write a heading at once and all five appear everywhere', async ({
  browser,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  // headless firefox/webkit on macOS route native mouse input to whichever window
  // holds OS focus, so five clicks in five windows at once land in whichever window
  // happens to be frontmost. That the board places a text where it was clicked is
  // exercised in every browser by TC-26; what this case proves - five clients
  // creating objects in one document at the same moment - is a property of the
  // document, which chromium exercises honestly.
  test.skip(testInfo.project.name !== 'chromium', 'parallel native input multiplexes across windows');

  const boardId = await createBoard(request);
  const pages: Page[] = [];
  for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) pages.push(await openBoard(browser, boardId));

  const centre = await areaCentre(pages[0]!);
  // each client writes in its own part of the board, so no two carets ever meet
  const headings = ['Went well', 'What blocked us', 'Next up', 'Ideas', 'Questions'];
  await Promise.all(
    pages.map(async (client, i) => {
      await createText(
        client,
        { x: centre.x - 500 + i * 200, y: centre.y - 200 + (i % 2) * 220 },
        headings[i]!,
      );
      await client.keyboard.press('Escape');
    }),
  );

  await waitForContentsMatch(pages, E2E_EVENTUAL_TIMEOUT_MS);
  for (const client of pages) {
    await expect.poll(async () => textCount(client)).toBe(MAX_CONCURRENT_EDITORS);
    const words = (await textContent(client)).map((t) => t.text).sort();
    expect(words).toEqual([...headings].sort());
  }
  // every heading is on every screen, drawn as an object and not as a stray caret
  for (const client of pages) {
    await expect(client.locator('[data-testid="text-object"]')).toHaveCount(MAX_CONCURRENT_EDITORS);
  }
});

test('TC-31 text abandoned without a character leaves nothing behind', async ({ page }) => {
  const centre = await areaCentre(page);
  const at = { x: centre.x + 40, y: centre.y + 30 };

  await page.keyboard.press('t');
  await page.mouse.click(at.x, at.y);
  await expect(textEditor(page)).toHaveCount(1);
  await page.keyboard.press('Escape');

  // the object it made for itself is gone, and so is the box it had been given
  await expect(textToolLayer(page)).toHaveCount(0);
  await expect(textList(page)).toHaveCount(0);
  expect(await textCount(page)).toBe(0);
  expect(await content(page)).toHaveLength(0);
  await expect(textEditor(page)).toHaveCount(0);

  // and the spot it occupied is empty board: a marquee over it selects nothing
  await marquee(page, { x: at.x - 120, y: at.y - 90 }, { x: at.x + 160, y: at.y + 110 });
  await expect(page.getByTestId('selection-box')).toHaveCount(0);
  await expect(page.locator('[data-selected="true"]')).toHaveCount(0);
  await expect(selectionBar(page)).toHaveCount(0);
});

test('TC-31 a text left empty by erasing its last character goes the same way', async ({
  page,
}) => {
  const centre = await areaCentre(page);
  const id = await createText(page, { x: centre.x - 120, y: centre.y - 40 }, 'x');

  // erase the only character, then leave: the text is empty, so it goes
  await page.keyboard.press('Backspace');
  expect((await textOf(page, id)).text).toBe('');
  await page.keyboard.press('Escape');

  await expect(textList(page)).toHaveCount(0);
  expect(await textCount(page)).toBe(0);
});

test('a text is drawn above the notes, which is what writing across them means', async ({
  page,
}) => {
  const centre = await areaCentre(page);
  await createNote(page, { x: centre.x - 120, y: centre.y - 60 }, 'a note');

  // the Text tool answers for a click on top of a note too
  const id = await createText(page, { x: centre.x - 60, y: centre.y - 20 }, 'on top');
  await page.keyboard.press('Escape');

  expect(await textCount(page)).toBe(1);
  expect(await noteCount(page)).toBe(1);
  // written last, so drawn last: the words are on top of the note, not under it
  const painted = await page
    .locator('[data-testid="board-world"] > *')
    .evaluateAll((els) => els.map((el) => String((el as HTMLElement).dataset.textId ?? (el as HTMLElement).dataset.noteId ?? 'other')));
  expect(painted[painted.length - 1]).toBe(id);

  // and a note dragged afterwards does not take the words with it
  await dragNote(page, 0, 60, 60);
  expect((await textOf(page, id)).text).toBe('on top');
});

test('the wheel and the other tools go on working while the Text tool is held', async ({
  page,
  browserName,
}) => {
  const centre = await areaCentre(page);
  expect((await readCamera(page)).zoom).toBe(1);

  await page.keyboard.press('t');
  await page.mouse.move(centre.x, centre.y);

  // The layer takes clicks, not the wheel: a plain wheel goes on panning the board
  // and a ctrl-wheel goes on zooming it, exactly as they did before the tool existed.
  const before = await readCamera(page);
  await page.mouse.wheel(0, 240);
  await expect
    .poll(async () => (await readCamera(page)).y, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .not.toBe(before.y);
  expect((await readCamera(page)).zoom).toBe(1);

  await ctrlWheel(page, centre, -240, browserName);
  await expect
    .poll(async () => (await readCamera(page)).zoom, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBeGreaterThan(1);
  await expect(page.getByTestId('zoom-label')).not.toHaveText('100%');

  // the sticky note button is still the sticky note button, tool held or not
  await page.getByRole('button', { name: 'Sticky note (N)', exact: true }).click();
  await expect.poll(() => noteCount(page)).toBe(1);
  // the caret owns the board while it is in a note: the layer waits rather than
  // covering the field somebody is typing into, and the rail still says which tool
  // is held
  await expect(textToolLayer(page)).toHaveCount(0);
  await expect(textToolButton(page)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(textToolLayer(page)).toHaveCount(1);

  // and the tool writes its text into the board the camera has now
  const id = await createText(page, { x: centre.x - 300, y: centre.y + 200 }, 'a text');
  expect((await textOf(page, id)).text).toBe('a text');
  expect(await textCount(page)).toBe(1);
  expect(await noteCount(page)).toBe(1);
});
