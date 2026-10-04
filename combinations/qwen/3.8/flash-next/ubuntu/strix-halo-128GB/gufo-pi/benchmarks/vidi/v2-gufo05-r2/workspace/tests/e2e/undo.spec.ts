/**
 * Story 8 end to end: undo and redo in the real browser, with the real provider
 * carrying other people's changes.
 *
 * The unit and component tests prove origin filtering against a simulated peer;
 * only the browser proves it against the actual `y-websocket` origin — that one
 * person can undo their own work while a colleague's changes, arriving over the
 * wire, stay standing on every screen (PRD undo.own, undo.safe, undo.keyboard).
 */

import { expect, test } from './helpers/live';
import {
  changeArrives,
  createNoteAt,
  deleteNoteViaToolbar,
  expectNoErrors,
  type Participant,
} from './helpers/live';
import { setCamera, VIEWPORT_SIZE, type Pixel } from './helpers/board';
import { endEditing, getNotes, noteBoxes } from './helpers/notes';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

const PEOPLE = ['Mia', 'Raj', 'Ana', 'Bo', 'Cy'];

/** A camera that puts world (0,0) at the middle of the screen at `zoom`. */
function centredOn(worldX: number, worldY: number, zoom: number) {
  return {
    x: worldX - VIEWPORT_SIZE.width / (2 * zoom),
    y: worldY - VIEWPORT_SIZE.height / (2 * zoom),
    zoom,
  };
}

function centre(box: { x: number; y: number; width: number; height: number }): Pixel {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function count(page: Participant['page'] | { page: Participant['page'] }): Promise<number> {
  const p = 'page' in page ? page.page : page;
  return (await getNotes(p)).length;
}

async function hasNote(page: Participant['page'], id: string): Promise<boolean> {
  return (await getNotes(page)).some((note) => note.id === id);
}

async function createNotes(person: Participant, points: Pixel[]): Promise<string[]> {
  const ids: string[] = [];
  for (const at of points) {
    const id = await createNoteAt(person.page, at);
    ids.push(id);
    await endEditing(person.page);
  }
  return ids;
}

test('TC-22: undo restores my delete while a colleague keeps their new note, and redo deletes again', async ({
  liveBoards,
}) => {
  const { people } = await liveBoards.open([PEOPLE[0]!, PEOPLE[1]!]);
  const [mia, raj] = people;
  await setCamera(mia.page, centredOn(0, 0, 0.3));
  await setCamera(raj.page, centredOn(0, 0, 0.3));

  // Mia makes eight notes in her own column.
  const points = Array.from({ length: 8 }, (_, i) => ({
    x: 360 + (i % 2) * 120,
    y: 220 + Math.floor(i / 2) * 120,
  }));
  const ids = await createNotes(mia, points);
  await changeArrives(
    'TC-22 eight notes reach Raj',
    async () => {},
    async () => (await getNotes(raj.page)).length === 8,
  );

  // Mia selects everything and deletes it — one action, gone on both screens.
  await mia.page.keyboard.press('Control+a');
  await mia.page.keyboard.press('Delete');
  await expect.poll(() => count(mia.page)).toBe(0);
  await expect.poll(() => count(raj.page)).toBe(0);

  // While the delete sits in Mia's history, Raj adds a note of his own.
  const rajId = await createNoteAt(raj.page, { x: 900, y: 300 });
  await endEditing(raj.page);
  await expect.poll(() => count(mia.page)).toBe(1);

  // Mia undoes her delete: her eight come back on both screens, Raj's stays.
  await changeArrives(
    'TC-22 undo restores eight, keeps Raj note',
    () => mia.page.keyboard.press('Control+z'),
    async () => {
      const onMia = await getNotes(mia.page);
      const onRaj = await getNotes(raj.page);
      return (
        onMia.length === 9 &&
        onRaj.length === 9 &&
        ids.every((id) => onRaj.some((n) => n.id === id)) &&
        onRaj.some((n) => n.id === rajId)
      );
    },
  );

  // Redo deletes the eight again — still never touching Raj's note.
  await changeArrives(
    'TC-22 redo deletes eight again, keeps Raj note',
    () => mia.page.keyboard.press('Control+Shift+z'),
    async () => {
      const onMia = await getNotes(mia.page);
      const onRaj = await getNotes(raj.page);
      return onMia.length === 1 && onRaj.length === 1 && onRaj.some((n) => n.id === rajId);
    },
  );

  expectNoErrors(people);
});

test('TC-23: undoing a move of a note a colleague deleted is not an error', async ({
  liveBoards,
}) => {
  const { people } = await liveBoards.open([PEOPLE[0]!, PEOPLE[1]!]);
  const [mia, raj] = people;

  const id = await createNoteAt(mia.page, { x: 500, y: 400 });
  await endEditing(mia.page);
  await changeArrives(
    'TC-23 note reaches Raj',
    async () => {},
    async () => hasNote(raj.page, id),
  );

  // Mia moves the note.
  const box = (await noteBoxes(mia.page))[id]!;
  await changeArrives(
    'TC-23 move reaches Raj',
    () =>
      mia.page.mouse
        .move(centre(box).x, centre(box).y)
        .then(() => mia.page.mouse.down())
        .then(() => mia.page.mouse.move(centre(box).x + 160, centre(box).y + 90, { steps: 8 }))
        .then(() => mia.page.mouse.up()),
    async () => {
      const moved = (await getNotes(raj.page)).find((n) => n.id === id);
      const mine = (await getNotes(mia.page)).find((n) => n.id === id);
      return !!moved && !!mine && moved.x === mine.x && moved.y === mine.y;
    },
  );

  // Raj deletes it while it is on both screens.
  await deleteNoteViaToolbar(raj.page, id);
  await expect.poll(() => hasNote(mia.page, id)).toBe(false);

  // Mia undoes: nothing is resurrected, and the board does not fall over.
  await mia.page.keyboard.press('Control+z');
  await expect.poll(async () => !(await hasNote(mia.page, id)) && !(await hasNote(raj.page, id))).toBe(
    true,
  );

  // Her history is still usable — further undo/redo are harmless.
  await mia.page.keyboard.press('Control+z');
  await mia.page.keyboard.press('Control+Shift+z');
  await expect.poll(() => hasNote(mia.page, id)).toBe(false);

  expectNoErrors(people);
});

test('TC-24: everyone undoes only their own change; the boards stay identical', async ({
  liveBoards,
}) => {
  const { people } = await liveBoards.open(PEOPLE.slice(0, MAX_CONCURRENT_EDITORS));
  for (const person of people) await setCamera(person.page, centredOn(0, 0, 0.35));

  // Each person creates one note in their own slot; it reaches everybody.
  const created = new Map<string, string>();
  for (const [index, person] of people.entries()) {
    const at = { x: 140 + (index % 6) * 110, y: 140 };
    const id = await createNoteAt(person.page, at);
    created.set(person.name, id);
    await endEditing(person.page);
    await changeArrives(
      `TC-24 ${person.name} note reaches all`,
      async () => {},
      async () => {
        for (const other of people) if (!(await hasNote(other.page, id))) return false;
        return true;
      },
    );
  }
  await expect
    .poll(async () => {
      for (const person of people) if ((await count(person.page)) !== people.length) return false;
      return true;
    })
    .toBe(true);

  // Everybody undoes their own last change at once. Each stack holds only that
  // person's own create, so each note disappears for its own author only.
  await Promise.all(people.map((person) => person.page.keyboard.press('Control+z')));

  // In the end the board is empty everywhere — each person's change reverted,
  // nobody else's — and every screen agrees.
  await expect
    .poll(async () => {
      for (const person of people) if ((await count(person.page)) !== 0) return false;
      return true;
    })
    .toBe(true);

  const expected = await getNotes(people[0]!.page);
  for (const person of people) {
    expect(`${person.name}: ${JSON.stringify(await getNotes(person.page))}`).toBe(
      `${person.name}: ${JSON.stringify(expected)}`,
    );
  }

  expectNoErrors(people);
});
