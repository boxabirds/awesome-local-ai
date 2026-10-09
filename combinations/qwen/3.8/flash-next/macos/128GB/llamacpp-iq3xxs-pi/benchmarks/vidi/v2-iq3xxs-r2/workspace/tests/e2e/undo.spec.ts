import { expect, test } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS, UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import {
  expectClose,
  noteRect,
  waitForCentredBoard,
  type NoteRecord,
} from './helpers/board';
import {
  applyChange,
  boardLink,
  capacity,
  closeParticipants,
  createBoard,
  createBoardLink,
  createNoteAt,
  createParticipants,
  deleteNote,
  endEditing,
  expectConverged,
  expectEventually,
  expectNoErrors,
  moveNoteBy,
  notesOf,
  positionOf,
  recolourNote,
  snapshotOf,
  textOf,
  typeInto,
  type Participant,
  type Point,
} from './helpers/participants';
import {
  clickNote,
  dragHandle,
  shiftDrag,
  waitForSelection,
} from './helpers/selection';
import {
  clickRedo,
  clickUndo,
  expectUndoControls,
  expectUndoTooltips,
  redo,
  undo,
} from './helpers/undo';

/**
 * Story 8 in real browsers on a real room: one person taking their own steps back while the
 * others carry on working. Every restoration is checked on every screen — a history that only
 * existed in one browser would not be worth having — and the negative halves matter as much as
 * the positive ones: what this person never did, and what the *other* people did, stays done.
 *
 * TC-22 to TC-24 are the story's three scenarios. The three tests after them are the same
 * controls from one person's point of view, in the PRD's own wording of what a step is,
 * because "one Ctrl+Z, one step" and "the deleted note comes back with its own id" are
 * properties the group scenarios cannot show on their own.
 */

/* --------------------------------------------------- the story's three scenarios */

/** Eight notes in a 4×2 grid, in a band that clears the toolbar, the share button and the zoom controls. */
const GRID: Point[] = [230, 460, 690, 920].flatMap((x) => [250, 520].map((y) => ({ x, y })));

/** A marquee that holds every note in `GRID` completely, starting on empty board. */
const GRID_MARQUEE = { from: { x: 125, y: 140 }, to: { x: 1125, y: 645 } };

/** Raj's own note, made after the accident, well clear of the grid. */
const RAJ_SPOT = { x: 1150, y: 250 };

/**
 * The fields the story names, for these ids, sorted by id so the order cannot matter. Throws
 * when one of them is missing, which is itself a failure worth having quickly.
 */
async function fieldsOf(person: Participant, ids: readonly string[]): Promise<NoteRecord[]> {
  const notes = await notesOf(person);
  return [...ids].sort().map((id) => {
    const note = notes.find((candidate) => candidate.id === id);
    if (!note) throw new Error(`${person.name} has no note ${id}`);
    return note;
  });
}

/** Only the fields a step can change. */
function kept(notes: readonly NoteRecord[]): unknown[] {
  return notes.map((note) => ({
    x: Math.round(note.x * 1000) / 1000,
    y: Math.round(note.y * 1000) / 1000,
    color: note.color,
    text: note.text,
  }));
}

test('TC-22: an accidental delete of eight notes comes back in one Ctrl+Z and goes again in one Redo', async ({
  browser,
}) => {
  const people = await createParticipants(browser, boardLink(await createBoard(browser)), 2);
  const [mia, raj] = people as [Participant, Participant];
  try {
    // Everything on the grid is Raj's work — Raj made the notes and varied them — so the
    // deletion Mia is about to make is the only thing in Mia's history.
    const ids: string[] = [];
    for (const spot of GRID) {
      ids.push(await createNoteAt(raj, spot));
      await endEditing(raj);
    }
    await recolourNote(raj, ids[1]!, 'pink');
    await recolourNote(raj, ids[3]!, 'blue');
    await typeInto(raj, ids[2]!, 'quarterly numbers, please check');
    const shrunk: string[] = [];
    for (const id of [ids[4]!, ids[5]!]) {
      await clickNote(raj.page, id);
      await dragHandle(raj.page, 'se', { x: -50, y: -40 });
      shrunk.push(id);
    }
    await expectEventually(
      mia.page,
      'Mia sees all eight notes',
      async () => (await notesOf(mia)).length === GRID.length,
    );
    await expectConverged(people);
    const before = kept(await fieldsOf(mia, ids));
    const sizesBefore = await Promise.all(shrunk.map((id) => noteRect(mia.page, id)));

    // Mia means to delete one note, box-selects the whole grid, and presses Delete.
    await shiftDrag(mia.page, GRID_MARQUEE.from, GRID_MARQUEE.to);
    await waitForSelection(mia.page, ids);
    await applyChange(
      'the delete of eight notes',
      mia,
      async () => {
        await mia.page.keyboard.press('Delete');
      },
      [raj],
    );
    expect(await notesOf(mia)).toHaveLength(0);
    await expectUndoControls(mia, { undo: true, redo: false });

    // Raj carries on as if nothing had happened.
    const rajNote = await createNoteAt(raj, RAJ_SPOT);
    await endEditing(raj);
    await expectEventually(
      mia.page,
      'Raj’s new note arrives for Mia',
      async () => (await notesOf(mia)).length === 1,
    );

    // One Ctrl+Z. All eight are back, exactly as they were, on both screens, and Raj's own
    // note is where Raj left it.
    await undo(mia);
    await expectEventually(
      raj.page,
      'the eight notes are back for Raj',
      async () => (await notesOf(raj)).length === GRID.length + 1,
    );
    for (const person of people) {
      const notes = await fieldsOf(person, ids);
      expect(kept(notes), `${person.name} sees the notes as they were`).toEqual(before);
      expect(notes.some((note) => note.color === 'pink'), `${person.name} sees the recoloured note`).toBe(true);
      expect(notes.some((note) => note.text.includes('quarterly')), `${person.name} sees the typed text`).toBe(true);
      expect((await notesOf(person)).some((note) => note.id === rajNote)).toBe(true);
    }
    for (const [index, id] of shrunk.entries()) {
      for (const person of people) {
        const rect = await noteRect(person.page, id);
        expectClose(rect.width, sizesBefore[index]!.width);
        expectClose(rect.height, sizesBefore[index]!.height);
      }
    }
    await expectConverged(people);
    // Mia's history is empty: eight of Raj's notes back, Raj's note and Raj's work untouched.
    await expectUndoControls(mia, { undo: false, redo: true });
    await expectUndoTooltips(mia.page);

    // The Redo button: all eight away again on both screens, Raj's note still there.
    await clickRedo(mia);
    await expectEventually(
      raj.page,
      'the redo takes the eight notes away for Raj too',
      async () => (await notesOf(raj)).length === 1,
    );
    expect((await notesOf(mia)).map((note) => note.id)).toEqual([rajNote]);
    await expectConverged(people);
    await expectUndoControls(mia, { undo: true, redo: false });

    expectNoErrors(people);
  } finally {
    await closeParticipants(people);
  }
});

test('TC-23: when somebody else deletes what I moved, my undo does nothing rather than anything strange', async ({
  browser,
}) => {
  const people = await createParticipants(browser, await createBoardLink(browser), 2);
  const [mia, raj] = people as [Participant, Participant];
  try {
    const note = await createNoteAt(mia, { x: 400, y: 300 });
    await endEditing(mia);
    await expectEventually(
      raj.page,
      'Raj sees the note',
      async () => (await notesOf(raj)).length === 1,
    );
    await applyChange('my move', mia, () => moveNoteBy(mia, note, { x: 120, y: 80 }), [raj]);

    // Raj deletes it. Mia never asked for that, and none of it is in Mia's history.
    await applyChange('Raj’s deletion', raj, () => deleteNote(raj, note), [mia]);
    expect(await notesOf(mia)).toHaveLength(0);
    await expectUndoControls(mia, { undo: true, redo: false });

    // Mia undoes her move of a note that is not there any more.
    await undo(mia);

    // No error anywhere, and the note is still absent on both screens.
    expectNoErrors(people);
    expect(await notesOf(mia)).toHaveLength(0);
    expect(await notesOf(raj)).toHaveLength(0);
    await expectConverged(people);

    // Her history still works: the next thing Mia does is hers to take back.
    const mine = await createNoteAt(mia, { x: 800, y: 500 });
    await endEditing(mia);
    await expectEventually(
      raj.page,
      'Raj sees Mia’s next note',
      async () => (await notesOf(raj)).some((note) => note.id === mine),
    );
    await undo(mia);
    await expectEventually(
      raj.page,
      'Mia’s own undo takes her own note away for Raj too',
      async () => !(await notesOf(raj)).some((candidate) => candidate.id === mine),
    );
    expect(await notesOf(mia)).toHaveLength(0);
    await expectConverged(people);

    expectNoErrors(people);
  } finally {
    await closeParticipants(people);
  }
});

test('TC-24: everyone on the board undoes only their own work', async ({ browser }) => {
  test.setTimeout(300_000);
  const seats = capacity();
  expect(seats).toBe(MAX_CONCURRENT_EDITORS);
  const people = await createParticipants(browser, await createBoardLink(browser), seats);
  try {
    // Each person owns a column of two notes on the grid story 7 uses, so nobody's drag or
    // double-click ever lands on somebody else's note.
    const spotsFor = (seat: number): [Point, Point] => [
      { x: 200 + seat * 230, y: 220 },
      { x: 200 + seat * 230, y: 460 },
    ];
    const owned = await Promise.all(
      people.map(async (person, seat) => {
        const [first, second] = spotsFor(seat);
        const top = await createNoteAt(person, first);
        await endEditing(person);
        const bottom = await createNoteAt(person, second);
        await endEditing(person);
        return { person, top, bottom };
      }),
    );
    // `fieldsOf` sorts, so these arrays line up by id.
    const allIds = owned.flatMap((entry) => [entry.top, entry.bottom]).sort();
    await expectConverged(people);
    const empty = kept(await fieldsOf(people[0]!, allIds));

    // Up and left, and never far: a note that drifts onto its neighbour's column would make
    // somebody else's double-click ambiguous.
    const movedBy = (seat: number): Point => ({ x: -(20 + seat * 5), y: -(10 + seat * 4) });
    const typed = (seat: number): string => `seat ${seat} was here`;

    // Everybody works at once: each moves their own top note and types in their own bottom one.
    await Promise.all(
      owned.map(async ({ person, top, bottom }, seat) => {
        await moveNoteBy(person, top, movedBy(seat));
        // Longer than the capture window, so the typing is a second step rather than the tail
        // of the drag, in every browser however fast the machine is.
        await person.page.waitForTimeout(UNDO_CAPTURE_TIMEOUT_MS + 100);
        await typeInto(person, bottom, typed(seat));
      }),
    );
    await expectConverged(people);
    const worked = kept(await fieldsOf(people[0]!, allIds));
    expect(worked).not.toEqual(empty);

    // First person one, alone: their own two steps go, and nobody else's do — checked in every
    // browser, so "intact" cannot mean "only still here on my own screen".
    const [first, ...rest] = owned as [typeof owned[number], ...typeof owned];
    const mineIds = [first.top, first.bottom].sort();
    const otherIds = allIds.filter((id) => !mineIds.includes(id));
    const mineEmpty = empty.filter((_, index) => mineIds.includes(allIds[index]!));
    const othersWork = kept(await fieldsOf(first.person, otherIds));
    await undo(first.person);
    await undo(first.person);
    await expectConverged(people);
    for (const person of people) {
      expect(
        kept(await fieldsOf(person, mineIds)),
        `${person.name} sees seat 0's own steps taken back`,
      ).toEqual(mineEmpty);
      expect(
        kept(await fieldsOf(person, otherIds)),
        `${person.name} still has everybody else's work`,
      ).toEqual(othersWork);
    }

    // Then everybody else undoes their own two steps at once, and the room converges on the
    // board it held before anybody worked: every step was taken back by the person who made it.
    await Promise.all(
      rest.map(async ({ person }) => {
        await undo(person);
        await undo(person);
      }),
    );
    await expectConverged(people);
    const final = await Promise.all(people.map((person) => snapshotOf(person.page)));
    expect(new Set(final).size, 'every browser holds the same board').toBe(1);
    for (const person of people) {
      expect(
        kept(await fieldsOf(person, allIds)),
        `${person.name}'s board is back to where it started`,
      ).toEqual(empty);
    }

    expectNoErrors(people);
  } finally {
    await closeParticipants(people);
  }
});

/* ------------------------------------------- the same controls, one person at a time */

/** Alex's notes, spaced out so a drag of one never lands on another. */
const ALEX_SPOTS = [
  { x: 260, y: 180 },
  { x: 620, y: 330 },
  { x: 980, y: 480 },
];

const SAM_SPOT = { x: 1040, y: 200 };

/** Alex makes three notes, with Sam watching each one appear. */
async function alexMakesThreeNotes(alex: Participant, sam: Participant): Promise<string[]> {
  const ids: string[] = [];
  for (const [index, at] of ALEX_SPOTS.entries()) {
    ids.push(await createNoteAt(alex, at));
    await endEditing(alex);
    await expectEventually(
      sam.page,
      `the note Alex made (${index + 1}) appears for Sam`,
      async () => (await notesOf(sam)).length === ids.length,
    );
  }
  await expectConverged([alex, sam]);
  return ids;
}

interface Step {
  name: string;
  act: () => Promise<void>;
  /** What the board has to look like once this step has been taken back. */
  check: () => Promise<void>;
}

test('the PRD’s scenario "Undo my steps, one at a time": one Ctrl+Z takes back exactly one of my steps, newest first', async ({
  browser,
}) => {
  const people = await createParticipants(browser, boardLink(await createBoard(browser)), 2);
  const [alex, sam] = people as [Participant, Participant];
  try {
    const ids = await alexMakesThreeNotes(alex, sam);
    const [moved, deleted, untouched] = ids as [string, string, string];

    const positionBeforeMove = await positionOf(alex, moved);
    const sizeBeforeResize = await noteRect(alex.page, moved);

    const steps: Step[] = [
      {
        name: 'move',
        act: () => moveNoteBy(alex, moved, { x: 140, y: 90 }),
        check: async () => {
          // The move was Alex's newest step, so one Ctrl+Z is the move going back.
          expect(await positionOf(alex, moved)).toEqual(positionBeforeMove);
        },
      },
      {
        name: 'resize',
        act: async () => {
          await clickNote(alex.page, moved);
          await dragHandle(alex.page, 'se', { x: 60, y: 40 });
        },
        check: async () => {
          // Width and height come back with the resize, on both screens — and not on its own.
          for (const person of [alex, sam]) {
            const rect = await noteRect(person.page, moved);
            expectClose(rect.width, sizeBeforeResize.width);
            expectClose(rect.height, sizeBeforeResize.height);
          }
        },
      },
      {
        name: 'recolour',
        act: () => recolourNote(alex, moved, 'violet'),
        check: async () => {
          const colour = (await notesOf(alex)).find((note) => note.id === moved)?.color;
          expect(colour, 'the colour the undo puts back').not.toBe('violet');
          expect(colour).toBe((await notesOf(sam)).find((note) => note.id === moved)?.color);
        },
      },
      {
        name: 'delete',
        act: () => deleteNote(alex, deleted),
        check: async () => {
          // The deleted note is back with its own id, and the note nobody touched never left.
          expect((await notesOf(alex)).map((note) => note.id).sort()).toEqual([...ids].sort());
          expect(await positionOf(alex, untouched)).toEqual(await positionOf(sam, untouched));
        },
      },
    ];

    // Every snapshot below is what one Ctrl+Z has to bring back, in reverse.
    const states: string[] = [];
    for (const step of steps) {
      states.push(await snapshotOf(alex.page));
      await applyChange(step.name, alex, step.act, [sam]);
    }
    // The newest thing Alex did is a deletion, so there is a step to take back and nothing
    // yet to put back.
    await expectUndoControls(alex, { undo: true, redo: false });
    await expectUndoTooltips(alex.page);
    const done = await snapshotOf(alex.page);
    const movedLast = await positionOf(alex, moved);

    for (let index = steps.length - 1; index >= 0; index -= 1) {
      const step = steps[index]!;
      await undo(alex);
      await expectEventually(
        sam.page,
        `Alex's undo of the ${step.name} reaches Sam`,
        async () => (await snapshotOf(sam.page)) === states[index],
      );
      expect(await snapshotOf(alex.page), `Alex's board after undoing the ${step.name}`).toBe(
        states[index],
      );
      await step.check();
      // Both screens agree after every single step.
      await expectConverged(people);
    }

    // Redo goes one step at a time too, and from the other end: the first redo is the oldest
    // of the steps Alex took back, and the deletion — the newest — is the last thing to return.
    await redo(alex);
    await expectEventually(
      sam.page,
      'the first redo is Alex’s move, not the deletion',
      async () =>
        (await notesOf(sam)).some((note) => note.id === deleted) &&
        (await positionOf(sam, moved)).x === movedLast.x,
    );
    expect(await positionOf(alex, moved)).toEqual(movedLast);
    expect((await notesOf(alex)).some((note) => note.id === deleted)).toBe(true);

    for (let index = 1; index < steps.length; index += 1) await redo(alex);
    await expectEventually(
      sam.page,
      "the last redo is Alex's deletion",
      async () => !(await notesOf(sam)).some((note) => note.id === deleted),
    );
    // …and once every step is back, the board is what it was before Alex started undoing.
    expect(await snapshotOf(alex.page)).toBe(done);
    await expectConverged(people);

    expectNoErrors(people);
  } finally {
    await closeParticipants(people);
  }
});

test('the PRD’s scenario "Undo one step only": a dragged then deleted note comes back where it was dragged to, then where it started', async ({
  browser,
}) => {
  const people = await createParticipants(browser, await createBoardLink(browser), 2);
  const [alex, sam] = people as [Participant, Participant];
  try {
    const note = await createNoteAt(alex, ALEX_SPOTS[0]!);
    await endEditing(alex);
    await expectEventually(
      sam.page,
      'the note exists for Sam',
      async () => (await notesOf(sam)).length === 1,
    );
    const started = await positionOf(alex, note);

    await applyChange('drag', alex, () => moveNoteBy(alex, note, { x: 120, y: 80 }), [sam]);
    const dragged = await positionOf(alex, note);
    await applyChange('deletion', alex, () => deleteNote(alex, note), [sam]);
    expect(await notesOf(alex)).toHaveLength(0);
    await expectUndoControls(alex, { undo: true, redo: false });

    // The Undo button: the note comes back, with the id it had, where the drag left it — not
    // where it was when it was made.
    await clickUndo(alex);
    await expectEventually(
      sam.page,
      'the note is back for Sam',
      async () => (await notesOf(sam)).length === 1,
    );
    expect((await notesOf(alex)).map((entry) => entry.id)).toEqual([note]);
    expect(await positionOf(alex, note)).toEqual(dragged);
    expect(await positionOf(sam, note)).toEqual(dragged);
    await expectConverged(people);

    // One more step and the drag never happened either.
    await undo(alex);
    await expectEventually(
      sam.page,
      'the note is back where it started, for Sam',
      async () => (await positionOf(sam, note)).x === started.x,
    );
    expect(await positionOf(alex, note)).toEqual(started);
    await expectConverged(people);

    // Redo brings the dragged position back, and only that.
    await redo(alex);
    await expectEventually(
      sam.page,
      'the dragged position returns for Sam',
      async () => (await positionOf(sam, note)).x === dragged.x,
    );
    expect(await positionOf(alex, note)).toEqual(dragged);
    await expectConverged(people);

    expectNoErrors(people);
  } finally {
    await closeParticipants(people);
  }
});

test('the PRD’s scenario "Undo the other person’s steps stay": my Ctrl+Z never takes back what the other person did', async ({
  browser,
}) => {
  const link = await createBoardLink(browser);
  const people = await createParticipants(browser, link, 2);
  const [alex, sam] = people as [Participant, Participant];
  try {
    // Sam works alone first: a note of her own, some text, and a move.
    const theirs = await createNoteAt(sam, SAM_SPOT);
    await endEditing(sam);
    const shared = await createNoteAt(sam, { x: 420, y: 420 });
    await endEditing(sam);
    await applyChange('typing', sam, () => typeInto(sam, shared, 'kept by Sam'), [alex]);
    await applyChange('Sam’s move', sam, () => moveNoteBy(sam, theirs, { x: 90, y: 60 }), [alex]);

    // None of Sam's work is Alex's to take back: with Alex having done nothing at all, the
    // history Alex has is empty.
    await expectUndoControls(alex, { undo: false, redo: false });

    // Alex moves the note Sam typed in — a shared note, and the only step Alex owns.
    const sharedBeforeMove = await positionOf(alex, shared);
    await applyChange('Alex’s move', alex, () => moveNoteBy(alex, shared, { x: -140, y: -70 }), [
      sam,
    ]);
    const sharedMoved = await positionOf(sam, shared);
    const samPosition = await positionOf(alex, theirs);
    expect(sharedMoved).not.toEqual(sharedBeforeMove);
    await expectUndoControls(alex, { undo: true, redo: false });

    await undo(alex);

    // Alex's note moved back to where Alex pressed it; Sam's note is exactly where she left
    // it, on both screens.
    await expectEventually(
      sam.page,
      'Alex’s undo arrives for Sam',
      async () => (await positionOf(sam, shared)).x === sharedBeforeMove.x,
    );
    expect(await positionOf(alex, shared)).toEqual(sharedBeforeMove);
    expect(await positionOf(sam, shared)).toEqual(sharedBeforeMove);
    expect(await positionOf(alex, theirs)).toEqual(samPosition);
    expect(await positionOf(sam, theirs)).toEqual(samPosition);

    // Sam's text survived Alex's Ctrl+Z in a note they share, on both screens.
    expect(await textOf(alex, shared)).toContain('kept by Sam');
    expect(await textOf(sam, shared)).toContain('kept by Sam');
    await expectConverged(people);

    // And it survives a reload of Sam's browser: nothing was undone for her.
    await sam.page.reload();
    await waitForCentredBoard(sam.page);
    await expectEventually(
      sam.page,
      'Sam’s board comes back as she left it',
      async () => {
        const notes = await notesOf(sam);
        return notes.length === 2 && (await textOf(sam, shared)).includes('kept by Sam');
      },
    );
    const reloaded = await notesOf(sam);
    const sharedNow = (await notesOf(alex)).find((note) => note.id === shared);
    expect(reloaded.find((note) => note.id === theirs)).toMatchObject({
      x: samPosition.x,
      y: samPosition.y,
    });
    // The note Alex moved is where Alex's own undo left it, in Sam's reloaded browser too.
    expect(reloaded.find((note) => note.id === shared)?.x).toBe(sharedNow?.x);

    expectNoErrors(people);
  } finally {
    await closeParticipants(people);
  }
});
