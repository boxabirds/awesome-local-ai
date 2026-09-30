import { expect, test, type Page } from '@playwright/test';
import {
  CATCH_UP_TEST_OUTAGE_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import { setCamera } from './helpers/board';
import { centre, createByDoubleClick, editor, noteId } from './helpers/notes';
import {
  badge,
  closeAll,
  docText,
  expectEventually,
  expectSameBoards,
  openParticipants,
  printLatencyReport,
  screenNote,
  screenNotes,
  type Participant,
} from './helpers/participants';

let participants: Participant[] = [];
test.afterEach(async () => {
  await closeAll(participants);
  participants = [];
});

function note(page: Page, id: string) {
  return page.locator(`[data-note-id="${id}"]`);
}

/**
 * Double-clicks the board and types; returns the new note id (editing ended).
 * Found by its editing state, not by counting, since others add notes meanwhile.
 */
async function createNote(page: Page, at: { x: number; y: number }, text: string): Promise<string> {
  await page.mouse.dblclick(at.x, at.y);
  const editing = page.locator('[data-editing="true"]');
  await expect(editing).toHaveCount(1);
  await expect(editor(page)).toBeFocused();
  const id = await noteId(editing);
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  return id;
}

async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 6 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
  await page.mouse.up();
}

test.describe('Two-person workshop', () => {
  test.afterAll(() => printLatencyReport('two-person workshop'));

  test('TC-22: create, type, move, recolour and delete each appear for Sam', async ({ browser }) => {
    participants = await openParticipants(browser, ['Alex', 'Sam']);
    const [alex, sam] = participants.map((p) => p.page);

    // Create + type.
    const created = await createByDoubleClick(alex, { x: 500, y: 400 });
    const id = await noteId(created);
    await expectEventually('create', async () => (await screenNote(sam, id)) !== undefined, {
      sender: alex, receiver: sam, id, key: 'present', value: '1',
    });
    await alex.keyboard.type('Pricing', { delay: 40 });
    await expectEventually('text', async () => (await screenNote(sam, id))?.text === 'Pricing', {
      sender: alex, receiver: sam, id, key: 'text', value: 'Pricing',
    });
    // Letters arrive while Alex types (not only at the end).
    const partial = await sam.evaluate(
      (noteId) => (window.__vidi6Seen ?? []).filter((e) => e.id === noteId && e.key === 'text').map((e) => e.value),
      id,
    );
    expect(partial.filter((t) => t.length > 0 && t !== 'Pricing').length).toBeGreaterThan(0);
    await alex.keyboard.press('Escape');

    // Move.
    await dragBy(alex, await centre(note(alex, id)), 240, 60);
    const moved = (await screenNote(alex, id))!;
    await expectEventually(
      'move',
      async () => {
        const s = await screenNote(sam, id);
        return s?.x === moved.x && s?.y === moved.y;
      },
      { sender: alex, receiver: sam, id, key: 'x', value: String(moved.x) },
    );

    // Recolour.
    await note(alex, id).click();
    await alex.getByRole('button', { name: 'Green colour' }).click();
    await expectEventually('recolour', async () => (await screenNote(sam, id))?.color === 'green', {
      sender: alex, receiver: sam, id, key: 'color', value: 'green',
    });

    // Delete.
    await alex.getByRole('button', { name: 'Delete note' }).click();
    await expectEventually('delete', async () => (await screenNotes(sam)).length === 0, {
      sender: alex, receiver: sam, id, key: 'present', value: '0',
    });
    for (const p of participants) expect(p.consoleErrors).toEqual([]);
  });

  test('TC-23: both typing in one note at once keep every character', async ({ browser }) => {
    participants = await openParticipants(browser, ['Alex', 'Sam']);
    const [alex, sam] = participants.map((p) => p.page);
    const id = await createNote(alex, { x: 600, y: 400 }, 'green');
    await expectEventually('create', async () => (await screenNote(sam, id))?.text === 'green');

    for (const page of [alex, sam]) {
      await note(page, id).dblclick();
      await expect(editor(page)).toBeFocused();
    }
    await alex.evaluate(() => {
      const ta = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Note text"]')!;
      ta.setSelectionRange(0, 0);
    });
    await Promise.all([alex.keyboard.type('red ', { delay: 35 }), sam.keyboard.type(' blue', { delay: 35 })]);

    await expect.poll(() => docText(alex, id), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe('red green blue');
    await expect.poll(() => docText(sam, id), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe('red green blue');
    // What each person sees in their own editor.
    await expect(editor(alex)).toHaveValue('red green blue');
    await expect(editor(sam)).toHaveValue('red green blue');
  });

  test('TC-24: both dragging one note at once settle to the same place', async ({ browser }) => {
    participants = await openParticipants(browser, ['Alex', 'Sam']);
    const [alex, sam] = participants.map((p) => p.page);
    const id = await createNote(alex, { x: 640, y: 400 }, 'drag me');
    await expectEventually('create', async () => (await screenNote(sam, id)) !== undefined);

    const [fromA, fromS] = [await centre(note(alex, id)), await centre(note(sam, id))];
    await Promise.all([dragBy(alex, fromA, 300, -150), dragBy(sam, fromS, -300, 150)]);
    const released = Date.now();
    await expectSameBoards(participants);
    console.log(`[settle] TC-24 positions identical ${Date.now() - released} ms after release (logged, not asserted)`);
    const [a, s] = [await screenNote(alex, id), await screenNote(sam, id)];
    expect(a).toEqual(s);
  });

  test('TC-25: a note deleted while Sam edits it disappears and the editor closes, without errors', async ({
    browser,
  }) => {
    participants = await openParticipants(browser, ['Alex', 'Sam']);
    const [alex, sam] = participants.map((p) => p.page);
    const id = await createNote(alex, { x: 640, y: 400 }, 'to be removed');
    await expectEventually('create', async () => (await screenNote(sam, id)) !== undefined);

    await note(sam, id).dblclick();
    await expect(editor(sam)).toBeFocused();
    await sam.keyboard.type(' still typing');

    await note(alex, id).click();
    await alex.getByRole('button', { name: 'Delete note' }).click();

    await expect(note(sam, id)).toHaveCount(0, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(editor(sam)).toHaveCount(0);
    // Typing after the deletion does not bring the note back.
    await sam.keyboard.type('more');
    await sam.waitForTimeout(300);
    for (const page of [alex, sam]) expect(await screenNotes(page)).toEqual([]);
    for (const p of participants) expect(p.consoleErrors).toEqual([]);
  });

  test('TC-28: selecting and editing stay personal', async ({ browser }) => {
    participants = await openParticipants(browser, ['Alex', 'Sam']);
    const [alex, sam] = participants.map((p) => p.page);
    const id = await createNote(alex, { x: 640, y: 400 }, 'mine');
    await expectEventually('create', async () => (await screenNote(sam, id)) !== undefined);

    await note(alex, id).click();
    await expect(note(alex, id)).toHaveAttribute('data-selected', 'true');
    await note(alex, id).dblclick();
    await expect(editor(alex)).toBeFocused();
    await alex.keyboard.type('!');
    // Sam received the text change, so any selection/editing state would have arrived too.
    await expectEventually('text', async () => (await screenNote(sam, id))?.text === 'mine!');
    await expect(note(sam, id)).toHaveAttribute('data-selected', 'false');
    await expect(note(sam, id)).toHaveAttribute('data-editing', 'false');
    await expect(sam.locator('.sticky-note.is-selected')).toHaveCount(0);
    await expect(editor(sam)).toHaveCount(0);
    await expect(sam.getByRole('toolbar', { name: 'Note' })).toHaveCount(0);
  });
});

test.describe('Full-capacity session', () => {
  test.afterAll(() => printLatencyReport('full-capacity session'));

  test('TC-26: MAX_CONCURRENT_EDITORS people each create 5 and move 5 notes', async ({ browser }) => {
    test.setTimeout(180_000);
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `P${i + 1}`);
    participants = await openParticipants(browser, names);
    const ZOOM = 0.4;
    const NOTES_EACH = 5;
    await Promise.all(participants.map((p) => setCamera(p.page, { x: 0, y: 0, zoom: ZOOM })));

    // Participant i owns row i; note j sits in column j.
    const COL = 200;
    const ROW = 140;
    const spot = (i: number, j: number) => ({ x: 180 + j * COL, y: 100 + i * ROW });
    const owned: string[][] = participants.map(() => []);

    await Promise.all(
      participants.map(async (p, i) => {
        for (let j = 0; j < NOTES_EACH; j++) owned[i].push(await createNote(p.page, spot(i, j), `${p.name}-${j}`));
        for (const id of owned[i]) await dragBy(p.page, await centre(note(p.page, id)), 40, 30);
      }),
    );

    // Every change reaches every other participant.
    for (const [i, sender] of participants.entries()) {
      for (const id of owned[i]) {
        const final = (await screenNote(sender.page, id))!;
        for (const receiver of participants) {
          if (receiver === sender) continue;
          await expectEventually(
            `${sender.name}→${receiver.name} create`,
            async () => (await screenNote(receiver.page, id)) !== undefined,
            { sender: sender.page, receiver: receiver.page, id, key: 'present', value: '1' },
          );
          await expectEventually(
            `${sender.name}→${receiver.name} move`,
            async () => {
              const s = await screenNote(receiver.page, id);
              return s?.x === final.x && s?.y === final.y;
            },
            { sender: sender.page, receiver: receiver.page, id, key: 'x', value: String(final.x) },
          );
        }
      }
    }
    const board = await expectSameBoards(participants);
    expect(board).toHaveLength(MAX_CONCURRENT_EDITORS * NOTES_EACH);
  });
});

test.describe('Flaky Wi-Fi', () => {
  test('TC-27: an outage shows Reconnecting…, then Connected, and both sides catch up', async ({ browser }) => {
    test.setTimeout(CATCH_UP_TEST_OUTAGE_MS + 6 * E2E_EVENTUAL_TIMEOUT_MS);
    participants = await openParticipants(browser, ['Alex', 'Sam']);
    const [alexP, samP] = participants;
    const [alex, sam] = [alexP.page, samP.page];
    await expect(badge(alex)).toHaveCount(0);

    const outageStart = Date.now();
    await alexP.context.setOffline(true);
    await expect(badge(alex)).toHaveText('Reconnecting…', { timeout: CATCH_UP_TEST_OUTAGE_MS + E2E_EVENTUAL_TIMEOUT_MS });

    for (let i = 0; i < 3; i++) {
      await createNote(alex, { x: 300 + i * 260, y: 250 }, `Alex offline ${i}`);
      await createNote(sam, { x: 300 + i * 260, y: 550 }, `Sam ${i}`);
    }
    // The board stays fully editable while reconnecting.
    expect(await screenNotes(alex)).toHaveLength(3);
    expect(await screenNotes(sam)).toHaveLength(3);

    const remaining = CATCH_UP_TEST_OUTAGE_MS - (Date.now() - outageStart);
    if (remaining > 0) await alex.waitForTimeout(remaining);
    await expect(badge(alex)).toHaveText('Reconnecting…');
    await alexP.context.setOffline(false);

    await expect(badge(alex)).toHaveText('Connected', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(badge(alex)).toHaveClass(/is-confirmed/);
    await expect(badge(alex)).toHaveCount(0, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    const board = await expectSameBoards(participants);
    expect(board).toHaveLength(6);
    expect(board.map((n) => n.text).sort()).toEqual(
      ['Alex offline 0', 'Alex offline 1', 'Alex offline 2', 'Sam 0', 'Sam 1', 'Sam 2'],
    );
  });
});
