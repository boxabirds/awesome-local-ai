// Story 8 in real browsers against wrangler dev: each person undoes and redoes only their own changes while
// others keep working, through the real sync provider.
import { expect, test, type Page } from '@playwright/test';
import { createBoardAt } from './helpers/boards-api';
import { setCamera, settle } from './helpers/board';
import { dragBy, noteById, notes } from './helpers/notes';
import { closeAll, expectWithin, openParticipants, type Participant } from './helpers/participants';
import { marquee, seedBoard, selectedIds, toScreen } from './helpers/selection';
import { UNDO_CLUSTER, UNDO_OTHERS, undoBoard } from '../fixtures/boards';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

const CAM = { x: -100, y: -100, zoom: 0.5 };

type Note = Awaited<ReturnType<typeof notes>>[number];

/** Screen centre of a note (read from the doc, so it is right after moves and resizes). */
async function centre(page: Page, id: string) {
  const n = (await notes(page)).find((x) => x.id === id);
  if (!n) throw new Error(`note ${id} not on the board`);
  return toScreen(CAM, { x: n.x + n.width / 2, y: n.y + n.height / 2 });
}

/** A seeded undo board opened by every name, each at CAM. */
async function openBoard(browser: Parameters<typeof openParticipants>[0], names: string[]) {
  const board = undoBoard();
  const boardId = await createBoardAt();
  await seedBoard(boardId, board.doc);
  const { people } = await openParticipants(browser, names, boardId);
  for (const p of people) {
    await expect(p.page.locator('[data-note-id]')).toHaveCount(12);
    await setCamera(p.page, CAM);
    await settle(p.page);
  }
  return { ids: board.ids, people };
}

const byId = (list: Note[]) => new Map(list.map((n) => [n.id, n]));
/** What a person sees of the board, independent of stacking order. */
const sorted = (list: Note[]) => [...list].sort((a, b) => (a.id < b.id ? -1 : 1));

function undoButton(page: Page) {
  return page.getByRole('button', { name: 'Undo' });
}
function redoButton(page: Page) {
  return page.getByRole('button', { name: 'Redo' });
}

async function doubleClickCreate(page: Page, world: { x: number; y: number }) {
  const at = toScreen(CAM, world);
  await page.mouse.dblclick(at.x, at.y);
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await expect(editor).toBeFocused();
  // Others may be creating notes at the same moment: the new one is the note being edited.
  const id = await editor.evaluate((el) => el.closest<HTMLElement>('[data-note-id]')!.dataset.noteId!);
  await page.keyboard.press('Escape');
  return id;
}

test.describe('Workflow "Recover an accidental delete while a colleague works"', () => {
  test('TC-22 Mia deletes 8 notes, Raj adds one, Mia undoes and redoes: Raj’s note always stays', async ({
    browser,
  }) => {
    const { ids, people } = await openBoard(browser, ['Mia', 'Raj']);
    const [mia, raj] = people;
    try {
      const cluster = ids.slice(0, 8);
      const original = await notes(mia.page);
      await expect(undoButton(mia.page)).toBeDisabled();
      await expect(redoButton(mia.page)).toBeDisabled();

      // Mia box-selects the 8 and presses Delete.
      const edge = UNDO_CLUSTER.x + 3 * UNDO_CLUSTER.step + 260;
      await marquee(mia.page, toScreen(CAM, { x: -20, y: -20 }), toScreen(CAM, { x: edge, y: UNDO_CLUSTER.step + 260 }));
      expect(await selectedIds(mia.page)).toEqual([...cluster].sort());
      await mia.page.keyboard.press('Delete');
      await expectWithin(async () => (await notes(raj.page)).length).toBe(4);
      await expect(undoButton(mia.page)).toBeEnabled();

      // Meanwhile Raj adds a note.
      const rajs = await doubleClickCreate(raj.page, { x: 1600, y: 300 });
      await expectWithin(async () => (await notes(mia.page)).some((n) => n.id === rajs)).toBe(true);

      // Mia presses Ctrl/Cmd+Z: all 8 return on both screens exactly as they were; Raj's note remains.
      await mia.page.keyboard.press('ControlOrMeta+z');
      for (const p of [mia, raj]) {
        await expectWithin(async () => (await notes(p.page)).length).toBe(13);
        const seen = byId(await notes(p.page));
        for (const n of original) expect(seen.get(n.id), `${p.name} sees ${n.id}`).toEqual(n);
        expect(seen.has(rajs)).toBe(true);
      }
      await expect(noteById(raj.page, cluster[5])).toBeVisible();
      await expect(undoButton(mia.page)).toBeDisabled();
      await expect(redoButton(mia.page)).toBeEnabled();

      // Redo (button) deletes the 8 again on both screens; Raj's note stays.
      await redoButton(mia.page).click();
      for (const p of [mia, raj]) {
        await expectWithin(async () => (await notes(p.page)).map((n) => n.id).sort()).toEqual(
          [...ids.slice(8), rajs].sort(),
        );
      }
      await expect(redoButton(mia.page)).toBeDisabled();

      // Undo once more restores them; Mia's history is then exhausted.
      await mia.page.keyboard.press('ControlOrMeta+z');
      await expectWithin(async () => (await notes(raj.page)).length).toBe(13);
      await expect(undoButton(mia.page)).toBeDisabled();
      // Raj's own history holds only his note; he never undid Mia's work, and she never undid his.
      await expect(undoButton(raj.page)).toBeEnabled();
      expect(sorted(await notes(mia.page))).toEqual(sorted(await notes(raj.page)));
      for (const p of people) expect(p.errors, p.name).toEqual([]);
    } finally {
      await closeAll(people);
    }
  });
});

test.describe('Workflow "Undo after a colleague deleted my object"', () => {
  test('TC-23 undoing a move of a note Raj deleted does nothing, and the next undo still works', async ({
    browser,
  }) => {
    const { ids, people } = await openBoard(browser, ['Mia', 'Raj']);
    const [mia, raj] = people;
    try {
      const [moved, recoloured] = [ids[8], ids[9]];
      const colourBefore = (await notes(mia.page)).find((n) => n.id === recoloured)!.color;

      // Mia recolours one note, then moves another.
      await mia.page.mouse.click(...xy(await centre(mia.page, recoloured)));
      await mia.page.getByRole('button', { name: 'Pink colour' }).click();
      await dragBy(mia.page, await centre(mia.page, moved), 0, 150);
      await expectWithin(async () => (await notes(raj.page)).find((n) => n.id === moved)?.y).toBe(
        UNDO_OTHERS.y + 300,
      );

      // Raj deletes the moved note.
      await raj.page.mouse.click(...xy(await centre(raj.page, moved)));
      await raj.page.keyboard.press('Delete');
      await expectWithin(async () => (await notes(mia.page)).some((n) => n.id === moved)).toBe(false);

      // Mia undoes: nothing visible happens, no error, the note stays gone on both screens.
      await mia.page.keyboard.press('Escape');
      await mia.page.keyboard.press('ControlOrMeta+z');
      await settle(mia.page);
      for (const p of people) expect((await notes(p.page)).some((n) => n.id === moved)).toBe(false);
      expect((await notes(mia.page)).find((n) => n.id === recoloured)!.color).toBe('pink');

      // Her next undo still works: the colour change is reverted on both screens.
      await expect(undoButton(mia.page)).toBeEnabled();
      await mia.page.keyboard.press('ControlOrMeta+z');
      for (const p of people) {
        await expectWithin(async () => (await notes(p.page)).find((n) => n.id === recoloured)?.color).toBe(
          colourBefore,
        );
        expect((await notes(p.page)).some((n) => n.id === moved)).toBe(false);
      }
      for (const p of people) expect(p.errors, p.name).toEqual([]);
    } finally {
      await closeAll(people);
    }
  });
});

test.describe('Workflow "Everyone undoing at once"', () => {
  test('TC-24 MAX_CONCURRENT_EDITORS people each undo only their own move and typing', async ({ browser }) => {
    test.setTimeout(120_000);
    const names = ['Mia', 'Raj', 'Ana', 'Tom', 'Lea'].slice(0, MAX_CONCURRENT_EDITORS);
    const { ids, people } = await openBoard(browser, names);
    try {
      const original = await notes(people[0].page);
      const run = (fn: (p: Participant, i: number) => Promise<void>) => Promise.all(people.map(fn));

      // Everyone adds a note of their own (kept: it is not undone).
      const created: string[] = [];
      await run(async (p, i) => {
        created[i] = await doubleClickCreate(p.page, { x: 1200 + (i % 3) * 300, y: 1000 + Math.floor(i / 3) * 300 });
      });
      // Everyone moves a different note, then types in a different note.
      await run(async (p, i) => {
        await p.page.keyboard.press('Escape');
        await dragBy(p.page, await centre(p.page, ids[i]), 20 + 5 * i, 30);
        await p.page.mouse.dblclick(...xy(await centre(p.page, ids[5 + i])));
        const editor = p.page.getByRole('textbox', { name: 'Note text' });
        await expect(editor).toBeFocused();
        await p.page.keyboard.type(` +${p.name}`);
        await p.page.keyboard.press('Escape');
      });
      for (const p of people) {
        await expectWithin(async () => {
          const seen = byId(await notes(p.page));
          return names.every((name, i) => seen.get(ids[5 + i])?.text.endsWith(` +${name}`));
        }).toBe(true);
      }

      // Everyone presses Ctrl/Cmd+Z twice, at the same time.
      await run(async (p) => {
        await p.page.keyboard.press('ControlOrMeta+z');
        await p.page.keyboard.press('ControlOrMeta+z');
      });

      // Each person's move and typing are reverted, everyone's new notes remain, and all boards are identical.
      const expected = sorted(original);
      for (const p of people) {
        await expect
          .poll(async () => sorted((await notes(p.page)).filter((n) => !created.includes(n.id))), { timeout: 5000 })
          .toEqual(expected);
        const seen = byId(await notes(p.page));
        for (const id of created) expect(seen.has(id), `${p.name} sees ${id}`).toBe(true);
      }
      const first = sorted(await notes(people[0].page));
      for (const p of people.slice(1)) expect(sorted(await notes(p.page))).toEqual(first);
      for (const p of people) expect(p.errors, p.name).toEqual([]);
    } finally {
      await closeAll(people);
    }
  });
});

function xy(p: { x: number; y: number }): [number, number] {
  return [p.x, p.y];
}
