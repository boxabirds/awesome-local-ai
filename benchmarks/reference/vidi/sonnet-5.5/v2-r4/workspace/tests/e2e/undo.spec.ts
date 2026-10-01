import { expect, test, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { E2E_EVENTUAL_TIMEOUT_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { undoBoard } from '../fixtures/undo-board';
import { setCamera } from './helpers/board';
import { closeAll, openParticipants } from './helpers/participants';
import { seedBoard } from './helpers/seed';

const ZOOM = 0.4;
const at = (wx: number, wy: number) => ({ x: 640 + wx * ZOOM, y: 400 + wy * ZOOM });
const notes = (page: Page) => page.getByRole('group', { name: 'Sticky note' });
const undoBtn = (page: Page) => page.getByRole('button', { name: 'Undo', exact: true });
const redoBtn = (page: Page) => page.getByRole('button', { name: 'Redo', exact: true });

interface View { text: string; x: number; y: number; w: number; h: number; color: string }

/** Every note as seen on this page, sorted by id so boards can be compared. */
async function board(page: Page): Promise<Record<string, View>> {
  return notes(page).evaluateAll((els) =>
    Object.fromEntries(
      els.map((el) => {
        const e = el as HTMLElement;
        return [
          e.dataset.noteId!,
          {
            text: e.querySelector('[data-testid="note-text"]')!.textContent ?? '',
            x: parseFloat(e.style.left),
            y: parseFloat(e.style.top),
            w: parseFloat(e.style.width),
            h: parseFloat(e.style.height),
            color: e.style.backgroundColor,
          },
        ];
      }),
    ),
  );
}

async function idOf(page: Page, text: string): Promise<string> {
  return (await notes(page).filter({ hasText: new RegExp(`^${text}$`) }).getAttribute('data-note-id'))!;
}

async function open(browser: Parameters<typeof openParticipants>[0], n: number) {
  const boardId = newBoardId();
  await seedBoard('http://localhost:8791', boardId, undoBoard());
  const opened = await openParticipants(browser, n, boardId);
  for (const p of opened.people) {
    await expect(notes(p.page)).toHaveCount(18);
    await setCamera(p.page, -640 / ZOOM, -400 / ZOOM, ZOOM);
  }
  return opened.people;
}

async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await page.mouse.up();
}

async function marqueeCluster(page: Page) {
  const a = at(-800, -300);
  const b = at(320, 230);
  await page.keyboard.down('Shift');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

const eventually = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

test.describe('Recover my mistakes while colleagues work', () => {
  test('TC-22 undo restores my 8 deleted notes, keeps Raj’s note; redo deletes them again', async ({ browser }) => {
    const [mia, raj] = await open(browser, 2);
    const original = await board(mia.page);
    await marqueeCluster(mia.page);
    await expect(mia.page.getByRole('status').filter({ hasText: '8 selected' })).toBeVisible();
    await expect(undoBtn(mia.page)).toBeDisabled();
    await mia.page.keyboard.press('Delete');
    await expect(notes(mia.page)).toHaveCount(10);
    await expect(notes(raj.page)).toHaveCount(10);

    const rajsNote = at(1200, 0);
    await raj.page.mouse.dblclick(rajsNote.x - 100, rajsNote.y);
    await raj.page.keyboard.press('Escape');
    await expect(notes(raj.page)).toHaveCount(11);
    await expect(notes(mia.page)).toHaveCount(11);

    await mia.page.keyboard.press('ControlOrMeta+z');
    await expect(notes(mia.page)).toHaveCount(19);
    await expect(notes(raj.page)).toHaveCount(19);
    const restored = await board(raj.page);
    for (const [id, v] of Object.entries(original)) if (v.text.startsWith('C')) expect(restored[id]).toEqual(v);
    expect(Object.keys(restored).filter((id) => !(id in original))).toHaveLength(1); // Raj's note remains
    await expect(undoBtn(mia.page)).toBeDisabled(); // history of the delete exhausted
    await expect(redoBtn(mia.page)).toBeEnabled();

    await redoBtn(mia.page).click();
    await expect(notes(mia.page)).toHaveCount(11);
    await expect(notes(raj.page)).toHaveCount(11);
    await expect(redoBtn(mia.page)).toBeDisabled();
    expect(mia.consoleErrors).toEqual([]);
    expect(raj.consoleErrors).toEqual([]);
    await closeAll([mia, raj]);
  });

  test('TC-23 undoing a move of a note a colleague deleted shows nothing and breaks nothing', async ({ browser }) => {
    const [mia, raj] = await open(browser, 2);
    const f1 = await idOf(mia.page, 'F1');
    const f2 = await idOf(mia.page, 'F2');
    const c = at(-520, 350);
    await dragBy(mia.page, c, 0, 20);
    await expect.poll(async () => (await board(raj.page))[f1]?.y).toBeGreaterThan((await board(raj.page))[f2].y);

    await raj.page.mouse.click(c.x, c.y + 20);
    await raj.page.keyboard.press('Delete');
    await expect(notes(mia.page)).toHaveCount(17);

    await mia.page.keyboard.press('ControlOrMeta+z');
    await expect(notes(mia.page)).toHaveCount(17);
    await expect(notes(raj.page)).toHaveCount(17);
    expect((await board(mia.page))[f1]).toBeUndefined();
    await mia.page.keyboard.press('ControlOrMeta+z'); // still usable
    await expect(notes(raj.page)).toHaveCount(17);
    expect(mia.consoleErrors).toEqual([]);
    expect(raj.consoleErrors).toEqual([]);
    await closeAll([mia, raj]);
  });

  test('TC-24 everyone undoes only their own move and typing at once', async ({ browser }) => {
    const people = await open(browser, MAX_CONCURRENT_EDITORS);
    const original = await board(people[0].page);
    const mover = await Promise.all(people.map((p, i) => idOf(p.page, `F${i + 1}`)));
    const typed = await Promise.all(people.map((p, i) => idOf(p.page, `F${i + 6}`)));

    // Everyone changes their own two notes.
    await Promise.all(
      people.map(async (p, i) => {
        await dragBy(p.page, at(-520 + i * 260, 350), 0, 20);
        const t = at(-520 + i * 260, 600);
        await p.page.mouse.dblclick(t.x, t.y);
        await p.page.keyboard.type('x');
        await p.page.keyboard.press('Escape');
      }),
    );
    for (const p of people) {
      await eventually(async () => {
        const b = await board(p.page);
        return people.every((_, i) => b[typed[i]].text === `F${i + 6}x` && b[mover[i]].y !== original[mover[i]].y);
      }).toBe(true);
    }

    // Everyone undoes twice: typing, then the move.
    await Promise.all(
      people.map(async (p) => {
        await p.page.keyboard.press('ControlOrMeta+z');
        await p.page.keyboard.press('ControlOrMeta+z');
      }),
    );
    for (const p of people) await eventually(() => board(p.page)).toEqual(original);
    for (const p of people) expect(p.consoleErrors).toEqual([]);
    await closeAll(people);
  });
});
