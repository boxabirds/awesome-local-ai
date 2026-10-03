import { expect, type Page } from '@playwright/test';

import { test } from './fixtures.js';
import {
  badge,
  badgeText,
  boardSnapshot,
  closeParticipants,
  connectionState,
  expectNoteCount,
  expectSameBoard,
  logLatency,
  measureChange,
  noteCountOf,
  openParticipants,
  person,
  type Participant,
} from './helpers/participants.js';
import {
  binButton,
  colorSwatch,
  createNote,
  docNotes,
  dragNote,
  escapeEditing,
  noteAt,
  noteById,
  noteCentre,
  noteText,
  notes,
  stickyEditor,
  typeIntoNote,
  typeIntoOpenEditor,
  waitForNoteCount,
} from './helpers/sticky.js';
import {
  CATCH_UP_TEST_OUTAGE_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config.js';

/**
 * Live collaboration in real browsers (design "E2E workflows"): two people on
 * one board in separate browser contexts, then a full-capacity session, then a
 * connection that goes away and comes back. Every functional assertion is a
 * change arriving; how long it took is measured and printed, never asserted
 * (design "Not covered").
 */

/** How many of each character a text holds. */
function characterCounts(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const character of text) counts[character] = (counts[character] ?? 0) + 1;
  return counts;
}

/** The counts that the notes started with plus everything both people typed. */
function expectedCounts(texts: string[]): Record<string, number> {
  return texts.reduce<Record<string, number>>((total, text) => {
    const counts = characterCounts(text);
    for (const [character, count] of Object.entries(counts)) {
      total[character] = (total[character] ?? 0) + count;
    }
    return total;
  }, {});
}

/** How many different boards these pages hold: 1 once they agree. */
async function distinctSnapshotCount(people: Participant[]): Promise<number> {
  return new Set(await Promise.all(people.map((p) => boardSnapshot(p.page)))).size;
}

/**
 * Type more text into the note that is open for editing. `typeIntoNote` asserts
 * the whole text; this one only waits for the note to end up holding both, which
 * is what an append looks like when somebody else is typing too.
 */
async function typeMore(page: Page, index: number, text: string): Promise<void> {
  await page.keyboard.type(text);
  const id = (await docNotes(page))[index]?.id;
  if (!id) throw new Error(`no note at ${index} to type into`);
  await expect
    .poll(async () => (await noteById(page, id)).text.includes(text), {
      message: `text did not reach ${page.url()}`,
    })
    .toBe(true);
}

/** Put one note on the board, typed in, and make sure everybody has it. */
async function seedNote(alex: Participant, sam: Participant, text: string): Promise<string> {
  await createNote(alex.page);
  await typeIntoNote(alex.page, text);
  await escapeEditing(alex.page);
  await waitForNoteCount(sam.page, 1);
  const [note] = await docNotes(alex.page);
  if (!note) throw new Error('the seed note was not created');
  return note.id;
}

/**
 * TC-22 — every operation kind arrives. Alex creates, types, moves, recolours
 * and deletes; each change shows up for Sam.
 */
test('TC-22: every change Alex makes appears for Sam', async ({ browser }) => {
  test.setTimeout(120_000);
  const people = await openParticipants(browser, ['Alex', 'Sam']);
  const alex = person(people, 'Alex');
  const sam = person(people, 'Sam');

  // 1. Create, with the text that comes with it.
  await measureChange(
    'TC-22 create and type arrives for Sam',
    async () => {
      await createNote(alex.page);
      await typeIntoNote(alex.page, 'green');
      await escapeEditing(alex.page);
    },
    async () => (await noteCountOf(sam)) === 1 && (await noteText(sam.page, 0)) === 'green',
  );
  const id = (await docNotes(alex.page))[0]!.id;

  // 2. Move it.
  const from = await noteCentre(alex.page, 0);
  await measureChange(
    'TC-22 move arrives for Sam',
    async () => {
      await dragNote(alex.page, from, { x: from.x + 160, y: from.y + 90 });
    },
    async () => {
      const [here, there] = await Promise.all([
        noteById(alex.page, id),
        noteById(sam.page, id),
      ]);
      return here.x === there.x && here.y === there.y && here.x !== from.x;
    },
  );

  // 3. Recolour it.
  await noteAt(alex.page, 0).click();
  await measureChange(
    'TC-22 recolour arrives for Sam',
    async () => {
      await colorSwatch(alex.page, 'blue').click();
    },
    async () => (await noteById(sam.page, id)).color === 'blue',
  );

  // 4. Type more text into it.
  const at = await noteCentre(alex.page, 0);
  await measureChange(
    'TC-22 typed text arrives for Sam',
    async () => {
      await alex.page.mouse.dblclick(at.x, at.y);
      await typeMore(alex.page, 0, ' meeting notes');
      await escapeEditing(alex.page);
    },
    async () => (await noteById(sam.page, id)).text === 'green meeting notes',
  );

  // 5. Delete it.
  await measureChange(
    'TC-22 delete arrives for Sam',
    async () => {
      await noteAt(alex.page, 0).click();
      await binButton(alex.page).click();
    },
    async () => (await noteCountOf(sam)) === 0,
  );

  await expectSameBoard(people);
  expect(await noteCountOf(alex)).toBe(0);
  await closeParticipants(people);
});

/**
 * TC-23 — two people type into the same note at the same time. Nothing is lost
 * and both pages end up with the same text.
 */
test('TC-23: two people typing into one note keep all their text', async ({ browser }) => {
  test.setTimeout(120_000);
  const people = await openParticipants(browser, ['Alex', 'Sam']);
  const alex = person(people, 'Alex');
  const sam = person(people, 'Sam');

  const id = await seedNote(alex, sam, 'green');
  const at = await noteCentre(alex.page, 0);

  // Both open the same note and type at the same time, a character at a time.
  await alex.page.mouse.dblclick(at.x, at.y);
  await sam.page.mouse.dblclick(at.x, at.y);
  await expect(stickyEditor(alex.page)).toBeFocused();
  await expect(stickyEditor(sam.page)).toBeFocused();

  const typed = { Alex: 'red ', Sam: ' blue' };
  const started = Date.now();
  await Promise.all([
    alex.page.keyboard.type(typed.Alex, { delay: 30 }),
    sam.page.keyboard.type(typed.Sam, { delay: 30 }),
  ]);
  await escapeEditing(alex.page);
  await escapeEditing(sam.page);

  await measureChange(
    'TC-23 both pages agree on the merged text',
    async () => {},
    async () => (await boardSnapshot(alex.page)) === (await boardSnapshot(sam.page)),
  );

  const textAlex = await noteById(alex.page, id).then((n) => n.text);
  const textSam = await noteById(sam.page, id).then((n) => n.text);
  // Both pages show one and the same text, and it holds every character either
  // of them typed. The order within one person's own typing is theirs; the two
  // streams interleave, which is what a merge is.
  expect(textSam).toBe(textAlex);
  expect(characterCounts(textAlex)).toEqual(
    expectedCounts(['green', typed.Alex, typed.Sam]),
  );
  expect(textAlex).toHaveLength('green'.length + typed.Alex.length + typed.Sam.length);
  logLatency('TC-23 two-person typing exchange', Date.now() - started, 'other');

  await expectSameBoard(people);
  await closeParticipants(people);
});

/**
 * TC-24 — two people drag the same note to different places at the same time.
 * They settle on one position; how long that takes is reported, not asserted.
 */
test('TC-24: two people dragging one note settle on one position', async ({ browser }) => {
  test.setTimeout(120_000);
  const people = await openParticipants(browser, ['Alex', 'Sam']);
  const alex = person(people, 'Alex');
  const sam = person(people, 'Sam');

  const id = await seedNote(alex, sam, 'one note');
  const at = await noteCentre(alex.page, 0);

  // Both grab it and pull it their own way, at the same time.
  const started = Date.now();
  await Promise.all([
    dragNote(alex.page, at, { x: at.x + 220, y: at.y - 120 }, 4),
    dragNote(sam.page, at, { x: at.x - 180, y: at.y + 140 }, 4),
  ]);

  await measureChange(
    'TC-24 two drags of one note converge',
    async () => {},
    async () => {
      const [a, s] = await Promise.all([noteById(alex.page, id), noteById(sam.page, id)]);
      return a.x === s.x && a.y === s.y;
    },
  );
  logLatency('TC-24 settle after two drags', Date.now() - started, 'other');

  const [a, s] = await Promise.all([noteById(alex.page, id), noteById(sam.page, id)]);
  expect(a.x).toBe(s.x);
  expect(a.y).toBe(s.y);
  await expectSameBoard(people);
  await closeParticipants(people);
});

/**
 * TC-25 — Sam is typing into a note while Alex deletes it. The note goes away
 * from under Sam, and nothing else happens.
 */
test('TC-25: a delete wins over the person typing into that note', async ({ browser }) => {
  test.setTimeout(120_000);
  const people = await openParticipants(browser, ['Alex', 'Sam']);
  const alex = person(people, 'Alex');
  const sam = person(people, 'Sam');

  await seedNote(alex, sam, 'Retro board');
  const at = await noteCentre(sam.page, 0);

  // Sam is in the middle of typing.
  await sam.page.mouse.dblclick(at.x, at.y);
  await expect(stickyEditor(sam.page)).toBeFocused();
  await sam.page.keyboard.type(' and ');

  // Alex deletes the note Sam is typing into.
  await measureChange(
    'TC-25 Sam sees Alex delete the note he is typing into',
    async () => {
      await noteAt(alex.page, 0).click();
      await binButton(alex.page).click();
    },
    async () => (await noteCountOf(sam)) === 0,
  );

  // The editor goes with it: no textarea, no selection outline, nothing left over.
  await expect(stickyEditor(sam.page)).toHaveCount(0);
  await expect(notes(sam.page)).toHaveCount(0);
  // And nobody was shouted at: no dialog, no console error.
  for (const personHere of people) {
    expect(personHere.dialogs, `${personHere.name} dialogs`).toEqual([]);
    expect(personHere.consoleErrors, `${personHere.name} console errors`).toEqual([]);
  }

  await expectSameBoard(people);
  await closeParticipants(people);
});

/** How many notes a full-capacity session ends up with. */
const FULL_SESSION_ROUNDS = 5;

/**
 * TC-26 — a full house: MAX_CONCURRENT_EDITORS people, each creating five notes
 * and moving five notes, in rounds so the changes genuinely overlap.
 */
test('TC-26: a full-capacity session ends with one identical board', async ({ browser }) => {
  test.setTimeout(300_000);
  const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `Editor ${i + 1}`);
  const people = await openParticipants(browser, names);

  // Each round, everybody creates a note at the same time.
  for (let round = 0; round < FULL_SESSION_ROUNDS; round += 1) {
    await measureChange(
      `TC-26 create round ${round + 1}: ${MAX_CONCURRENT_EDITORS} notes reach everybody`,
      async () => {
        await Promise.all(
          people.map(async (who, index) => {
            await createNote(who.page);
            await typeIntoOpenEditor(who.page, `note ${index + 1}-${round + 1}`);
            await escapeEditing(who.page);
          }),
        );
      },
      async () => {
        const counts = await Promise.all(people.map(noteCountOf));
        return counts.every((count) => count === people.length * (round + 1));
      },
    );
  }

  // Then everybody moves one of the notes, a round at a time.
  for (let round = 0; round < FULL_SESSION_ROUNDS; round += 1) {
    await measureChange(
      `TC-26 move round ${round + 1} reaches everybody`,
      async () => {
        await Promise.all(
          people.map(async (who, index) => {
            const which = (index + round) % people.length;
            const from = await noteCentre(who.page, which);
            await dragNote(
              who.page,
              from,
              { x: from.x + 30 * (index + 1), y: from.y + 20 * (round + 1) },
              3,
            );
          }),
        );
      },
      async () => (await distinctSnapshotCount(people)) === 1,
    );
  }

  await expectSameBoard(people);
  await expectNoteCount(
    people[0]!.page,
    people.length * FULL_SESSION_ROUNDS,
  );
  // Nobody was locked out by the crowd: everybody is still in step, and nobody
  // was told anything.
  for (const who of people) {
    expect(await connectionState(who.page), `${who.name} state`).toBe('connected');
    expect(who.dialogs, `${who.name} dialogs`).toEqual([]);
  }
  await closeParticipants(people);
});

/**
 * TC-27 — flaky Wi-Fi. Alex's connection drops while both keep working; when it
 * comes back, both pages have everything, and Alex is told about all of it.
 */
test('TC-27: an outage costs nothing, both pages catch up', async ({ browser }) => {
  test.setTimeout(180_000);
  const people = await openParticipants(browser, ['Alex', 'Sam']);
  const alex = person(people, 'Alex');
  const sam = person(people, 'Sam');

  // Alex's connection goes, and stays gone for the length of the outage. The
  // browser is told the network is down too, so the provider's retries really
  // do fail while the outage lasts. Playwright's offline mode does not interrupt
  // a socket that is already open (it only refuses new ones), so the drop itself
  // is asked for through the test-only connection hook.
  await alex.context.setOffline(true);
  await alex.page.evaluate(() => window.__vidi6Connection?.dropConnection());
  await expect
    .poll(() => badgeText(alex.page), {
      message: 'Alex was never told the room was gone',
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe('Reconnecting…');
  expect(await connectionState(alex.page)).toBe('reconnecting');

  // Each of them adds three notes while Alex is out.
  for (let i = 0; i < 3; i += 1) {
    await createNote(alex.page);
    await typeIntoOpenEditor(alex.page, `offline ${i + 1}`);
    await escapeEditing(alex.page);
  }
  for (let i = 0; i < 3; i += 1) {
    await createNote(sam.page);
    await typeIntoOpenEditor(sam.page, `online ${i + 1}`);
    await escapeEditing(sam.page);
  }
  // Neither page has the other's work yet.
  expect(await noteCountOf(alex)).toBe(3);
  expect(await noteCountOf(sam)).toBe(3);

  // Hold the outage open for the length the design names.
  await alex.page.waitForTimeout(CATCH_UP_TEST_OUTAGE_MS);

  // Back on the network, and reconnecting now instead of waiting for the
  // provider's backoff.
  await alex.context.setOffline(false);
  const restored = Date.now();
  await alex.page.evaluate(() => window.__vidi6Connection?.restoreConnection());

  // The badge is the story: "Connected" for the confirmation window…
  await expect
    .poll(() => badgeText(alex.page), {
      message: 'Alex was never told he was back',
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe('Connected');
  // …and then nothing at all.
  await expect(badge(alex.page)).toHaveCount(0, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await expect
    .poll(() => connectionState(alex.page), { message: 'Alex never reached the room' })
    .toBe('connected');
  logLatency('TC-27 reconnect until the room is reached again', Date.now() - restored, 'other');

  // All six notes are on both pages: Alex's three went up, Sam's three came down.
  await expectNoteCount(alex.page, 6);
  await expectNoteCount(sam.page, 6);
  await expectSameBoard(people);
  await closeParticipants(people);
});

/**
 * TC-28 — selection and editing stay local. Alex's caret is not board content,
 * so Sam must not see a trace of it. (Presence is story 6; this is the negative
 * that keeps that story honest.)
 */
test('TC-28: nobody sees anyone else’s selection', async ({ browser }) => {
  test.setTimeout(120_000);
  const people = await openParticipants(browser, ['Alex', 'Sam']);
  const alex = person(people, 'Alex');
  const sam = person(people, 'Sam');

  await seedNote(alex, sam, 'shared note');
  const at = await noteCentre(alex.page, 0);

  // Alex selects the note and starts editing it.
  await alex.page.mouse.click(at.x, at.y);
  await expect(noteAt(alex.page, 0)).toHaveAttribute('data-selected', 'true');
  await alex.page.keyboard.press('Enter');
  await expect(stickyEditor(alex.page)).toBeFocused();

  // Sam has the note, but nothing that says Alex is looking at it.
  await expect(notes(sam.page)).toHaveCount(1);
  await expect(stickyEditor(sam.page)).toHaveCount(0);
  await expect(noteAt(sam.page, 0)).toHaveAttribute('data-selected', 'false');
  await expect(noteAt(sam.page, 0)).toHaveAttribute('data-editing', 'false');
  // Sam's own board is still Sam's to move: the note is where Sam left it, and
  // Alex's editing did not change it.
  expect((await docNotes(sam.page))[0]?.text).toBe('shared note');
  expect(await boardSnapshot(alex.page)).toBe(await boardSnapshot(sam.page));

  await closeParticipants(people);
});
