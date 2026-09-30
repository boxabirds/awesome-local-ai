// Story 8 — undo and redo my own changes without undoing anyone else's.
// Real browsers against wrangler dev: only the real provider proves that other
// people's changes (provider origin) never enter my history.
import { expect, test, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { undoBoard } from '../fixtures/boards';
import { setCamera, viewport } from './helpers/board';
import { closeAll, openParticipants, type Participant } from './helpers/participants';
import { seedBoard } from './helpers/seed';
import { createBoardId } from './helpers/server';

const CAMERA = { x: -100, y: -100, zoom: 0.5 };

interface ObjectState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  text: string;
}

let participants: Participant[] = [];
test.afterEach(async () => {
  await closeAll(participants);
  participants = [];
});

async function seeded(baseURL: string) {
  const boardId = await createBoardId(baseURL);
  const fixture = undoBoard();
  await seedBoard(baseURL, boardId, fixture.doc);
  return { boardId, ...fixture };
}

async function ready(p: Participant, count: number) {
  await expect(p.page.getByRole('group', { name: 'Sticky note' })).toHaveCount(count, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await setCamera(p.page, CAMERA);
}

/** Every object in the board document, sorted by id (sizes, colours and text included). */
async function boardState(page: Page): Promise<ObjectState[]> {
  return page.evaluate(() => {
    const out: ObjectState[] = [];
    window.__vidi6!.doc.getMap('objects').forEach((value, id) => {
      const m = value as unknown as { get(k: string): unknown };
      out.push({
        id,
        x: m.get('x') as number,
        y: m.get('y') as number,
        width: (m.get('width') as number | undefined) ?? 200,
        height: (m.get('height') as number | undefined) ?? 200,
        color: m.get('color') as string,
        text: String(m.get('text')),
      });
    });
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  });
}

async function eventuallyState(page: Page, expected: ObjectState[]) {
  await expect.poll(() => boardState(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toEqual(expected);
}

async function sameBoards(ps: Participant[]): Promise<ObjectState[]> {
  let first: ObjectState[] = [];
  await expect
    .poll(
      async () => {
        const all = await Promise.all(ps.map((p) => boardState(p.page)));
        first = all[0];
        return all.every((b) => JSON.stringify(b) === JSON.stringify(first));
      },
      { timeout: E2E_EVENTUAL_TIMEOUT_MS },
    )
    .toBe(true);
  return first;
}

/** Viewport pixel of a world point at CAMERA. */
async function toScreen(page: Page, p: { x: number; y: number }) {
  const box = (await viewport(page).boundingBox())!;
  return {
    x: Math.round(box.x + (p.x - CAMERA.x) * CAMERA.zoom),
    y: Math.round(box.y + (p.y - CAMERA.y) * CAMERA.zoom),
  };
}

/** Screen centre of an object from its document rect. */
async function centreOf(page: Page, id: string) {
  const o = (await boardState(page)).find((s) => s.id === id)!;
  return toScreen(page, { x: o.x + o.width / 2, y: o.y + o.height / 2 });
}

async function clickCentre(page: Page, id: string, double = false) {
  const { x, y } = await centreOf(page, id);
  if (double) await page.mouse.dblclick(x, y);
  else await page.mouse.click(x, y);
}

async function dragPx(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 6 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
  await page.mouse.up();
}

async function marquee(page: Page, fromWorld: { x: number; y: number }, toWorld: { x: number; y: number }) {
  const from = await toScreen(page, fromWorld);
  const to = await toScreen(page, toWorld);
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

const undoButton = (page: Page) => page.getByRole('button', { name: 'Undo' });
const redoButton = (page: Page) => page.getByRole('button', { name: 'Redo' });

test('TC-22 recover an accidental delete while a colleague works', async ({ browser, baseURL }) => {
  const { boardId, cluster } = await seeded(baseURL!);
  participants = await openParticipants(browser, ['Mia', 'Raj'], boardId);
  const [mia, raj] = participants;
  await Promise.all(participants.map((p) => ready(p, 12)));
  const before = await boardState(mia.page);
  await expect(undoButton(mia.page)).toBeDisabled();
  await expect(redoButton(mia.page)).toBeDisabled();

  // Mia box-selects the 8-note cluster and presses Delete.
  await marquee(mia.page, { x: -20, y: -20 }, { x: 1100, y: 580 });
  await expect(mia.page.getByRole('toolbar', { name: 'Selection' })).toContainText('8 selected');
  await mia.page.keyboard.press('Delete');
  await expect(mia.page.getByRole('group', { name: 'Sticky note' })).toHaveCount(4);
  await expect(raj.page.getByRole('group', { name: 'Sticky note' })).toHaveCount(4, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await expect(undoButton(mia.page)).toBeEnabled();

  // Raj adds a note meanwhile.
  await raj.page.getByRole('button', { name: 'Sticky note (N)' }).click();
  await raj.page.getByRole('textbox', { name: 'Note text' }).fill('Raj was here');
  await raj.page.keyboard.press('Escape');
  await expect(mia.page.getByRole('group', { name: 'Sticky note' })).toHaveCount(5, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  const rajNote = (await boardState(raj.page)).find((o) => !before.some((b) => b.id === o.id))!;
  expect(rajNote.text).toBe('Raj was here');

  // Mia undoes: the 8 notes come back exactly, on both screens; Raj's note stays.
  await mia.page.keyboard.press('ControlOrMeta+z');
  const restored = [...before, rajNote].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  await eventuallyState(mia.page, restored);
  await eventuallyState(raj.page, restored);
  await expect(raj.page.getByRole('group', { name: 'Sticky note' })).toHaveCount(13);
  for (const id of cluster) await expect(raj.page.locator(`[data-note-id="${id}"]`)).toBeVisible();
  await expect(redoButton(mia.page)).toBeEnabled();
  await expect(undoButton(mia.page)).toBeDisabled();

  // Redo deletes the 8 again on both screens; Raj's note still stays.
  await redoButton(mia.page).click();
  const redone = [...before.filter((o) => !cluster.includes(o.id)), rajNote].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  await eventuallyState(mia.page, redone);
  await eventuallyState(raj.page, redone);

  // Undo again restores them; then Mia's history is exhausted.
  await undoButton(mia.page).click();
  await eventuallyState(raj.page, restored);
  await expect(undoButton(mia.page)).toBeDisabled();
  expect(mia.consoleErrors).toEqual([]);
});

test('TC-23 undo after a colleague deleted my object', async ({ browser, baseURL }) => {
  const { boardId, cluster, others } = await seeded(baseURL!);
  participants = await openParticipants(browser, ['Mia', 'Raj'], boardId);
  const [mia, raj] = participants;
  await Promise.all(participants.map((p) => ready(p, 12)));
  const target = cluster[0];
  const colored = others[0];
  const originalColor = (await boardState(mia.page)).find((o) => o.id === colored)!.color;

  // Step 1: Mia recolours another note. Step 2: Mia moves the target.
  await clickCentre(mia.page, colored);
  const newColor = originalColor === 'pink' ? 'Blue' : 'Pink';
  await mia.page.getByRole('button', { name: `${newColor} colour` }).click();
  await dragPx(mia.page, await centreOf(mia.page, target), 60, 150);
  await expect
    .poll(async () => (await boardState(raj.page)).find((o) => o.id === target)?.y, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(300);

  // Raj deletes the target.
  await clickCentre(raj.page, target);
  await raj.page.keyboard.press('Delete');
  await expect(mia.page.locator(`[data-note-id="${target}"]`)).toHaveCount(0, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

  // Mia undoes the move: nothing visible, no error; the note stays absent everywhere.
  const beforeUndo = await boardState(mia.page);
  await mia.page.keyboard.press('ControlOrMeta+z');
  await mia.page.waitForTimeout(500);
  expect(await boardState(mia.page)).toEqual(beforeUndo);
  await expect(raj.page.locator(`[data-note-id="${target}"]`)).toHaveCount(0);
  await expect(mia.page.locator(`[data-note-id="${target}"]`)).toHaveCount(0);

  // The next undo still works: the colour change is reverted on both screens.
  await mia.page.keyboard.press('ControlOrMeta+z');
  for (const p of participants) {
    await expect
      .poll(async () => (await boardState(p.page)).find((o) => o.id === colored)?.color, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBe(originalColor);
  }
  await expect(mia.page.locator(`[data-note-id="${target}"]`)).toHaveCount(0);
  await expect(undoButton(mia.page)).toBeDisabled();
  expect(mia.consoleErrors).toEqual([]);
});

test('TC-24 everyone undoing at once', async ({ browser, baseURL }) => {
  const { boardId, cluster, others } = await seeded(baseURL!);
  const names = ['Mia', 'Raj', 'Ana', 'Tom', 'Lea'].slice(0, MAX_CONCURRENT_EDITORS);
  participants = await openParticipants(browser, names, boardId);
  await Promise.all(participants.map((p) => ready(p, 12)));
  const initial = await boardState(participants[0].page);
  const typed = [cluster[5], cluster[6], cluster[7], others[0], others[1]];

  // Each person moves a different note and types into a different note, all at once.
  await Promise.all(
    participants.map(async (p, i) => {
      await dragPx(p.page, await centreOf(p.page, cluster[i]), 0, 60);
      await clickCentre(p.page, typed[i], true);
      const editor = p.page.getByRole('textbox', { name: 'Note text' });
      await expect(editor).toBeFocused();
      await p.page.keyboard.press('End');
      await editor.pressSequentially(` +${p.name}`, { delay: 30 });
      await p.page.keyboard.press('Escape');
    }),
  );
  const changed = await sameBoards(participants);
  participants.forEach((p, i) => {
    const moved = changed.find((o) => o.id === cluster[i])!;
    const start = initial.find((o) => o.id === cluster[i])!;
    expect(moved.y).toBe(start.y + 120);
    expect(changed.find((o) => o.id === typed[i])!.text).toContain(`+${p.name}`);
  });

  // Everyone undoes twice at the same time: each person's own changes are reverted.
  await Promise.all(
    participants.map(async (p) => {
      await p.page.keyboard.press('ControlOrMeta+z');
      await p.page.keyboard.press('ControlOrMeta+z');
    }),
  );
  const final = await sameBoards(participants);
  expect(final).toEqual(initial);
  for (const p of participants) {
    await expect(undoButton(p.page)).toBeDisabled();
    await expect(redoButton(p.page)).toBeEnabled();
    expect(p.consoleErrors).toEqual([]);
  }
});
