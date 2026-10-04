/**
 * Story 3 end to end: two (then five) people in separate browser contexts on the
 * same board URL, watching each other work.
 *
 * TC-22 every kind of change reaches the other screen · TC-23 simultaneous typing
 * keeps every character · TC-24 simultaneous drags settle on one position ·
 * TC-25 a delete while someone is typing in the note ends cleanly everywhere ·
 * TC-26 `MAX_CONCURRENT_EDITORS` people on one board all see everything ·
 * TC-27 an outage: local edits wait, both screens catch up, the badge narrates ·
 * TC-28 selection and editing stay on your own screen.
 *
 * Latency is logged against LIVE_UPDATE_LATENCY_BUDGET_MS and never asserted (one
 * shared machine runs the server, the browsers and the tests); waits use
 * E2E_EVENTUAL_TIMEOUT_MS.
 */

import {
  badge,
  boardJson,
  changeArrives,
  createNoteAt,
  deleteNoteViaToolbar,
  recolourNote,
  expect,
  expectNoErrors,
  openBoardAs,
  startEditingNote,
  test,
  type Participant,
} from './helpers/live';
import type { Page } from '@playwright/test';
import { setCamera, VIEWPORT_SIZE, type Pixel } from './helpers/board';
import {
  createNoteByDblClick,
  dragPointer,
  endEditing,
  getNotes,
  noteBoxes,
  typeIntoEditor,
  type NoteBox,
} from './helpers/notes';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  STICKY_COLORS,
} from '../../src/shared/config';
import { seededRandom, WORDS } from '../fixtures/random-ops';

const PEOPLE = ['Ana', 'Bo', 'Cy', 'Di', 'Eli', 'Fay', 'Gus'];

function centre(box: NoteBox): Pixel {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A camera that puts a world point in the middle of the screen at `zoom`. */
function centredOn(worldX: number, worldY: number, zoom: number) {
  return {
    x: worldX - VIEWPORT_SIZE.width / (2 * zoom),
    y: worldY - VIEWPORT_SIZE.height / (2 * zoom),
    zoom,
  };
}

test('the home page offers a board, and taking it opens one', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('A shared board for thinking together')).toBeVisible();
  await page.getByTestId('new-board-button').click();
  await expect(page).toHaveURL(/\/b\/[A-Za-z0-9_-]{22}$/);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  // The board is empty and in sync, so there is nothing to report.
  await expect(badge(page)).toHaveCount(0);
});

test('TC-22: create, type, recolour, move and delete all reach the other person', async ({
  liveBoards,
}) => {
  const { people } = await liveBoards.open([PEOPLE[0]!, PEOPLE[1]!]);
  const [alex, sam] = people;

  let id = '';
  await changeArrives(
    'TC-22 create',
    async () => {
      id = await createNoteByDblClick(alex.page, { x: 520, y: 380 });
    },
    async () => (await noteOn(sam.page, id)) !== undefined,
  );

  await changeArrives(
    'TC-22 text',
    () => typeIntoEditor(alex.page, 'shared text'),
    async () => (await noteOn(sam.page, id))?.text === 'shared text',
  );
  await endEditing(alex.page);

  await changeArrives(
    'TC-22 recolour',
    () => alex.page.getByRole('button', { name: 'Green colour' }).click(),
    async () => (await noteOn(sam.page, id))?.color === 'green',
  );

  const worldBefore = (await noteOn(alex.page, id))!;
  const from = centre((await noteBoxes(alex.page))[id]!);
  await changeArrives(
    'TC-22 move',
    () => dragPointer(alex.page, from, { x: from.x + 120, y: from.y + 60 }),
    async () => {
      const moved = await noteOn(sam.page, id);
      return moved !== undefined && moved.x - worldBefore.x > 100 && moved.y - worldBefore.y > 40;
    },
  );

  await changeArrives(
    'TC-22 delete',
    () => alex.page.getByRole('button', { name: 'Delete note' }).click(),
    async () => (await getNotes(sam.page)).length === 0,
  );

  expectNoErrors(people);
});

test('TC-23: both people typing in one note keep every character', async ({ liveBoards }) => {
  const { people } = await liveBoards.open([PEOPLE[0]!, PEOPLE[1]!]);
  const [alex, sam] = people;

  let id = '';
  await changeArrives(
    'TC-23 create',
    async () => {
      id = await createNoteByDblClick(alex.page, { x: 520, y: 380 });
    },
    async () => (await noteOn(sam.page, id)) !== undefined,
  );

  // Sam starts editing the same note, so both cursors are inside it at once.
  await sam.page.locator(`[data-note-id="${id}"]`).dblclick();
  await expect(sam.page.locator(`[data-note-id="${id}"] textarea`)).toBeVisible();

  const typedByAlex = 'alex was here ';
  const typedBySam = 'sam was here ';
  const everyCharacter = [...(typedByAlex + typedBySam)].sort().join('');

  // Neither waits for the other.
  await Promise.all([alex.page.keyboard.type(typedByAlex), sam.page.keyboard.type(typedBySam)]);

  let textOnAlex = '';
  let textOnSam = '';
  try {
    await expect
      .poll(
        async () => {
          textOnAlex = (await noteOn(alex.page, id))?.text ?? '';
          textOnSam = (await noteOn(sam.page, id))?.text ?? '';
          return [...textOnAlex].sort().join('') === everyCharacter && textOnSam === textOnAlex;
        },
        { timeout: 15_000, message: 'concurrent typing did not merge into the same text' },
      )
      .toBe(true);
  } catch (error) {
    const counts = {
      alex: (await getNotes(alex.page)).map((note) => `${note.id}:${JSON.stringify(note.text)}`),
      sam: (await getNotes(sam.page)).map((note) => `${note.id}:${JSON.stringify(note.text)}`),
    };
    throw new Error(
      `${(error as Error).message}\nalex says ${JSON.stringify(textOnAlex)}\n` +
        `sam says  ${JSON.stringify(textOnSam)}\nboards: ${JSON.stringify(counts)}`,
    );
  }

  expectNoErrors(people);
});

test('TC-24: both people dragging the same note settle on one position', async ({ liveBoards }) => {
  const { people } = await liveBoards.open([PEOPLE[0]!, PEOPLE[1]!]);
  const [alex, sam] = people;

  let id = '';
  await changeArrives(
    'TC-24 create',
    async () => {
      id = await createNoteByDblClick(alex.page, { x: 520, y: 380 });
    },
    async () => (await noteOn(sam.page, id)) !== undefined,
  );
  await endEditing(alex.page);

  const from = centre((await noteBoxes(alex.page))[id]!);
  const started = Date.now();
  // Each drags it somewhere else, without waiting for the other.
  await Promise.all([
    dragPointer(alex.page, from, { x: from.x - 180, y: from.y - 90 }),
    dragPointer(sam.page, from, { x: from.x + 180, y: from.y + 90 }),
  ]);

  let settled = { x: 0, y: 0 };
  await expect
    .poll(
      async () => {
        const onAlex = await noteOn(alex.page, id);
        const onSam = await noteOn(sam.page, id);
        if (!onAlex || !onSam || onAlex.x !== onSam.x || onAlex.y !== onSam.y) return false;
        settled = { x: onAlex.x, y: onAlex.y };
        return true;
      },
      { timeout: 15_000, message: 'the two screens never agreed on where the note is' },
    )
    .toBe(true);
  console.log(
    `TC-24: both screens agree on (${settled.x}, ${settled.y}) ` +
      `${Date.now() - started} ms after the drags started`,
  );

  expectNoErrors(people);
});

test('TC-25: a note deleted while the other person is typing is gone on both screens', async ({
  liveBoards,
}) => {
  const { people } = await liveBoards.open([PEOPLE[0]!, PEOPLE[1]!]);
  const [alex, sam] = people;

  let id = '';
  await changeArrives(
    'TC-25 create',
    async () => {
      id = await createNoteByDblClick(alex.page, { x: 520, y: 380 });
    },
    async () => (await noteOn(sam.page, id)) !== undefined,
  );

  // Sam is typing in it when Alex deletes it.
  await sam.page.locator(`[data-note-id="${id}"]`).dblclick();
  await typeIntoEditor(sam.page, 'still typing here');
  await expect(sam.page.locator(`[data-note-id="${id}"] textarea`)).toBeVisible();

  await endEditing(alex.page);
  await alex.page.keyboard.press('Delete');

  // Sam's note and its editor disappear; nobody is left with a phantom, and no
  // error is shown or logged.
  await expect(sam.page.locator(`[data-note-id="${id}"]`)).toHaveCount(0);
  await expect(sam.page.locator('textarea')).toHaveCount(0);
  await expect.poll(async () => (await getNotes(sam.page)).length).toBe(0);
  await expect.poll(async () => (await getNotes(alex.page)).length).toBe(0);

  expectNoErrors(people);
});

test('TC-26: five people on one board see every one of each other’s changes', async ({
  liveBoards,
}) => {
  const { people } = await liveBoards.open(PEOPLE.slice(0, MAX_CONCURRENT_EDITORS));

  // Everyone looks at the same patch of board, zoomed out far enough that the
  // slots below are clear of each other on every screen. (The camera is personal:
  // it is not part of the board.)
  for (const person of people) await setCamera(person.page, centredOn(0, 0, 0.35));

  const notesPerPerson = 5;
  const mine: string[][] = people.map(() => []);
  for (const [index, person] of people.entries()) {
    for (let created = 0; created < notesPerPerson; created++) {
      const at = slot(index * notesPerPerson + created);
      await changeArrives(
        `TC-26 ${person.name} creates note #${created + 1}`,
        async () => {
          const id = await createNoteByDblClick(person.page, at);
          mine[index]!.push(id);
          await endEditing(person.page);
        },
        () => everybodyElseSaw(person, people, mine[index]!),
      );
    }
  }

  // Each person nudges their own notes; everybody else follows.
  for (const [index, person] of people.entries()) {
    for (const [created, id] of mine[index]!.entries()) {
      const box = (await noteBoxes(person.page))[id]!;
      const from = centre(box);
      await changeArrives(
        `TC-26 ${person.name} moves note #${created + 1}`,
        () => dragPointer(person.page, from, { x: from.x + 30, y: from.y + 20 }),
        async () => {
          const mineNow = await noteOn(person.page, id);
          if (!mineNow) return false;
          for (const other of people) {
            if (other === person) continue;
            const theirs = await noteOn(other.page, id);
            if (!theirs || theirs.x !== mineNow.x || theirs.y !== mineNow.y) return false;
          }
          return true;
        },
      );
    }
  }

  const expected = await boardJson(people[0]!.page);
  expect(JSON.parse(expected)).toHaveLength(MAX_CONCURRENT_EDITORS * notesPerPerson);
  for (const person of people) {
    expect(`${person.name}: ${await boardJson(person.page)}`).toBe(`${person.name}: ${expected}`);
  }

  expectNoErrors(people);
});

test('TC-27: edits made while disconnected catch up, and the badge narrates it', async ({
  liveBoards,
}) => {
  // A deliberate 30-second outage, plus the provider's own timeout for noticing a
  // connection that has gone silent.
  test.setTimeout(180_000);

  const { people } = await liveBoards.open([PEOPLE[0]!, PEOPLE[1]!]);
  const [alex, sam] = people;

  // Ana's network drops. Her page does not know it yet — a connection that goes
  // silent is only noticed after the provider's own timeout, which is exactly the
  // 30-second outage the PRD describes.
  await alex.context.setOffline(true);

  // Notes are 200 world units across, so the clicks are kept well apart; a click
  // that landed inside an existing note would edit it instead of making a new one.
  for (let i = 0; i < 3; i++) {
    await createNoteByDblClick(alex.page, { x: 240, y: 200 + i * 230 });
    await endEditing(alex.page);
  }
  for (let i = 0; i < 3; i++) {
    await createNoteByDblClick(sam.page, { x: 1040, y: 200 + i * 230 });
    await endEditing(sam.page);
  }

  // The badge says what is true, and Ana's board is still a board: her three
  // notes are there, and Sam has her own three and none of Ana's.
  await expect(badge(alex.page)).toHaveText('Reconnecting…', { timeout: 45_000 });
  expect(await getNotes(alex.page)).toHaveLength(3);
  expect(await getNotes(sam.page)).toHaveLength(3);

  await alex.context.setOffline(false);

  // Connected again: the badge confirms it, and the backlog arrives in both
  // directions — six notes on both screens.
  await expect(badge(alex.page)).toHaveText('Connected', { timeout: 30_000 });
  await expect.poll(async () => (await getNotes(alex.page)).length).toBe(6);
  await expect.poll(async () => (await getNotes(sam.page)).length).toBe(6);
  expect(await boardJson(alex.page)).toBe(await boardJson(sam.page));

  expectNoErrors(people);
});

test('TC-28: selecting and editing a note is invisible to everybody else', async ({
  liveBoards,
}) => {
  const { people } = await liveBoards.open([PEOPLE[0]!, PEOPLE[1]!]);
  const [alex, sam] = people;

  let id = '';
  await changeArrives(
    'TC-28 create',
    async () => {
      id = await createNoteByDblClick(alex.page, { x: 520, y: 380 });
    },
    async () => (await noteOn(sam.page, id)) !== undefined,
  );

  // Ana has it selected and is typing in it, right now.
  await expect(
    alex.page.locator(`[data-note-id="${id}"][data-selected="true"] textarea`),
  ).toBeVisible();
  await typeIntoEditor(alex.page, 'private');

  // Sam sees the note, but with nothing selected and no editor — and no toolbar
  // of her own springing up.
  await expect(sam.page.locator(`[data-note-id="${id}"]`)).toHaveAttribute('data-selected', 'false');
  await expect(sam.page.locator(`[data-note-id="${id}"] textarea`)).toHaveCount(0);
  await expect(sam.page.getByTestId('note-toolbar')).toHaveCount(0);

  expectNoErrors(people);
});

test('someone who joins later starts from the board as it is now', async ({ liveBoards, browser }) => {
  const { boardId, people } = await liveBoards.open([PEOPLE[0]!]);
  const [alex] = people;

  for (let i = 0; i < 4; i++) {
    await createNoteByDblClick(alex.page, { x: 200 + (i % 2) * 230, y: 200 + Math.floor(i / 2) * 230 });
    await endEditing(alex.page);
  }
  const expected = await boardJson(alex.page);

  const [late] = await openBoardAs(browser, boardId, [PEOPLE[1]!]);
  try {
    await expect.poll(async () => await boardJson(late.page)).toBe(expected);
  } finally {
    await late.context.close();
  }

  expectNoErrors(people);
});

/** Screen point of the n-th slot in the grid the capacity test fills. */
function slot(index: number): Pixel {
  return { x: 120 + (index % 6) * 100, y: 120 + Math.floor(index / 6) * 100 };
}

/**
 * Every connection state this page has been in, in order. The page records them as
 * they happen, so a state that came and went in between two polls is still caught.
 */
async function connectionStatesSeen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const states = window.__vidi6?.connectionStates?.();
    if (!states) {
      throw new Error('no connection states: e2e needs a test build (`npm run build:test`)');
    }
    return states;
  });
}

async function noteOn(page: Page, id: string) {
  return (await getNotes(page)).find((note) => note.id === id);
}

async function everybodyElseSaw(
  person: { page: Page },
  people: readonly { page: Page }[],
  ids: readonly string[],
): Promise<boolean> {
  for (const other of people) {
    if (other === person) continue;
    const notes = await getNotes(other.page);
    if (!ids.every((id) => notes.some((note) => note.id === id))) return false;
  }
  return true;
}

/* ---------------------------------------------------------------------------
 * The nightly cases. These run for minutes, so they are tagged @nightly and left
 * out of an ordinary run; start them with `npm run test:e2e:nightly`.
 * ------------------------------------------------------------------------- */

/** Longer than the provider's own tolerance for a silent connection (30 s). */
const IDLE_TEST_MS = 45_000;
/** How long the capacity soak keeps everybody editing (shorten with VIDI6_SOAK_MS). */
const SOAK_TEST_MS = Number(process.env.VIDI6_SOAK_MS ?? 60_000);
/** The soak looks the board out at, so a minute of work fits on the screen. */
const SOAK_ZOOM = 0.25;
const SOAK_SLOT_STEP = 65;
const SOAK_BAND_STEP = 150;
const SOAK_COLUMNS = 18;
/** One row per writer: the gaps are then wide enough for the selection toolbar. */
const SOAK_SLOTS_PER_PERSON = SOAK_COLUMNS;
/** How far a note may drift from the middle of its own slot, in screen pixels. */
const SOAK_DRIFT_LIMIT = 6;

test('TC-29 @nightly: a board nobody touches stays connected', async ({ liveBoards }) => {
  test.setTimeout(180_000);

  const { people } = await liveBoards.open([PEOPLE[0]!, PEOPLE[1]!]);
  const [alex, sam] = people;

  // Nothing happens for longer than either provider is prepared to sit through
  // silence. Awareness traffic is what keeps both connections answering, so the
  // badge never has anything to report.
  const until = Date.now() + IDLE_TEST_MS;
  while (Date.now() < until) {
    await alex.page.waitForTimeout(2_000);
    await expect(badge(alex.page)).toHaveCount(0);
    await expect(badge(sam.page)).toHaveCount(0);
  }

  // The state the badge is driven by, not just the badge. The page records every
  // state as it happens, so a momentary `reconnecting` between two polls could not
  // slip through; the only states here are the load and the arrival of the board.
  for (const person of people) {
    const states = await connectionStatesSeen(person.page);
    expect(`${person.name}: ${states.join(' -> ')}`).not.toMatch(/reconnecting/);
    expect(states.at(-1)).toBe('connected');
  }

  // Still connected: a change made now arrives like any other.
  let id = '';
  await changeArrives(
    'TC-29 first change after 45 s of nothing',
    async () => {
      id = await createNoteByDblClick(alex.page, { x: 520, y: 380 });
    },
    async () => (await noteOn(sam.page, id)) !== undefined,
  );

  expectNoErrors(people);
});

test('TC-30 @nightly: five people editing continuously for a minute', async ({ liveBoards }) => {
  // A minute of work, plus the settling and the leaving-the-board check. Kept close
  // to what the test needs so that anything stuck fails loudly instead of idling.
  test.setTimeout(150_000);

  const { people } = await liveBoards.open(PEOPLE.slice(0, MAX_CONCURRENT_EDITORS));
  for (const person of people) await setCamera(person.page, centredOn(0, 0, SOAK_ZOOM));

  const latencies: number[] = [];
  const missed: string[] = [];
  await Promise.all(
    people.map((person, index) => soak(person, index, people, latencies, missed)),
  );

  const sorted = [...latencies].sort((a, b) => a - b);
  const at = (quantile: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(quantile * sorted.length))] ?? 0;
  console.log(
    `TC-30 soak: ${latencies.length} changes across ${people.length} screens — ` +
      `p50 ${at(0.5)} ms, p95 ${at(0.95)} ms, max ${at(1)} ms ` +
      `(budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms, logged rather than asserted)`,
  );

  // Every change reached every other screen, and everybody ends on the same board.
  expect(missed).toEqual([]);
  const expected = await boardJson(people[0]!.page);
  expect(JSON.parse(expected).length).toBeGreaterThan(0);
  for (const person of people) {
    expect(`${person.name}: ${await boardJson(person.page)}`).toBe(`${person.name}: ${expected}`);
  }

  // Leaving a board destroys the connection, and a destroyed connection must not
  // come back: nobody wants a page that keeps dialling a room it has left.
  for (const person of people) {
    const before = await person.page.evaluate(() => window.__vidi6?.connectionAttempts?.() ?? -1);
    expect(before).toBeGreaterThan(0);
    await person.page.evaluate(() => window.__vidi6?.disconnectBoard?.());
    // y-websocket's first backoff step is a second, so this spans two retries.
    await person.page.waitForTimeout(2_000);
    const after = await person.page.evaluate(() => window.__vidi6?.connectionAttempts?.() ?? -1);
    expect(after, `${person.name}: sockets opened after leaving the board`).toBe(before);
  }

  expectNoErrors(people);
});

/** One participant's minute: create a note, type in one, move one, at a steady pace. */
async function soak(
  person: Participant,
  index: number,
  people: Participant[],
  latencies: number[],
  missed: string[],
): Promise<void> {
  const rng = seededRandom(20260815 + index);
  // Where each of my notes was created, so drags keep it near home. Slots 65 px apart
  // hold notes 50 px wide, so a note that drifted too far would sit on top of its
  // neighbour and the next click would hit the wrong one.
  const home = new Map<string, Pixel>();
  const word = () => WORDS[Math.floor(rng() * WORDS.length)]!;
  const oneOfMine = () => [...home.keys()][Math.floor(rng() * home.size)]!;
  const startedAt = Date.now();
  const until = startedAt + SOAK_TEST_MS;
  const trace = (step: string) => {
    if (process.env.VIDI6_SOAK_TRACE) {
      console.log(`${person.name} +${Date.now() - startedAt}ms ${step}`);
    }
  };

  let lastTried = 'nothing yet';
  while (Date.now() < until) {
    const roll = rng();
    // Slots are used in order, so a slot freed by a delete is reusable and a
    // double-click never lands on a note that is already there.
    const free = nextFreeSlot(index, home);
    try {
      trace(`${roll.toFixed(2)} with ${home.size} of my own notes`);
      if (free && (roll < 0.2 || home.size === 0)) {
        const slot = free;
        lastTried = `create at (${slot.x}, ${slot.y})`;
        const typed = word();
        let id = '';
        await measure(person, people, latencies, missed, trace, 'a new note and its first word',
          async () => {
            id = await createNoteAt(person.page, slot);
            await typeIntoEditor(person.page, typed);
            await endEditing(person.page);
            home.set(id, slot);
          },
          async (other) => (await noteOn(other.page, id))?.text === typed,
        );
      } else if (roll < 0.4) {
        const id = oneOfMine();
        lastTried = `add text to ${id}`;
        const typed = ` ${word()}`;
        await measure(person, people, latencies, missed, trace, 'more text',
          async () => {
            await startEditingNote(person.page, id);
            await typeIntoEditor(person.page, typed);
            await endEditing(person.page);
          },
          async (other) =>
            (await noteOn(other.page, id))?.text === (await noteOn(person.page, id))?.text,
        );
      } else if (roll < 0.6) {
        const id = oneOfMine();
        lastTried = `recolour ${id}`;
        const now = (await noteOn(person.page, id))?.color ?? 'yellow';
        const colour = otherColour(now, rng);
        await measure(person, people, latencies, missed, trace, 'a new colour',
          async () => {
            await recolourNote(person.page, id, colour);
          },
          async (other) => (await noteOn(other.page, id))?.color === colour,
        );
      } else if (roll < 0.7) {
        const id = oneOfMine();
        lastTried = `delete ${id}`;
        await measure(person, people, latencies, missed, trace, 'a deletion',
          async () => {
            await deleteNoteViaToolbar(person.page, id);
            home.delete(id);
          },
          async (other) => (await noteOn(other.page, id)) === undefined,
        );
      } else {
        const id = oneOfMine();
        lastTried = `drag ${id}`;
        const box = (await noteBoxes(person.page))[id];
        const at = home.get(id);
        if (!box || !at) continue; // it was here a moment ago; take another
        const from = centre(box);
        // Nudge it back towards home, or, when it is already there, wander a little.
        const step = SOAK_DRIFT_LIMIT;
        const dx = home.get(id)!.x - from.x;
        const dy = home.get(id)!.y - from.y;
        const to = {
          x: from.x + (Math.abs(dx) > 1 ? Math.max(-step, Math.min(step, dx)) : step),
          y: from.y + (Math.abs(dy) > 1 ? Math.max(-step, Math.min(step, dy)) : -step),
        };
        await measure(person, people, latencies, missed, trace, 'a drag',
          () => dragPointer(person.page, from, to),
          async (other) => {
            const here = await noteOn(person.page, id);
            const there = await noteOn(other.page, id);
            return !!here && !!there && here.x === there.x && here.y === there.y;
          },
        );
      }
    } catch (error) {
      trace(`caught: ${(error as Error).message.split('\n')[0]}`);
      missed.push(
        `${person.name}: while trying to ${lastTried}: ` +
          `${(error as Error).message.split('\n')[0]} ` +
          `(notes on this screen: ${(await getNotes(person.page).catch(() => [])).length})`,
      );
    }
  }
  trace(`finished the soak`);
}

/**
 * Do something on one screen, then time how long every other screen takes to show it.
 * The wait is a `poll` rather than an assertion on one snapshot, because "eventually
 * appears" is the promise being tested; the elapsed time is what gets reported.
 */
async function measure(
  person: Participant,
  people: Participant[],
  latencies: number[],
  missed: string[],
  trace: (step: string) => void,
  what: string,
  act: () => Promise<void>,
  arrived: (other: Participant) => Promise<boolean>,
): Promise<void> {
  const started = Date.now();
  await act();
  trace(`did ${what}`);
  const others = people.filter((other) => other !== person);
  try {
    await expect
      .poll(
        async () => {
          for (const other of others) {
            if (!(await arrived(other))) return false;
          }
          return true;
        },
        { timeout: E2E_EVENTUAL_TIMEOUT_MS },
      )
      .toBe(true);
    trace(`${what} on ${others.length} other screen(s) after ${Date.now() - started}ms`);
    latencies.push(Date.now() - started);
  } catch {
    missed.push(`${person.name}: ${what} never reached the other screens`);
  }
}

/** A colour this note does not already have. */
function otherColour(current: string, rng: () => number): string {
  const names = (Object.keys(STICKY_COLORS) as string[]).filter((name) => name !== current);
  return names[Math.floor(rng() * names.length)]!;
}

/**
 * The first slot in this writer's band that no note of theirs is sitting in, or
 * undefined once the band is full.
 */
function nextFreeSlot(participant: number, home: Map<string, Pixel>): Pixel | undefined {
  const taken = new Set([...home.values()].map((at) => `${at.x},${at.y}`));
  for (let index = 0; index < SOAK_SLOTS_PER_PERSON; index++) {
    const slot = soakSlot(participant, index);
    if (!taken.has(`${slot.x},${slot.y}`)) return slot;
  }
  return undefined;
}

/**
 * The next slot in this writer's own band of the board. Each writer has one row, so
 * a double-click always lands on empty board, and the gap between rows is wide enough
 * that the floating toolbar of a selected note never covers another note.
 */
function soakSlot(participant: number, index: number): Pixel {
  return { x: 60 + (index % SOAK_COLUMNS) * SOAK_SLOT_STEP, y: 60 + participant * SOAK_BAND_STEP };
}
