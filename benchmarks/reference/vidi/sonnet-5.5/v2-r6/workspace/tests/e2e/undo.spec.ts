import { expect, test, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { boardWithNotes, type PlacedNote } from '../fixtures/boards';
import { createBoardId, E2E_ORIGIN } from './helpers/create';
import { boardSnapshot, dragNote, notesOf, openParticipants, pos } from './helpers/participants';
import { seedBoard } from './helpers/seed';

const eventually = { timeout: E2E_EVENTUAL_TIMEOUT_MS };

async function seeded(notes: PlacedNote[]): Promise<string> {
  const id = await createBoardId();
  await seedBoard(E2E_ORIGIN, id, boardWithNotes(notes).updates, notes.length);
  return id;
}

const undoButton = (page: Page) => page.getByRole('button', { name: 'Undo' });
const redoButton = (page: Page) => page.getByRole('button', { name: 'Redo' });

/** Creates a note by double-clicking empty board at a screen point and leaves editing. */
async function addNoteAt(page: Page, x: number, y: number, text = ''): Promise<void> {
  const before = await notesOf(page).count();
  await page.mouse.dblclick(x, y);
  await expect(notesOf(page)).toHaveCount(before + 1);
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

test('TC-22 Mia recovers an accidental delete while Raj keeps working', async ({ browser }) => {
  const notes: PlacedNote[] = [];
  for (let i = 0; i < 8; i++) notes.push({ x: 200 + (i % 4) * 260, y: 200 + Math.floor(i / 4) * 260, text: `note ${i}` });
  const id = await seeded(notes);
  const [mia, raj] = await openParticipants(browser, 2, id);
  await expect(notesOf(mia.page)).toHaveCount(8);
  const original = await boardSnapshot(mia.page);

  await expect(undoButton(mia.page)).toBeDisabled();
  await mia.page.keyboard.press('Control+a');
  await mia.page.keyboard.press('Delete');
  await expect(notesOf(mia.page)).toHaveCount(0);
  await expect(notesOf(raj.page)).toHaveCount(0, eventually);

  await addNoteAt(raj.page, 1100, 650, 'from Raj');
  await expect(notesOf(mia.page)).toHaveCount(1, eventually);

  await mia.page.keyboard.press('Control+z');
  await expect(notesOf(mia.page)).toHaveCount(9, eventually);
  await expect(notesOf(raj.page)).toHaveCount(9, eventually);
  const restored = (await boardSnapshot(mia.page)).filter((n) => n.text !== 'from Raj');
  expect(restored).toEqual(original);
  expect(await boardSnapshot(raj.page)).toEqual(await boardSnapshot(mia.page));
  await expect(undoButton(mia.page)).toBeDisabled();

  await redoButton(mia.page).click();
  await expect(notesOf(mia.page)).toHaveCount(1);
  await expect(notesOf(raj.page)).toHaveCount(1, eventually);
  await expect(notesOf(raj.page).first()).toContainText('from Raj');

  await undoButton(mia.page).click();
  await expect(notesOf(raj.page)).toHaveCount(9, eventually);
  expect(mia.errors).toEqual([]);
  expect(raj.errors).toEqual([]);
});

test('TC-23 undoing a move of a note Raj deleted shows no error and recreates nothing', async ({ browser }) => {
  const id = await seeded([{ x: 300, y: 300, text: 'target' }]);
  const [mia, raj] = await openParticipants(browser, 2, id);
  await addNoteAt(mia.page, 900, 600, 'mine');
  await expect(notesOf(raj.page)).toHaveCount(2, eventually);

  const target = mia.page.locator('[data-sticky-note]', { hasText: 'target' });
  await dragNote(mia.page, target, 60, 60);
  await expect.poll(async () => (await pos(target))[0]).toBeGreaterThan(200);

  const rajTarget = raj.page.locator('[data-sticky-note]', { hasText: 'target' });
  await expect(rajTarget).toBeVisible();
  const b = (await rajTarget.boundingBox())!;
  await raj.page.mouse.click(b.x + 20, b.y + 20);
  await raj.page.keyboard.press('Delete');
  await expect(notesOf(mia.page)).toHaveCount(1, eventually);

  await mia.page.keyboard.press('Control+z');
  await expect(notesOf(mia.page)).toHaveCount(1);
  await expect(notesOf(raj.page)).toHaveCount(1);
  // the next undos still work: first Mia's typing, then the creation of her own note
  await mia.page.keyboard.press('Control+z');
  await expect(mia.page.locator('[data-sticky-note]', { hasText: 'mine' })).toHaveCount(0);
  await expect(notesOf(mia.page)).toHaveCount(1);
  await mia.page.keyboard.press('Control+z');
  await expect(notesOf(mia.page)).toHaveCount(0);
  await expect(notesOf(raj.page)).toHaveCount(0, eventually);
  expect(mia.errors).toEqual([]);
  expect(raj.errors).toEqual([]);
});

test('TC-24 everyone undoes only their own changes at once', async ({ browser }) => {
  const n = MAX_CONCURRENT_EDITORS;
  const seedNotes: PlacedNote[] = [];
  for (let i = 0; i < n; i++) seedNotes.push({ x: 150 + i * 230, y: 150, text: `m${i}` });
  for (let i = 0; i < n; i++) seedNotes.push({ x: 150 + i * 230, y: 450, text: `t${i}` });
  const id = await seeded(seedNotes);
  const people = await openParticipants(browser, n, id);
  for (const p of people) await expect(notesOf(p.page)).toHaveCount(n * 2, eventually);

  const startPositions = await boardSnapshot(people[0].page);
  await Promise.all(people.map(async ({ page }, i) => {
    await dragNote(page, page.locator('[data-sticky-note]', { hasText: `m${i}` }), 0, 80);
    const typed = page.locator('[data-sticky-note]', { hasText: `t${i}` });
    await typed.dblclick();
    await page.keyboard.press('End');
    await page.keyboard.type('+x');
    await page.keyboard.press('Escape');
  }));
  const edited = await boardSnapshot(people[0].page);
  expect(edited).not.toEqual(startPositions);
  for (const p of people) {
    await expect.poll(async () => JSON.stringify(await boardSnapshot(p.page)), eventually).toBe(JSON.stringify(edited));
  }

  await Promise.all(people.map(async ({ page }) => {
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
  }));
  for (const p of people) {
    await expect.poll(async () => JSON.stringify(await boardSnapshot(p.page)), eventually).toBe(JSON.stringify(startPositions));
  }
  for (const p of people) expect(p.errors).toEqual([]);
});
