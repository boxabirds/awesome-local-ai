/**
 * TC-26 to TC-31 (story 9: `text.tool_ui`, `text.object`, `text.auto_width`,
 * `text.fixed_width`, `text.size`, `text.empty`, `text.concurrent`,
 * `text.consistent`): free text written on a real board, in a real browser, on a
 * board served by `wrangler dev` — so the box a heading ends up with was measured
 * by the fonts this machine actually has, and every write these tests measure has
 * travelled through the room to get back to the screen.
 *
 * Component tests cover the same object with a fake measurer and can only say one
 * box was bigger than another. What only a browser can settle is the thing the
 * whole story is about: that a 300-character sentence comes out 600 units wide and
 * several lines tall (`text.auto_width`), that pulling a side handle re-wraps the
 * words instead of stretching them, and that two people typing into one heading
 * end up with one heading.
 *
 * Mouse points come from real things — a note's box, a handle's box, a slot of
 * empty grid — and box measurements are read back in board units from each
 * object's own data attributes, which is how a test tells the stored measurement
 * from the browser's opinion of it.
 */
import { expect, test } from '@playwright/test';

import {
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { PROSE_300, RETRO_ITEM } from '../fixtures/texts';
import { expectInitialView } from './helpers/board';
import { createBoard } from './helpers/share';
import { EMPTY_CORNER, noteBox, openBoard, slot } from './helpers/live';
import { dragFrom } from './helpers/notes';
import {
  dragHandle,
  expectHandles,
  expectSelected,
  marquee,
  pick,
  seedNotes,
  selectedIds,
} from './helpers/selection';
import {
  chooseTextSize,
  editText,
  expectSideHandlesOnly,
  expectTextCount,
  expectTextToolbar,
  expectTextWords,
  holdSelectTool,
  holdTextTool,
  makeHeading,
  selectText,
  textBox,
  textEditor,
  textLines,
  textView,
  textWords,
} from './helpers/texts';

/** The three notes a heading is titled over, and the space above them. */
const CLUSTER = [
  { x: -260, y: 20, text: 'Kept the release train', color: 'yellow' as const },
  { x: -60, y: 20, text: 'Cut setup to an hour', color: 'green' as const },
  { x: 140, y: 20, text: 'Six colours, clear themes', color: 'pink' as const },
];

test('TC-26 a 300-character annotation comes out 600 units wide and several lines tall', async ({
  browser,
  request,
}) => {
  const boardId = await createBoard(request);
  const ana = await openBoard(browser, boardId, 'Ana');
  await expectInitialView(ana.page);
  const notes = await seedNotes(ana.page, CLUSTER);
  const first = await noteBox(ana.page, pick(notes, 0));

  // Below the cluster, where an annotation belongs: a point on empty grid, taken
  // from the note it goes under rather than from the camera this board opened with.
  const id = await makeHeading(ana.page, { x: first.x, y: first.y + first.height + 60 }, PROSE_300);

  const text = await textView(ana.page, id);
  // The words asked for more than the board gives an automatic text, so it wraps
  // at the limit and the box is the limit — to the unit the measurer wrote it.
  expect(Math.abs(text.width - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(2);
  expect(text.widthMode).toBe('auto');
  expect(text.words).toBe(PROSE_300);

  // Several lines, counted the way the browser breaks them, and the stored height
  // is at least as tall as the lines it was written for.
  const lines = await textLines(ana.page, id);
  expect(lines).toBeGreaterThanOrEqual(3);
  expect(text.height).toBeGreaterThanOrEqual(lines * TEXT_SIZES.M * TEXT_LINE_HEIGHT - 2);

  // A heading has no fill and no border: what is on the board is the words, in the
  // size they were written in.
  expect(text.size).toBe('M');
  expect(text.fontPx).toBe(TEXT_SIZES.M);

  expect(ana.problems).toEqual([]);
  await ana.context.close();
});

test('TC-27 the side handle narrows the annotation, the words re-wrap taller, and there is no top or bottom handle to pull', async ({
  browser,
  request,
}) => {
  const boardId = await createBoard(request);
  const ana = await openBoard(browser, boardId, 'Ana');
  await expectInitialView(ana.page);
  const notes = await seedNotes(ana.page, CLUSTER);
  const first = await noteBox(ana.page, pick(notes, 0));
  const id = await makeHeading(ana.page, { x: first.x, y: first.y + first.height + 60 }, PROSE_300);

  await selectText(ana.page, id);
  // Two handles, on the side edges: a text takes as many lines as its words need,
  // so there is no height here to drag (`text.fixed_width`).
  await expectSideHandlesOnly(ana.page);

  const before = await textView(ana.page, id);
  const beforeLines = await textLines(ana.page, id);
  await dragHandle(ana.page, 'e', { x: -160, y: 0 });

  const after = await textView(ana.page, id);
  // This width is now the text's own, chosen rather than measured.
  expect(after.widthMode).toBe('fixed');
  // At 100 % a screen pixel is a board unit, and this test says so by pulling a
  // round 160 of them.
  expect(Math.abs(after.width - (before.width - 160))).toBeLessThanOrEqual(2);
  // The same words, in less room: they wrap more and stand taller.
  const afterLines = await textLines(ana.page, id);
  expect(afterLines).toBeGreaterThan(beforeLines);
  expect(after.height).toBeGreaterThan(before.height);
  expect(after.words).toBe(PROSE_300);
  // A side handle is not a corner: the left edge did not move, and neither did the
  // size the letters are written in.
  expect(after.x).toBe(before.x);
  expect(after.y).toBe(before.y);
  expect(after.size).toBe('M');
  // Still only the side edges, after the drag as before it.
  await expectSideHandlesOnly(ana.page);

  expect(ana.problems).toEqual([]);
  await ana.context.close();
});

test('TC-28 title a retro section: type it, take it back, size it XL, drag it over the cluster, delete it, undo', async ({
  browser,
  request,
}) => {
  const boardId = await createBoard(request);
  const ana = await openBoard(browser, boardId, 'Ana');
  await expectInitialView(ana.page);
  await expect(ana.page.getByTestId('zoom-percent')).toHaveText('100%');
  const notes = await seedNotes(ana.page, CLUSTER);
  const first = await noteBox(ana.page, pick(notes, 0));
  const spot = { x: first.x - 20, y: first.y - 70 };

  const id = await makeHeading(ana.page, spot, 'Went well');
  const typed = await textView(ana.page, id);
  expect(typed.words).toBe('Went well');
  expect(typed.width).toBeGreaterThan(TEXT_MIN_WIDTH_WORLD);

  // The heading and the box it needed are one undo step (`undo.capture`, TC-25):
  // one press of Ctrl+Z and the board is back to a heading nobody has typed into,
  // at the width an empty one has.
  await ana.page.keyboard.press('Control+z');
  await expect
    .poll(() => textView(ana.page, id).then((text) => text.words), {
      message: 'one undo did not take the typed heading back',
    })
    .toBe('');
  const emptied = await textView(ana.page, id);
  expect(emptied.width).toBeLessThanOrEqual(TEXT_MIN_WIDTH_WORLD + 2);
  await ana.page.keyboard.press('Control+Shift+z');
  await expect(textWords(ana.page, id)).toHaveText('Went well');
  expect(Math.abs((await textView(ana.page, id)).width - typed.width)).toBeLessThanOrEqual(2);

  // XL from the toolbar above the selected heading (`text.size`).
  await selectText(ana.page, id);
  await expectTextToolbar(ana.page);
  await chooseTextSize(ana.page, 'XL');
  const big = await textView(ana.page, id);
  expect(big.size).toBe('XL');
  expect(big.fontPx).toBe(TEXT_SIZES.XL);
  expect(big.width).toBeGreaterThan(typed.width);
  expect(big.x).toBe(typed.x);
  expect(big.y).toBe(typed.y);

  // Drag it down over the cluster it is titling: from the middle of the heading to
  // the middle of the note it now belongs to. At 100 % a screen pixel is a board
  // unit, so the heading ends up exactly that far from where it was.
  const heading = await textBox(ana.page, id);
  const target = await noteBox(ana.page, pick(notes, 1));
  const from = { x: heading.x + heading.width / 2, y: heading.y + heading.height / 2 };
  const to = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const beforeMove = await textView(ana.page, id);
  await dragFrom(ana.page, from, to);
  const moved = await textView(ana.page, id);
  expect(Math.round(moved.x - beforeMove.x)).toBe(Math.round(to.x - from.x));
  expect(Math.round(moved.y - beforeMove.y)).toBe(Math.round(to.y - from.y));

  // Delete, and it is gone from this screen, selection and all.
  await ana.page.keyboard.press('Delete');
  await expectTextCount(ana.page, 0);
  expect(await selectedIds(ana.page)).toEqual([]);

  // Ctrl+Z brings the heading back with its words, its size and its place.
  await ana.page.keyboard.press('Control+z');
  await expect(textWords(ana.page, id)).toHaveText('Went well');
  const restored = await textView(ana.page, id);
  expect(restored.words).toBe('Went well');
  expect(restored.size).toBe('XL');
  expect(Math.round(restored.x)).toBe(Math.round(moved.x));
  expect(Math.round(restored.y)).toBe(Math.round(moved.y));

  expect(ana.problems).toEqual([]);
  await ana.context.close();
});

test('TC-23 in a browser: a heading beside a note has eight handles, and scaling the box leaves the letters alone', async ({
  browser,
  request,
}) => {
  const boardId = await createBoard(request);
  const ana = await openBoard(browser, boardId, 'Ana');
  await expectInitialView(ana.page);
  const notes = await seedNotes(ana.page, CLUSTER);
  const note = pick(notes, 1);
  const noteAt = await noteBox(ana.page, note);
  // A heading under the cluster, so the box around the two of them has room to grow.
  const id = await makeHeading(
    ana.page,
    { x: noteAt.x + 20, y: noteAt.y + noteAt.height + 60 },
    RETRO_ITEM,
  );

  // A heading and a note together. The selection is generic and so are its handles,
  // eight of them (`sel.multi_type`): this is the one case where a text does get a
  // top and a bottom handle, because that box belongs to the selection and not to
  // it (`text.group`).
  await selectText(ana.page, id);
  await ana.page.keyboard.down('Shift');
  await ana.page.mouse.click(noteAt.x + noteAt.width / 2, noteAt.y + noteAt.height / 2);
  await ana.page.keyboard.up('Shift');
  await expectSelected(ana.page, [id, note]);
  await expectHandles(ana.page);

  const before = await textView(ana.page, id);
  const noteBefore = await noteBox(ana.page, note);
  await dragHandle(ana.page, 'se', { x: 120, y: 120 });

  const after = await textView(ana.page, id);
  // The note grew with the box; the heading came along, in the same letters it went
  // in with, keeping the width its own words asked for (`text.group`, `text.font`).
  expect((await noteBox(ana.page, note)).width).toBeGreaterThan(noteBefore.width);
  expect(after.size).toBe('M');
  expect(after.fontPx).toBe(TEXT_SIZES.M);
  expect(after.width).toBe(before.width);
  expect(after.words).toBe(RETRO_ITEM);
  // Nothing about this gesture wrote the text's own width: it is still measured.
  expect(after.widthMode).toBe('auto');
  expect(after.x).toBeGreaterThanOrEqual(before.x);
  expect(after.y).toBeGreaterThanOrEqual(before.y);

  expect(ana.problems).toEqual([]);
  await ana.context.close();
});

test('TC-29 two people typing into one heading leave one heading with all their characters', async ({
  browser,
  request,
}) => {
  const boardId = await createBoard(request);
  const ana = await openBoard(browser, boardId, 'Ana');
  const ben = await openBoard(browser, boardId, 'Ben');
  await expectInitialView(ana.page);
  await expectInitialView(ben.page);

  const id = await makeHeading(ana.page, slot(1, 1), 'Retro');
  // The heading reaches Ben as any other object would.
  await expect(textWords(ben.page, id)).toHaveText('Retro');

  // Both of them open it, and neither of them is refused: there is no lock on a
  // heading, only one shared string (`text.concurrent`).
  await editText(ana.page, id);
  await editText(ben.page, id);
  // Two screens, both with the same heading open in front of them.
  await expect(textEditor(ana.page)).toBeVisible();
  await expect(textEditor(ben.page)).toBeVisible();

  // Character by character, alternating, so the two streams really interleave.
  const A = 'week';
  const B = 'prep';
  for (let i = 0; i < Math.max(A.length, B.length); i += 1) {
    if (A[i] !== undefined) await ana.page.keyboard.type(A[i]);
    if (B[i] !== undefined) await ben.page.keyboard.type(B[i]);
  }
  await ana.page.keyboard.press('Escape');
  await expect(textEditor(ana.page)).toHaveCount(0);
  await ben.page.keyboard.press('Escape');
  await expect(textEditor(ben.page)).toHaveCount(0);

  // One heading, and the two screens agree on it: neither keeps a private version,
  // and neither waits for the other to stop (`text.consistent`, `text.concurrent`).
  await expect
    .poll(
      async () => {
        const hers = (await textView(ana.page, id)).words;
        return hers !== '' && (await textView(ben.page, id)).words === hers;
      },
      {
        message: 'the two screens never agreed on the heading',
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      },
    )
    .toBe(true);
  const words = (await textView(ana.page, id)).words;
  // Nothing was lost on the way: every character either of them typed is there, and
  // nothing else is.
  const expected = [...('Retro' + A + B)].sort().join('');
  expect([...words].sort().join('')).toBe(expected);

  expect(ana.problems).toEqual([]);
  expect(ben.problems).toEqual([]);
  await ana.context.close();
  await ben.context.close();
});

test('TC-30 every screen sees every heading the room makes at once', async ({ browser, request }) => {
  const boardId = await createBoard(request);
  const crew = [];
  for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
    const member = await openBoard(browser, boardId, `Person ${i + 1}`);
    crew.push(member);
    await expectInitialView(member.page);
  }
  const words = crew.map((_, index) => `Heading ${index + 1}`);

  // All of them hold Text, all of them click, all of them type: five headings, no
  // two screens able to agree on the order they arrived in.
  await Promise.all(
    crew.map(async (member, index) => {
      const id = await makeHeading(member.page, slot(index % 3, Math.floor(index / 3)), words[index]);
      expect(id).not.toBe('');
    }),
  );

  for (const member of crew) {
    await expectTextCount(member.page, MAX_CONCURRENT_EDITORS);
    const seen = await expectTextWords(member.page, words);
    // Every one of them is written in the size a heading starts in, and is
    // selectable on this screen like any other object.
    expect(new Set(seen.map((text) => text.size))).toEqual(new Set(['M']));
    expect(member.problems).toEqual([]);
  }

  await Promise.all(crew.map((member) => member.context.close()));
});

test('TC-31 text nobody typed into is not on the board, and there is nothing left there to select', async ({
  browser,
  request,
}) => {
  const boardId = await createBoard(request);
  const ana = await openBoard(browser, boardId, 'Ana');
  const ben = await openBoard(browser, boardId, 'Ben');
  await expectInitialView(ana.page);
  await expectInitialView(ben.page);

  const spot = slot(1, 1);
  await holdTextTool(ana.page);
  await ana.page.mouse.click(spot.x, spot.y);
  // The object is really there while it is being looked at: an empty heading is
  // what the first second of typing is made of (`text.empty`).
  await expect(textEditor(ana.page)).toBeVisible();
  await expectTextCount(ana.page, 1);

  // Escape, with nothing typed into it.
  await ana.page.keyboard.press('Escape');
  await expect(textEditor(ana.page)).toHaveCount(0);
  await expectTextCount(ana.page, 0);
  // It never reached the room either: the other screen never saw one.
  await expectTextCount(ben.page, 0);
  // And the tool went back to Select with it (`text.tool_ui`).
  await holdSelectTool(ana.page);

  // The spot where it was is just board again: a rectangle over it takes nothing in.
  await ana.page.mouse.click(EMPTY_CORNER.x, EMPTY_CORNER.y);
  await marquee(ana.page, { x: spot.x - 80, y: spot.y - 60 }, { x: spot.x + 240, y: spot.y + 60 });
  await expectSelected(ana.page, []);
  await expect(ana.page.getByTestId('selection-bar')).toHaveCount(0);

  expect(ana.problems).toEqual([]);
  expect(ben.problems).toEqual([]);
  await ana.context.close();
  await ben.context.close();
});
