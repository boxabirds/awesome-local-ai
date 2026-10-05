/**
 * Story 3 end-to-end: several people, one board, real browsers.
 *
 * These are the only tests that go through the whole serving path — the built
 * client, `wrangler dev`, the Durable Object room, Yjs in two browsers — so they are
 * also the only place where "Alex's edit appears on Sam's screen" is checked as a
 * user experiences it. Everything waits rather than sleeps, and every wait is timed
 * and reported against the latency budget at the end of the test.
 *
 * TC-24 to TC-28 run in chromium only. They check the room and the merge, which are
 * the same code in every browser, and TC-26 alone needs `MAX_CONCURRENT_EDITORS`
 * contexts; running all of them on three engines would slow the suite without
 * covering anything the engines differ on. TC-22 and TC-23 — editing the same note
 * at the same moment — run wherever a browser does.
 */

import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  CATCH_UP_TEST_OUTAGE_MS,
  CONNECTED_CONFIRMATION_MS,
  MAX_CONCURRENT_EDITORS,
  RECONNECT_MAX_BACKOFF_MS
} from '../../src/shared/config';
import {
  deleteButton,
  doubleClickBoard,
  dragNote,
  note,
  noteToolbar,
  setCamera,
  swatch
} from './helpers/board';
import {
  boardOf,
  closeSessions,
  connectionOf,
  domOf,
  openSession,
  positionOf,
  takeLinkAway,
  type Session
} from './helpers/participants';

/** Sessions opened by the running test, so nothing leaks when one fails. */
const sessions: Session[] = [];

test.afterEach(async () => {
  await closeSessions(sessions);
});

async function withPeople(browser: Browser, ...names: string[]): Promise<Session> {
  const session = await openSession(browser, names);
  sessions.push(session);
  return session;
}

/** A chromium-only case, for the reasons in the header. */
function chromiumOnly(testInfo: { project: { name: string } }): void {
  test.skip(
    testInfo.project.name !== 'chromium',
    'the room and the merge are browser-independent, and this case is expensive'
  );
}

/** The nth note's text, as one board holds it. */
async function textOn(page: Page, index: number): Promise<string> {
  const notes = (await boardOf(page)) as { text: string }[];
  return notes[index]?.text ?? '';
}

/** The nth note's id. */
async function idOn(page: Page, index: number): Promise<string> {
  const notes = (await boardOf(page)) as { id: string }[];
  return notes[index]?.id ?? '';
}

/** Make a note and leave it alone: typed text is optional. */
async function createNote(page: Page, x: number, y: number, text = ''): Promise<void> {
  await doubleClickBoard(page, x, y);
  if (text) await page.keyboard.type(text);
  await page.mouse.click(140, 660);
}

/** Click a note and start typing in it. */
async function startEditing(page: Page, index: number): Promise<void> {
  await note(page, index).click();
  await page.keyboard.press('Enter');
  await expect(stickyInputOf(page)).toBeFocused();
}

function stickyInputOf(page: Page) {
  return page.locator('[data-testid="sticky-input"]');
}

/** What `wanted` holds that `merged` is short of, letter by letter. */
function missingLetters(wanted: string, merged: string): string {
  const have = new Map<string, number>();
  for (const character of merged) have.set(character, (have.get(character) ?? 0) + 1);
  const need = new Map<string, number>();
  for (const character of wanted) need.set(character, (need.get(character) ?? 0) + 1);
  const short: string[] = [];
  for (const [character, count] of need) {
    const got = have.get(character) ?? 0;
    if (got < count) short.push(`${character.repeat(count - got)}`);
  }
  return short.join('');
}

test('TC-22: everything Alex does appears on Sam board', async ({ browser }) => {
  const session = await withPeople(browser, 'alex', 'sam');
  const alex = session.person('alex').page;
  const sam = session.person('sam').page;

  await createNote(alex, 500, 350);
  await session.eventually('the new note appears for Sam', async () => {
    const notes = await boardOf(sam);
    return notes.length === 1 || `Sam holds ${notes.length} note(s)`;
  });

  await startEditing(alex, 0);
  await alex.keyboard.type('quarterly planning');
  await alex.mouse.click(140, 660);
  await session.eventually('the typed words appear for Sam', async () =>
    (await textOn(sam, 0)) === 'quarterly planning' || `Sam reads ${JSON.stringify(await textOn(sam, 0))}`
  );

  await note(alex, 0).click();
  await swatch(alex, 'blue', 0).click();
  await session.eventually('the new colour appears for Sam', async () => {
    const notes = (await boardOf(sam)) as { color: string }[];
    return notes[0]?.color === 'blue' || `Sam sees ${notes[0]?.color}`;
  });

  const id = await idOn(sam, 0);
  const before = await positionOf(sam, id);
  await dragNote(alex, 0, 160, 90);
  await session.eventually('the move appears for Sam', async () => {
    const after = await positionOf(sam, id);
    if (!after || !before) return 'the note has gone missing';
    return after.x !== before.x || after.y !== before.y || `Sam still sees ${JSON.stringify(after)}`;
  });

  await note(alex, 0).click();
  await deleteButton(alex, 0).click();
  await session.eventually('the note disappearing appears for Sam', async () => {
    const notes = await boardOf(sam);
    return notes.length === 0 || `Sam still holds ${notes.length} note(s)`;
  });

  expect(session.person('alex').errors).toEqual([]);
  expect(session.person('sam').errors).toEqual([]);
  session.report();
});

test('TC-23: both typing into one note at the same time leaves one text with every character', async ({ browser }) => {
  const session = await withPeople(browser, 'alex', 'sam');
  const alex = session.person('alex').page;
  const sam = session.person('sam').page;

  await createNote(alex, 520, 330, 'goals');
  await session.eventually('the note reaches Sam', async () => (await textOn(sam, 0)) === 'goals');

  await startEditing(alex, 0);
  await startEditing(sam, 0);

  // At the same time, in both browsers.
  await Promise.all([alex.keyboard.type(' shipped'), sam.keyboard.type(' learned')]);
  await alex.mouse.click(140, 660);
  await sam.mouse.click(140, 660);

  await session.eventually('one text holding every typed character, on both boards', async () => {
    const mine = await textOn(alex, 0);
    const yours = await textOn(sam, 0);
    if (mine !== yours) return `Alex reads ${JSON.stringify(mine)}, Sam reads ${JSON.stringify(yours)}`;
    const short = missingLetters('goals shipped learned', mine);
    return short === '' || `${JSON.stringify(mine)} is short of ${JSON.stringify(short)}`;
  });

  expect(session.person('alex').errors).toEqual([]);
  expect(session.person('sam').errors).toEqual([]);
  session.report();
});

test('TC-24: both dragging the same note at once leaves one settled position', async ({ browser }, testInfo) => {
  chromiumOnly(testInfo);
  const session = await withPeople(browser, 'alex', 'sam');
  const alex = session.person('alex').page;
  const sam = session.person('sam').page;

  await createNote(alex, 520, 330, 'to move');
  await session.eventually('the note reaches Sam', async () => (await textOn(sam, 0)) === 'to move');

  const id = await idOn(sam, 0);
  const start = await positionOf(sam, id);
  if (!start) throw new Error('the note to drag is not on the board');

  // Both grab it and pull it their own way, at the same time.
  await Promise.all([dragNote(alex, 0, 180, 70), dragNote(sam, 0, -140, 120)]);

  let settled: { x: number; y: number } | null = null;
  await session.eventually('both boards settle on one position', async () => {
    const mine = await positionOf(alex, id);
    const yours = await positionOf(sam, id);
    if (!mine || !yours) return 'the note has gone missing';
    if (mine.x !== yours.x || mine.y !== yours.y) {
      return `Alex holds (${mine.x}, ${mine.y}), Sam holds (${yours.x}, ${yours.y})`;
    }
    settled = mine;
    return true;
  });

  // One position, and not the one it started at.
  expect(settled).not.toEqual(start);
  expect(session.person('alex').errors).toEqual([]);
  expect(session.person('sam').errors).toEqual([]);
  session.report();
});

test('TC-25: a note deleted by somebody else closes the editor typing into it', async ({ browser }, testInfo) => {
  chromiumOnly(testInfo);
  const session = await withPeople(browser, 'alex', 'sam');
  const alex = session.person('alex').page;
  const sam = session.person('sam').page;

  await createNote(alex, 520, 330);
  await session.eventually('the note reaches Sam', async () => (await boardOf(sam)).length === 1);

  // Sam is in the middle of typing when Alex bins it.
  await startEditing(sam, 0);
  await sam.keyboard.type('but the point was');
  await expect(stickyInputOf(sam)).toBeFocused();

  await note(alex, 0).click();
  await deleteButton(alex, 0).click();

  await session.eventually("Sam loses the note and the editor with it", async () => {
    const notes = await boardOf(sam);
    if (notes.length !== 0) return `Sam still holds ${notes.length} note(s)`;
    const editors = await stickyInputOf(sam).count();
    return editors === 0 || `Sam is still typing into ${editors} editor(s)`;
  });

  // The board is not stuck: Sam can carry on, and Alex sees it.
  await createNote(sam, 700, 420, 'carry on');
  await session.eventually('Alex sees Sam carry on', async () => (await textOn(alex, 0)) === 'carry on');

  expect(session.person('alex').errors).toEqual([]);
  expect(session.person('sam').errors).toEqual([]);
  session.report();
});

test('TC-26: at full capacity every change reaches everyone, and the boards end up identical', async ({ browser }, testInfo) => {
  chromiumOnly(testInfo);
  test.setTimeout(240_000);
  const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_unused, index) => `editor${index}`);
  const session = await withPeople(browser, ...names);

  // Each editor works in their own part of the board, so that a double-click lands
  // on empty space rather than on somebody else's note.
  await Promise.all(
    names.map(async (name, index) => {
      const page = session.person(name).page;
      await setCamera(page, { x: index * 4000, y: 0, zoom: 1 });
      for (let noteIndex = 0; noteIndex < 5; noteIndex += 1) {
        const x = 250 + (noteIndex % 3) * 300;
        const y = 200 + Math.floor(noteIndex / 3) * 300;
        await createNote(page, x, y, `${name}-${noteIndex}`);
      }
    })
  );

  const created = MAX_CONCURRENT_EDITORS * 5;
  await session.eventually(`all ${names.length} boards hold ${created} notes`, async () => {
    for (const person of session.people) {
      const notes = await boardOf(person.page);
      if (notes.length !== created) return `${person.name} holds ${notes.length}`;
    }
    return true;
  });

  // Then each editor moves their own five notes.
  await Promise.all(
    names.map(async (name) => {
      const page = session.person(name).page;
      for (let index = 0; index < created; index += 1) {
        await dragNote(page, index, 30, 20);
      }
      // Clicking empty space clears the local selection, so the boards can be
      // compared as pictures and not as somebody's cursor.
      await page.mouse.click(140, 660);
    })
  );

  await session.eventually('every board ends up identical', async () => {
    const first = await domOf(session.people[0].page);
    for (const person of session.people) {
      const mine = await domOf(person.page);
      if (mine !== first) return `${person.name} differs from ${session.people[0].name}`;
    }
    return true;
  });

  for (const person of session.people) expect(person.errors).toEqual([]);
  session.report();
});

test('TC-27: everything typed during an outage arrives when the link comes back', async ({ browser }, testInfo) => {
  chromiumOnly(testInfo);
  test.setTimeout(CATCH_UP_TEST_OUTAGE_MS + 240_000);
  const session = await withPeople(browser, 'alex', 'sam');
  const alex = session.person('alex');
  const sam = session.person('sam').page;

  // Alex loses the link, and keeps trying to get it back.
  const giveLinkBack = await takeLinkAway(alex.page, { refuseReconnects: true });

  // Both carry on working, unaware of each other.
  for (let index = 0; index < 3; index += 1) {
    await createNote(alex.page, 300 + index * 260, 240, `offline-${index}`);
  }
  for (let index = 0; index < 3; index += 1) {
    await createNote(sam, 300 + index * 260, 500, `online-${index}`);
  }

  await session.eventually('Alex is told the link has gone', async () => {
    const state = await connectionOf(alex.page);
    return state === 'reconnecting' || `Alex reports ${state}`;
  });

  // The two boards have drifted apart, which is the whole difficulty.
  await session.eventually("Alex holds only Alex's three notes", async () => {
    const mine = await boardOf(alex.page);
    return mine.length === 3 || `Alex holds ${mine.length}`;
  });
  await session.eventually("Sam holds only Sam's three notes", async () => {
    const yours = await boardOf(sam);
    return yours.length === 3 || `Sam holds ${yours.length}`;
  });

  // Stay out of contact for the outage the settings describe, so that coming back
  // happens on the real reconnect schedule rather than on the first retry.
  await alex.page.waitForTimeout(CATCH_UP_TEST_OUTAGE_MS);

  // The link comes back.
  await giveLinkBack();

  await session.eventually('both boards hold all six notes', async () => {
    const mine = await boardOf(alex.page);
    const yours = await boardOf(sam);
    if (mine.length !== 6 || yours.length !== 6) {
      return `Alex holds ${mine.length}, Sam holds ${yours.length}`;
    }
    const onAlex = new Set(mine.map((held) => (held as { text: string }).text));
    for (const wanted of ['offline-0', 'offline-1', 'offline-2', 'online-0', 'online-1', 'online-2']) {
      if (!onAlex.has(wanted)) return `${wanted} never arrived on Alex board`;
    }
    return true;
  });

  // And the badge says Connected, then gets out of the way.
  const badge = alex.page.locator('[data-vidi6="connection-status"]');
  await expect
    .poll(() => badge.textContent().catch(() => null), {
      message: 'Alex should be told the link is back',
      timeout: RECONNECT_MAX_BACKOFF_MS + 15_000
    })
    .toBe('Connected');
  await expect(badge, 'and then the badge gets out of the way').toBeHidden({
    timeout: CONNECTED_CONFIRMATION_MS + 15_000
  });

  expect(session.person('alex').errors).toEqual([]);
  expect(session.person('sam').errors).toEqual([]);
  session.report();
});

test('TC-28: one person selection and editor stay on their own screen', async ({ browser }, testInfo) => {
  chromiumOnly(testInfo);
  const session = await withPeople(browser, 'alex', 'sam');
  const alex = session.person('alex').page;
  const sam = session.person('sam').page;

  await createNote(alex, 520, 330, 'shared text');
  await session.eventually('the note reaches Sam', async () => (await textOn(sam, 0)) === 'shared text');

  // Alex selects the note and is typing in it right now.
  await startEditing(alex, 0);
  await alex.keyboard.type(' and then some');
  await expect(stickyInputOf(alex)).toBeFocused();

  // Sam sees the text, and nothing of how Alex is looking at it.
  await session.eventually("Sam's copy of the text", async () =>
    (await textOn(sam, 0)).length > 'shared text'.length ||
    `Sam reads ${JSON.stringify(await textOn(sam, 0))}`
  );
  await expect(note(sam, 0)).toHaveAttribute('data-selected', 'false');
  await expect(stickyInputOf(sam)).toHaveCount(0);
  await expect(noteToolbar(sam, 0)).toHaveCount(0);

  expect(session.person('alex').errors).toEqual([]);
  expect(session.person('sam').errors).toEqual([]);
  session.report();
});
