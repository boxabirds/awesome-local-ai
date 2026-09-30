// Select, move, resize and delete several objects at once (story 7).
//
// These are the three workflows the design names: reorganise a cluster (box-select,
// move, resize, nudge, delete), a colleague deleting something while this screen has
// it selected, and a board at full editing capacity where everyone moves something at
// the same time. Everything runs against the real `wrangler dev` room, because a
// selection that only survives on one screen is not a selection.
//
// Positions are screen pixels: the board is opened at rest (world origin at the
// centre, 100%), where one screen pixel is one board unit, so a drag of 300 pixels is
// a move of 300 units and the arithmetic below is the arithmetic on the board.
import { expect, test } from '@playwright/test';
import {
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import { openBoard, readCamera, settle, STANDARD_VIEW } from './helpers/board';
import {
  clearSelection,
  createNote,
  deleteSelectionButton,
  dragHandle,
  gapBetween,
  marquee,
  noteCentre,
  readNotes,
  selectAllOnBoard,
  selectedCount,
  selectedIds,
  selectionBar,
  selectionText,
  stopEditing,
  type NoteInfo,
} from './helpers/sticky';
import {
  createNote as createNoteFor,
  deleteNote,
  dragNote,
  expectEventually,
  openParticipants,
  printLatencyReport,
  stopEditing as stopEditingFor,
  type Participant,
} from './helpers/participants';


const indexById = (all: NoteInfo[], id: string): number => {
  const index = all.findIndex((note) => note.id === id);
  if (index < 0) throw new Error('that note is not on this screen');
  return index;
};

/** Do two notes cover some of the same board? */
const overlapsRect = (a: NoteInfo, b: NoteInfo): boolean =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height &&
  b.top < a.top + a.height;

/** Where this screen has the given notes, as one comparable string. */
const layoutOf = async (who: Participant, ids: readonly string[]): Promise<string> => {
  const all = await who.notes();
  return ids
    .slice()
    .sort()
    .map((id) => {
      const note = all.get(id);
      return note === undefined ? `${id}:gone` : `${id}:${Math.round(note.left)},${Math.round(note.top)}`;
    })
    .join('|');
};

test.afterAll(() => {
  printLatencyReport('story 7');
});

test.describe('a cluster, reorganised (TC-32 to TC-34)', () => {
  // TC-32: box-select. A is inside the box, B half inside, C outside: only A is in.
  test('TC-32 a marquee selects what is wholly inside it and nothing else', async ({
    page,
  }) => {
    await openBoard(page);
    const inside = await createNote(page, 400, 300, 'inside');
    await stopEditing(page);
    await createNote(page, 560, 300, 'half');
    await stopEditing(page);
    await createNote(page, 860, 300, 'outside');
    await stopEditing(page);

    // Let go of the note that creation left selected: a marquee adds to a selection,
    // and this test is about what the box itself takes.
    await clearSelection(page);

    // The box ends at x=520: the first note stops at 500, the second carries on to 660.
    await marquee(page, { x: 250, y: 150 }, { x: 520, y: 450 });

    expect(await selectedCount(page)).toBe(1);
    expect(await selectedIds(page)).toEqual([inside]);
    // One note selected is shown as that note's own tools; a count is what more than
    // one note gets.
    await expect(page.getByTestId('note-toolbar')).toBeVisible();
    expect(await selectionText(page)).toBeNull();
    // The box is gone once the pointer is up: it was a way of selecting, not a drawing.
    await expect(page.getByTestId('marquee')).toHaveCount(0);
  });

  // TC-33: the same selection, moved as a group over a note that is not in it, then
  // resized from a corner until it cannot get any smaller.
  test('TC-33 a group moves together, and a corner resize scales sizes and gaps', async ({
    page,
  }) => {
    await openBoard(page);
    // Made first, so it sits under everything made after it: the cluster is going to be
    // moved on top of it, and "the group renders above the fourth note" has to mean a
    // drawing order, not just a shared patch of board.
    const beneath = await createNote(page, 1000, 300, 'beneath');
    await stopEditing(page);
    // Two rows of three, 20 units apart.
    const cluster: string[] = [];
    for (const y of [250, 470]) {
      for (const x of [350, 570, 790]) {
        cluster.push(await createNote(page, x, y, 'cluster'));
        await stopEditing(page);
      }
    }

    // Box around the six. The seventh starts at x=900 and the box stops at 960, so it is
    // only partly inside and does not join.
    await clearSelection(page);
    expect(await selectedCount(page)).toBe(0);
    await marquee(page, { x: 200, y: 120 }, { x: 960, y: 600 });
    expect(await selectedCount(page)).toBe(6);
    expect(await selectionText(page)).toBe('6 selected');

    const before = await readNotes(page);
    const selectedBefore = cluster.map((id) => before[indexById(before, id)]);

    // Move: grab one of the selected notes and take the group 300 units along.
    const grab = await noteCentre(page, indexById(before, cluster[0] as string));
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 150, grab.y, { steps: 5 });
    await page.mouse.move(grab.x + 300, grab.y, { steps: 5 });
    await page.mouse.up();
    await settle(page);

    const moved = await readNotes(page);
    const selectedMoved = cluster.map((id) => moved[indexById(moved, id)]);
    for (const [index, note] of selectedMoved.entries()) {
      expect(note.left - (selectedBefore[index] as NoteInfo).left).toBe(300);
      expect(note.top - (selectedBefore[index] as NoteInfo).top).toBe(0);
    }
    // The note that was not in the box did not budge, and neither did the board.
    const asideBefore = before[indexById(before, beneath)];
    const asideMoved = moved[indexById(moved, beneath)];
    expect(asideMoved).toEqual(asideBefore);
    expect(await readCamera(page)).toEqual(STANDARD_VIEW);

    // The group landed on top of it: overlapping, and drawn above it.
    let overlaps = 0;
    for (const note of selectedMoved) {
      if (!overlapsRect(note, asideMoved)) continue;
      overlaps += 1;
      expect(note.z).toBeGreaterThan(asideMoved.z);
    }
    expect(overlaps).toBeGreaterThan(0);

    // Resize from the bottom-right corner. The box is 640 by 420, so 64 across and
    // 42 down is the same scale on either axis: 10% bigger, everywhere.
    await dragHandle(page, 'bottom-right', 64, 42);

    const resized = await readNotes(page);
    const selectedAfter = cluster.map((id) => resized[indexById(resized, id)]);
    const scale = (selectedAfter[0] as NoteInfo).width / (selectedMoved[0] as NoteInfo).width;
    expect(Math.abs(scale - 1.1)).toBeLessThan(0.01);
    for (const note of selectedAfter) {
      // Sizes scale, and a note stays a square.
      expect(Math.abs(note.width - STICKY_SIZE_WORLD * scale)).toBeLessThan(1);
      expect(note.width).toBe(note.height);
    }
    // Gaps scale by the same factor: the cluster grows, it does not crumple.
    const gapBefore = gapBetween(selectedMoved[0] as NoteInfo, selectedMoved[1] as NoteInfo);
    const gapAfter = gapBetween(selectedAfter[0] as NoteInfo, selectedAfter[1] as NoteInfo);
    expect(Math.abs(gapAfter / gapBefore - scale)).toBeLessThan(0.02);
    // Still the same six selected, and the seventh still not.
    expect(await selectedCount(page)).toBe(6);
    expect((await selectedIds(page)).sort()).toEqual([...cluster].sort());

    // The same handle pulled back past the floor stops there: a note is never
    // smaller than its type's minimum, however far the pointer goes.
    await dragHandle(page, 'bottom-right', -1154, -512);
    const shrunk = await readNotes(page);
    for (const id of cluster) {
      const note = shrunk[indexById(shrunk, id)];
      expect(Math.abs(note.width - STICKY_MIN_SIZE_WORLD)).toBeLessThan(1);
      expect(note.width).toBe(note.height);
    }
    // The note outside the selection was never resized at all.
    expect((shrunk[indexById(shrunk, beneath)] as NoteInfo).width).toBe(STICKY_SIZE_WORLD);

    // And one button in the bar takes the whole reorganised cluster away, leaving the
    // note that was never in the box.
    await deleteSelectionButton(page).click();
    await settle(page);
    await expect(page.getByTestId('sticky-note')).toHaveCount(1);
    expect(await selectedIds(page)).toEqual([]);
    expect(await selectionText(page)).toBeNull();
    const left = await readNotes(page);
    expect(left[0]?.id).toBe(beneath);
  });

  // TC-34: the arrows nudge the selection; they neither scroll the page nor pan.
  test('TC-34 the arrows nudge the selection and Delete removes it', async ({
    page,
  }) => {
    await openBoard(page);
    const made: string[] = [];
    for (const y of [250, 470]) {
      for (const x of [350, 570, 790]) {
        made.push(await createNote(page, x, y, 'note'));
        await stopEditing(page);
      }
    }

    await selectAllOnBoard(page);
    expect(await selectedCount(page)).toBe(6);
    expect(await selectionText(page)).toBe('6 selected');

    const before = await readNotes(page);
    const cameraBefore = await readCamera(page);

    // Three small nudges: the selection is three units along, every note by the same
    // amount, and nothing else about the board has moved.
    for (let press = 0; press < 3; press += 1) {
      await page.keyboard.press('ArrowRight');
      await settle(page);
      const after = await readNotes(page);
      for (const id of made) {
        const note = after[indexById(after, id)];
        const was = before[indexById(before, id)];
        expect(note.left - was.left).toBe(NUDGE_STEP_WORLD * (press + 1));
        expect(note.top).toBe(was.top);
      }
    }

    // Shift is the large step: ten further in a single press.
    await page.keyboard.press('Shift+ArrowRight');
    await settle(page);
    const nudged = await readNotes(page);
    for (const id of made) {
      const note = nudged[indexById(nudged, id)];
      const was = before[indexById(before, id)];
      expect(note.left - was.left).toBe(NUDGE_STEP_WORLD * 3 + NUDGE_LARGE_STEP_WORLD);
    }

    // The board did not pan, the page did not scroll, the browser did not zoom.
    expect(await readCamera(page)).toEqual(cameraBefore);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollTop)).toBe(0);

    await page.keyboard.press('Delete');
    await settle(page);
    await expect(page.getByTestId('sticky-note')).toHaveCount(0);
    expect(await selectedCount(page)).toBe(0);
    // Nothing left to act on: no bar, so no dead Delete button.
    await expect(selectionBar(page)).toHaveCount(0);
  });

  // The board's own ways of letting go, on the way: Escape and a click of space.
  test('Escape and a click of empty space both let go of the selection', async ({
    page,
  }) => {
    await openBoard(page);
    await createNote(page, 400, 300);
    await stopEditing(page);
    await createNote(page, 700, 300);
    await stopEditing(page);

    await selectAllOnBoard(page);
    expect(await selectedCount(page)).toBe(2);
    await clearSelection(page);
    expect(await selectedCount(page)).toBe(0);
    await expect(selectionBar(page)).toHaveCount(0);

    await selectAllOnBoard(page);
    expect(await selectedCount(page)).toBe(2);
    await page.mouse.click(1050, 120);
    await settle(page);
    expect(await selectedCount(page)).toBe(0);
  });

  // A plain drag of empty space is the story 1 pan, and does not draw a box.
  test('a drag without Shift pans and selects nothing', async ({ page }) => {
    await openBoard(page);
    await createNote(page, 400, 300);
    await stopEditing(page);
    const before = await readNotes(page);
    await clearSelection(page);
    expect(await selectedCount(page)).toBe(0);

    await page.mouse.move(200, 120);
    await page.mouse.down();
    await page.mouse.move(500, 400, { steps: 5 });
    await expect(page.getByTestId('marquee')).toHaveCount(0);
    await page.mouse.up();
    await settle(page);

    expect(await selectedCount(page)).toBe(0);
    expect(await readCamera(page)).not.toEqual(STANDARD_VIEW);

    // The note came with the board rather than moving under the pointer.
    const after = await readNotes(page);
    expect(after[0]?.left).toBe(before[0]?.left);
  });
});

test.describe('a colleague deleting while I select (TC-35)', () => {
  test('TC-35 a note deleted by someone else drops out of my selection', async ({
    browser,
  }) => {
    const { people } = await openParticipants(browser, 2);
    const [lee, sam] = people as [Participant, Participant];

    const mine: string[] = [];
    for (const [index, x] of [350, 570, 790].entries()) {
      mine.push(await createNoteFor(lee, x, 250, `note ${String(index + 1)}`));
      await stopEditingFor(lee);
    }

    await selectAllOnBoard(lee.page);
    // The four this board holds: the three just made, and the one the room opened with.
    expect(await selectionText(lee.page)).toBe('4 selected');

    // Sam deletes one of them, with his own selection and his own bin.
    const gone = mine[1] as string;
    await deleteNote(sam, gone);

    // Lee's selection loses that id on its own, and says one fewer.
    await expectEventually("Lee's count drops to 3 selected", () => selectionText(lee.page), {
      is: (text) => text === '3 selected',
      description: "Lee's bar does not say '3 selected'",
    });
    const stillSelected = await selectedIds(lee.page);
    expect(stillSelected).not.toContain(gone);
    expect(stillSelected).toContain(mine[0] as string);
    expect(stillSelected).toContain(mine[2] as string);
    // Three, not two: this board's select-all took the room's opening note too.
    expect(stillSelected.length).toBe(3);
    await expect(lee.page.getByTestId('sticky-note')).toHaveCount(3);
    // Lee never had to do anything: no ghost of the deleted note is selected.
    expect(await lee.note(gone)).toBeUndefined();
  });
});

test.describe('a board at full capacity (TC-36)', () => {
  test('TC-36 everyone moves a different group and every screen ends up the same', async ({
    browser,
  }) => {
    const { people } = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
    const [host, ...others] = people as [Participant, ...Participant[]];

    // One note per person, laid out where five people can each press their own.
    const spots = [
      { x: 250, y: 200 },
      { x: 470, y: 200 },
      { x: 690, y: 200 },
      { x: 250, y: 420 },
      { x: 470, y: 420 },
    ].slice(0, people.length);
    const ids: string[] = [];
    for (const [index, spot] of spots.entries()) {
      ids.push(await createNoteFor(host, spot.x, spot.y, `theirs ${String(index + 1)}`));
      await stopEditingFor(host);
    }
    for (const who of others) {
      await expectEventually(`${who.name} sees all ${String(people.length)} notes`, () =>
        who.notes(), { is: (all) => ids.every((id) => all.has(id)) });
    }

    // Where the notes that people are about to pull are before anybody pulls one.
    const start = await host.notes();
    const moved = [...ids]
      .sort()
      .map((id) => {
        const note = start.get(id);
        if (note === undefined) throw new Error('a note disappeared before anybody moved it');
        return `${id}:${String(Math.round(note.left + 60))},${String(Math.round(note.top + 40))}`;
      })
      .join('|');

    // Each person moves their own note by the same distance, at the same time. No
    // two of them touch the same note, which is what makes the outcome predictable.
    await Promise.all(
      people.map((who, index) => dragNote(who, ids[index] as string, 60, 40)),
    );

    // One screen is enough to be right about, and then every screen has to agree.
    const settled = await expectEventually('the layout settles on one screen', () =>
      layoutOf(host, ids), {
      is: (layout) => layout === moved,
      description: 'one screen has every moved note 60 across and 40 down',
    });

    for (const who of others) {
      await expectEventually(`${who.name} agrees on the layout`, () => layoutOf(who, ids), {
        is: (layout) => layout === settled,
        description: `${who.name} has a different layout`,
      });
    }

    // Notes square, as they were: moving does not resize anything.
    for (const who of people) {
      for (const note of await readNotes(who.page)) {
        expect(note.width).toBe(STICKY_SIZE_WORLD);
        expect(note.height).toBe(STICKY_SIZE_WORLD);
      }
    }
  });
});
