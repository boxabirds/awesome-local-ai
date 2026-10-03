// Story 9 e2e: writing free text anywhere on the board, in a real browser with real
// fonts and the real sync server.
//
// These are the workflows the story is about — a heading, a long annotation, a width
// drag that rewraps, abandoned text, and several people in the same text at once. The
// box assertions compare the *stored* measurement with the *painted* lines, because the
// point of the stored box is that every client reads the same numbers instead of each
// measuring for itself.

import { expect, test, type Page } from '@playwright/test';
import {
  MAX_CONCURRENT_EDITORS,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { ONE_LINE_ANNOTATION, THREE_HUNDRED_CHARS } from '../fixtures/texts';
import { gotoBoard } from './helpers/board';
import {
  createFreshBoard,
  createParticipants,
  type Participant,
} from './helpers/participants';
import {
  dragHandle,
  dragScreen,
  editorBox,
  resizeHandle,
  seedNotesAtScreen,
  selectionCount,
  stickyIds,
} from './helpers/sticky';
import {
  boardCursor,
  createTextWithTool,
  editText,
  endTextEdit,
  holdTextTool,
  lineHeightOf,
  paintedFontSize,
  paintedLineCount,
  selectToolButton,
  selectedTextIds,
  storedText,
  storedTextOrNull,
  textDeleteButton,
  textEditor,
  textIds,
  textObject,
  textScreenBox,
  textSelected,
  textSizePreset,
  textToolButton,
  typeIntoTextEditor,
  toolState,
} from './helpers/text';

/** How many objects of any type this client's document holds. */
function objectCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __vidi6Board: { getMap(name: string): { size: number } };
        }
      ).__vidi6Board.getMap('objects').size,
  );
}

/** Exactly the same characters, no more and no less, in either string. */
function sameCharacters(a: string, b: string): boolean {
  const count = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const ch of s) m.set(ch, (m.get(ch) ?? 0) + 1);
    return m;
  };
  const [x, y] = [count(a), count(b)];
  if (x.size !== y.size) return false;
  for (const [ch, n] of x) if (y.get(ch) !== n) return false;
  return true;
}

/** Every text object on a screen, as the document holds it: id → text. */
async function allTexts(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const doc = (
      window as unknown as {
        __vidi6Board: {
          getMap(name: string): {
            forEach(cb: (v: { get(k: string): unknown }, k: string) => void): void;
          };
        };
      }
    ).__vidi6Board;
    const out: Record<string, string> = {};
    doc.getMap('objects').forEach((value, key) => {
      if (value.get('type') === 'text') {
        out[key] = (value.get('text') as { toString(): string }).toString();
      }
    });
    return out;
  });
}

test('TC-26 a 300 character annotation wraps at the cap and paints several lines', async ({
  page,
}) => {
  await gotoBoard(page);
  const id = await createTextWithTool(page, 420, 260);
  await typeIntoTextEditor(page, THREE_HUNDRED_CHARS);

  // The stored box is what the layout measured: the auto-width cap, because the line
  // is far wider than it, and a height of as many lines as that takes.
  const stored = await storedText(page, id);
  expect(stored.text).toBe(THREE_HUNDRED_CHARS);
  expect(stored.widthMode).toBe('auto');
  // The line is far wider than the cap, so the box stops at the cap — measured while
  // typing, not only when the editor closes.
  expect(Math.abs(stored.width - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(2);
  const whileTyping = stored.height;

  // Leaving an annotation this long keeps every character of it.
  await endTextEdit(page);
  expect(await storedText(page, id).then((s) => s.text.length)).toBe(
    THREE_HUNDRED_CHARS.length,
  );

  // The height is as many lines as the screen actually paints, and the painted box
  // matches the stored one (zoom is 1, so units and pixels are the same here).
  const lines = await paintedLineCount(page, id);
  expect(lines).toBeGreaterThanOrEqual(4);
  const final = await storedText(page, id);
  expect(final.height).toBeGreaterThan(lines * lineHeightOf('M') - 2);
  expect(final.height).toBeLessThan(lines * lineHeightOf('M') + 2);
  expect(final.height).toBe(whileTyping);
  const box = await textScreenBox(page, id);
  expect(Math.abs(box.w - final.width)).toBeLessThanOrEqual(2);
});

test('TC-27 dragging the side handle rewraps the text and grows its height', async ({
  page,
}) => {
  await gotoBoard(page);
  const id = await createTextWithTool(page, 400, 240);
  await typeIntoTextEditor(page, ONE_LINE_ANNOTATION);
  await endTextEdit(page);

  // Selected: only the two side handles are offered, never a top or bottom one.
  await expect(resizeHandle(page, 'e')).toBeVisible();
  await expect(resizeHandle(page, 'w')).toBeVisible();
  await expect(resizeHandle(page, 'n')).toHaveCount(0);
  await expect(resizeHandle(page, 's')).toHaveCount(0);

  const before = await storedText(page, id);
  expect(before.widthMode).toBe('auto');
  const linesBefore = await paintedLineCount(page, id);

  // Drag the right handle in by 160 screen px (zoom 1, so 160 world units).
  await dragHandle(page, 'e', -160, 0);
  await expect
    .poll(() => storedText(page, id).then((s) => s.widthMode))
    .toBe('fixed');

  const after = await storedText(page, id);
  expect(Math.abs(after.width - (before.width - 160))).toBeLessThanOrEqual(2);
  expect(after.width).toBeGreaterThan(TEXT_MIN_WIDTH_WORLD);
  // The same words now need more room vertically: the height followed the wrapping.
  expect(after.height).toBeGreaterThan(before.height);
  expect(after.height % lineHeightOf('M')).toBe(0);
  const linesAfter = await paintedLineCount(page, id);
  expect(linesAfter).toBeGreaterThan(linesBefore);
  // Still no top, bottom or corner handle: a text object is only as wide as it is.
  await expect(resizeHandle(page, 'n')).toHaveCount(0);
  await expect(resizeHandle(page, 'se')).toHaveCount(0);
  // Nothing about the text itself changed, and it is still this client's own.
  expect(after.text).toBe(before.text);
  expect(after.size).toBe('M');
  expect(after.createdBy.length).toBeGreaterThan(0);

  // Dragging the handle out again gives the width back and the lines back with it.
  await dragHandle(page, 'e', 400, 0);
  await expect
    .poll(() => storedText(page, id).then((s) => s.width))
    .toBeGreaterThan(after.width);
  await expect
    .poll(() => storedText(page, id).then((s) => s.height))
    .toBeLessThan(after.height);
});

test('TC-28 titling a section: write it, size it, move it, delete it, undo it', async ({
  page,
}) => {
  await gotoBoard(page);
  // A cluster of notes to title, laid out in front of the camera.
  const notes = await seedNotesAtScreen(page, [
    { x: 420, y: 420 },
    { x: 640, y: 420 },
    { x: 530, y: 600 },
  ]);
  expect(notes).toHaveLength(3);

  // The heading goes above the cluster.
  const id = await createTextWithTool(page, 420, 200);
  await typeIntoTextEditor(page, 'Went well');
  await endTextEdit(page);
  const written = await storedText(page, id);
  expect(written.text).toBe('Went well');
  expect(await textSelected(page, id)).toBe(true);

  // Bigger, from the bar above the selection: the size changes, the spot does not.
  await textSizePreset(page, 'XL');
  const sized = await storedText(page, id);
  expect(sized.size).toBe('XL');
  expect(sized.x).toBe(written.x);
  expect(sized.y).toBe(written.y);
  expect(sized.height).toBeGreaterThan(written.height);
  expect(await paintedFontSize(page, id)).toBe(TEXT_SIZES.XL);

  // Drag it onto the cluster: the heading moves, the notes stay where they are.
  const box = await textScreenBox(page, id);
  await dragScreen(page, box.x + box.w / 2, box.y + box.h / 2, 120, 180);
  await expect
    .poll(() => storedText(page, id).then((s) => s.y))
    .toBeGreaterThan(written.y);
  expect([...(await stickyIds(page))].sort()).toEqual([...notes].sort());

  // Delete removes it; one undo brings back that object with its text and size.
  await page.keyboard.press('Delete');
  await expect(textObject(page, id)).toHaveCount(0);
  expect(await storedTextOrNull(page, id)).toBeNull();

  await page.keyboard.press('Control+z');
  await expect(textObject(page, id)).toBeVisible();
  const restored = await storedText(page, id);
  expect(restored.text).toBe('Went well');
  expect(restored.size).toBe('XL');
});

test('TC-29 two people typing into the same text end up with every character', async ({
  browser,
  request,
}) => {
  const board = await createFreshBoard(request);
  const people = await createParticipants(browser, board, ['ada', 'brin']);
  const [ada, brin] = people as [Participant, Participant];

  // Ada starts a heading; Brin opens the very same text and writes in it too.
  const id = await createTextWithTool(ada.page, 400, 240);
  await ada.type('Went ');
  await editText(brin.page, id);
  await brin.type('well: ');

  // Both keep typing into the same box at the same time.
  await Promise.all([ada.type('shipped'), brin.type('early')]);
  await endTextEdit(ada.page);
  await endTextEdit(brin.page);

  // However the two streams of keystrokes interleave, both documents end up with one
  // and the same text: Y.Text merged the edits, nobody lost a keystroke. (What is not
  // promised is that each person's words stay in one piece — two people share one
  // caret in one box, exactly as in story 2.)
  const expected = 'Went well: shippedearly';
  const merged = await expect
    .poll(() =>
      Promise.all([
        storedTextOrNull(ada.page, id),
        storedTextOrNull(brin.page, id),
      ]).then(([a, b]) => (a !== null && a === b ? a : null)),
    )
    .not.toBeNull()
    .then(() => storedTextOrNull(ada.page, id));
  expect(
    merged !== null && sameCharacters(merged, expected),
    `merged text ${JSON.stringify(merged)} is not made of exactly what was typed`,
  ).toBe(true);
  expect(merged).toContain('Went ');
  expect(merged).toContain('well: ');

  // One box, and both screens read the same numbers rather than their own.
  const box = await storedText(ada.page, id);
  expect(box.height % lineHeightOf('M')).toBe(0);
  expect(await paintedLineCount(ada.page, id)).toBe(await paintedLineCount(brin.page, id));
  expect((await storedText(brin.page, id)).width).toBe(box.width);

  for (const p of people) expect(p.pageErrors).toEqual([]);
  await Promise.all(people.map((p) => p.close()));
});

test('TC-30 five people each write a heading with the Text tool at once', async ({
  browser,
  request,
}) => {
  const board = await createFreshBoard(request);
  const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `w${i}`);
  const people = await createParticipants(browser, board, names);
  const headings = names.map((_, i) => `Heading ${i}`);
  const ownIds: string[] = [];

  // Everyone takes the Text tool, clicks their own spot and types their own heading,
  // all at the same time on five independent client states.
  await Promise.all(
    people.map(async (p: Participant, i: number) => {
      const mine = await createTextWithTool(p.page, 160 + i * 200, 180 + (i % 2) * 260);
      ownIds.push(mine);
      await typeIntoTextEditor(p.page, headings[i]!);
      await endTextEdit(p.page);
    }),
  );

  // Every screen ends up holding all five headings, with the same text in each: the
  // objects and their characters all travel, and no board ends up with a version of
  // someone else's heading of its own.
  const expected = [...headings].sort().join('|');
  const screens = await Promise.all(
    people.map(async (p) => {
      await expect
        .poll(() => allTexts(p.page).then((t) => Object.values(t).sort().join('|')))
        .toBe(expected);
      return allTexts(p.page);
    }),
  );
  for (const screen of screens) {
    expect(Object.values(screen).sort()).toEqual([...headings].sort());
  }
  // Nobody's tool stayed stuck on Text, and nobody's board threw an error.
  for (const p of people) {
    expect((await toolState(p.page)).text).toBe(false);
    expect((await toolState(p.page)).select).toBe(true);
    expect(p.pageErrors).toEqual([]);
  }

  await Promise.all(people.map((p) => p.close()));
});

test('TC-31 text abandoned without a character leaves the board as it was', async ({
  page,
}) => {
  await gotoBoard(page);

  // Hold Text, click, and leave immediately: nothing was ever written.
  await holdTextTool(page);
  expect(await boardCursor(page)).toBe('text');
  expect(await objectCount(page)).toBe(0);
  await page.mouse.click(500, 300);
  await expect(textEditor(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(textEditor(page)).toHaveCount(0);

  // Not a trace of it: no object in the document, nothing painted.
  expect(await textIds(page)).toHaveLength(0);
  expect(await objectCount(page)).toBe(0);

  // A marquee dragged over that spot selects nothing, because nothing is there.
  await page.keyboard.down('Shift');
  await page.mouse.move(380, 200);
  await page.mouse.down();
  await page.mouse.move(700, 430, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  expect(await selectionCount(page)).toBeNull();
  expect(await selectedTextIds(page)).toHaveLength(0);

  // The tool came back to Select and the rest of the board is unaffected: a sticky
  // note can still be made with N and selected with a click.
  expect((await toolState(page)).select).toBe(true);
  await page.keyboard.press('n');
  await expect(editorBox(page)).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await stickyIds(page)).toHaveLength(1);
  await selectToolButton(page).click();
  expect(await textDeleteButton(page).count()).toBe(0);
  expect(await textIds(page)).toHaveLength(0);
});

test('TC-14e the Text tool is offered, held and dropped, on a real board', async ({
  page,
}) => {
  await gotoBoard(page);
  expect(await toolState(page)).toEqual({
    select: true,
    text: false,
    textDisabled: false,
  });
  expect(await boardCursor(page)).not.toBe('text');

  // T holds Text: the rail says so, and the board itself is asking for a click.
  await page.keyboard.press('t');
  await expect(textToolButton(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await boardCursor(page)).toBe('text');

  // The mouse works too, and Escape returns to Select.
  await page.keyboard.press('Escape');
  await expect(selectToolButton(page)).toHaveAttribute('aria-pressed', 'true');
  await textToolButton(page).click();
  expect((await toolState(page)).text).toBe(true);
  await selectToolButton(page).click();
  expect((await toolState(page)).text).toBe(false);

  // And with Text held, a click writes nothing until it is actually typed into.
  await page.keyboard.press('t');
  await page.mouse.click(600, 400);
  await expect(textEditor(page)).toBeVisible();
  expect(await textIds(page)).toHaveLength(1);
  await page.keyboard.press('Escape');
  expect(await textIds(page)).toHaveLength(0);
});
