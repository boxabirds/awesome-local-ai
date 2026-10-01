// Story 7 end-to-end: multi-select, group transforms and deletion in real
// browsers, singly and across live editors (TC-32 to TC-36). The TC ids are the
// Acceptance Cases in
// spec/stories/007-select-move-resize-and-delete-several-objects-at-o/design.md.
//
// Selections are marquee-dragged with a real Shift held, group moves are one
// mouse drag on one member, shift-clicks are real clicks that move keyboard
// focus the way a browser means to, and the five-client cases run the same
// actions on five real browser contexts at once.

import { expect, test, type Page } from "@playwright/test";
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
  STICKY_SIZE_WORLD,
} from "../../src/shared/config";
import {
  createBoard,
  openFreshBoard,
  readCamera,
  type Point,
} from "./helpers/board";
import {
  content,
  createNote,
  deleteNote,
  noteCount,
  openBoard,
  waitForContentsMatch,
} from "./helpers/live";

const noteElements = (page: Page) =>
  page.locator('[data-testid="sticky-note"]');
const selectedElements = (page: Page) =>
  page.locator('[data-testid="sticky-note"][data-selected="true"]');
const selectionBar = (page: Page) => page.getByTestId("selection-bar");
const selectionBox = (page: Page) => page.getByTestId("selection-box");

/** Screen centre of one note, addressed by id: z-order shuffles the list. */
async function centreOf(page: Page, id: string): Promise<Point> {
  const box = await page.locator(`[data-note-id="${id}"]`).boundingBox();
  if (box === null) throw new Error(`note ${id} is not rendered`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function positionOf(
  page: Page,
  id: string,
): Promise<{ x: number; y: number }> {
  const notes = await content(page);
  const note = notes.find((n) => n.id === id);
  if (note === undefined) throw new Error(`note ${id} is gone`);
  return { x: note.x, y: note.y };
}

/** Shift-drag a marquee over empty space, in a real browser, with a real Shift. */
async function marquee(page: Page, from: Point, to: Point): Promise<void> {
  await page.keyboard.down("Shift");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
}

/** Mouse-drag one note by id a screen delta, in plenty of steps. */
async function dragById(
  page: Page,
  id: string,
  dx: number,
  dy: number,
): Promise<void> {
  const from = await centreOf(page, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await page.mouse.up();
}

/** Shift-click, the way a trackpad user adds to a selection. */
async function shiftClickNote(page: Page, id: string): Promise<void> {
  const c = await centreOf(page, id);
  await page.keyboard.down("Shift");
  await page.mouse.click(c.x, c.y);
  await page.keyboard.up("Shift");
}

test('TC-32 a marquee takes the note inside it whole and leaves the rest', async ({
  page,
  request,
}) => {
  await openFreshBoard(page, request);
  // three notes in a row: A, B straddling the marquee's right edge, C outside it
  const [a, b] = [
    await createNoteAt(page, { x: 240, y: 300 }, 'in'),
    await createNoteAt(page, { x: 520, y: 300 }, 'half'),
  ];
  await createNoteAt(page, { x: 800, y: 300 }, 'out');
  await page.mouse.click(640, 700); // click empty space: nothing selected
  await expect(selectedElements(page)).toHaveCount(0);

  // the box ends at x 580: the first note (screen 140..340) lies inside it
  // whole, the second (420..620) half in, the third far out. A box only takes
  // what fits entirely (TC-07, TC-32), and selecting moves nothing.
  const before = await content(page);
  const cameraBefore = await readCamera(page);
  await marquee(page, { x: 130, y: 190 }, { x: 580, y: 410 });
  await expect(selectedElements(page)).toHaveCount(1);
  await expect(page.locator(`[data-note-id="${a}"]`)).toHaveAttribute(
    'data-selected',
    'true',
  );
  expect(await content(page)).toEqual(before);
  expect(await readCamera(page)).toEqual(cameraBefore);

  // shift-click is the other way in and out; the browser focuses the note the
  // click lands on, and that focus must not undo the click's own selection
  await shiftClickNote(page, b);
  await expect(selectedElements(page)).toHaveCount(2);
  await shiftClickNote(page, a);
  await expect(selectedElements(page)).toHaveCount(1);
  await expect(page.locator(`[data-note-id="${b}"]`)).toHaveAttribute('data-selected', 'true');

  // and a plain click on the one selected note keeps it selected, alone
  await page.click(`[data-note-id="${b}"]`);
  await expect(selectedElements(page)).toHaveCount(1);
  expect(await readCamera(page)).toEqual(cameraBefore);
});

/** Double-click empty space to create a note there, type, and leave the editor. */
async function createNoteAt(
  page: Page,
  at: Point,
  text: string,
): Promise<string> {
  await createNote(page, at, text);
  const notes = await content(page);
  const note = notes.find((n) => n.text === text);
  if (note === undefined) throw new Error(`note "${text}" did not land`);
  return note.id;
}

test('TC-33 a selected cluster moves as one and a corner resize scales it', async ({
  page,
  request,
}) => {
  await openFreshBoard(page, request);
  // three notes in a row and one below the row; the row is the cluster
  const ids = [
    await createNoteAt(page, { x: 240, y: 300 }, 'a'),
    await createNoteAt(page, { x: 520, y: 300 }, 'b'),
    await createNoteAt(page, { x: 800, y: 300 }, 'c'),
  ];
  const fourth = await createNoteAt(page, { x: 240, y: 660 }, 'fourth');
  await page.mouse.click(640, 700);
  await marquee(page, { x: 130, y: 190 }, { x: 910, y: 410 });
  await expect(selectedElements(page)).toHaveCount(3);

  // one drag on one member: 300 screen px = 300 world units at the board's
  // opening zoom, and all three notes take exactly that step
  const before = await content(page);
  const cameraBefore = await readCamera(page);
  await dragById(page, ids[1]!, 300, 0);
  await expect(selectedElements(page)).toHaveCount(3);
  for (const id of ids) {
    const was = before.find((n) => n.id === id)!;
    const now = await positionOf(page, id);
    expect(now.x).toBeCloseTo(was.x + 300, 0);
    expect(now.y).toBeCloseTo(was.y, 0);
  }
  const aside = await positionOf(page, fourth);
  const asideWas = before.find((n) => n.id === fourth)!;
  expect(aside).toEqual({ x: asideWas.x, y: asideWas.y });
  expect(await readCamera(page)).toEqual(cameraBefore);

  // the northwest handle, pulled half way into the box, halves it: the
  // southeast corner holds still, sizes and gaps halve, squares stay square.
  // (The pull travels inward, so the pointer stays inside the window - some
  // browsers clamp pointer coordinates that leave it.)
  const box = selectionBox(page);
  const boxEdge = await box.boundingBox();
  if (boxEdge === null) throw new Error('the selection box is not rendered');
  const moved = await content(page);
  const selected = moved.filter((n) => ids.includes(n.id));
  const union = {
    x: Math.min(...selected.map((n) => n.x)),
    y: Math.min(...selected.map((n) => n.y)),
    right: Math.max(...selected.map((n) => n.x + (n.width ?? STICKY_SIZE_WORLD))),
    bottom: Math.max(...selected.map((n) => n.y + (n.height ?? STICKY_SIZE_WORLD))),
  };
  const pull = { x: (union.right - union.x) / 2, y: (union.bottom - union.y) / 2 };
  await page.mouse.move(boxEdge.x + 1, boxEdge.y + 1);
  await page.mouse.down();
  await page.mouse.move(boxEdge.x + 1 + pull.x / 2, boxEdge.y + 1 + pull.y / 2, { steps: 5 });
  await page.mouse.move(boxEdge.x + 1 + pull.x, boxEdge.y + 1 + pull.y, { steps: 5 });
  await page.mouse.up();

  const grown = await content(page);
  const side = (n: { width?: number; height?: number }): [number, number] => [
    n.width ?? STICKY_SIZE_WORLD,
    n.height ?? STICKY_SIZE_WORLD,
  ];
  const anchorX = union.right;
  const anchorY = union.bottom;
  let previousCentre: number | null = null;
  for (const id of ids) {
    const was = moved.find((n) => n.id === id)!;
    const now = grown.find((n) => n.id === id)!;
    const [wasW, wasH] = side(was);
    const [nowW, nowH] = side(now);
    expect(nowW).toBeCloseTo(wasW / 2, 0);
    expect(nowH).toBeCloseTo(wasH / 2, 0); // notes stay square
    expect(now.x).toBeCloseTo(anchorX - (anchorX - was.x) / 2, 0);
    expect(now.y).toBeCloseTo(anchorY - (anchorY - was.y) / 2, 0);
    const centre = now.x + nowW / 2;
    if (previousCentre !== null) {
      expect(centre - previousCentre).toBeCloseTo(280 / 2, 0); // gaps halve too
    }
    previousCentre = centre;
  }
  expect(await positionOf(page, fourth)).toEqual(aside);
});

test('TC-34 arrow keys nudge the selection without scrolling or panning, and Delete clears', async ({
  page,
  request,
}) => {
  await openFreshBoard(page, request);
  const ids = [
    await createNoteAt(page, { x: 440, y: 320 }, 'left'),
    await createNoteAt(page, { x: 760, y: 420 }, 'right'),
  ];
  await page.keyboard.press('Control+a');
  await expect(selectedElements(page)).toHaveCount(2);

  // one press per step; the world moves by the nudge unit, and neither the
  // page (it does not scroll) nor the camera (arrows do not pan) gives way
  const cameraBefore = await readCamera(page);
  const steps = [
    ['ArrowUp', 0, -1],
    ['ArrowRight', 1, 0],
    ['Shift+ArrowDown', 0, 10],
    ['Shift+ArrowLeft', -10, 0],
  ] as const;
  for (const [key, dx, dy] of steps) {
    const was = await Promise.all(ids.map((id) => positionOf(page, id)));
    await page.keyboard.press(key);
    const now = await Promise.all(ids.map((id) => positionOf(page, id)));
    for (const i of ids.keys()) {
      expect(now[i]!.x).toBeCloseTo(was[i]!.x + dx, 0);
      expect(now[i]!.y).toBeCloseTo(was[i]!.y + dy, 0);
    }
    expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]);
    expect(await readCamera(page)).toEqual(cameraBefore);
  }

  // Delete takes the whole selection; the board is empty and nothing is selected
  await page.keyboard.press('Delete');
  await expect.poll(() => noteCount(page)).toBe(0);
  await expect(selectedElements(page)).toHaveCount(0);
  await expect(selectionBox(page)).toHaveCount(0);
});

test("TC-35 a colleague deletes one of my selected notes and my selection shrinks", async ({
  browser,
  request,
}) => {
  test.setTimeout(60_000);
  const boardId = await createBoard(request);
  const mine = await openBoard(browser, boardId);
  const theirs = await openBoard(browser, boardId);

  const ids: string[] = [];
  for (const [i, x] of [320, 640, 960].entries()) {
    ids.push(await createNoteAt(mine, { x, y: 400 }, `n${i}`));
  }
  await waitForContentsMatch([mine, theirs], E2E_EVENTUAL_TIMEOUT_MS);

  // I select all three with the keyboard
  await mine.click(`[data-note-id="${ids[0]!}"]`);
  await mine.keyboard.press("Control+a");
  await expect(selectedElements(mine)).toHaveCount(3);
  // and my colleague, in their own browser, deletes the middle one
  await deleteNote(theirs, 1);
  await expect(noteElements(theirs)).toHaveCount(2);

  // my selection drops it by itself: the other two stay selected, the bar follows
  await expect(selectedElements(mine)).toHaveCount(2);
  await expect(selectionBar(mine)).toContainText("2 selected");
  await expect(selectionBox(mine)).toBeVisible();
  await expect(noteElements(mine)).toHaveCount(2);
  // the note that survives is still where it was: a delete did not move it
  expect(await positionOf(mine, ids[2]!)).toEqual(
    await positionOf(theirs, ids[2]!),
  );
});

test("TC-36 five clients transform different objects at once and converge", async ({
  browser,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  // headless firefox/webkit on macOS route *concurrent* native mouse input to
  // whichever window holds OS focus, so five parallel drags land in whichever
  // windows happen to be frontmost. What this case proves - transforms by
  // different editors merging into one document - is a property of the
  // document, which chromium exercises honestly; it is the harness, not the
  // board, that cannot press five mice at once over there.
  test.skip(testInfo.project.name !== "chromium", "parallel native input multiplexes across windows");
  const boardId = await createBoard(request);
  const pages: Page[] = [];
  for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++)
    pages.push(await openBoard(browser, boardId));

  const ids: string[] = [];
  for (const [i, x] of [240, 480, 720, 960, 1200].entries()) {
    ids.push(await createNoteAt(pages[0]!, { x, y: 400 }, `n${i}`));
  }
  await waitForContentsMatch(pages, E2E_EVENTUAL_TIMEOUT_MS);

  const before = await Promise.all(ids.map((id) => positionOf(pages[0]!, id)));

  // each client selects exactly one distinct note, and moves it, at the same
  // time; the five ways apart are chosen so no note ever crosses another -
  // every drag holds its own object, whatever the others are dragging
  const moves = [
    { x: -140, y: 140 },
    { x: -70, y: -140 },
    { x: 0, y: 140 },
    { x: 70, y: -140 },
    { x: 140, y: 140 },
  ];
  await Promise.all(
    pages.map(async (client, i) => {
      const id = ids[i]!;
      await client.click(`[data-note-id="${id}"]`);
      await expect(selectedElements(client)).toHaveCount(1);
      await dragById(client, id, moves[i]!.x, moves[i]!.y);
    }),
  );
  await waitForContentsMatch(pages, E2E_EVENTUAL_TIMEOUT_MS);

  // the same final document everywhere, each note exactly where its mover left it
  for (const client of pages) {
    const notes = await content(client);
    expect(notes.length).toBe(5);
    for (const [i, id] of ids.entries()) {
      expect(await positionOf(client, id)).toEqual({
        x: before[i]!.x + moves[i]!.x,
        y: before[i]!.y + moves[i]!.y,
      });
    }
  }
});
