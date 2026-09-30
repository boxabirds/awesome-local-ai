// Story 8 — undo and redo my own changes without undoing anyone else's (TC-22 to TC-24).
import { type Page, expect, test } from '@playwright/test';
import type { StickySnapshot } from '../../src/shared/board-model';
import { E2E_EVENTUAL_TIMEOUT_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { CLUSTER_PITCH, type UndoSeedNote, undoRetroBoard } from '../fixtures/undo-board';
import { nextFrames, setCamera } from './helpers/board';
import { type Participant, closeParticipants, getNotes, openParticipants } from './helpers/participants';

type Camera = { x: number; y: number; zoom: number };
const CAM: Camera = { x: -300, y: -100, zoom: 0.5 };
const toScreen = (w: { x: number; y: number }) => ({ x: (w.x - CAM.x) * CAM.zoom, y: (w.y - CAM.y) * CAM.zoom });
const eventually = { timeout: E2E_EVENTUAL_TIMEOUT_MS };

async function seed(page: Page, notes: readonly UndoSeedNote[]): Promise<string[]> {
  const ids = await page.evaluate((list) => window.__vidi6!.seedNotes!(list), notes);
  await expect.poll(async () => (await getNotes(page)).length).toBeGreaterThanOrEqual(notes.length);
  return ids;
}

/** Board content as every participant should see it. */
function boardOf(notes: readonly StickySnapshot[]) {
  return [...notes]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(({ id, text, color, x, y, width, height }) => ({ id, text, color, x, y, width, height }));
}

async function board(page: Page) {
  return boardOf(await getNotes(page));
}

/** Waits until every participant shows `expected`. */
async function expectBoards(people: readonly Participant[], expected: ReturnType<typeof boardOf>) {
  await Promise.all(people.map((p) => expect.poll(() => board(p.page), { ...eventually, message: p.name }).toEqual(expected)));
}

async function noteCentre(page: Page, id: string) {
  const n = (await getNotes(page)).find((note) => note.id === id);
  if (!n) throw new Error(`note ${id} not found`);
  return toScreen({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
}

async function dragNote(page: Page, id: string, dx: number, dy: number) {
  const from = await noteCentre(page, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  await page.mouse.up();
  await nextFrames(page);
}

const undoButton = (page: Page) => page.getByRole('button', { name: 'Undo' });
const redoButton = (page: Page) => page.getByRole('button', { name: 'Redo' });

test.describe('story 8: undo and redo my own changes', () => {
  test('TC-22 recover an accidental delete while a colleague works', async ({ browser }) => {
    const [mia, raj] = await openParticipants(browser, 2);
    try {
      await setCamera(mia!.page, CAM);
      await setCamera(raj!.page, CAM);
      // Raj prepares the board, so none of it is in Mia's history.
      const fixture = undoRetroBoard();
      const ids = await seed(raj!.page, fixture.all);
      const clusterIds = ids.slice(0, fixture.cluster.length);
      await expect.poll(async () => (await getNotes(mia!.page)).length, eventually).toBe(ids.length);
      const original = await board(mia!.page);
      await expect(undoButton(mia!.page)).toBeDisabled();
      await expect(redoButton(mia!.page)).toBeDisabled();

      // Mia box-selects the 8-note cluster and presses Delete.
      const a = toScreen({ x: -20, y: -20 });
      const b = toScreen({ x: 4 * CLUSTER_PITCH, y: 2 * CLUSTER_PITCH });
      await mia!.page.keyboard.down('Shift');
      await mia!.page.mouse.move(a.x, a.y);
      await mia!.page.mouse.down();
      await mia!.page.mouse.move(b.x, b.y, { steps: 6 });
      await mia!.page.mouse.up();
      await mia!.page.keyboard.up('Shift');
      await nextFrames(mia!.page);
      await expect.poll(() => mia!.page.evaluate(() => [...(window.__vidi6?.getSelection?.() ?? [])].sort())).toEqual(
        [...clusterIds].sort(),
      );
      await mia!.page.keyboard.press('Delete');
      const afterDelete = original.filter((n) => !clusterIds.includes(n.id));
      await expectBoards([mia!, raj!], afterDelete);
      await expect(undoButton(mia!.page)).toBeEnabled();

      // Meanwhile Raj adds a note.
      await raj!.page.getByRole('button', { name: 'Sticky note' }).click();
      await raj!.page.keyboard.type('Raj: new idea');
      await raj!.page.keyboard.press('Escape');
      await expect.poll(async () => (await getNotes(mia!.page)).length, eventually).toBe(afterDelete.length + 1);
      const rajNote = (await board(raj!.page)).find((n) => !ids.includes(n.id))!;
      expect(rajNote.text).toBe('Raj: new idea');

      // Mia presses Ctrl/Cmd+Z: the 8 notes come back everywhere, exactly as they were; Raj's note stays.
      await mia!.page.keyboard.press('ControlOrMeta+z');
      const restored = boardOf([...original, rajNote] as StickySnapshot[]);
      await expectBoards([mia!, raj!], restored);
      await expect(undoButton(mia!.page)).toBeDisabled();
      await expect(redoButton(mia!.page)).toBeEnabled();
      // Raj's own history is untouched by Mia's undo.
      await expect(undoButton(raj!.page)).toBeEnabled();

      // Redo removes the 8 again on both screens.
      await redoButton(mia!.page).click();
      await expectBoards([mia!, raj!], boardOf([...afterDelete, rajNote] as StickySnapshot[]));
      await expect(redoButton(mia!.page)).toBeDisabled();

      // Undo again restores them; Mia's history is then exhausted.
      await mia!.page.keyboard.press('ControlOrMeta+z');
      await expectBoards([mia!, raj!], restored);
      await expect(undoButton(mia!.page)).toBeDisabled();

      expect(mia!.problems).toEqual([]);
      expect(raj!.problems).toEqual([]);
    } finally {
      await closeParticipants([mia!, raj!]);
    }
  });

  test('TC-23 undo after a colleague deleted my object', async ({ browser }) => {
    const [mia, raj] = await openParticipants(browser, 2);
    try {
      await setCamera(mia!.page, CAM);
      await setCamera(raj!.page, CAM);
      const [first, second] = await seed(raj!.page, [
        { x: 0, y: 0, text: 'First', color: 'yellow', size: 200 },
        { x: 600, y: 0, text: 'Second', color: 'blue', size: 200 },
      ]);
      await expect.poll(async () => (await getNotes(mia!.page)).length, eventually).toBe(2);
      const original = await board(mia!.page);

      // Mia moves both notes, one after the other.
      await dragNote(mia!.page, first!, 0, 150);
      await dragNote(mia!.page, second!, 0, 150);
      await expect.poll(async () => (await board(raj!.page)).map((n) => n.y), eventually).toEqual([300, 300]);

      // Raj deletes the second note.
      const c = await noteCentre(raj!.page, second!);
      await raj!.page.mouse.click(c.x, c.y);
      await raj!.page.keyboard.press('Delete');
      await expect.poll(async () => (await getNotes(mia!.page)).length, eventually).toBe(1);

      // Mia undoes: nothing visible happens and the note is not recreated.
      await mia!.page.keyboard.press('ControlOrMeta+z');
      await nextFrames(mia!.page);
      const firstMoved = { ...original.find((n) => n.id === first)!, y: 300 };
      await expectBoards([mia!, raj!], [firstMoved]);
      await expect(mia!.page.locator(`[data-id="${second}"]`)).toHaveCount(0);

      // Her next undo still works: the first note returns to where it was.
      await expect(undoButton(mia!.page)).toBeEnabled();
      await mia!.page.keyboard.press('ControlOrMeta+z');
      await expectBoards([mia!, raj!], [original.find((n) => n.id === first)!]);

      expect(mia!.problems).toEqual([]);
      expect(raj!.problems).toEqual([]);
    } finally {
      await closeParticipants([mia!, raj!]);
    }
  });

  test('TC-24 everyone undoing at once reverts only their own changes', async ({ browser }) => {
    const people = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
    try {
      await Promise.all(people.map((p) => setCamera(p.page, CAM)));
      // Each person gets a note to move (top row) and a note to type in (bottom row).
      const notes: UndoSeedNote[] = people.flatMap((_, i) => [
        { x: i * 250, y: 0, text: `Move ${i}`, color: 'yellow', size: 200 },
        { x: i * 250, y: 600, text: `Type ${i}`, color: 'green', size: 200 },
      ]);
      const ids = await seed(people[0]!.page, notes);
      await Promise.all(
        people.map((p) => expect.poll(async () => (await getNotes(p.page)).length, eventually).toBe(notes.length)),
      );
      const original = await board(people[0]!.page);

      // Everyone moves their note and types in theirs, at the same time.
      await Promise.all(
        people.map(async (p, i) => {
          await dragNote(p.page, ids[2 * i]!, 0, 100);
          const t = await noteCentre(p.page, ids[2 * i + 1]!);
          await p.page.mouse.dblclick(t.x, t.y);
          await expect(p.page.getByRole('textbox', { name: 'Sticky note text' })).toBeFocused();
          await p.page.keyboard.press('End');
          await p.page.keyboard.type(` by ${p.name}`);
          await p.page.keyboard.press('Escape');
        }),
      );
      const changed = boardOf(
        original.map((n) => {
          const index = ids.indexOf(n.id);
          const owner = people[Math.floor(index / 2)]!;
          return (index % 2 === 0 ? { ...n, y: n.y + 200 } : { ...n, text: `${n.text} by ${owner.name}` }) as StickySnapshot;
        }),
      );
      await expectBoards(people, changed);

      // Everyone presses Ctrl/Cmd+Z twice, at the same time.
      await Promise.all(
        people.map(async (p) => {
          await p.page.keyboard.press('ControlOrMeta+z');
          await p.page.keyboard.press('ControlOrMeta+z');
        }),
      );
      await expectBoards(people, original);

      for (const p of people) expect(p.problems).toEqual([]);
    } finally {
      await closeParticipants(people);
    }
  });
});
