import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  closeAll,
  dragNote,
  expectEventually,
  newNoteAt,
  noteView,
  noteViews,
  notes,
  openParticipants,
  sameBoard,
} from './helpers/participants';

async function makeNote(page: Page, x: number, y: number): Promise<string> {
  const id = await newNoteAt(page, x, y);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox')).toHaveCount(0);
  return id;
}

async function marquee(page: Page, from: [number, number], to: [number, number]) {
  await page.keyboard.down('Shift');
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

const undoKey = 'ControlOrMeta+z';
const undoButton = (page: Page) => page.getByRole('button', { name: 'Undo' });
const redoButton = (page: Page) => page.getByRole('button', { name: 'Redo' });

test.describe('undo and redo', () => {
  test('TC-22 recover an accidental delete while a colleague works', async ({ browser }) => {
    const [mia, raj] = await openParticipants(browser, 2);
    try {
      const ids: string[] = [];
      for (const y of [150, 400]) for (const x of [200, 420, 640, 860]) ids.push(await makeNote(mia.page, x, y));
      await expectEventually('raj sees 8', async () => (await noteViews(raj.page)).length === 8);
      const before = (await noteViews(mia.page)).map((n) => ({ ...n }));

      await marquee(mia.page, [60, 20], [1020, 560]);
      await expect(mia.page.getByText('8 selected')).toBeVisible();
      await mia.page.keyboard.press('Delete');
      await expect(notes(mia.page)).toHaveCount(0);

      const rajId = await makeNote(raj.page, 1150, 650);
      await expectEventually('mia sees raj note', async () => (await noteView(mia.page, rajId)) !== undefined);

      await mia.page.keyboard.press(undoKey);
      await expectEventually('8 back for both', async () => (await noteViews(raj.page)).length === 9);
      for (const page of [mia.page, raj.page]) {
        const views = await noteViews(page);
        for (const b of before) expect(views.find((v) => v.id === b.id)).toEqual(b);
        expect(views.find((v) => v.id === rajId)).toBeTruthy();
      }

      await redoButton(mia.page).click();
      await expectEventually('8 removed again', async () => (await noteViews(raj.page)).length === 1);
      expect((await noteViews(mia.page)).map((n) => n.id)).toEqual([rajId]);

      // Exhaust Mia's history: the Undo button ends up disabled and Raj's note is untouched.
      for (let i = 0; i < 20 && (await undoButton(mia.page).isEnabled()); i++) await undoButton(mia.page).click();
      await expect(undoButton(mia.page)).toBeDisabled();
      await expectEventually('same board', () => sameBoard([mia, raj]));
      expect((await noteViews(mia.page)).map((n) => n.id)).toEqual([rajId]);
      expect([...mia.errors, ...raj.errors]).toEqual([]);
    } finally {
      await closeAll([mia, raj]);
    }
  });

  test('TC-23 a colleague deleted my object: undo shows no error and brings nothing back', async ({ browser }) => {
    const [mia, raj] = await openParticipants(browser, 2);
    try {
      const id = await makeNote(mia.page, 400, 300);
      await expectEventually('raj sees note', async () => (await noteView(raj.page, id)) !== undefined);
      const startLeft = (await noteView(mia.page, id))!.left;
      await dragNote(mia.page, id, 200, 100);
      await expectEventually('raj sees move', async () => ((await noteView(raj.page, id))?.left ?? startLeft) > startLeft + 100);

      const box = (await raj.page.locator(`[data-note-id="${id}"]`).boundingBox())!;
      await raj.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await raj.page.keyboard.press('Delete');
      await expectEventually('gone for mia', async () => (await noteViews(mia.page)).length === 0);

      await mia.page.keyboard.press(undoKey);
      await mia.page.keyboard.press(undoKey);
      await mia.page.waitForTimeout(300);
      expect(await noteViews(mia.page)).toEqual([]);
      expect(await noteViews(raj.page)).toEqual([]);
      expect([...mia.errors, ...raj.errors]).toEqual([]);
    } finally {
      await closeAll([mia, raj]);
    }
  });

  test('TC-24 everyone undoing at once only reverts their own changes', async ({ browser }) => {
    const people = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
    try {
      const xs = [150, 370, 590, 810, 1030];
      const ids: string[] = [];
      for (const x of xs) ids.push(await makeNote(people[0].page, x, 300));
      await expectEventually('everyone sees 5', async () =>
        (await Promise.all(people.map((p) => noteViews(p.page)))).every((v) => v.length === MAX_CONCURRENT_EDITORS),
      );
      const original = await noteViews(people[0].page);

      // Each person types into the next person's neighbour note, then moves their own note.
      await Promise.all(
        people.map(async (p, i) => {
          await p.page.mouse.dblclick(xs[(i + 1) % xs.length], 300);
          await expect(p.page.getByRole('textbox')).toBeFocused();
          await p.page.keyboard.type(`by ${p.name}`);
          await p.page.keyboard.press('Escape');
        }),
      );
      await expectEventually('typing synced', async () =>
        (await noteViews(people[0].page)).every((n) => n.text.startsWith('by ')),
      );
      await Promise.all(people.map((p, i) => dragNote(p.page, ids[i], 0, 200)));
      await expectEventually('moves synced', async () =>
        (await noteViews(people[0].page)).every((n) => n.top > original[0].top + 100),
      );

      await Promise.all(
        people.map(async (p) => {
          await p.page.keyboard.press(undoKey);
          await p.page.waitForTimeout(100);
          await p.page.keyboard.press(undoKey);
        }),
      );
      await expectEventually('all reverted', async () => {
        const views = await noteViews(people[0].page);
        return views.every((v) => v.text === '' && v.top === original.find((o) => o.id === v.id)!.top);
      });
      await expectEventually('identical boards', () => sameBoard(people));
      expect((await noteViews(people[0].page)).length).toBe(MAX_CONCURRENT_EDITORS);
      expect(people.flatMap((p) => p.errors)).toEqual([]);
    } finally {
      await closeAll(people);
    }
  });
});
