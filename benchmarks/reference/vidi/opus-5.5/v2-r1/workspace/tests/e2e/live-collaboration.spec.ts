import { type Page, expect, test } from '@playwright/test';
import {
  CATCH_UP_TEST_OUTAGE_MS,
  CONNECTED_CONFIRMATION_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import {
  boxOf,
  centreOf,
  drag,
  getNotes,
  noteEditor,
  notes,
  setCamera,
  waitForFrame,
} from './helpers/board';
import {
  LatencyLog,
  type Participant,
  connectionBadge,
  connectionState,
  openParticipants,
} from './helpers/participants';

const noteById = (page: Page, id: string) => page.locator(`[data-sticky-id="${id}"]`);

async function noteModel(page: Page, id: string) {
  return (await getNotes(page)).find((n) => n.id === id);
}

/** Double-clicks empty board at (x, y), ends editing and returns the new note's id. */
async function createNoteAt(page: Page, x: number, y: number, text = ''): Promise<string> {
  await page.mouse.dblclick(x, y);
  await expect(noteEditor(page)).toBeFocused();
  // Other people's notes may arrive meanwhile: the new note is the one being edited.
  const id = await noteEditor(page).evaluate(
    (el) => el.closest<HTMLElement>('[data-sticky-id]')!.dataset.stickyId!,
  );
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await expect(noteEditor(page)).toHaveCount(0);
  return id;
}

/** Starts editing a note: select it with a click, then Enter (caret at the end). */
async function startEditing(page: Page, id: string) {
  const c = centreOf(await boxOf(noteById(page, id)));
  await page.mouse.click(c.x, c.y);
  await expect(noteById(page, id)).toHaveAttribute('data-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(noteEditor(page)).toBeFocused();
}

const sameNotes = async (a: Page, b: Page) =>
  JSON.stringify(await getNotes(a)) === JSON.stringify(await getNotes(b));

function expectNoProblems(...people: Participant[]) {
  for (const p of people) expect(p.problems, `${p.name} console errors / dialogs`).toEqual([]);
}

test.describe('Workflow: Two-person workshop', () => {
  const log = new LatencyLog();
  test.afterAll(() => {
    log.report('Two-person workshop latency');
  });

  test('TC-22 every kind of change Alex makes appears for Sam', async ({ browser }, testInfo) => {
    const session = await openParticipants(browser, testInfo, ['Alex', 'Sam']);
    const [alex, sam] = session.participants;
    try {
      // Create + type.
      await alex.page.mouse.dblclick(400, 300);
      await expect(noteEditor(alex.page)).toBeFocused();
      let since = Date.now();
      await log.expectEventually('create', async () => (await notes(sam.page).count()) === 1, since);
      const [{ id }] = await getNotes(alex.page);

      await alex.page.keyboard.type('Pricing', { delay: 20 });
      since = Date.now();
      await log.expectEventually(
        'type',
        async () => (await noteModel(sam.page, id))?.text === 'Pricing',
        since,
      );
      await expect(noteById(sam.page, id)).toContainText('Pricing');
      await alex.page.keyboard.press('Escape');

      // Move.
      await drag(alex.page, { x: 400, y: 300 }, 240, 60);
      const moved = (await noteModel(alex.page, id))!;
      expect(moved.x).not.toBe(300 - 100);
      since = Date.now();
      await log.expectEventually(
        'move',
        async () => {
          const n = await noteModel(sam.page, id);
          return n?.x === moved.x && n?.y === moved.y;
        },
        since,
      );
      const alexBox = await boxOf(noteById(alex.page, id));
      const samBox = await boxOf(noteById(sam.page, id));
      expect(Math.abs(samBox.x - alexBox.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(samBox.y - alexBox.y)).toBeLessThanOrEqual(1);

      // Recolour (the note is selected after the drag, so its toolbar shows).
      await alex.page.getByRole('button', { name: 'Pink colour' }).click();
      since = Date.now();
      await log.expectEventually(
        'recolour',
        async () => (await noteModel(sam.page, id))?.color === 'pink',
        since,
      );
      await expect(noteById(sam.page, id)).toHaveCSS('background-color', 'rgb(244, 143, 177)');

      // Delete.
      await alex.page.getByRole('button', { name: 'Delete note' }).click();
      since = Date.now();
      await log.expectEventually('delete', async () => (await notes(sam.page).count()) === 0, since);
      expect(await getNotes(sam.page)).toEqual([]);
      expectNoProblems(alex, sam);
    } finally {
      await session.close();
    }
  });

  test('TC-23 both typing in the same note keeps every character on both screens', async ({
    browser,
  }, testInfo) => {
    const session = await openParticipants(browser, testInfo, ['Alex', 'Sam']);
    const [alex, sam] = session.participants;
    try {
      const id = await createNoteAt(alex.page, 500, 350, 'green');
      await expect.poll(() => noteModel(sam.page, id).then((n) => n?.text)).toBe('green');

      await startEditing(alex.page, id);
      await startEditing(sam.page, id);
      // Alex types at the start, Sam at the end, at the same time.
      await alex.page.evaluate(() => {
        const t = document.activeElement as HTMLTextAreaElement;
        t.setSelectionRange(0, 0);
      });
      const since = Date.now();
      await Promise.all([
        alex.page.keyboard.type('red ', { delay: 40 }),
        sam.page.keyboard.type(' blue', { delay: 40 }),
      ]);
      await log.expectEventually('concurrent typing settles', () => sameNotes(alex.page, sam.page), since);

      for (const p of [alex, sam]) {
        expect((await noteModel(p.page, id))?.text).toBe('red green blue');
        await expect(noteEditor(p.page)).toHaveValue('red green blue');
      }
      expectNoProblems(alex, sam);
    } finally {
      await session.close();
    }
  });

  test('TC-24 both dragging the same note settle on one position', async ({ browser, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'functional coverage in chromium');
    const session = await openParticipants(browser, testInfo, ['Alex', 'Sam']);
    const [alex, sam] = session.participants;
    try {
      const id = await createNoteAt(alex.page, 500, 350);
      await expect(noteById(sam.page, id)).toBeVisible();
      const start = (await noteModel(alex.page, id))!;

      const since = Date.now();
      await Promise.all([
        drag(alex.page, { x: 500, y: 350 }, 300, 0),
        drag(sam.page, { x: 500, y: 350 }, -200, 150),
      ]);
      await log.expectEventually('concurrent drags settle', () => sameNotes(alex.page, sam.page), since);
      const a = (await noteModel(alex.page, id))!;
      const s = (await noteModel(sam.page, id))!;
      expect({ x: s.x, y: s.y }).toEqual({ x: a.x, y: a.y });
      // Settled on one of the two drop positions.
      expect([
        { x: start.x + 300, y: start.y },
        { x: start.x - 200, y: start.y + 150 },
      ]).toContainEqual({ x: a.x, y: a.y });
      expectNoProblems(alex, sam);
    } finally {
      await session.close();
    }
  });

  test('TC-25 a note Alex deletes while Sam edits it disappears for Sam without an error', async ({
    browser,
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'functional coverage in chromium');
    const session = await openParticipants(browser, testInfo, ['Alex', 'Sam']);
    const [alex, sam] = session.participants;
    try {
      const id = await createNoteAt(alex.page, 500, 350, 'Draft');
      await expect(noteById(sam.page, id)).toContainText('Draft');
      await startEditing(sam.page, id);
      await sam.page.keyboard.type(' idea');

      const c = centreOf(await boxOf(noteById(alex.page, id)));
      await alex.page.mouse.click(c.x, c.y);
      await alex.page.getByRole('button', { name: 'Delete note' }).click();
      // Sam keeps typing while the delete arrives.
      await sam.page.keyboard.type(' more');

      const since = Date.now();
      await log.expectEventually('delete during edit', async () => (await notes(sam.page).count()) === 0, since);
      await expect(noteEditor(sam.page)).toHaveCount(0);
      await expect(notes(alex.page)).toHaveCount(0);
      // The deleted note is not brought back by Sam's typing.
      await sam.page.waitForTimeout(300);
      expect(await getNotes(alex.page)).toEqual([]);
      expect(await getNotes(sam.page)).toEqual([]);
      expectNoProblems(alex, sam);
    } finally {
      await session.close();
    }
  });

  test('TC-28 Alex selecting and editing a note does not select or edit it for Sam', async ({
    browser,
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'functional coverage in chromium');
    const session = await openParticipants(browser, testInfo, ['Alex', 'Sam']);
    const [alex, sam] = session.participants;
    try {
      const id = await createNoteAt(alex.page, 500, 350, 'Mine');
      await expect(noteById(sam.page, id)).toContainText('Mine');
      await startEditing(alex.page, id);
      await alex.page.keyboard.type('!');
      // The text change arrives (so everything Alex sent has arrived) ...
      await expect(noteById(sam.page, id)).toContainText('Mine!');
      // ... but no selection outline, toolbar or editor.
      await expect(noteById(sam.page, id)).toHaveAttribute('data-selected', 'false');
      await expect(noteEditor(sam.page)).toHaveCount(0);
      await expect(sam.page.getByRole('toolbar', { name: 'Note toolbar' })).toHaveCount(0);
      expectNoProblems(alex, sam);
    } finally {
      await session.close();
    }
  });
});

test.describe('Workflow: Full-capacity session', () => {
  test('TC-26 MAX_CONCURRENT_EDITORS people each create and move 5 notes; all screens end identical', async ({
    browser,
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'functional coverage in chromium');
    test.setTimeout(180_000);
    const log = new LatencyLog();
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `P${i + 1}`);
    const session = await openParticipants(browser, testInfo, names);
    const people = session.participants;
    const REGION = 10_000; // world units between participants' areas
    const view = testInfo.project.use.viewport!;
    try {
      // Each person works in their own area of the board so double-clicks land on empty space.
      await Promise.all(
        people.map((p, i) =>
          setCamera(p.page, { x: i * REGION - view.width / 2, y: -view.height / 2, zoom: 1 }),
        ),
      );
      const seenByOthers = (me: Participant, id: string, pos?: { x: number; y: number }) => async () => {
        for (const other of people) {
          if (other === me) continue;
          const n = await noteModel(other.page, id);
          if (!n || (pos && (n.x !== pos.x || n.y !== pos.y))) return false;
        }
        return true;
      };

      await Promise.all(
        people.map(async (me) => {
          const ids: string[] = [];
          for (let j = 0; j < 5; j++) {
            const id = await createNoteAt(me.page, 180 + j * 220, 300, `${me.name}-${j}`);
            ids.push(id);
            await log.expectEventually(`${me.name} create ${j}`, seenByOthers(me, id));
          }
          for (let j = 0; j < 5; j++) {
            await drag(me.page, { x: 180 + j * 220, y: 300 }, 0, 200);
            const n = (await noteModel(me.page, ids[j]))!;
            await log.expectEventually(`${me.name} move ${j}`, seenByOthers(me, ids[j], n));
          }
        }),
      );

      await expect
        .poll(
          async () => {
            const all = await Promise.all(people.map((p) => getNotes(p.page)));
            return all.every((s) => JSON.stringify(s) === JSON.stringify(all[0])) ? all[0].length : -1;
          },
          { timeout: E2E_EVENTUAL_TIMEOUT_MS },
        )
        .toBe(MAX_CONCURRENT_EDITORS * 5);
      for (const p of people) await expect(notes(p.page)).toHaveCount(MAX_CONCURRENT_EDITORS * 5);
      expectNoProblems(...people);
    } finally {
      log.report('Full-capacity session latency');
      await session.close();
    }
  });
});

test.describe('Workflow: Flaky Wi-Fi', () => {
  test('TC-27 edits made during an outage catch up in both directions', async ({
    browser,
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'functional coverage in chromium');
    test.setTimeout(CATCH_UP_TEST_OUTAGE_MS + 90_000);
    const session = await openParticipants(browser, testInfo, ['Alex', 'Sam']);
    const [alex, sam] = session.participants;
    try {
      await expect(connectionBadge(alex.page)).toHaveCount(0);
      await alex.context.setOffline(true);
      const outageStart = Date.now();
      await expect(connectionBadge(alex.page)).toHaveText('Reconnecting…');
      await expect(connectionBadge(alex.page)).toHaveAttribute('data-state', 'reconnecting');
      await expect(connectionBadge(sam.page)).toHaveCount(0);

      // Both keep working; Alex's board stays fully editable.
      for (const x of [300, 550, 800]) {
        await createNoteAt(alex.page, x, 200, `Alex ${x}`);
        await createNoteAt(sam.page, x, 550, `Sam ${x}`);
      }
      await expect(notes(alex.page)).toHaveCount(3);
      await expect(notes(sam.page)).toHaveCount(3);

      const remaining = CATCH_UP_TEST_OUTAGE_MS - (Date.now() - outageStart);
      if (remaining > 0) await alex.page.waitForTimeout(remaining);
      await expect(connectionBadge(alex.page)).toHaveText('Reconnecting…');
      expect(await getNotes(sam.page)).toHaveLength(3);

      await alex.context.setOffline(false);
      await expect(connectionBadge(alex.page)).toHaveText('Connected', {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      });
      await expect(connectionBadge(alex.page)).toHaveAttribute('data-state', 'confirmed');
      await expect(connectionBadge(alex.page)).toHaveCount(0, {
        timeout: CONNECTED_CONFIRMATION_MS + 2000,
      });
      expect(await connectionState(alex.page)).toBe('connected');

      for (const p of [alex, sam]) {
        await expect(notes(p.page)).toHaveCount(6, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
      }
      await expect.poll(() => sameNotes(alex.page, sam.page)).toBe(true);
      await waitForFrame(sam.page);
      for (const x of [300, 550, 800]) {
        await expect(sam.page.locator('.sticky-text', { hasText: `Alex ${x}` })).toBeVisible();
        await expect(alex.page.locator('.sticky-text', { hasText: `Sam ${x}` })).toBeVisible();
      }
    } finally {
      await session.close();
    }
  });
});
