import { expect, test } from '@playwright/test';
import {
  CATCH_UP_TEST_OUTAGE_MS,
  CONNECTED_CONFIRMATION_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import { setCamera } from './helpers/board';
import {
  centreOf,
  closeAll,
  createNoteAt,
  domSnapshot,
  dragBy,
  expectWithin,
  note,
  noteState,
  notes,
  openParticipants,
  type Participant,
} from './helpers/participants';

const CAPACITY_ZOOM = 0.25;
const NOTES_EACH = 5;
const OFFLINE_NOTES_EACH = 3;
const MULTI_CONTEXT_TIMEOUT_MS = 120_000;

let people: Participant[] = [];
test.afterEach(async () => {
  await closeAll(people);
  people = [];
});

/** Multi-context tests beyond TC-22/TC-23 run in Chromium only (design: chromium is sufficient). */
function chromiumOnly(browserName: string) {
  test.skip(browserName !== 'chromium', 'multi-context scenario runs in chromium');
}

test.describe('Two-person workshop', () => {
  test('TC-22 every kind of change appears for the other person within the budget', async ({ browser }) => {
    people = await openParticipants(browser, ['Alex', 'Sam']);
    const [alex, sam] = people as [Participant, Participant];

    // Create
    await alex.page.getByRole('button', { name: 'Sticky note' }).click();
    await expect(notes(alex.page)).toHaveCount(1);
    const id = (await notes(alex.page).first().getAttribute('data-id'))!;
    await expectWithin(() => notes(sam.page).count(), 'create').toBe(1);

    // Text: letters arrive as Alex types
    await alex.page.keyboard.type('Pri');
    await expectWithin(async () => (await noteState(sam.page, id))?.text, 'partial text').toBe('Pri');
    await alex.page.keyboard.type('cing');
    await expectWithin(async () => (await noteState(sam.page, id))?.text, 'text').toBe('Pricing');
    await alex.page.keyboard.press('Escape');

    // Move
    await dragBy(alex.page, await centreOf(note(alex.page, id)), 240, 80);
    const moved = (await noteState(alex.page, id))!;
    await expectWithin(async () => {
      const s = await noteState(sam.page, id);
      return s && { x: s.x, y: s.y };
    }, 'move').toEqual({ x: moved.x, y: moved.y });

    // Recolour
    await alex.page.getByRole('button', { name: 'Pink colour' }).click();
    await expect(note(alex.page, id)).toHaveAttribute('data-color', 'pink');
    await expectWithin(async () => (await noteState(sam.page, id))?.color, 'recolour').toBe('pink');

    // Delete
    await alex.page.getByRole('button', { name: 'Delete note' }).click();
    await expect(notes(alex.page)).toHaveCount(0);
    await expectWithin(() => notes(sam.page).count(), 'delete').toBe(0);
  });

  test('TC-23 simultaneous typing in one note keeps every character', async ({ browser }) => {
    people = await openParticipants(browser, ['Alex', 'Sam']);
    const [alex, sam] = people as [Participant, Participant];
    await alex.page.getByRole('button', { name: 'Sticky note' }).click();
    await alex.page.keyboard.type('green');
    const id = (await notes(alex.page).first().getAttribute('data-id'))!;
    await expectWithin(async () => (await noteState(sam.page, id))?.text).toBe('green');

    await sam.page.locator(`[data-id="${id}"]`).dblclick();
    const samEditor = sam.page.getByRole('textbox', { name: 'Note text' });
    await expect(samEditor).toBeFocused();
    // Carets: Alex at the start, Sam at the end (Home/End differ per platform).
    const alexEditor = alex.page.getByRole('textbox', { name: 'Note text' });
    await alexEditor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
    await samEditor.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
    await Promise.all([alex.page.keyboard.type('red '), sam.page.keyboard.type(' blue')]);

    for (const p of people) {
      await expectWithin(async () => (await noteState(p.page, id))?.text, p.name).toBe('red green blue');
    }
  });

  test('TC-24 two people dragging one note settle on the same position', async ({ browser, browserName }) => {
    chromiumOnly(browserName);
    people = await openParticipants(browser, ['Alex', 'Sam']);
    const [alex, sam] = people as [Participant, Participant];
    const id = await createNoteAt(alex.page, { x: 500, y: 400 }, 'Shared');
    await expectWithin(() => notes(sam.page).count()).toBe(1);

    const [fromA, fromS] = [await centreOf(note(alex.page, id)), await centreOf(note(sam.page, id))];
    await Promise.all([dragBy(alex.page, fromA, 300, -150, 20), dragBy(sam.page, fromS, -300, 150, 20)]);

    await expectWithin(async () => {
      const [a, s] = [await noteState(alex.page, id), await noteState(sam.page, id)];
      return a !== null && s !== null && a.x === s.x && a.y === s.y;
    }, 'positions converge').toBe(true);
  });

  test('TC-25 deleting a note someone is typing in ends their editing cleanly', async ({ browser, browserName }) => {
    chromiumOnly(browserName);
    people = await openParticipants(browser, ['Alex', 'Sam']);
    const [alex, sam] = people as [Participant, Participant];
    const id = await createNoteAt(alex.page, { x: 500, y: 400 }, 'Doomed');
    await expectWithin(() => notes(sam.page).count()).toBe(1);

    await note(sam.page, id).dblclick();
    await expect(sam.page.getByRole('textbox', { name: 'Note text' })).toBeFocused();
    await sam.page.keyboard.type(' idea');

    await note(alex.page, id).click();
    await alex.page.getByRole('button', { name: 'Delete note' }).click();

    await expectWithin(() => notes(sam.page).count(), 'note removed for Sam').toBe(0);
    await expect(sam.page.getByRole('textbox', { name: 'Note text' })).toHaveCount(0);
    // Sam keeps typing into nothing: the note must not come back.
    await sam.page.keyboard.type('more');
    await sam.page.waitForTimeout(LIVE_UPDATE_LATENCY_BUDGET_MS);
    await expect(notes(sam.page)).toHaveCount(0);
    await expect(notes(alex.page)).toHaveCount(0);
    expect(sam.errors).toEqual([]);
    expect(sam.dialogs).toEqual([]);
    expect(alex.errors).toEqual([]);
  });

  test('TC-28 my selection and editing stay on my screen', async ({ browser, browserName }) => {
    chromiumOnly(browserName);
    people = await openParticipants(browser, ['Alex', 'Sam']);
    const [alex, sam] = people as [Participant, Participant];
    const id = await createNoteAt(alex.page, { x: 500, y: 400 }, 'Mine');
    await expectWithin(() => notes(sam.page).count()).toBe(1);

    await note(alex.page, id).click();
    await expect(note(alex.page, id)).toHaveAttribute('data-selected', 'true');
    await note(alex.page, id).dblclick();
    await expect(alex.page.getByRole('textbox', { name: 'Note text' })).toBeFocused();
    await alex.page.waitForTimeout(LIVE_UPDATE_LATENCY_BUDGET_MS);

    await expect(note(sam.page, id)).toHaveAttribute('data-selected', 'false');
    await expect(note(sam.page, id)).toHaveAttribute('data-state', 'unselected');
    await expect(sam.page.getByRole('textbox', { name: 'Note text' })).toHaveCount(0);
    await expect(sam.page.getByRole('toolbar', { name: 'Note' })).toHaveCount(0);
  });
});

test.describe('Full-capacity session', () => {
  test(`TC-26 ${MAX_CONCURRENT_EDITORS} people create and move notes; everyone sees every change`, async ({ browser, browserName }) => {
    chromiumOnly(browserName);
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `Person ${i + 1}`);
    people = await openParticipants(browser, names);
    // Zoom out so every participant's notes fit on screen in their own row.
    await Promise.all(people.map((p) => setCamera(p.page, { x: -200, y: -200, zoom: CAPACITY_ZOOM })));
    const rowHeight = 700 / MAX_CONCURRENT_EDITORS;

    const others = (me: Participant) => people.filter((p) => p !== me);
    await Promise.all(
      people.map(async (me, row) => {
        const y = 80 + row * rowHeight;
        const ids: string[] = [];
        for (let j = 0; j < NOTES_EACH; j++) {
          const id = await createNoteAt(me.page, { x: 150 + j * 200, y }, `${me.name} #${j + 1}`);
          ids.push(id);
          const mine = await noteState(me.page, id);
          for (const o of others(me)) {
            await expectWithin(() => noteState(o.page, id), `${o.name} sees ${me.name}'s create`).toEqual(mine);
          }
        }
        for (const id of ids) {
          await dragBy(me.page, await centreOf(note(me.page, id)), 80, 0);
          const mine = await noteState(me.page, id);
          for (const o of others(me)) {
            await expectWithin(async () => {
              const s = await noteState(o.page, id);
              return s && { x: s.x, y: s.y };
            }, `${o.name} sees ${me.name}'s move`).toEqual({ x: mine!.x, y: mine!.y });
          }
        }
      }),
    );

    const final = await domSnapshot(people[0]!.page);
    expect(final).toHaveLength(MAX_CONCURRENT_EDITORS * NOTES_EACH);
    for (const p of people) await expectWithin(() => domSnapshot(p.page), p.name).toEqual(final);
  });
});

test.describe('Flaky Wi-Fi', () => {
  test('TC-27 edits made during an outage reach everyone after reconnecting', async ({ browser, browserName }) => {
    chromiumOnly(browserName);
    test.setTimeout(MULTI_CONTEXT_TIMEOUT_MS);
    people = await openParticipants(browser, ['Alex', 'Sam']);
    const [alex, sam] = people as [Participant, Participant];
    const badge = alex.page.getByTestId('connection-status');
    await expect(badge).toHaveCount(0);

    await alex.setOnline(false);
    const outageStart = Date.now();
    await expect(badge).toHaveText('Reconnecting…');
    for (let i = 0; i < OFFLINE_NOTES_EACH; i++) {
      await createNoteAt(alex.page, { x: 200 + i * 250, y: 250 }, `Alex offline ${i + 1}`);
      await createNoteAt(sam.page, { x: 200 + i * 250, y: 550 }, `Sam online ${i + 1}`);
    }
    await expect(notes(alex.page)).toHaveCount(OFFLINE_NOTES_EACH);
    await expect(badge).toHaveText('Reconnecting…');
    const remaining = CATCH_UP_TEST_OUTAGE_MS - (Date.now() - outageStart);
    if (remaining > 0) await alex.page.waitForTimeout(remaining);

    await alex.setOnline(true);
    await expect(badge).toHaveText('Connected', { timeout: 15_000 });
    await expect(badge).toHaveAttribute('data-state', 'confirmed');
    await expect(badge).toHaveCount(0, { timeout: CONNECTED_CONFIRMATION_MS + 1000 });

    const total = OFFLINE_NOTES_EACH * 2;
    await expectWithin(() => notes(alex.page).count()).toBe(total);
    await expectWithin(() => notes(sam.page).count()).toBe(total);
    expect(await domSnapshot(alex.page)).toEqual(await domSnapshot(sam.page));
  });
});
