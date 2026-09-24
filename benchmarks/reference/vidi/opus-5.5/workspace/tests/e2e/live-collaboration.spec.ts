import { expect, test, type Page } from '@playwright/test';
import {
  CATCH_UP_TEST_OUTAGE_MS,
  CONNECTED_CONFIRMATION_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import { nextFrames, noteLocator, setCamera } from './helpers/board';
import {
  closeParticipants,
  connectionBadge,
  editingNoteId,
  expectWithin,
  openParticipants,
  renderedNote,
  renderedNotes,
  waitConnected,
  type Participant,
} from './helpers/participants';

const HALF = 2;
const EMPTY_SPOT = { x: 1000, y: 650 } as const;
const DRAG_STEPS = 10;
const TYPE_DELAY_MS = 30;
/** Enough for page loads, several contexts and the waits under test. */
const MULTI_CONTEXT_TIMEOUT_MS = 120_000;
/** Reconnection: exponential backoff is capped at RECONNECT_MAX_BACKOFF_MS, plus the sync. */
const RECONNECT_TIMEOUT_MS = 20_000;

function editor(page: Page) {
  return page.getByRole('textbox', { name: 'Note text' });
}

async function centreOfNote(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = await noteLocator(page, id).boundingBox();
  if (!box) throw new Error(`note ${id} not rendered`);
  return { x: box.x + box.width / HALF, y: box.y + box.height / HALF };
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: DRAG_STEPS });
  await page.mouse.up();
  await nextFrames(page);
}

/** Double-clicks empty board at `at`; returns the new note's id with its editor still open. */
async function startNote(page: Page, at: { x: number; y: number }): Promise<string> {
  await page.mouse.dblclick(at.x, at.y);
  await expect(editor(page)).toBeFocused();
  return editingNoteId(page);
}

/** Creates a note, types `text`, ends editing (note stays selected). */
async function createNote(page: Page, at: { x: number; y: number }, text = ''): Promise<string> {
  const id = await startNote(page, at);
  if (text) await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  return id;
}

function sortedChars(text: string): string {
  return [...text].sort().join('');
}

test.describe('Workflow: two-person workshop', () => {
  let people: Participant[] = [];
  test.afterEach(async () => {
    await closeParticipants(people);
    people = [];
  });

  test('TC-22 every kind of change reaches the other person within the budget', async ({ browser }) => {
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    people = await openParticipants(browser, ['Alex', 'Sam']);
    const [alex, sam] = people as [Participant, Participant];

    // Create: the note appears for Sam.
    const id = await startNote(alex.page, { x: 400, y: 300 });
    await expectWithin(async () => (await renderedNote(sam.page, id)) !== undefined, 'create').toBe(true);

    // Typing: the letters arrive.
    await alex.page.keyboard.type('Pricing', { delay: TYPE_DELAY_MS });
    await expectWithin(async () => (await renderedNote(sam.page, id))?.text, 'text').toBe('Pricing');
    await alex.page.keyboard.press('Escape');

    // Move.
    await drag(alex.page, await centreOfNote(alex.page, id), 150, 80);
    const moved = (await renderedNote(alex.page, id))!.transform;
    await expectWithin(async () => (await renderedNote(sam.page, id))?.transform, 'move').toBe(moved);

    // Recolour (the note is selected after the drag).
    await alex.page.getByRole('button', { name: 'Blue colour' }).click();
    await expect(noteLocator(alex.page, id)).toHaveAttribute('data-color', 'blue');
    await expectWithin(async () => (await renderedNote(sam.page, id))?.color, 'recolour').toBe('blue');

    // Delete.
    await alex.page.getByRole('button', { name: 'Delete note' }).click();
    await expect(noteLocator(alex.page, id)).toHaveCount(0);
    await expectWithin(async () => (await renderedNotes(sam.page)).length, 'delete').toBe(0);

    expect(alex.errors).toEqual([]);
    expect(sam.errors).toEqual([]);
  });

  test('TC-23 typing into the same note at the same time keeps every character', async ({ browser }) => {
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    people = await openParticipants(browser, ['Alex', 'Sam']);
    const [alex, sam] = people as [Participant, Participant];

    const id = await createNote(alex.page, { x: 640, y: 400 }, 'green');
    await alex.page.mouse.click(EMPTY_SPOT.x, EMPTY_SPOT.y);
    await expectWithin(async () => (await renderedNote(sam.page, id))?.text).toBe('green');

    for (const p of [alex, sam]) {
      const centre = await centreOfNote(p.page, id);
      await p.page.mouse.dblclick(centre.x, centre.y);
      await expect(editor(p.page)).toBeFocused();
    }
    const alexWords = ' apple pie';
    const samWords = ' banana split';
    await Promise.all([
      alex.page.keyboard.type(alexWords, { delay: TYPE_DELAY_MS }),
      sam.page.keyboard.type(samWords, { delay: TYPE_DELAY_MS }),
    ]);

    const expectedChars = sortedChars(`green${alexWords}${samWords}`);
    await expectWithin(async () => {
      const a = (await renderedNote(alex.page, id))?.text;
      const s = (await renderedNote(sam.page, id))?.text;
      return a === s ? sortedChars(a ?? '') : `differs: ${a} | ${s}`;
    }).toBe(expectedChars);
    // The open editors show the merged text too.
    const merged = (await renderedNote(alex.page, id))!.text;
    await expect(editor(alex.page)).toHaveValue(merged);
    await expect(editor(sam.page)).toHaveValue(merged);
  });

  test('TC-24 dragging the same note at the same time settles to one position', async ({ browser }) => {
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    people = await openParticipants(browser, ['Alex', 'Sam']);
    const [alex, sam] = people as [Participant, Participant];

    const id = await createNote(alex.page, { x: 500, y: 400 });
    await alex.page.mouse.click(EMPTY_SPOT.x, EMPTY_SPOT.y);
    await expectWithin(async () => (await renderedNote(sam.page, id)) !== undefined).toBe(true);

    const start = await centreOfNote(alex.page, id);
    await Promise.all([drag(alex.page, start, 250, 0), drag(sam.page, start, 0, 200)]);

    await expectWithin(async () => {
      const a = (await renderedNote(alex.page, id))?.transform;
      const s = (await renderedNote(sam.page, id))?.transform;
      return a === s;
    }, 'positions converge').toBe(true);
    const docs = await Promise.all(
      [alex, sam].map((p) => p.page.evaluate(() => window.__vidi6!.getNotes().map((n) => ({ ...n })))),
    );
    expect(docs[0]).toEqual(docs[1]);
  });

  test('TC-25 a note deleted while someone types in it disappears for them without an error', async ({ browser }) => {
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    people = await openParticipants(browser, ['Alex', 'Sam']);
    const [alex, sam] = people as [Participant, Participant];

    const id = await createNote(alex.page, { x: 500, y: 400 }, 'Draft');
    await expectWithin(async () => (await renderedNote(sam.page, id))?.text).toBe('Draft');

    const centre = await centreOfNote(sam.page, id);
    await sam.page.mouse.dblclick(centre.x, centre.y);
    await expect(editor(sam.page)).toBeFocused();
    await sam.page.keyboard.type(' more', { delay: TYPE_DELAY_MS });

    // Alex's note is still selected: Delete removes it.
    await expect(noteLocator(alex.page, id)).toHaveAttribute('data-selected', 'true');
    await alex.page.keyboard.press('Delete');
    await expect(noteLocator(alex.page, id)).toHaveCount(0);

    await expectWithin(async () => (await renderedNotes(sam.page)).length, 'deleted for Sam').toBe(0);
    await expect(editor(sam.page)).toHaveCount(0);

    // Sam keeps typing: nothing brings the note back, anywhere.
    await sam.page.keyboard.type('late', { delay: TYPE_DELAY_MS });
    await sam.page.waitForTimeout(CONNECTED_CONFIRMATION_MS / 4);
    expect(await renderedNotes(sam.page)).toEqual([]);
    expect(await renderedNotes(alex.page)).toEqual([]);
    expect(sam.errors).toEqual([]);
    expect(sam.dialogs).toEqual([]);
    expect(alex.errors).toEqual([]);
  });

  test('TC-28 selecting and editing stay personal', async ({ browser }) => {
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    people = await openParticipants(browser, ['Alex', 'Sam']);
    const [alex, sam] = people as [Participant, Participant];

    const id = await createNote(alex.page, { x: 500, y: 400 }, 'Mine');
    await expectWithin(async () => (await renderedNote(sam.page, id))?.text).toBe('Mine');
    await expect(noteLocator(alex.page, id)).toHaveAttribute('data-selected', 'true');
    const centre = await centreOfNote(alex.page, id);
    await alex.page.mouse.dblclick(centre.x, centre.y);
    await expect(editor(alex.page)).toBeFocused();
    await alex.page.keyboard.type('!', { delay: TYPE_DELAY_MS });

    // Sam sees Alex's text, but never Alex's selection, editor or note toolbar.
    await expectWithin(async () => (await renderedNote(sam.page, id))?.text).toBe('Mine!');
    await expect(noteLocator(sam.page, id)).toHaveAttribute('data-selected', 'false');
    await expect(noteLocator(sam.page, id)).toHaveAttribute('data-editing', 'false');
    await expect(editor(sam.page)).toHaveCount(0);
    await expect(sam.page.getByRole('toolbar', { name: 'Note' })).toHaveCount(0);
  });
});

test.describe('Workflow: full-capacity session', () => {
  const NOTES_EACH = 5;
  /** Zoomed out so every participant's notes fit on screen without overlapping. */
  const ZOOM = 0.2;
  const COLUMN = { first: 200, step: 200 } as const;
  const ROW = { first: 150, step: 110 } as const;
  const MOVE_DX = 60;

  let people: Participant[] = [];
  test.afterEach(async () => {
    await closeParticipants(people);
    people = [];
  });

  test(`TC-26 ${MAX_CONCURRENT_EDITORS} people create and move notes; everyone sees every change`, async ({ browser }) => {
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS * HALF);
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `Person ${i + 1}`);
    people = await openParticipants(browser, names);
    for (const p of people) {
      await setCamera(p.page, { x: 0, y: 0, zoom: ZOOM });
      await nextFrames(p.page);
    }

    const seenEverywhere = async (sender: Participant, id: string, what: string) => {
      const expected = await renderedNote(sender.page, id);
      await Promise.all(
        people
          .filter((p) => p !== sender)
          .map((p) =>
            expectWithin(() => renderedNote(p.page, id), `${what} by ${sender.name} seen by ${p.name}`).toEqual(expected),
          ),
      );
    };

    await Promise.all(
      people.map(async (p, i) => {
        const ids: string[] = [];
        const x = COLUMN.first + i * COLUMN.step;
        for (let r = 0; r < NOTES_EACH; r += 1) {
          const id = await createNote(p.page, { x, y: ROW.first + r * ROW.step });
          ids.push(id);
          await seenEverywhere(p, id, `create ${r}`);
        }
        for (const [r, id] of ids.entries()) {
          await drag(p.page, await centreOfNote(p.page, id), MOVE_DX, 0);
          await seenEverywhere(p, id, `move ${r}`);
        }
      }),
    );

    const snapshots = await Promise.all(people.map((p) => renderedNotes(p.page)));
    expect(snapshots[0]).toHaveLength(MAX_CONCURRENT_EDITORS * NOTES_EACH);
    for (const s of snapshots) expect(s).toEqual(snapshots[0]);
  });
});

test.describe('Workflow: flaky Wi-Fi', () => {
  let people: Participant[] = [];
  test.afterEach(async () => {
    await closeParticipants(people);
    people = [];
  });

  test('TC-27 edits made during an outage catch up in both directions', async ({ browser }) => {
    test.setTimeout(CATCH_UP_TEST_OUTAGE_MS + MULTI_CONTEXT_TIMEOUT_MS);
    people = await openParticipants(browser, ['Alex', 'Sam']);
    const [alex, sam] = people as [Participant, Participant];
    const NOTES_EACH = 3;

    const outageStart = Date.now();
    await alex.context.setOffline(true);
    await expect(connectionBadge(alex.page)).toHaveText('Reconnecting…', { timeout: RECONNECT_TIMEOUT_MS });
    await expect(connectionBadge(alex.page)).toHaveAttribute('data-state', 'reconnecting');

    // Both keep working: Alex locally, Sam live.
    for (let i = 0; i < NOTES_EACH; i += 1) {
      await createNote(alex.page, { x: 300 + i * 250, y: 250 }, `Alex ${i + 1}`);
      await createNote(sam.page, { x: 300 + i * 250, y: 550 }, `Sam ${i + 1}`);
    }
    // Nothing crosses while Alex is cut off.
    expect(await renderedNotes(alex.page)).toHaveLength(NOTES_EACH);
    expect(await renderedNotes(sam.page)).toHaveLength(NOTES_EACH);
    await expect(connectionBadge(alex.page)).toHaveText('Reconnecting…');

    await alex.page.waitForTimeout(Math.max(0, CATCH_UP_TEST_OUTAGE_MS - (Date.now() - outageStart)));
    await alex.context.setOffline(false);

    await expect(connectionBadge(alex.page)).toHaveText('Connected', { timeout: RECONNECT_TIMEOUT_MS });
    await expect(connectionBadge(alex.page)).toHaveAttribute('data-state', 'confirmed');
    for (const p of [alex, sam]) {
      await expect.poll(async () => (await renderedNotes(p.page)).length).toBe(NOTES_EACH * HALF);
    }
    expect(await renderedNotes(alex.page)).toEqual(await renderedNotes(sam.page));
    // The green confirmation hides after CONNECTED_CONFIRMATION_MS.
    await waitConnected(alex.page, CONNECTED_CONFIRMATION_MS * HALF);
  });
});
