/**
 * TC-32 to TC-36 (story 7: `sel.marquee_ui`, `sel.transform`, `sel.keyboard`,
 * `sel.size_limits`): a person reorganising a cluster of notes, in a real browser
 * on a board served by `wrangler dev`, so every write these tests measure has
 * travelled through the room to get back to the screen.
 *
 * Mouse points always come from a real element (a note's box, a handle's box)
 * and never from arithmetic on the camera a board opens with; what is asserted
 * is in *board* units, read back out of each note's data attributes. The one
 * test that needs screen pixels to stand for board units says so, by checking
 * the zoom label first — and every test waits for the view a board opens with
 * before it measures anything, because until that view lands a note's screen box
 * is its board position and no mouse can reach it.
 */
import { expect, test } from '@playwright/test';

import {
  MAX_CONCURRENT_EDITORS,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import {
  selectionBoard,
  SELECTION_BOARD_NOTES,
  type SeedPlacement,
} from '../fixtures/boards';
import { camera, expectInitialView } from './helpers/board';
import { createBoard } from './helpers/share';
import { notes, readNotes } from './helpers/notes';
import {
  changeVisible,
  expectEveryPageSees,
  noteBox,
  openBoard,
  selectNote,
  type Participant,
} from './helpers/live';
import {
  dragHandle,
  dragNoteBy,
  expectHandles,
  expectMoved,
  expectNoteToolbar,
  expectSelected,
  expectSelectionBar,
  expectStill,
  marquee,
  pick,
  placements,
  seedNotes,
  selectedIds,
  type Placement,
} from './helpers/selection';

/** Three notes, spaced out: one inside a rectangle, one cut by it, one away. */
const SPREAD: SeedPlacement[] = [
  { x: -420, y: -120, text: 'The note the rectangle fully covers', color: 'yellow' },
  { x: -100, y: -120, text: 'The note the rectangle cuts in half', color: 'pink' },
  { x: 140, y: 120, text: 'The note the rectangle never touches', color: 'blue' },
];

/**
 * The note these tests do not select. It sits where the cluster is going to
 * land, and it is created after every fixture note, so it starts on top of all
 * of them: a cluster that renders above it afterwards has been lifted by the
 * move that put it there (`sel.transform`).
 */
const LANDED_ON: SeedPlacement = {
  x: 60,
  y: -330,
  text: 'The note the cluster lands on top of',
  color: 'blue',
};

/** The fixture lays twenty notes as five columns of two rows. */
const COLUMNS = 5;

test('TC-32 a Shift+drag selects the notes fully inside the rectangle', async ({
  browser,
  request,
}) => {
  const boardId = await createBoard(request);
  const lee = await openBoard(browser, boardId, 'Lee');
  await expectInitialView(lee.page);
  const ids = await seedNotes(lee.page, SPREAD);
  const inside = pick(ids, 0);
  const half = pick(ids, 1);
  const outside = pick(ids, 2);

  const covered = await noteBox(lee.page, inside);
  const cut = await noteBox(lee.page, half);
  await marquee(
    lee.page,
    // A corner of empty board beside the note that is to be fully covered ...
    { x: covered.x - 24, y: covered.y - 24 },
    // ... to a point in the middle of the next note, and below both.
    { x: cut.x + cut.width / 2, y: covered.y + covered.height + 24 },
  );

  await expectSelected(lee.page, [inside]);
  // Exactly one sticky note selected: story 2's toolbar above it, not a count.
  await expectNoteToolbar(lee.page);
  // Nothing was written: a selection is this screen's business alone (`sel.local`).
  await expectStill(lee.page, await placements(lee.page), [inside, half, outside]);

  expect(lee.problems).toEqual([]);
  await lee.context.close();
});

test('TC-33 one gesture moves and resizes a whole cluster', async ({ browser, request }) => {
  const boardId = await createBoard(request);
  const lee = await openBoard(browser, boardId, 'Lee');
  const board = await seedFixture(lee);
  const { cluster, landedOn, others } = board;

  // A drag of 300 screen pixels is a drag of 300 board units only at 100%, and
  // this test is about exactly that number.
  await expect(lee.page.getByTestId('zoom-percent')).toHaveText('100%');

  await selectCluster(lee, board);
  await expectSelectionBar(lee.page, 6);
  await expectHandles(lee.page);

  // --- Move: grab one note of the cluster and pull it 300 units right. ---
  const beforeMove = await placements(lee.page);
  await dragNoteBy(lee.page, pick(cluster, 0), { x: 300, y: 0 });
  await expectMoved(lee.page, beforeMove, cluster, { x: 300, y: 0 });
  // Nobody else moved — not the fourteen notes of the fixture, and not the one
  // note the cluster is now sitting on.
  await expectStill(lee.page, beforeMove, others);

  // ... and the moved notes are drawn above it, in the same transaction (`sel.transform`).
  const moved = await placements(lee.page);
  const onTop = moved.get(landedOn);
  if (!onTop) throw new Error('the note the cluster landed on is gone');
  const stillUnder = cluster.filter((id) => {
    const at = moved.get(id);
    if (!at) throw new Error(`${id} vanished while the cluster moved`);
    return at.z <= onTop.z;
  });
  expect(stillUnder).toEqual([]);

  // --- Resize: the corner handle scales the box, the notes and the gaps. ---
  const beforeResize = await placements(lee.page);
  const box = boxOf(beforeResize, cluster);
  const pull = { x: 150, y: 150 };
  // One scale covers the notes and the box, because the notes keep their
  // proportions and the box is scaled by the same factor. Where the box's own
  // two axes disagree, the axis that was pulled further decides — that is
  // geometry's aspect lock, and it is what keeps a cluster a cluster.
  const scaleX = (box.width + pull.x) / box.width;
  const scaleY = (box.height + pull.y) / box.height;
  const scale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
  await dragHandle(lee.page, 'se', pull);
  await expect
    .poll(async () => {
      const now = await placements(lee.page);
      return cluster
        .map((id) => grew(id, beforeResize.get(id), now.get(id), box, scale))
        .filter((problem) => problem !== '')
        .join(' ; ');
    })
    .toBe('');
  await expectStill(lee.page, beforeResize, others);

  // --- Shrinking stops when the first note reaches its type's minimum. ---
  const beforeShrink = await placements(lee.page);
  await dragHandle(lee.page, 'se', { x: -1_000, y: -1_000 });
  await expect
    .poll(async () => {
      const now = await placements(lee.page);
      return cluster
        .map((id) => {
          const at = now.get(id);
          if (!at) return `${id} is missing`;
          return near(at.width, STICKY_MIN_SIZE_WORLD, 1) && near(at.height, STICKY_MIN_SIZE_WORLD, 1)
            ? ''
            : `${id} stopped at ${at.width}x${at.height} instead of ${STICKY_MIN_SIZE_WORLD}`;
        })
        .filter((problem) => problem !== '')
        .join(' ; ');
    })
    .toBe('');
  // Stopped, not pushed through: nothing outside the selection changed either.
  await expectStill(lee.page, beforeShrink, others);

  expect(lee.problems).toEqual([]);
  await lee.context.close();
});

test('TC-34 the arrow keys nudge the selection and the board stays put', async ({
  browser,
  request,
}) => {
  const boardId = await createBoard(request);
  const lee = await openBoard(browser, boardId, 'Lee');
  const board = await seedFixture(lee);
  const { cluster, landedOn, others } = board;

  await selectCluster(lee, board);
  await expectSelectionBar(lee.page, 6);

  const where = await camera(lee.page);
  const scrolled = (): Promise<number> =>
    lee.page.evaluate(
      () => Math.round((window.scrollY || document.documentElement.scrollTop) * 100) / 100,
    );
  expect(await scrolled()).toBe(0);

  // Three small steps, then one big one.
  const before = await placements(lee.page);
  for (let press = 0; press < 3; press += 1) await lee.page.keyboard.press('ArrowRight');
  await expectMoved(lee.page, before, cluster, { x: 3 * NUDGE_STEP_WORLD, y: 0 }, 1);
  await lee.page.keyboard.press('Shift+ArrowRight');
  await expectMoved(
    lee.page,
    before,
    cluster,
    { x: 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD, y: 0 },
    1,
  );

  // The board did not pan and the page did not scroll: those keys moved notes.
  expect(await camera(lee.page)).toEqual(where);
  expect(await scrolled()).toBe(0);
  await expectStill(lee.page, before, others);

  // One press deletes the whole selection, and nothing outside it.
  await lee.page.keyboard.press('Delete');
  await expect(notes(lee.page)).toHaveCount(others.length);
  await expect(lee.page.locator(`.sticky-note[data-note-id="${landedOn}"]`)).toHaveCount(1);
  await expect(selectedIds(lee.page)).resolves.toEqual([]);
  await expect(lee.page.getByTestId('selection-bar')).toHaveCount(0);

  expect(lee.problems).toEqual([]);
  await lee.context.close();
});

test('TC-35 a note someone else deletes leaves my selection', async ({ browser, request }) => {
  const boardId = await createBoard(request);
  const lee = await openBoard(browser, boardId, 'Lee');
  const sam = await openBoard(browser, boardId, 'Sam');
  const pages = [lee.page, sam.page];
  await expectInitialView(lee.page);

  const ids = await seedNotes(lee.page, selectionBoard());
  await expectEveryPageSees(pages, ids.length, 'both screens hold the fixture');
  await expectInitialView(sam.page);

  // Lee surrounds the first four notes of the top row: the fifth is cut by the
  // rectangle's right edge, so it stays out.
  const four = ids.slice(0, 4);
  const firstBox = await noteBox(lee.page, pick(four, 0));
  const lastBox = await noteBox(lee.page, pick(four, 3));
  await marqueeAround(lee, [firstBox, lastBox], {
    x: lastBox.x + lastBox.width + 12,
    y: firstBox.y - 20,
  });
  await expectSelected(lee.page, four);
  await expectSelectionBar(lee.page, 4);

  // Sam, on their own screen, picks one of those four and deletes it. How long
  // that takes to show on Lee's screen is logged against the suite's latency
  // budget; what is asserted is that it shows at all (design: "log the time,
  // assert that the effect arrives"), because the number belongs to this machine.
  const gone = pick(four, 2);
  const left = four.filter((id) => id !== gone);
  await changeVisible(
    'a delete on the other screen',
    async () => {
      await selectNote(sam.page, gone);
      await sam.page.keyboard.press('Delete');
    },
    async () => (await readNotes(lee.page)).length === ids.length - 1,
  );

  // Lee's selection let go of that id on its own, and says how many are left:
  // the selection is pruned from the board snapshot, never from a message about
  // selection (`sel.local`, and why `useSelection` watches the snapshot).
  await expectSelectionBar(lee.page, 3);
  await expectSelected(lee.page, left);

  // The three outlines are still Lee's to delete, and only those three.
  await lee.page.keyboard.press('Delete');
  await expect(notes(lee.page)).toHaveCount(ids.length - 4);
  for (const id of four) {
    await expect(lee.page.locator(`.sticky-note[data-note-id="${id}"]`)).toHaveCount(0);
  }
  await expectEveryPageSees(pages, ids.length - 4, 'both screens lost exactly four notes');
  await expect(selectedIds(lee.page)).resolves.toEqual([]);

  expect([...lee.problems, ...sam.problems]).toEqual([]);
  await Promise.all([lee.context.close(), sam.context.close()]);
});

test(`TC-36 ${MAX_CONCURRENT_EDITORS} people reorganise different parts of one board`, async ({
  browser,
  request,
}) => {
  const boardId = await createBoard(request);
  const capacity = MAX_CONCURRENT_EDITORS;
  const seeder = await openBoard(browser, boardId, 'Seeder');
  const ids = await seedNotes(seeder.page, selectionBoard());

  const people: Participant[] = [];
  for (let index = 0; index < capacity; index += 1) {
    people.push(await openBoard(browser, boardId, NAMES[index] ?? `Person ${index + 1}`));
  }
  const pages = people.map((person) => person.page);
  await expectEveryPageSees(pages, ids.length, 'everyone opened the same board');

  // Selections first, so what each person is about to move is settled before
  // anyone writes. Each takes one column of the top cluster: the note in the
  // front row and the one below it.
  const gestures = [];
  for (let index = 0; index < capacity; index += 1) {
    const person = people[index];
    if (!person) throw new Error(`no participant at index ${index}`);
    await expectInitialView(person.page);
    const column = [pick(ids, index), pick(ids, index + COLUMNS)];
    const front = await noteBox(person.page, pick(column, 0));
    const behind = await noteBox(person.page, pick(column, 1));
    // Upwards, from below the column: the page's own chrome sits above the
    // cluster, and a press there would belong to the chrome, not to the board.
    await marquee(
      person.page,
      { x: front.x - 12, y: behind.y + behind.height + 12 },
      { x: front.x + front.width + 12, y: front.y - 12 },
    );
    await expectSelected(person.page, column);
    gestures.push({
      person,
      ids: column,
      // Every gesture pulls a different way, so no two of them are the same.
      delta: { x: 40 + 25 * index, y: 30 + 15 * (capacity - index) },
    });
  }

  const first = pages[0];
  if (!first) throw new Error('a full house has at least one screen');
  const before = await placements(first);
  // All at the same time: five screens writing to one board.
  await Promise.all(
    gestures.map((gesture) => dragNoteBy(gesture.person.page, pick(gesture.ids, 0), gesture.delta)),
  );

  // Each person's own notes ended where that person put them, whatever the other
  // four were writing underneath.
  for (const gesture of gestures) {
    await expectMoved(gesture.person.page, before, gesture.ids, gesture.delta, 3);
  }
  // And every screen holds one board: the same notes, in the same places.
  await expectEveryPageSees(pages, ids.length, 'one board, reorganised by a full house', 20_000);

  for (const person of people) expect(person.problems).toEqual([]);
  await Promise.all([seeder.context.close(), ...people.map((person) => person.context.close())]);
});

/** Every name a full house of participants gets. */
const NAMES = ['Lee', 'Sam', 'Ana', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay'];

/** The board TC-33 and TC-34 work on. */
interface Fixture {
  /** Every id the board holds, in the order the fixture laid them out. */
  readonly ids: string[];
  /** The six notes these tests work on: three columns of the top cluster, two rows. */
  readonly cluster: string[];
  /** The one note that is not selected but sits in the cluster's way. */
  readonly landedOn: string;
  /** Everything that has to stay where it is: the other fourteen notes plus that one. */
  readonly others: string[];
}

async function seedFixture(person: Participant): Promise<Fixture> {
  await expectInitialView(person.page);
  const fixture = selectionBoard();
  expect(fixture).toHaveLength(SELECTION_BOARD_NOTES);
  const ids = await seedNotes(person.page, [...fixture, LANDED_ON]);
  const cluster = [
    pick(ids, 0),
    pick(ids, 1),
    pick(ids, 2),
    pick(ids, COLUMNS),
    pick(ids, COLUMNS + 1),
    pick(ids, COLUMNS + 2),
  ];
  const landedOn = pick(ids, ids.length - 1);
  const others = ids.filter((id) => !cluster.includes(id));
  expect(others).toHaveLength(15);
  return { ids, cluster, landedOn, others };
}

/**
 * Shift+drag a rectangle around the cluster. Its far corner stops just past the
 * cluster's bottom-right note, which cuts the next column and the rest of the
 * fixture in half: those stay unselected, because "fully inside" is the rule
 * (`sel.marquee_ui`). Waits for the six to carry an outline — the screen catches
 * up with the board on its own frame, so a test that reads once may read nothing.
 */
async function selectCluster(person: Participant, board: Fixture): Promise<void> {
  const first = pick(board.cluster, 0);
  const below = pick(board.cluster, 3);
  const near = await noteBox(person.page, first);
  const corner = await noteBox(person.page, pick(board.cluster, 2));
  await marqueeAround(person, [near, await noteBox(person.page, below)], {
    x: corner.x + corner.width + 12,
    y: near.y - 20,
  });
  await expectSelected(person.page, board.cluster);
}

/**
 * Shift+drag a rectangle around `around`, ending at `to`: the notes named are
 * fully inside, and the rectangle stops a few pixels past the last one, so
 * whatever neighbours it in half stays unselected (`sel.marquee_ui`). The board
 * is at 100%, so those pixels are board units too.
 */
async function marqueeAround(
  person: Participant,
  around: readonly { x: number; y: number; width: number; height: number }[],
  to: { x: number; y: number },
): Promise<void> {
  const left = Math.min(...around.map((note) => note.x));
  const bottom = Math.max(...around.map((note) => note.y + note.height));
  // Up from the bottom-left corner: above the cluster sits the page's own chrome
  // (the share button), and a press there belongs to the chrome, not to the board.
  await marquee(person.page, { x: left - 20, y: bottom + 12 }, to);
}

/** The box a selection is drawn in, in board units. */
function boxOf(
  readings: ReadonlyMap<string, Placement>,
  ids: readonly string[],
): { x: number; y: number; width: number; height: number } {
  const edges = ids.map((id) => {
    const at = readings.get(id);
    if (!at) throw new Error(`${id} is missing from the board`);
    return at;
  });
  const left = Math.min(...edges.map((at) => at.x));
  const top = Math.min(...edges.map((at) => at.y));
  return {
    x: left,
    y: top,
    width: Math.max(...edges.map((at) => at.x + at.width)) - left,
    height: Math.max(...edges.map((at) => at.y + at.height)) - top,
  };
}

/**
 * What is wrong with one note after its box grew from `box` by `scale`, anchored
 * at the box's top-left corner — which is where the opposite handle was held.
 * Empty means the note is right: it grew by the same factor as the box, it kept
 * its proportions, and it moved as little as the gap in front of it grew (the
 * scaled gap is what makes a cluster still a cluster after a resize).
 */
function grew(
  id: string,
  was: Placement | undefined,
  at: Placement | undefined,
  box: { x: number; y: number; width: number; height: number },
  scale: number,
): string {
  if (!was || !at) return `${id} is missing`;
  const expected = {
    x: box.x + (was.x - box.x) * scale,
    y: box.y + (was.y - box.y) * scale,
    width: was.width * scale,
    height: was.height * scale,
  };
  const problems = (['x', 'y', 'width', 'height'] as const)
    .map((field) =>
      near(at[field], expected[field], 1.5)
        ? ''
        : `${id}.${field} is ${at[field].toFixed(1)}, expected ${expected[field].toFixed(1)}`,
    )
    .concat(Math.abs(at.width - at.height) <= 1 ? '' : `${id} stopped being square`)
    .concat(at.width > was.width ? '' : `${id} did not grow`)
    .filter((problem) => problem !== '');
  return problems.join(' ');
}

const near = (value: number, wanted: number, tolerance: number): boolean =>
  Math.abs(value - wanted) <= tolerance;
