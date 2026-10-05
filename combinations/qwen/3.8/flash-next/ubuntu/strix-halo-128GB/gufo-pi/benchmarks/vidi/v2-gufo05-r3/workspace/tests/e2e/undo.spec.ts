/**
 * Story 8 e2e (task 5): TC-22 to TC-24, plus the quieter cases the design's
 * coverage table leaves to judgement.
 *
 * Two to five people in as many browser contexts on one board, driven only
 * through the keyboard, the pointer and the toolbar. Everything is read back from
 * the board model (the test-only `window.__vidi6.getBoard` hook) on *every*
 * screen, because the promise of this story is about whose change disappears:
 * mine, and only mine.
 */
import { expect, test, type Page } from '@playwright/test';

import { MAX_CONCURRENT_EDITORS, STICKY_COLORS, UNDO_MAX_STEPS } from '../../src/shared/config';
import type { StickyColor } from '../../src/shared/config';
import type { StickySnapshot } from '../../src/shared/board-model';
import {
  boardKey,
  boardOf,
  closeParticipants,
  createBoard,
  openParticipant,
  openParticipants,
  waitForBoardsEqual,
  waitForConnected,
  type Participant,
} from './helpers/participants';
import { setCamera } from './helpers/board';
import {
  clearSelection,
  createNoteAtScreen,
  resizeHandle,
  selectedIds,
  shiftDragBy,
} from './helpers/selection';
import {
  boxOf,
  centredCamera,
  createStickyByButton,
  dragBy,
  editor,
  getBoard,
  noteById,
  stopEditing,
} from './helpers/sticky-notes';

const ZOOM = 0.4;
/** A world point's screen point for a centred camera at {@link ZOOM}. */
const at = (world: { x: number; y: number }) => ({
  x: 640 + world.x * ZOOM,
  y: 400 + world.y * ZOOM,
});

/** One note as the model holds it, on the given person's screen. */
async function noteState(
  participant: Participant,
  id: string,
): Promise<{ x: number; y: number; text: string; color: string } | null> {
  const found = (await boardOf(participant)).find((object) => object.id === id);
  return found ? { x: found.x, y: found.y, text: found.text, color: found.color } : null;
}

const undoButton = (page: Page) => page.locator('[data-undo]');
const redoButton = (page: Page) => page.locator('[data-redo]');

/** Reload a participant's board: their own history starts again from empty. */
async function reopen(participant: Participant): Promise<void> {
  await participant.page.reload();
  await participant.page.waitForSelector('[data-board-surface]');
  await waitForConnected(participant);
  await setCamera(participant.page, centredCamera(ZOOM));
}

/** Select a note and pick a colour from the toolbar above it. */
async function paint(participant: Participant, id: string, color: StickyColor): Promise<void> {
  await noteById(participant.page, id).click();
  await participant.page.getByRole('button', { name: `${color} colour` }).click();
  await clearSelection(participant.page);
}

/** Select a note and pull its bottom-right handle by `(dx, dy)` world units. */
async function grow(
  participant: Participant,
  id: string,
  dx: number,
  dy: number,
): Promise<void> {
  await noteById(participant.page, id).click();
  const handle = resizeHandle(participant.page, 'Resize bottom-right');
  const box = await handle.boundingBox();
  if (!box) throw new Error('the resize handle has no bounding box');
  await dragBy(
    participant.page,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    dx * ZOOM,
    dy * ZOOM,
  );
  await clearSelection(participant.page);
}

/** Click every undo/redo click there is to click, stopping at the limit. */
async function clickUntilDisabled(
  page: Page,
  attribute: 'data-undo' | 'data-redo',
  attempts: number,
): Promise<number> {
  return page.evaluate(
    async ({ attribute: name, count }) => {
      const button = document.querySelector<HTMLButtonElement>(`[${name}]`);
      if (!button) throw new Error(`the ${name} button is missing`);
      let times = 0;
      for (let step = 0; step < count; step++) {
        if (button.disabled) break;
        button.click();
        times++;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return times;
    },
    { attribute, count: attempts },
  );
}

/** Nothing at all was reported to the console by anybody. */
function expectQuiet(people: Participant[]): void {
  for (const person of people) expect(person.consoleErrors, person.name).toEqual([]);
}

test.describe('undo my own work, and nobody else’s', () => {
  test('TC-22 eight notes I deleted come back, and my colleague’s note is not mine to touch', async ({
    browser,
    request,
  }) => {
    const boardId = await createBoard(request);
    const [mia, raj] = await openParticipants(browser, boardId, ['Mia', 'Raj']);
    try {
      await setCamera(mia.page, centredCamera(ZOOM));
      await setCamera(raj.page, centredCamera(ZOOM));

      // Raj makes eight notes, varied in text, colour, size and position, so a
      // restoration that loses any one of those shows up. They are *his* work:
      // undoing my delete of someone else's notes has to bring theirs back.
      const spots = [
        { x: -600, y: -200 },
        { x: -200, y: -200 },
        { x: 200, y: -200 },
        { x: 600, y: -200 },
        { x: -600, y: 200 },
        { x: -200, y: 200 },
        { x: 200, y: 200 },
        { x: 600, y: 200 },
      ];
      const colors = Object.keys(STICKY_COLORS) as StickyColor[];
      const eight: StickySnapshot[] = [];
      for (const [index, spot] of spots.entries()) {
        const point = at(spot);
        eight.push(await createNoteAtScreen(raj, point.x, point.y, `Raj ${index + 1}`));
      }
      await paint(raj, eight[1].id, colors[1 % colors.length]);
      await paint(raj, eight[4].id, colors[2 % colors.length]);
      await grow(raj, eight[2].id, 120, 120);
      await grow(raj, eight[6].id, -60, -60);
      await waitForBoardsEqual([mia, raj], 'eight of Raj’s notes on both screens');

      // Exactly what the board looked like before Mia touches it.
      const beforeDelete = await boardOf(mia);
      expect(beforeDelete).toHaveLength(8);
      expect(new Set(beforeDelete.map((note) => note.color)).size).toBeGreaterThan(1);
      expect(
        new Set(beforeDelete.map((note) => `${note.width ?? 0}x${note.height ?? 0}`)).size,
      ).toBeGreaterThan(1);

      // Mia box-selects all eight in one rectangle and deletes them: one action,
      // so one undo step.
      const from = at({ x: -900, y: -450 });
      const to = at({ x: 900, y: 450 });
      await shiftDragBy(mia.page, from, to.x - from.x, to.y - from.y);
      await expect
        .poll(() => selectedIds(mia.page))
        .toEqual(eight.map((note) => note.id).sort());
      await mia.page.keyboard.press('Delete');
      await expectEventuallyLength(mia, 0);
      await waitForBoardsEqual([mia, raj], 'the eight are gone from both screens');

      // Raj carries on, unaware.
      const rajPoint = at({ x: 1100, y: -500 });
      const his = await createNoteAtScreen(raj, rajPoint.x, rajPoint.y, 'added afterwards');
      await waitForBoardsEqual([mia, raj], 'Raj’s new note on both screens');
      const hisState = await noteState(raj, his.id);

      // Mia takes her delete back.
      await mia.page.keyboard.press('Control+z');
      await expectEventuallyLength(mia, 9);
      await waitForBoardsEqual([mia, raj], 'all nine on both screens');
      const restored = (await boardOf(mia)).filter((note) => note.id !== his.id);
      expect(boardKey(restored)).toBe(boardKey(beforeDelete));

      // Her history held one step, and it has been used up.
      await expect(undoButton(mia.page)).toBeDisabled();

      // Redo puts the delete back, on both screens — Raj’s note excepted.
      await redoButton(mia.page).click();
      await expectEventuallyLength(raj, 1);
      await waitForBoardsEqual([mia, raj], 'only Raj’s later note is left');
      expect(await noteState(mia, his.id)).toEqual(hisState);
      expect(await noteState(raj, his.id)).toEqual(hisState);

      expectQuiet([mia, raj]);
    } finally {
      await closeParticipants([mia, raj]);
    }
  });

  test('TC-23 undoing a move of a note my colleague deleted does nothing, and my history still works', async ({
    browser,
    request,
  }) => {
    const boardId = await createBoard(request);
    const [mia, raj] = await openParticipants(browser, boardId, ['Mia', 'Raj']);
    try {
      await setCamera(mia.page, centredCamera(ZOOM));
      await setCamera(raj.page, centredCamera(ZOOM));

      const one = at({ x: -100, y: 0 });
      const two = at({ x: 400, y: 300 });
      const moved = await createNoteAtScreen(raj, one.x, one.y, 'Raj moves this one');
      const kept = await createNoteAtScreen(raj, two.x, two.y, 'and this one stays');
      await waitForBoardsEqual([mia, raj], 'both notes on both screens');

      // Mia moves Raj's note: one step of her own.
      const box = await boxOf(noteById(mia.page, moved.id));
      await dragBy(mia.page, { x: box.cx, y: box.cy }, 150 * ZOOM, 60 * ZOOM);
      await waitForBoardsEqual([mia, raj], 'Mia has moved the note');

      // Raj deletes it while Mia is reaching for the keyboard.
      await noteById(raj.page, moved.id).click();
      await raj.page.keyboard.press('Delete');
      await expectEventuallyLength(raj, 1);
      await waitForBoardsEqual([mia, raj], 'the note is gone from both screens');

      // Mia undoes a move of something that no longer exists. Nothing appears,
      // nothing throws, and the step is simply spent.
      await mia.page.keyboard.press('Control+z');
      await mia.page.waitForTimeout(250);
      await expectEventuallyLength(mia, 1);
      await waitForBoardsEqual([mia, raj], 'both screens still agree');
      expect((await boardOf(mia)).map((note) => note.id)).toEqual([kept.id]);
      await expect(undoButton(mia.page)).toBeDisabled();

      // Her history is not broken: a change of her own still undoes normally.
      const hersPoint = at({ x: -500, y: -400 });
      const hers = await createNoteAtScreen(mia, hersPoint.x, hersPoint.y, 'Mia’s own');
      const hersBox = await boxOf(noteById(mia.page, hers.id));
      await dragBy(mia.page, { x: hersBox.cx, y: hersBox.cy }, 120 * ZOOM, 40 * ZOOM);
      await waitForBoardsEqual([mia, raj], 'Mia moves her own note');
      const displaced = await noteState(mia, hers.id);

      await mia.page.keyboard.press('Control+z');
      await expect
        .poll(() => noteState(mia, hers.id))
        .toEqual({ ...displaced!, x: hers.x, y: hers.y });
      await waitForBoardsEqual([mia, raj], 'the board agrees again');

      expectQuiet([mia, raj]);
    } finally {
      await closeParticipants([mia, raj]);
    }
  });

  test('TC-24 everybody undoes at once, and only ever themselves', async ({ browser, request }) => {
    const boardId = await createBoard(request);
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, index) => `Editor ${index + 1}`);
    const people = await openParticipants(browser, boardId, names);
    try {
      for (const person of people) await setCamera(person.page, centredCamera(ZOOM));

      // One person seeds one note each. They then reload, so nobody carries a
      // step into the test: from here on, every step on the board is a step of
      // exactly one person, and the person who made the notes has no history.
      const seed = people[0]!;
      const notes: StickySnapshot[] = [];
      for (const index of names.keys()) {
        const point = at({ x: -700 + index * 350, y: index % 2 === 0 ? -200 : 200 });
        notes.push(await createNoteAtScreen(seed, point.x, point.y, `note ${index + 1}`));
      }
      await reopen(seed);
      await waitForBoardsEqual(people, 'every note on every screen');
      const asStarted = await boardOf(people[0]!);

      // Each moves their own note and types in the next one, all at once.
      await Promise.all(
        people.map(async (person, index) => {
          const mine = notes[index]!;
          const box = await boxOf(noteById(person.page, mine.id));
          await dragBy(person.page, { x: box.cx, y: box.cy }, 90 * ZOOM, 50 * ZOOM);
        }),
      );
      await waitForBoardsEqual(people, 'everybody has moved their note');

      await Promise.all(
        people.map(async (person, index) => {
          const theirs = notes[(index + 1) % notes.length]!;
          await noteById(person.page, theirs.id).dblclick();
          await editor(person.page).focus();
          await person.page.keyboard.type(` ${person.name}`, { delay: 5 });
          await person.page.keyboard.press('Escape');
          await editor(person.page).waitFor({ state: 'hidden' });
        }),
      );
      await waitForBoardsEqual(people, 'everybody has typed in a note');
      const workedOn = await boardOf(people[0]!);
      expect(workedOn.filter((note) => note.text.includes('Editor')).length).toBe(names.length);
      expect(boardKey(workedOn)).not.toBe(boardKey(asStarted));

      // Two undo keystrokes per person, all at the same time. Each takes back
      // their own typing and then their own move.
      for (let round = 0; round < 2; round += 1) {
        await Promise.all(people.map((person) => person.page.keyboard.press('Control+z')));
      }

      // The board ends up exactly as it was before anybody did anything: every
      // person's work reversed, and nobody's reversed twice or not at all.
      await waitForBoardsEqual(people, 'all screens agree after everybody undid');
      const settled = await boardOf(people[0]!);
      expect(boardKey(settled)).toBe(boardKey(asStarted));

      // And each person's history is empty, because it only ever held their own
      // two steps.
      for (const person of people) {
        await expect(undoButton(person.page)).toBeDisabled();
        await expect(redoButton(person.page)).toBeEnabled();
      }

      // One more keystroke from one person reaches nobody.
      await Promise.all(people.map((person) => person.page.keyboard.press('Control+z')));
      await waitForBoardsEqual(people, 'another round of undo changes nothing');
      expect(boardKey(await boardOf(people[0]!))).toBe(boardKey(asStarted));

      expectQuiet(people);
    } finally {
      await closeParticipants(people);
    }
  });
});

test.describe('undo alongside someone else, the everyday cases', () => {
  test('a mistake goes back on my screen, and my colleague sees it go', async ({
    browser,
    request,
  }) => {
    const boardId = await createBoard(request);
    const [alex, sam] = await openParticipants(browser, boardId, ['Alex', 'Sam']);
    try {
      await setCamera(alex.page, centredCamera(ZOOM));
      await setCamera(sam.page, centredCamera(ZOOM));

      const mine = await createNoteAtScreen(alex, at({ x: 0, y: 0 }).x, at({ x: 0, y: 0 }).y, 'quarterly');
      const theirs = await createNoteAtScreen(sam, at({ x: 300, y: -140 }).x, at({ x: 300, y: -140 }).y, 'roadmap');
      await waitForBoardsEqual([alex, sam], 'both notes on both screens');

      // Sam moves their own note along while Alex is busy typing.
      const samStart = await noteState(sam, theirs.id);
      const samBox = await boxOf(noteById(sam.page, theirs.id));
      await dragBy(sam.page, { x: samBox.cx, y: samBox.cy }, 140 * ZOOM, 80 * ZOOM);
      await waitForBoardsEqual([alex, sam], 'Sam moves their note');
      const samMoved = await noteState(sam, theirs.id);
      expect(samMoved).not.toEqual(samStart);

      // Alex types the wrong thing into their own note, then takes it back with
      // the shortcut a person's hands already know.
      await noteById(alex.page, mine.id).dblclick();
      await editor(alex.page).focus();
      await alex.page.keyboard.type(' rev2 FINAL', { delay: 15 });
      await expect
        .poll(() => noteState(alex, mine.id))
        .toHaveProperty('text', 'quarterly rev2 FINAL');

      await alex.page.keyboard.press('Control+z');

      // The mistake is gone from Alex's note...
      await expect.poll(() => noteState(alex, mine.id)).toHaveProperty('text', 'quarterly');
      // ...Sam sees it go...
      await expect.poll(() => noteState(sam, mine.id)).toHaveProperty('text', 'quarterly');
      // ...and nothing of Sam's own work moved.
      expect(await noteState(sam, theirs.id)).toEqual(samMoved);
      expect(await noteState(alex, theirs.id)).toEqual(samMoved);
      expectQuiet([alex, sam]);
    } finally {
      await closeParticipants([alex, sam]);
    }
  });

  test('my undo cannot touch what my colleague is doing in another note', async ({
    browser,
    request,
  }) => {
    const boardId = await createBoard(request);
    const [alex, sam] = await openParticipants(browser, boardId, ['Alex', 'Sam']);
    try {
      await setCamera(alex.page, centredCamera(ZOOM));
      await setCamera(sam.page, centredCamera(ZOOM));

      const mine = await createNoteAtScreen(alex, at({ x: -200, y: 100 }).x, at({ x: -200, y: 100 }).y, 'mine');
      const theirs = await createNoteAtScreen(sam, at({ x: 300, y: -100 }).x, at({ x: 300, y: -100 }).y, 'theirs');
      await waitForBoardsEqual([alex, sam], 'both notes on both screens');

      // Alex starts a fresh session, so the only thing in Alex's history from
      // here on is the move below.
      await reopen(alex);
      const myStart = (await noteState(alex, mine.id))!;

      const myBox = await boxOf(noteById(alex.page, mine.id));
      await dragBy(alex.page, { x: myBox.cx, y: myBox.cy }, 180 * ZOOM, 60 * ZOOM);
      await waitForBoardsEqual([alex, sam], 'Alex moves their note');

      // Sam is still working in their own note.
      await noteById(sam.page, theirs.id).dblclick();
      await editor(sam.page).focus();
      await sam.page.keyboard.type(' (in progress)', { delay: 10 });
      await waitForBoardsEqual([alex, sam], 'Sam types in their note');
      const samTyping = await noteState(sam, theirs.id);

      // Alex undoes: only their own note comes back.
      await alex.page.keyboard.press('Control+z');
      await expect.poll(() => noteState(alex, mine.id)).toEqual(myStart);
      await expect.poll(() => noteState(sam, mine.id)).toEqual(myStart);
      expect(await noteState(sam, theirs.id)).toEqual(samTyping);
      expect(await noteState(alex, theirs.id)).toEqual(samTyping);

      // Alex's history is empty now: pressing undo again reaches nothing at all,
      // let alone Sam's work.
      await expect(undoButton(alex.page)).toBeDisabled();
      await alex.page.keyboard.press('Control+z');
      await alex.page.keyboard.press('Control+z');
      expect(await noteState(alex, theirs.id)).toEqual(samTyping);
      expectQuiet([alex, sam]);
    } finally {
      await closeParticipants([alex, sam]);
    }
  });

  test('the history is a setting, and the oldest step goes first', async ({ browser, request }) => {
    test.setTimeout(180_000);
    const boardId = await createBoard(request);
    const alex = await openParticipant(browser, 'Alex', boardId);
    try {
      await setCamera(alex.page, centredCamera(ZOOM));
      await createStickyByButton(alex.page);
      await stopEditing(alex.page);
      const [note] = await getBoard(alex.page);
      if (!note) throw new Error('the new note is missing');

      // Select it, so the colour swatches are on screen for every step.
      await noteById(alex.page, note.id).click();
      await expect(alex.page.locator('[data-note-toolbar]')).toBeVisible();

      // More colour changes than the history is allowed to keep. Each swatch
      // click is its own step: a click is a discrete action.
      const steps = UNDO_MAX_STEPS + 1;
      await alex.page.evaluate(async (count) => {
        const blue = document.querySelector<HTMLButtonElement>('[aria-label="Blue colour"]');
        const yellow = document.querySelector<HTMLButtonElement>('[aria-label="Yellow colour"]');
        if (!blue || !yellow) throw new Error('the colour swatches are missing');
        for (let step = 0; step < count; step++) {
          (step % 2 === 0 ? blue : yellow).click();
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }, steps);
      expect((await noteState(alex, note.id))?.color).toBe('blue');

      // Undo until the board says there is nothing of mine left to undo. It stops
      // at the limit, not at the number of changes: the very first step has been
      // dropped, so the note stays blue instead of going back to yellow.
      expect(await clickUntilDisabled(alex.page, 'data-undo', steps + 5)).toBe(UNDO_MAX_STEPS);
      expect((await noteState(alex, note.id))?.color).toBe('blue');
      await expect(undoButton(alex.page)).toBeDisabled();
      await expect(redoButton(alex.page)).toBeEnabled();

      // Redo gives back exactly the steps the history still holds.
      expect(await clickUntilDisabled(alex.page, 'data-redo', steps + 5)).toBe(UNDO_MAX_STEPS);
      expect((await noteState(alex, note.id))?.color).toBe('blue');
      await expect(redoButton(alex.page)).toBeDisabled();
      expect((await getBoard(alex.page)).length).toBe(1);
      expectQuiet([alex]);
    } finally {
      await closeParticipants([alex]);
    }
  });
});

/** Wait until this person's board holds `length` objects. */
async function expectEventuallyLength(participant: Participant, length: number): Promise<void> {
  await expect
    .poll(async () => (await boardOf(participant)).length, { timeout: 10_000 })
    .toBe(length);
}
