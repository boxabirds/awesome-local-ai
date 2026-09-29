// Story 8 e2e: undo and redo on a board other people are working on, in real
// browsers against the real sync provider (TC-22 to TC-24).
//
// What these cases can prove and the component file cannot: that a keystroke on one
// screen changes what is on another screen, that a colleague's work is untouched by
// it, and that the two screens still agree afterwards. Everything is read from the
// DOM of each browser — nothing is read from the client's own memory, because whose
// history is whose is exactly what is in question.
//
// The undo chord is sent as Ctrl (+Shift) rather than Cmd: the board accepts either,
// and a suite that runs the same on any machine is a suite that keeps running. Note
// that the keystroke reaches the board because the page, not a text field, has the
// focus — which is also the story's rule (TC-21).
import { test, expect, type Page } from '@playwright/test';
import {
  ensureBoard,
  openSharedBoard,
  setCamera,
  noteCount,
  noteIds,
} from './helpers/board.ts';
import { RawClient } from './helpers/rawClient.ts';
import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  type StickyColor,
} from '../../src/shared/config.ts';
import {
  createSticky,
  getStickyText,
  resizeObjects,
} from '../../src/shared/board-model.ts';

interface NoteRect {
  id: string;
  text: string;
  color: string; // computed background colour, as the screen shows it
  x: number; // world position, from the element's own style
  y: number;
  width: number;
  height: number;
  z: number;
  left: number; // screen box, in CSS pixels
  top: number;
  right: number;
  bottom: number;
  cx: number;
  cy: number;
}

interface Point {
  x: number;
  y: number;
}

interface Seed {
  text: string;
  x: number; // world centre
  y: number;
  color?: StickyColor;
  width?: number;
  height?: number;
}

const settle = (page: Page) => page.waitForTimeout(60);

const pressUndo = (page: Page) => page.keyboard.press('Control+z');

async function rects(page: Page): Promise<NoteRect[]> {
  return page.evaluate(() => {
    const els = Array.from(
      document.querySelectorAll('[role="group"][aria-label="Sticky note"]'),
    ) as HTMLElement[];
    return els.map((el) => {
      const r = el.getBoundingClientRect();
      const label = el.querySelector('[data-testid="sticky-text"]');
      return {
        id: el.dataset.noteId ?? '',
        text: (label?.textContent ?? '').trim(),
        color: getComputedStyle(el).backgroundColor,
        x: parseFloat(el.style.left),
        y: parseFloat(el.style.top),
        width: parseFloat(el.style.width),
        height: parseFloat(el.style.height),
        z: parseFloat(el.style.zIndex),
        left: r.x,
        top: r.y,
        right: r.x + r.width,
        bottom: r.y + r.height,
        cx: r.x + r.width / 2,
        cy: r.y + r.height / 2,
      };
    });
  });
}

const byId = (list: NoteRect[], id: string): NoteRect => {
  const hit = list.find((n) => n.id === id);
  if (!hit) throw new Error(`no note ${id} on this board`);
  return hit;
};

const byText = (list: NoteRect[], text: string): NoteRect => {
  const hit = list.find((n) => n.text === text);
  if (!hit) throw new Error(`no note labelled "${text}" on this board`);
  return hit;
};

/**
 * Everything a screen shows about its notes — position, size, colour, text and
 * stacking — as one string. Camera-independent, so two screens can be compared
 * however differently they are looking at the board.
 */
function signature(list: NoteRect[]): string {
  return [...list]
    .map(
      (n) =>
        `${n.text}|${n.color}|${Math.round(n.width)}x${Math.round(n.height)}|${Math.round(
          n.x,
        )},${Math.round(n.y)},${n.z}`,
    )
    .sort()
    .join(' # ');
}

/** Assert another collaborator's screen agrees with `reference`, in time. */
async function expectAgrees(page: Page, reference: NoteRect[]) {
  const wanted = signature(reference);
  await expect
    .poll(() => rects(page).then(signature), {
      timeout: 4 * LIVE_UPDATE_LATENCY_BUDGET_MS,
    })
    .toBe(wanted);
}

/** Every note's screen box inside the viewport, so the drags below are reachable. */
async function expectAllOnScreen(page: Page) {
  const list = await rects(page);
  expect(list.length).toBeGreaterThan(0);
  for (const n of list) {
    expect(n.left).toBeGreaterThanOrEqual(0);
    expect(n.top).toBeGreaterThanOrEqual(0);
    expect(n.right).toBeLessThanOrEqual(1280);
    expect(n.bottom).toBeLessThanOrEqual(800);
  }
}

/**
 * Put notes on a board with a Node-side collaborator, through the same model calls
 * the app makes — including colour and size, which TC-22 needs to see come back.
 */
async function seedNotes(boardId: string, seeds: Seed[]): Promise<void> {
  const client = new RawClient(boardId);
  await client.connect();
  await client.waitFor(() => client.noteCount() === 0);
  for (const seed of seeds) {
    const id = createSticky(client.doc, { x: seed.x, y: seed.y }, seed.color);
    if (seed.text) getStickyText(client.doc, id)?.insert(0, seed.text);
    if (seed.width && seed.height) {
      resizeObjects(client.doc, new Map([[id, { x: seed.x, y: seed.y, width: seed.width, height: seed.height }]]));
    }
  }
  await client.waitFor(() => client.noteCount() === seeds.length);
  client.close();
}

async function lookAt(pages: Page[]) {
  for (const page of pages) {
    await setCamera(page, { x: 0, y: 0, zoom: 0.6 });
    await settle(page);
  }
}

async function marquee(page: Page, from: Point, to: Point) {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await settle(page);
}

/** Select a set of notes by name with one box drawn around their screen boxes. */
async function selectNotes(page: Page, list: NoteRect[], names: string[]) {
  const chosen = names.map((n) => byText(list, n));
  await marquee(
    page,
    {
      x: Math.min(...chosen.map((n) => n.left)) - 8,
      y: Math.min(...chosen.map((n) => n.top)) - 8,
    },
    {
      x: Math.max(...chosen.map((n) => n.right)) + 8,
      y: Math.max(...chosen.map((n) => n.bottom)) + 8,
    },
  );
  const selected = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-selected="true"]'))
      .map((el) => (el as HTMLElement).dataset.noteId ?? '')
      .filter((s) => s !== '')
      .sort(),
  );
  expect(selected).toEqual(chosen.map((n) => n.id).sort());
}

async function dragNote(page: Page, from: Point, dxPx: number, dyPx: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(20);
  await page.mouse.move(from.x + dxPx / 2, from.y + dyPx / 2, { steps: 6 });
  await page.waitForTimeout(20);
  await page.mouse.move(from.x + dxPx, from.y + dyPx, { steps: 6 });
  await page.mouse.up();
  await settle(page);
}

/** Double-click a note and type into it, the way the board asks you to. */
async function typeInNote(page: Page, at: Point, text: string) {
  await page.mouse.dblclick(at.x, at.y);
  await settle(page);
  await expect(page.getByTestId('sticky-text-editor')).toBeVisible();
  await page.keyboard.type(text, { delay: 30 });
  await settle(page);
  await page.keyboard.press('Escape');
  await settle(page);
}

/**
 * The board TC-22 works on: a row of notes, four to a line, in the world coordinates
 * the board keeps. At the 0.6 zoom these specs look at, world units become screen
 * pixels by multiplying by 0.6 from the top-left of the viewport — which is why they
 * start well to the right of the tool bar and end inside a 1280 x 800 screen
 * (`expectAllOnScreen` is what proves the drags below can reach them).
 */
function row(count: number, prefix = 'n'): Seed[] {
  const colors: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];
  const out: Seed[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      text: `${prefix}${i + 1}`,
      x: 400 + (i % 4) * 220,
      y: 200 + Math.floor(i / 4) * 260,
      color: colors[i % colors.length],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// TC-22 — recover an accidental delete while a colleague keeps working
// ---------------------------------------------------------------------------

test.describe('TC-22 recovering an accidental delete', () => {
  test('eight notes I deleted come back on both screens, my colleague’s note stays', async ({
    context,
  }) => {
    const id = await ensureBoard();
    const mia = await context.newPage();
    const raj = await context.newPage();
    // A page error would be a bug in undo itself, so watch for one from the start.
    const problems: string[] = [];
    mia.on('pageerror', (err) => problems.push(String(err)));

    const seeds = row(8);
    seeds[0] = { ...seeds[0]!, width: 260, height: 200 }; // one note of its own size
    await seedNotes(id, seeds);

    await openSharedBoard(mia, id);
    await openSharedBoard(raj, id);
    await lookAt([mia, raj]);
    await expect.poll(() => noteCount(mia)).toBe(8);
    await expectAllOnScreen(mia);

    const before = await rects(mia);
    await expectAgrees(raj, before);

    // Mia selects all eight and deletes them. One keystroke, one step.
    await selectNotes(mia, before, seeds.map((s) => s.text));
    await mia.keyboard.press('Delete');
    await settle(mia);
    expect(await noteCount(mia)).toBe(0);
    await expect.poll(() => noteCount(raj)).toBe(0);
    expect(await mia.getByTestId('undo-button')).toBeEnabled();

    // Raj adds a note of his own. It is his change, not hers.
    const spot = { x: 300, y: 620 }; // empty space below the notes
    await typeInNote(raj, spot, 'raj');
    await expect.poll(() => noteCount(mia)).toBe(1);

    // Mia undoes: the eight come back, exactly as they were, on both screens...
    await pressUndo(mia);
    await settle(mia);
    const restored = await rects(mia);
    // Raj's own note is compared separately below; what has to match what was there
    // before is my eight, note for note: text, colour, size, position and stacking.
    expect(signature(restored.filter((n) => n.text !== 'raj'))).toBe(signature(before));
    await expectAgrees(raj, restored);

    // ...and Raj's note is still there: undoing hers undid nothing of his.
    expect(await noteCount(mia)).toBe(9);
    expect((await rects(mia)).map((n) => n.text).sort()).toEqual(
      [...seeds.map((s) => s.text), 'raj'].sort(),
    );

    // Her history has nothing else in it: one undo was one step, so Undo goes grey.
    await expect(mia.getByTestId('undo-button')).toBeDisabled();
    await expect(mia.getByTestId('undo-button')).toHaveAttribute('aria-disabled', 'true');
    await expect(mia.getByTestId('redo-button')).toBeEnabled();

    // Redo removes the eight again, on both screens, and leaves Raj's note alone.
    await mia.getByTestId('redo-button').click();
    await settle(mia);
    expect((await rects(mia)).map((n) => n.text)).toEqual(['raj']);
    await expect.poll(() => rects(raj).then((l) => l.map((n) => n.text)), {
      timeout: 4 * LIVE_UPDATE_LATENCY_BUDGET_MS,
    }).toEqual(['raj']);

    expect(problems).toEqual([]);
    await mia.close();
    await raj.close();
  });
});

// ---------------------------------------------------------------------------
// TC-23 — a colleague deletes the object I was working on
// ---------------------------------------------------------------------------

test.describe('TC-23 undoing a change to something a colleague deleted', () => {
  test('undo of my own change does nothing loud, and my next undo still works', async ({
    context,
  }) => {
    const id = await ensureBoard();
    await seedNotes(id, [
      { text: 'keep', x: 500, y: 260 },
      { text: 'gone', x: 900, y: 260 },
    ]);

    const mia = await context.newPage();
    const raj = await context.newPage();
    const problems: string[] = [];
    mia.on('pageerror', (err) => problems.push(String(err)));
    const consoleErrors: string[] = [];
    mia.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await openSharedBoard(mia, id);
    await openSharedBoard(raj, id);
    await lookAt([mia, raj]);
    await expect.poll(() => noteCount(mia)).toBe(2);

    // Two steps of mine. The second one is the move of the note Raj is going to
    // remove; the first is a line of text on a note that survives, so there is a
    // next undo afterwards that can be seen to work.
    const start = await rects(mia);
    const keepId = byText(start, 'keep').id;
    const goneId = byText(start, 'gone').id;

    const keep = byText(start, 'keep');
    await typeInNote(mia, { x: keep.cx, y: keep.cy }, ' typed a line');
    const afterTyping = await rects(mia);
    expect(byId(afterTyping, keepId).text).toBe('keep typed a line');
    expect(byId(afterTyping, goneId).text).toBe('gone');

    const moved = byId(afterTyping, goneId);
    await dragNote(mia, { x: moved.cx, y: moved.cy }, 120, 90);
    const afterMove = await rects(mia);
    expect(byId(afterMove, goneId).x).not.toBe(moved.x);
    await expectAgrees(raj, afterMove);

    // Raj deletes the note I was working on.
    const onRaj = byId(await rects(raj), goneId);
    await raj.mouse.click(onRaj.cx, onRaj.cy);
    await settle(raj);
    await raj.keyboard.press('Delete');
    await settle(raj);
    await expect.poll(() => noteIds(mia)).toEqual([keepId]);

    // Now I undo the move of a note that is no longer on the board. There is nothing
    // of that step left to put back, so undo does not pretend otherwise and does not
    // report a problem: it goes on to the last thing of mine it can still change,
    // which is the line I typed. (A step whose object a colleague removed has no
    // content to restore; yjs keeps looking back down the stack until a step can
    // actually be performed. That is a step consumed, not a step jammed.)
    await pressUndo(mia);
    await settle(mia);
    expect(await noteIds(mia)).toEqual([keepId]); // the note is absent on my screen...
    expect(await noteIds(raj)).toEqual([keepId]); // ...and on Raj's
    expect(byId(await rects(mia), keepId).text).toBe('keep'); // my own text reversed
    expect(problems).toEqual([]);
    expect(consoleErrors).toEqual([]);

    // My stack is empty, and Redo offers back what undo did manage to reverse.
    await expect(mia.getByTestId('undo-button')).toBeDisabled();
    await expect(mia.getByTestId('redo-button')).toBeEnabled();

    // The next thing I change undoes normally: the history still works after a step
    // of mine was made impossible by someone else.
    const keepAgain = byId(await rects(mia), keepId);
    await typeInNote(mia, { x: keepAgain.cx, y: keepAgain.cy }, ' again');
    expect(byId(await rects(mia), keepId).text).toBe('keep again');
    await pressUndo(mia);
    await settle(mia);
    expect(byId(await rects(mia), keepId).text).toBe('keep');
    await expectAgrees(raj, await rects(mia));

    // Neither of my undos went near Raj's deletion. It is still on *his* stack, which
    // is the point: the delete is the one change on this board that only he can undo,
    // and undoing it brings his deletion back for everybody — which none of mine did.
    expect(await noteIds(mia)).toEqual([keepId]);
    await expect(raj.getByTestId('undo-button')).toBeEnabled();
    await pressUndo(raj);
    await settle(raj);
    const two = await noteIds(raj);
    expect(two).toHaveLength(2);
    expect(two).toContain(byId(await rects(raj), goneId).id);
    await expect.poll(() => noteIds(mia)).toEqual(two);

    expect(problems).toEqual([]);
    expect(consoleErrors).toEqual([]);

    await mia.close();
    await raj.close();
  });
});

// ---------------------------------------------------------------------------
// TC-24 — everyone undoing at once
// ---------------------------------------------------------------------------

test.describe('TC-24 everyone undoing at once', () => {
  test('each screen undoes its own two steps and the boards end up identical', async ({
    context,
  }) => {
    const editors = MAX_CONCURRENT_EDITORS;
    const id = await ensureBoard();
    // Two notes per editor: one they will move, one they will write in.
    const seeds: Seed[] = [];
    for (let i = 0; i < editors * 2; i++) {
      seeds.push({
        text: `o${i + 1}`,
        x: 360 + (i % 5) * 220,
        y: 200 + Math.floor(i / 5) * 260,
      });
    }
    await seedNotes(id, seeds);

    const pages: Page[] = [];
    const problems: string[] = [];
    for (let i = 0; i < editors; i++) {
      const page = await context.newPage();
      page.on('pageerror', (err) => problems.push(`editor ${i}: ${String(err)}`));
      await openSharedBoard(page, id);
      pages.push(page);
    }
    await lookAt(pages);
    for (const page of pages) await expect.poll(() => noteCount(page)).toBe(seeds.length);

    const start = await rects(pages[0]!);
    for (const page of pages.slice(1)) await expectAgrees(page, start);

    // Each editor moves their own first note and writes in their own second one.
    // Both are their own changes, and every note belongs to exactly one editor.
    await Promise.all(
      pages.map(async (page, i) => {
        const toMove = byText(await rects(page), `o${i * 2 + 1}`);
        await dragNote(page, { x: toMove.cx, y: toMove.cy }, 0, 70);
        const toWrite = byText(await rects(page), `o${i * 2 + 2}`);
        await typeInNote(page, { x: toWrite.cx, y: toWrite.cy }, '!' + i);
      }),
    );
    for (const page of pages) await expectAgrees(page, await rects(pages[0]!));

    const changed = await rects(pages[0]!);
    expect(signature(changed)).not.toBe(signature(start));

    // The world position of a note, which every screen agrees on because every
    // screen is looking at the board the same way.
    const worldY = (list: NoteRect[], text: string) => byText(list, text).y;
    const displaced = (list: NoteRect[], text: string) =>
      worldY(list, text) > worldY(start, text) + 50;

    // ---- everyone presses Ctrl+Z once ------------------------------------
    // What each screen loses is that screen's own keystrokes. Nobody's move is
    // touched, because the move is everybody's own *earlier* step and no undo of
    // anyone else's reaches it.
    await Promise.all(pages.map((page) => pressUndo(page)));
    await settle(pages[0]!);
    for (const page of pages) await expectAgrees(page, await rects(pages[0]!));
    const afterFirst = await rects(pages[0]!);
    for (let i = 0; i < editors; i++) {
      // My own typing is gone from the board...
      expect(byText(afterFirst, `o${i * 2 + 2}`).text).toBe(`o${i * 2 + 2}`);
      expect(byText(afterFirst, `o${i * 2 + 2}`).text).not.toContain('!');
      // ...and every move is still where it was dragged to, mine included.
      expect(displaced(afterFirst, `o${i * 2 + 1}`)).toBe(true);
    }
    expect(afterFirst.length).toBe(seeds.length);

    // ---- one editor presses Ctrl+Z again, the others do nothing ----------
    // Now their own move comes back, and only theirs: the four other editors' moves
    // stay where they were dragged, and the typing everyone else undid stays undone.
    await pressUndo(pages[0]!);
    await settle(pages[0]!);
    for (const page of pages) await expectAgrees(page, await rects(pages[0]!));
    const afterSecond = await rects(pages[0]!);
    expect(Math.abs(worldY(afterSecond, 'o1') - worldY(start, 'o1'))).toBeLessThan(2);
    for (let i = 1; i < editors; i++) {
      expect(displaced(afterSecond, `o${i * 2 + 1}`)).toBe(true);
    }
    await expect(pages[0]!.getByTestId('redo-button')).toBeEnabled();
    await expect(pages[0]!.getByTestId('undo-button')).toBeDisabled();

    // ---- the rest of them undo their moves too ---------------------------
    // The board is what it was before anyone touched it — every screen, note for
    // note. Only the stacking differs: dragging a note to the front is a change
    // nobody here made twice, and undo does not un-raise what it did not raise.
    await Promise.all(pages.slice(1).map((page) => pressUndo(page)));
    await settle(pages[0]!);
    for (const page of pages) await expectAgrees(page, await rects(pages[0]!));
    const ending = await rects(pages[0]!);
    expect(signature(ending.map((n) => ({ ...n, z: 0 })))).toBe(
      signature(start.map((n) => ({ ...n, z: 0 }))),
    );
    for (const page of pages) {
      await expect(page.getByTestId('undo-button')).toBeDisabled();
      await expect(page.getByTestId('redo-button')).toBeEnabled();
    }

    // Every screen agrees with every other one, not just with the first.
    const seen = new Set<string>();
    for (const page of pages) seen.add(signature(await rects(page)));
    expect(seen.size).toBe(1);

    expect(problems).toEqual([]);
    for (const page of pages) await page.close();
  });
});
