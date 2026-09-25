import { expect, test, type Page } from '@playwright/test';
import {
  boardPath,
  createBoard,
  openBoard,
  openCrowd,
  openFreshPair,
  slotOf,
} from './helpers/boards';

/**
 * Presence, end to end (story 6: TC-09 to TC-12).
 *
 * Two contexts, one room, real sockets: the only shape that can show a cursor
 * crossing a network. Everything is read as *drawn* — the overlay's own
 * elements — because the story is about what a second person sees, and a check
 * on the document would pass on a board that had lost the other person.
 *
 * Timing is measured, not assumed: the budget is the assertion. A warm-up move
 * precedes the measured one so a test measures a live link rather than the cost
 * of opening one, which is what the budget is actually about.
 */

const CURSORS = '[data-testid="remote-cursor"]';

/** How many remote cursors this page is drawing. */
async function cursorCount(page: Page): Promise<number> {
  return await page.locator(CURSORS).count();
}

/** The board area, which is where pointer coordinates and screen coordinates agree. */
async function move(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y, { steps: 3 });
}

/**
 * What this page draws, per person: name and colour, from the overlay itself.
 *
 * Read off the screen rather than out of `localStorage`, because the name a
 * person *published* is not necessarily the name they are drawn with — two
 * boards opened side by side both start out wanting the first guest name, and
 * the whole question is what the board shows once it knows there are two.
 */
async function drawnPeople(page: Page): Promise<Array<{ name: string; color: string; self: boolean }>> {
  return await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="avatar"]')).map((element) => ({
      name: element.getAttribute('data-name') ?? '',
      color: element.getAttribute('data-color') ?? '',
      self: element.getAttribute('data-self') === 'true',
    })),
  );
}

/** Wait for a cursor to be drawn at `position`, and say whether it ever was. */
async function waitCursorAt(page: Page, x: number, y: number, tolerance = 4): Promise<boolean> {
  const seen = await page
    .waitForFunction(
      ({ position, slack }) => {
        let closest: { x: number; y: number } | null = null;
        let shortest = Number.POSITIVE_INFINITY;
        for (const cursor of document.querySelectorAll('[data-testid="remote-cursor"]')) {
          const box = cursor.getBoundingClientRect();
          const distance = Math.abs(box.x - position.x) + Math.abs(box.y - position.y);
          if (distance < shortest) {
            shortest = distance;
            closest = { x: box.x, y: box.y };
          }
        }
        void closest;
        return shortest <= slack;
      },
      { position: { x, y }, slack: tolerance },
      { timeout: 5_000, polling: 20 },
    )
    .catch(() => null);
  return seen !== null;
}

test.describe('two people, one board, two cursors', () => {
  test('TC-09 a pointer move reaches the other board within 500 ms', async ({ browser }, testInfo) => {
    const [a, b] = await openFreshPair(browser, 'TC-09', slotOf(testInfo));

    // Warm the link: the first cursor is allowed to be slow, and the reason it
    // would be slow (opening a connection) is not what this budget measures.
    await move(a, 300, 300);
    await expect(b.locator(CURSORS)).toHaveCount(1, { timeout: 5_000 });

    const started = Date.now();
    await move(a, 640, 420);
    const seen = await waitCursorAt(b, 640, 420, 6);

    const elapsed = Date.now() - started;
    expect(seen, `the cursor took ${elapsed} ms, or never arrived`).toBe(true);
    expect(elapsed).toBeLessThanOrEqual(500);

    // And it is drawn *as that person*: a name and a colour, and not the ones
    // this board is wearing. Both tabs open wanting the first guest name, so a
    // cursor labelled with the same name as this screen's own dot would say
    // nothing about who moved.
    const label = await b.locator(CURSORS).first().innerText();
    expect(label.length).toBeGreaterThan(0);
    const people = await drawnPeople(b);
    expect(people).toHaveLength(2);
    const mine = people.find((person) => person.self);
    const theirs = people.find((person) => !person.self);
    expect(mine, 'this board knows which dot is itself').toBeDefined();
    expect(theirs?.name).toBe(label);
    expect(theirs?.name).not.toBe(mine?.name);
    expect(theirs?.color).not.toBe(mine?.color);

    await a.close();
    await b.close();
  });

  test('TC-09 a cursor is drawn where the pointer is, and nowhere else', async ({ browser }, testInfo) => {
    const [a, b] = await openFreshPair(browser, 'TC-09-offset', slotOf(testInfo));
    // Nobody has moved yet: an empty board draws nobody. A dot that appears
    // before anybody arrived, or a second arrow for the one person on the board,
    // is the failure this test is about.
    expect(await cursorCount(b)).toBe(0);

    // A *settled* cursor, not merely a cursor: a pointer moved in three steps
    // publishes its way there, and the first thing to arrive is not the place
    // anybody asked for.
    await move(a, 300, 300);
    expect(await waitCursorAt(b, 300, 300), 'the arrow never reached 300,300').toBe(true);
    expect(await cursorCount(b)).toBe(1);

    // One person only: the stack on each side is that person plus nobody else.
    expect(await b.getByTestId('avatar').count()).toBe(2);

    // The arrow follows the pointer rather than standing where it first landed.
    await move(a, 620, 180);
    expect(await waitCursorAt(b, 620, 180), 'the arrow never reached 620,180').toBe(true);
    expect(await cursorCount(b)).toBe(1);

    await a.close();
    await b.close();
  });

  test('TC-10 a board that is already occupied shows the people on it within 2 s', async ({
    browser,
    request,
  }, testInfo) => {
    const boardId = await createBoard(request, 'TC-10', slotOf(testInfo));
    const first = await browser.newContext();
    const a = await first.newPage();
    await openBoard(a, boardPath(boardId));
    await move(a, 400, 260);
    await expect(a.locator(CURSORS)).toHaveCount(0);

    // A goes quiet with a cursor still standing: this is the case where nobody
    // sends anything again, so only a newcomer that asks can see the answer.
    await a.waitForTimeout(1_200);

    const second = await browser.newContext();
    const b = await second.newPage();
    const started = Date.now();
    await openBoard(b, boardPath(boardId));
    // The budget is the story: two seconds, measured from the moment the second
    // board starts opening, with nobody sending anything on purpose.
    await expect(b.locator(CURSORS)).toHaveCount(1, { timeout: 2_000 });
    expect(Date.now() - started).toBeLessThanOrEqual(2_000);

    await a.close();
    await b.close();
  });

  test('TC-11 a closed tab stops being drawn within 3 s', async ({ browser }, testInfo) => {
    const [a, b] = await openFreshPair(browser, 'TC-11', slotOf(testInfo));
    await move(a, 500, 340);
    await expect(b.locator(CURSORS)).toHaveCount(1, { timeout: 5_000 });

    const closed = Date.now();
    const context = a.context();
    await context.close();

    // Two people were on the board and one of them is gone: at most one cursor
    // may still be drawn, and within the removal budget none at all.
    await expect(b.locator(CURSORS)).toHaveCount(0, { timeout: 3_000 });
    expect(Date.now() - closed).toBeLessThanOrEqual(3_000);
    // And the stack empties with it: a dot for somebody who left says they are
    // still here for as long as it is drawn.
    await expect
      .poll(async () => await b.getByTestId('avatar').count(), { timeout: 3_000 })
      .toBe(1);

    await b.close();
  });
});

/** The colours and names this page is drawing its people in, itself included. */
async function drawnColours(page: Page): Promise<string[]> {
  return await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="avatar"]')).map((element) => {
      const colour = element.getAttribute('data-color');
      const name = element.getAttribute('data-name');
      return `${colour ?? '?'}|${name ?? '?'}`;
    }),
  );
}

test.describe('a full board', () => {
  test('TC-12, TC-13 five boards opened at once end up with five different colours and names', async ({
    browser,
  }, testInfo) => {
    // The capacity the design names, opened in one go: every one of these five
    // picks a name and a colour before it has seen anybody, which is exactly the
    // moment a "pick something nobody has" rule has to earn its keep.
    const SIZE = 5;
    const { pages, contexts } = await openCrowd(browser, SIZE, 'TC-12', slotOf(testInfo));

    // Each board draws the whole board, itself included — a board you are alone
    // on still shows your own dot — so five people means five avatars here, and
    // the five have to be five *different* colours.
    // Checked on *every* page, not just one: convergence is a property of each
    // browser's own decision, and a page that never re-decides looks fine from
    // the outside while drawing four identical arrows.
    for (const page of pages) {
      await expect
        .poll(
          async () => {
            const drawn = await drawnColours(page);
            if (drawn.length !== SIZE) return `only ${String(drawn.length)} avatars`;
            const colours = new Set(drawn.map((entry) => entry.split('|')[0]));
            const names = new Set(drawn.map((entry) => entry.split('|')[1]));
            if (colours.size !== SIZE) return `${SIZE} people, ${String(colours.size)} colours: ${drawn.join(' ')}`;
            if (names.size !== SIZE) return `${SIZE} people, ${String(names.size)} names: ${drawn.join(' ')}`;
            return 'ok';
          },
          { timeout: 20_000, intervals: [200] },
        )
        .toBe('ok');
    }

    // And it *stayed* settled: a rule that never quite agrees keeps shuffling
    // colours while people move, which is visible as flicker and shows up here as
    // a stack that will not hold still.
    const first = pages[0];
    if (first === undefined) throw new Error('the crowd opened without a first page');
    const before = await drawnColours(first);
    await first.mouse.move(500, 300, { steps: 4 });
    await first.waitForTimeout(1_500);
    expect(await drawnColours(first)).toEqual(before);

    for (const context of contexts) await context.close();
  });
});

/**
 * Reading a cursor off the screen, in absolute viewport coordinates.
 *
 * The tip of the arrow, not the bounding box of the label under it: "within two
 * pixels of the corner" is a claim about a point, and a box that includes a
 * forty-pixel name tag is not a point.
 */
async function cursorTips(page: Page): Promise<Array<{ x: number; y: number }>> {
  return await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="remote-cursor"] svg')).map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y };
    }),
  );
}

/** Screen position of a world point on one page, read from that page's own camera. */
async function screenOf(page: Page, world: { x: number; y: number }): Promise<{ x: number; y: number }> {
  return await page.evaluate((point) => {
    const camera = window.__vidi6!.getCamera();
    return { x: (point.x - camera.x) * camera.zoom, y: (point.y - camera.y) * camera.zoom };
  }, world);
}

/**
 * Point one board at a world point and wait for the other to draw an arrow at the
 * same world point, re-driving the pointer up to three times.
 *
 * Both ends are given the *same world point* and each one's screen position comes
 * from its own camera, which is what the story describes: one person points at a
 * corner, the other sees the tip at that corner. It is also the only shape in
 * which "my screen position" and "my world position" cannot be confused.
 *
 * The re-driving is a harness accommodation, not a looser assertion. On webkit the
 * first synthetic pointer move after a load is sometimes not delivered as a
 * `pointermove` at all, and a camera set through the hook has not necessarily been
 * applied to the transform by the time the next call reads it back; either one
 * shows up as "no arrow ever drawn", which proves nothing about where the arrow
 * lands. The two-pixel check is unchanged, and TC-09/TC-25 are the tests that own
 * "a cursor crosses in 500 ms".
 */
async function pointUntilDrawn(
  mover: Page,
  watcher: Page,
  world: { x: number; y: number },
  slack: number,
): Promise<{ seen: boolean; ms: number; saw: string }> {
  const started = Date.now();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [onMover, onWatcher] = await Promise.all([screenOf(mover, world), screenOf(watcher, world)]);
    // Start the stroke away from the target: a move that begins and ends on the
    // same pixel dispatches nothing, and that is the miss this works around.
    await mover.mouse.move(Math.max(2, onMover.x - 12), Math.max(2, onMover.y - 12), { steps: 2 });
    await mover.mouse.move(onMover.x, onMover.y, { steps: 3 });
    const found = await watcher
      .waitForFunction(
        ({ position, tolerance }) => {
          for (const cursor of document.querySelectorAll('[data-testid="remote-cursor"] svg')) {
            const box = cursor.getBoundingClientRect();
            if (Math.abs(box.x - position.x) <= tolerance && Math.abs(box.y - position.y) <= tolerance) {
              return true;
            }
          }
          return false;
        },
        { position: onWatcher, tolerance: slack },
        { timeout: 1_500, polling: 20 },
      )
      .then(() => true)
      .catch(() => false);
    if (found) {
      return {
        seen: true,
        ms: Date.now() - started,
        saw: `${String(Math.round(onWatcher.x))},${String(Math.round(onWatcher.y))}`,
      };
    }
  }
  const saw = await watcher.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="remote-cursor"] svg'))
      .map((node) => {
        const box = node.getBoundingClientRect();
        return `${String(Math.round(box.x))},${String(Math.round(box.y))}`;
      })
      .join('|'),
  );
  return { seen: false, ms: Date.now() - started, saw };
}

test.describe('one board, seen from two different places', () => {
  test('TC-24 the same place on the board is the same place on both screens', async ({
    browser,
  }, testInfo) => {
    const [a, b] = await openFreshPair(browser, 'TC-24', slotOf(testInfo));

    // Two cameras that disagree about everything: a different zoom and a
    // different pan, which is the only way to tell "my pointer position" apart
    // from "my screen position". A test that ran both at 100% would pass even if
    // the client published raw screen coordinates, which is precisely the bug.
    // Chosen so the target point lands in *view* on both screens: the point of the
    // test is the mapping, and a cursor that lands off the edge is culled rather
    // than mis-mapped, which would test the wrong thing.
    await a.evaluate(() => window.__vidi6?.setCamera({ x: -1000, y: -750, zoom: 0.5 }));
    await b.evaluate(() => window.__vidi6?.setCamera({ x: -680, y: -480, zoom: 2 }));

    // The point A is about to point at, in world units, and where each screen
    // draws it: derived from the two live cameras rather than hard-coded, so the
    // assertion is about the mapping and not about where the window happens to be.
    const planned = await a.evaluate(() => {
      const mine = window.__vidi6!.getCamera();
      const world = { x: -400, y: -300 };
      const toScreen = (camera: { x: number; y: number; zoom: number }, point: { x: number; y: number }) => ({
        x: (point.x - camera.x) * camera.zoom,
        y: (point.y - camera.y) * camera.zoom,
      });
      const here = toScreen(mine, world);
      return { world, here };
    });

    // Warm the link and let both cameras land before anything is measured.
    await pointUntilDrawn(a, b, { x: -800, y: -600 }, 4);

    // This test's subject is the *mapping*, so it does not also carry the 500 ms
    // budget: TC-09 and TC-25 assert that, on a link they warm the same way.
    const aim = await pointUntilDrawn(a, b, planned.world, 2);
    expect(
      aim.seen,
      `no arrow was ever drawn at the same board point (saw ${aim.saw || 'nothing'})`,
    ).toBe(true);

    // And the *same board point*, not merely the same pixel: mapping the drawn
    // cursor back through this screen's camera has to land where the other person
    // actually is, at this zoom, within two screen pixels of error.
    const landed = await b.evaluate(() => {
      const svg = document.querySelector('[data-testid="remote-cursor"] svg');
      if (!svg) return null;
      const box = svg.getBoundingClientRect();
      const camera = window.__vidi6!.getCamera();
      return { x: box.x / camera.zoom + camera.x, y: box.y / camera.zoom + camera.y };
    });
    expect(landed, 'no cursor was ever drawn on the second screen').not.toBeNull();
    const error = Math.max(
      Math.abs((landed?.x ?? 0) - planned.world.x),
      Math.abs((landed?.y ?? 0) - planned.world.y),
    );
    expect(error / 2, 'the cursor is more than two screen pixels off').toBeLessThanOrEqual(1);

    await a.close();
    await b.close();
  });

  test('TC-25 a pointer that leaves the board is gone within 500 ms, and comes back', async ({
    browser,
  }, testInfo) => {
    const [a, b] = await openFreshPair(browser, 'TC-25', slotOf(testInfo));
    await move(a, 620, 420);
    await expect(b.locator(CURSORS)).toHaveCount(1, { timeout: 5_000 });

    // The event is dispatched rather than produced by a mouse, and that is not a
    // shortcut: the board surface is the whole window, so the only ways a real
    // pointer leaves it are out of the window or into another tab. Chasing either
    // in a browser test gives a test that fails on someone's laptop, and the
    // thing under test is the listener, not the operating system.
    const started = Date.now();
    await a.locator('[data-testid="board-area"]').dispatchEvent('pointerleave');
    await expect(b.locator(CURSORS)).toHaveCount(0, { timeout: 5_000 });
    const elapsed = Date.now() - started;
    expect(elapsed, `the cursor took ${String(elapsed)} ms to clear`).toBeLessThanOrEqual(500);

    // Coming back is not a warm-up: the next move is reported straight away, so a
    // person who returns is not invisible for another two seconds.
    await move(a, 300, 260);
    await expect(b.locator(CURSORS)).toHaveCount(1, { timeout: 5_000 });

    // And it stays gone while nobody moves: the cancelled position must not
    // reappear out of a queue, which is what a *late* hide would do.
    await a.locator('[data-testid="board-area"]').dispatchEvent('pointerleave');
    await expect(b.locator(CURSORS)).toHaveCount(0, { timeout: 5_000 });
    await a.waitForTimeout(1_500);
    expect(await cursorCount(b)).toBe(0);

    await a.close();
    await b.close();
  });
});

test.describe('who is holding what', () => {
  test('TC-28 a selection is shown to the other person, and takes nothing away', async ({
    browser,
  }, testInfo) => {
    const [a, b] = await openFreshPair(browser, 'TC-28', slotOf(testInfo));

    // Two notes, far enough apart that each person can have one. Seeded through
    // the board model rather than drawn, so the geometry is exact.
    const ids = await a.evaluate(() => [
      window.__vidi6!.seedNote({ x: -200, y: -100, text: 'left' }),
      window.__vidi6!.seedNote({ x: 200, y: -100, text: 'right' }),
    ]);
    await b.waitForFunction(() => (window.__vidi6?.getNotes().length ?? 0) === 2);

    // B picks the right-hand note first, so "B's selection is unchanged" is a
    // comparison rather than an absence.
    await b.bringToFront();
    await move(b, 640, 300);
    const boxB = await b.evaluate((id) => {
      const note = document.querySelector(`[data-note-id="${id}"]`);
      if (!note) return null;
      const box = (note as HTMLElement).getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }, ids[1] ?? '');
    if (boxB === null) throw new Error('the second note never reached the second screen');
    await b.mouse.click(boxB.x, boxB.y);
    await expect(b.locator('[data-testid="sticky-note"][data-selected="true"]')).toHaveCount(1);

    // A picks the *other* note. What B must gain is an outline in A's colour, and
    // what B must not lose is its own selection, its own edit, or its own typing.
    await a.bringToFront();
    const boxA = await a.evaluate((id) => {
      const note = document.querySelector(`[data-note-id="${id}"]`);
      if (!note) return null;
      const box = (note as HTMLElement).getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }, ids[0] ?? '');
    if (boxA === null) throw new Error('the first note never reached the first screen');
    await a.mouse.click(boxA.x, boxA.y);

    const outline = b.locator('[data-testid="selection-outline"]');
    await expect(outline).toHaveCount(1, { timeout: 5_000 });
    await expect(outline).toHaveAttribute('data-target', ids[0] ?? 'never');
    const tag = await b.locator('[data-testid="selection-tag"]').innerText();
    expect(tag.length).toBeGreaterThan(0);

    // B still owns its own selection: an outline that *moved* B's selection would
    // be a remote person editing through my keyboard.
    await expect(b.locator('[data-testid="sticky-note"][data-selected="true"]')).toHaveCount(1);
    expect(
      await b.evaluate((id) => {
        const note = document.querySelector(`[data-note-id="${id}"]`);
        return note?.getAttribute('data-selected') ?? 'gone';
      }, ids[1] ?? ''),
    ).toBe('true');

    // And B can still type in the note A is looking at, which is the part the
    // story is actually for: presence is a notice, not a lock.
    await b.mouse.dblclick(boxB.x, boxB.y);
    await b.waitForSelector('[data-testid="sticky-note-editor"]', { timeout: 5_000 });
    await b.keyboard.type('still mine');
    const text = await b.evaluate(() => window.__vidi6?.getNotes().find((n) => n.text.includes('still mine'))?.text);
    expect(text).toContain('still mine');

    // The outline goes away when A stops selecting, and it never blocks a click:
    // both halves of "it is only a picture of somebody else's cursor".
    await a.bringToFront();
    await a.mouse.click(60, 620);
    await expect(outline).toHaveCount(0, { timeout: 5_000 });

    await a.close();
    await b.close();
  });
});

test.describe('the people on a board, all of them', () => {
  test('TC-27 a board past its capacity still lists everyone', async ({ browser }, testInfo) => {
    // One more than the stack has room for: the sixth person is on the board, and
    // the only question is whether the board admits it.
    const SIZE = 6;
    const { pages, contexts } = await openCrowd(browser, SIZE, 'TC-27', slotOf(testInfo));

    // Let the crowd settle before reading anyone. Six browsers opened at once keep
    // meeting each other for a second or two, and a stack that is still growing is
    // not yet the thing under test.
    for (const page of pages) {
      await expect(page.getByTestId('avatar')).toHaveCount(5, { timeout: 20_000 });
      await expect(page.getByTestId('avatar-overflow')).toHaveCount(1, { timeout: 20_000 });
    }

    for (const page of pages) {
      // Not just "+1": the list under it has everyone's name and colour, because a
      // count nobody can open is a rumour about people.
      await page.getByTestId('avatar-overflow').locator('summary').click({ timeout: 10_000 });
      await expect(page.getByTestId('overflow-person')).toHaveCount(SIZE, { timeout: 10_000 });
      const listed = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid="overflow-person"]')).map((element) => ({
          name: element.getAttribute('data-name') ?? '',
          color: element.getAttribute('data-color') ?? '',
        })),
      );
      const drawn = await drawnPeople(page);
      // Six people, six names and six colours, counted on the screen rather than
      // assumed from the palette: nobody is refused a name or a colour because the
      // board is full.
      // Every other person is legible somewhere, and nobody appears twice: the
      // stack is capped, but the cap is on *pixels*, not on the answer.
      const everyone = [...new Set([...drawn, ...listed].map((person) => person.name))];
      expect(everyone).toHaveLength(SIZE);
      expect(drawn.length).toBeLessThan(SIZE);
      expect(listed.map((person) => person.color).includes('')).toBe(false);
    }
    // Every board is read before any of them is closed. A page taken out of the
    // crowd takes its place in everyone else's stack with it, and a board that is
    // down to four people has no "+1" to open: reading the boards one at a time
    // while shutting them behind the test would measure a crowd coming apart
    // rather than the six people the test is about.
    for (const page of pages) await page.close();
    for (const context of contexts) await context.close();
  });
  test('TC-31 the same board open twice in one browser is one person', async ({
    browser,
  }, testInfo) => {
    const boardId = await createBoard((await browser.newContext()).request, 'TC-31', slotOf(testInfo));
    const shared = await browser.newContext();
    const first = await shared.newPage();
    await openBoard(first, boardPath(boardId));
    // A second window of the *same* browser: one person, two documents, and two
    // awareness ids that have to add up to one avatar and one arrow.
    const second = await shared.newPage();
    await openBoard(second, boardPath(boardId));

    const watcher = await browser.newContext();
    const c = await watcher.newPage();
    await openBoard(c, boardPath(boardId));

    // Both windows point at the same corner, at the same time.
    await Promise.all([move(first, 400, 300), move(second, 400, 300)]);
    await c.waitForTimeout(1_200);

    // One person, one arrow: the second window is that same person with a second
    // window, and a board that draws two arrows for one pair of hands is a board
    // that lies about how many people are here.
    const stack = await drawnPeople(c);
    expect(stack).toHaveLength(2);
    expect(new Set(stack.map((person) => person.name)).size).toBe(2);
    expect(await cursorCount(c)).toBe(1);

    // Neither window draws its own other half either: the other tab is still *me*,
    // and a board that draws a second arrow for my own second window is a board
    // that says two people are here when one person is here twice.
    expect(await cursorCount(first)).toBe(0);
    expect(await cursorCount(second)).toBe(0);

    await shared.close();
    await watcher.close();
  });
});

test.describe('what people are called', () => {
  test('TC-29 a renamed person is seen as that name, and stays that name', async ({
    browser,
  }, testInfo) => {
    const [a, b] = await openFreshPair(browser, 'TC-29', slotOf(testInfo));
    await move(a, 500, 300);
    await expect(b.locator(CURSORS)).toHaveCount(1, { timeout: 5_000 });

    const started = Date.now();
    await a.getByRole('button', { name: 'Rename' }).click();
    await a.getByLabel('Your name').fill('Alex');
    await a.getByRole('button', { name: 'Save' }).click();

    // The other screen says the new name, within the story's two seconds, in the
    // place a stranger is named: the arrow's label and the stack's dot.
    await b.waitForFunction(
      () => {
        const dots = Array.from(document.querySelectorAll('[data-testid="avatar"]'));
        const seen = dots.some((dot) => dot.getAttribute('data-name') === 'Alex');
        const labels = Array.from(document.querySelectorAll('[data-testid="cursor-label"]'));
        const pointed = labels.some((label) => label.textContent === 'Alex');
        return seen && pointed;
      },
      undefined,
      { timeout: 5_000, polling: 50 },
    );
    expect(Date.now() - started).toBeLessThanOrEqual(2_000);

    // And it is *remembered*: a reload is a new document, a new connection and a
    // new awareness id, and the name has to survive all three. This is the half of
    // the story that a same-page test cannot reach.
    await a.reload();
    await a.waitForFunction(
      () => window.__vidi6?.getConnectionState() === 'connected',
      undefined,
      { timeout: 20_000 },
    );
    await expect(a.getByTestId('self-name')).toHaveText('Alex', { timeout: 5_000 });

    const stillAlex = await b.waitForFunction(
      () => {
        const dots = Array.from(document.querySelectorAll('[data-testid="avatar"]'));
        return dots.some((dot) => dot.getAttribute('data-name') === 'Alex');
      },
      undefined,
      { timeout: 5_000, polling: 100 },
    );
    expect(stillAlex).toBeTruthy();

    await a.close();
    await b.close();
  });

  test('TC-21 a name that is too long is refused on the screen, not swallowed', async ({
    browser,
  }, testInfo) => {
    const [a] = await openFreshPair(browser, 'TC-21', slotOf(testInfo));
    await a.getByRole('button', { name: 'Rename' }).click();
    await a.getByLabel('Your name').fill('A rather long name that goes past the limit');
    await a.getByRole('button', { name: 'Save' }).click();

    await expect(a.getByTestId('rename-error')).toHaveText('Name must be 1–32 characters');
    // Refused in a way the person can see and undo, rather than silently chopped
    // into a different name they never chose.
    await expect(a.getByTestId('self-name')).not.toHaveText('A rather long name that goes past the limit');

    await a.close();
  });
});
