// Story 8 e2e: undo and redo only my own changes, through real browsers and the real sync
// provider (wrangler dev) — TC-22 to TC-24.
import { type Page, expect, test } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { UNDO_CLUSTER, undoBoard } from '../fixtures/boards';
import { getNotes, setCamera, waitForFrame } from './helpers/board';
import { type Participant, openParticipants } from './helpers/participants';
import { createBoardViaApi, seedBoard } from './helpers/seed';

// Zoomed out so the whole board is visible: world x ∈ [-1280, 1280], y ∈ [-800, 800].
const CAMERA = { x: -1280, y: -800, zoom: 0.5 };
const TOTAL_NOTES = 12;
const NAMES = ['Mia', 'Raj', 'Ana', 'Leo', 'Kim'];

type World = { x: number; y: number };
const toPage = (p: World) => ({
  x: (p.x - CAMERA.x) * CAMERA.zoom,
  y: (p.y - CAMERA.y) * CAMERA.zoom,
});

type Note = Awaited<ReturnType<typeof getNotes>>[number];
const byId = async (page: Page) => new Map((await getNotes(page)).map((n) => [n.id, n]));
const centreOf = (n: Note) => toPage({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
const undoButton = (page: Page) => page.getByRole('button', { name: 'Undo' });
const redoButton = (page: Page) => page.getByRole('button', { name: 'Redo' });

async function seededSession(browser: Parameters<typeof openParticipants>[0], testInfo: Parameters<typeof openParticipants>[1], names: string[]) {
  const fixture = undoBoard();
  const id = await createBoardViaApi(testInfo.project.use.baseURL!);
  await seedBoard(testInfo.project.use.baseURL!, id, fixture.updates);
  const session = await openParticipants(browser, testInfo, names, id);
  for (const p of session.participants) {
    await expect(p.page.locator('[data-sticky-id]')).toHaveCount(TOTAL_NOTES);
    await setCamera(p.page, CAMERA);
  }
  return { ...fixture, session };
}

async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await page.mouse.up();
  await waitForFrame(page);
}

/** Shift+drag on the empty board between two world points. */
async function marquee(page: Page, from: World, to: World) {
  const a = toPage(from);
  const b = toPage(to);
  await page.keyboard.down('Shift');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await waitForFrame(page);
}

/** Every participant's notes, in stacking order. */
async function boards(participants: Participant[]) {
  return Promise.all(participants.map((p) => getNotes(p.page)));
}

async function expectIdentical(participants: Participant[]) {
  await expect
    .poll(
      async () => {
        const all = (await boards(participants)).map((b) => JSON.stringify(b));
        return all.every((b) => b === all[0]);
      },
      { timeout: E2E_EVENTUAL_TIMEOUT_MS },
    )
    .toBe(true);
}

test.describe('Workflow: Recover an accidental delete while a colleague works', () => {
  test('TC-22 Mia undoes her delete of 8 notes; Raj’s new note stays; Redo deletes them again', async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium only');
    const { session, cluster } = await seededSession(browser, testInfo, ['Mia', 'Raj']);
    const [mia, raj] = session.participants;
    try {
      await expect(undoButton(mia.page)).toBeDisabled();
      await expect(redoButton(mia.page)).toBeDisabled();
      const before = await getNotes(mia.page);
      const clusterBefore = before.filter((n) => cluster.includes(n.id));
      expect(clusterBefore).toHaveLength(8);

      // Mia box-selects the cluster and presses Delete.
      const { left, top, pitch, columns, rows } = UNDO_CLUSTER;
      await marquee(
        mia.page,
        { x: left - 50, y: top - 60 },
        { x: left + (columns - 1) * pitch + 250, y: top + (rows - 1) * pitch + 250 },
      );
      await expect(mia.page.getByTestId('selection-status')).toHaveText('8 selected');
      await mia.page.keyboard.press('Delete');
      for (const p of [mia, raj]) {
        await expect(p.page.locator('[data-sticky-id]')).toHaveCount(TOTAL_NOTES - 8);
      }
      await expect(undoButton(mia.page)).toBeEnabled();

      // Raj adds a note meanwhile.
      await raj.page.getByRole('button', { name: 'Sticky note' }).click();
      await raj.page.keyboard.type('Raj was here');
      await raj.page.keyboard.press('Escape');
      await expect(mia.page.locator('[data-sticky-id]')).toHaveCount(TOTAL_NOTES - 8 + 1);
      await expect
        .poll(async () => (await getNotes(mia.page)).some((n) => n.text === 'Raj was here'))
        .toBe(true);
      // Raj's change is not in Mia's history: her Redo stays unavailable.
      await expect(redoButton(mia.page)).toBeDisabled();

      // Mia presses Ctrl/Cmd+Z: the 8 notes come back everywhere, exactly as they were.
      await mia.page.keyboard.press('ControlOrMeta+z');
      for (const p of [mia, raj]) {
        await expect(p.page.locator('[data-sticky-id]')).toHaveCount(TOTAL_NOTES + 1);
        await expect
          .poll(async () => {
            const now = await byId(p.page);
            return clusterBefore.every((n) => JSON.stringify(now.get(n.id)) === JSON.stringify(n));
          })
          .toBe(true);
        expect((await getNotes(p.page)).some((n) => n.text === 'Raj was here')).toBe(true);
      }
      await expect(undoButton(mia.page)).toBeDisabled();
      await expect(redoButton(mia.page)).toBeEnabled();

      // Redo removes the 8 again on both screens; Raj's note stays.
      await redoButton(mia.page).click();
      for (const p of [mia, raj]) {
        await expect(p.page.locator('[data-sticky-id]')).toHaveCount(TOTAL_NOTES - 8 + 1);
        const ids = (await getNotes(p.page)).map((n) => n.id);
        expect(ids.some((id) => cluster.includes(id))).toBe(false);
      }
      await expect(redoButton(mia.page)).toBeDisabled();

      // And Undo once more restores them; Mia's history is then exhausted.
      await mia.page.keyboard.press('ControlOrMeta+z');
      await expect(raj.page.locator('[data-sticky-id]')).toHaveCount(TOTAL_NOTES + 1);
      await expect(undoButton(mia.page)).toBeDisabled();
      await expectIdentical([mia, raj]);
      expect(mia.problems).toEqual([]);
      expect(raj.problems).toEqual([]);
    } finally {
      await session.close();
    }
  });
});

test.describe('Workflow: Undo after a colleague deleted my object', () => {
  test('TC-23 undoing a move of a note Raj deleted does nothing; the next undo still works', async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium only');
    const { session, others } = await seededSession(browser, testInfo, ['Mia', 'Raj']);
    const [mia, raj] = session.participants;
    try {
      const start = await byId(mia.page);
      const [b, a] = others;
      // Mia moves B, then A.
      await dragBy(mia.page, centreOf(start.get(b)!), 0, 40);
      await dragBy(mia.page, centreOf(start.get(a)!), 0, 40);
      await expect.poll(async () => (await byId(raj.page)).get(a)?.y).toBe(start.get(a)!.y + 80);
      await expect.poll(async () => (await byId(raj.page)).get(b)?.y).toBe(start.get(b)!.y + 80);

      // Raj deletes A.
      const aNow = (await byId(raj.page)).get(a)!;
      await raj.page.mouse.click(centreOf(aNow).x, centreOf(aNow).y);
      await expect(raj.page.locator(`[data-sticky-id="${a}"][data-selected="true"]`)).toHaveCount(1);
      await raj.page.keyboard.press('Delete');
      await expect(mia.page.locator(`[data-sticky-id="${a}"]`)).toHaveCount(0);

      // Mia undoes the move of A: nothing visible, no error.
      await mia.page.keyboard.press('Escape');
      await mia.page.keyboard.press('ControlOrMeta+z');
      await waitForFrame(mia.page);
      for (const p of [mia, raj]) {
        await expect(p.page.locator(`[data-sticky-id="${a}"]`)).toHaveCount(0);
        expect((await byId(p.page)).get(b)!.y).toBe(start.get(b)!.y + 80);
      }
      await expect(undoButton(mia.page)).toBeEnabled();

      // The next undo moves B back, everywhere.
      await mia.page.keyboard.press('ControlOrMeta+z');
      for (const p of [mia, raj]) {
        await expect.poll(async () => (await byId(p.page)).get(b)?.y).toBe(start.get(b)!.y);
        await expect(p.page.locator(`[data-sticky-id="${a}"]`)).toHaveCount(0);
      }
      await expect(undoButton(mia.page)).toBeDisabled();
      expect(mia.problems).toEqual([]);
      expect(raj.problems).toEqual([]);
    } finally {
      await session.close();
    }
  });
});

test.describe('Workflow: Everyone undoing at once', () => {
  test('TC-24 MAX_CONCURRENT_EDITORS people each undo only their own changes', async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Chromium only');
    test.setTimeout(120_000);
    const names = NAMES.slice(0, MAX_CONCURRENT_EDITORS);
    const { session, cluster, others } = await seededSession(browser, testInfo, names);
    const { participants } = session;
    try {
      const start = await byId(participants[0].page);
      const all = [...cluster, ...others];
      // Participant i moves note moved[i] twice and types into note typed[i] in between.
      const moved = all.slice(0, names.length);
      const typed = all.slice(names.length, names.length * 2);
      const STEP = 15; // world units: stays inside the note's own cell

      await Promise.all(
        participants.map(async (p, i) => {
          const m = start.get(moved[i])!;
          await dragBy(p.page, centreOf(m), 0, STEP * CAMERA.zoom);
          await expect
            .poll(async () => (await byId(p.page)).get(moved[i])!.y)
            .toBe(m.y + STEP);
          const t = start.get(typed[i])!;
          const c = centreOf(t);
          await p.page.mouse.dblclick(c.x, c.y);
          await expect(p.page.getByRole('textbox', { name: 'Note text' })).toBeFocused();
          await p.page.keyboard.press('End');
          await p.page.keyboard.type(` +${p.name}`);
          await p.page.keyboard.press('Escape');
          await dragBy(p.page, centreOf({ ...m, y: m.y + STEP }), 0, STEP * CAMERA.zoom);
          await expect
            .poll(async () => (await byId(p.page)).get(moved[i])!.y)
            .toBe(m.y + 2 * STEP);
        }),
      );
      await expectIdentical(participants);
      const edited = await byId(participants[0].page);
      participants.forEach((p, i) => {
        expect(edited.get(typed[i])!.text.endsWith(` +${p.name}`)).toBe(true);
      });

      // Everyone presses Ctrl/Cmd+Z twice at the same time.
      await Promise.all(
        participants.map(async (p) => {
          await p.page.keyboard.press('ControlOrMeta+z');
          await p.page.keyboard.press('ControlOrMeta+z');
        }),
      );
      await expectIdentical(participants);
      for (const p of participants) {
        await expect
          .poll(async () => {
            const now = await byId(p.page);
            return names.every(
              (_, i) =>
                // Each person's second move and typing are reverted; their first move stays.
                now.get(moved[i])!.y === start.get(moved[i])!.y + STEP &&
                now.get(typed[i])!.text === start.get(typed[i])!.text,
            );
          }, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
          .toBe(true);
        expect(p.problems).toEqual([]);
      }
    } finally {
      await session.close();
    }
  });
});
