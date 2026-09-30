// Copyright 2026 Board Room contributors. All rights reserved.
//
// Live collaboration in real browsers: separate people, separate browser
// contexts, the real Worker and BoardRoom behind `wrangler dev`, real
// WebSockets. Nothing here is mocked; the only thing a test reaches for is the
// test-mode hook that reports the connection state (design: Fixtures).
//
// Specs: spec/stories/003-see-other-people-s-edits-appear-live-on-the-same-b/
// design.md, "Test coverage" (TC-22 to TC-28) and its three workflows.
import { expect, test } from '@playwright/test';
import {
  CATCH_UP_TEST_OUTAGE_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import { setCamera } from './helpers/board';
import {
  consoleErrorsOf,
  createNote,
  deleteNote,
  dragNote,
  expectChangeEventually,
  goOffline,
  goOnline,
  openParticipants,
  outageNoise,
  expectEventually,
  printLatencyReport,
  recolour,
  selectNote,
  sharedFieldsOf,
  sharedOf,
  sleep,
  startEditing,
  stopEditing,
  textOf,
  positionOf,
  type,
  type Participant,
} from './helpers/participants';

/** Where a note is put when a scenario does not care where it goes. */
const SPOT = { x: 620, y: 360 };

/** Five notes each, as the capacity scenarios describe a full session. */
const NOTES_EACH = 5;

test.afterAll(() => {
  printLatencyReport('Live collaboration: a change, and when the other person sees it');
});

test.describe('two-person workshop', () => {
  // TC-22: one writer, one watcher, every kind of change.
  test('what Alex does shows up for Sam, one change at a time (TC-22)', async ({ browser }) => {
    const { people } = await openParticipants(browser, 2);
    const [alex, sam] = people as [Participant, Participant];

    const id = await createNote(alex, SPOT.x, SPOT.y, 'first idea');
    await stopEditing(alex);
    await expectChangeEventually(
      `${sam.name} sees the note ${alex.name} created`,
      () => sharedFieldsOf(sam, id),
      await sharedFieldsOf(alex, id),
    );

    await dragNote(alex, id, 140, 90);
    await expectChangeEventually(
      `${sam.name} sees it move`,
      () => positionOf(sam, id),
      await positionOf(alex, id),
    );

    await recolour(alex, id, 'Blue');
    await expectChangeEventually(
      `${sam.name} sees it recoloured`,
      () => sam.note(id).then((note) => note?.color),
      'blue',
    );

    await startEditing(alex, id);
    await type(alex, ' and then some');
    await stopEditing(alex);
    await expectChangeEventually(
      `${sam.name} sees what was typed`,
      () => textOf(sam, id),
      await textOf(alex, id),
    );

    await deleteNote(alex, id);
    await expectEventually(
      `${sam.name} sees it go away`,
      () => sam.note(id),
      { is: (note) => note === undefined },
    );

    expect(consoleErrorsOf(people)).toEqual([]);
  });

  // TC-23: both typing into one note at the same time. The merge has to keep
  // every character, in an order both screens agree on.
  test('both typing into one note at once keeps every character (TC-23)', async ({ browser }) => {
    const { people } = await openParticipants(browser, 2);
    const [alex, sam] = people as [Participant, Participant];

    const id = await createNote(alex, SPOT.x, SPOT.y, 'go:');
    await stopEditing(alex);
    await expectChangeEventually(`${sam.name} has the note`, () => textOf(sam, id), 'go:');

    await startEditing(alex, id);
    await startEditing(sam, id);
    await Promise.all([type(alex, 'aaaa'), type(sam, 'bbbb')]);
    await Promise.all([stopEditing(alex), stopEditing(sam)]);

    const straightAfter = await Promise.all([textOf(alex, id), textOf(sam, id)]);
    console.log(
      `[merge] straight after typing: ${String(straightAfter[0])} / ${String(straightAfter[1])}`,
    );

    // The two screens are not asked to agree instantly; they are asked to agree.
    await expectEventually(
      `${alex.name} and ${sam.name} end up with the same text`,
      async () => [await textOf(alex, id), await textOf(sam, id)] as const,
      { is: ([one, two]) => one !== undefined && one === two },
    );

    const settled = await Promise.all([textOf(alex, id), textOf(sam, id)]);
    const alexText = settled[0];
    const samText = settled[1];
    console.log(`[merge] settled: ${String(alexText)} / ${String(samText)}`);
    expect(alexText).toBe(samText);
    const count = (text: string, character: string): number =>
      [...(text ?? '')].filter((letter) => letter === character).length;
    expect(count(alexText ?? '', 'a')).toBe(4);
    expect(count(alexText ?? '', 'b')).toBe(4);
    expect(alexText).toContain('go:');

    expect(consoleErrorsOf(people)).toEqual([]);
  });

  // TC-24: both dragging the same note to different places. Where it ends up is
  // whichever the document puts last, and both screens land on the same one.
  test('both dragging the same note settle on one position (TC-24)', async ({ browser }) => {
    const { people } = await openParticipants(browser, 2);
    const [alex, sam] = people as [Participant, Participant];

    const id = await createNote(alex, SPOT.x, SPOT.y, 'shared');
    await stopEditing(alex);
    await expectChangeEventually(`${sam.name} has the note`, () => textOf(sam, id), 'shared');

    await Promise.all([dragNote(alex, id, 180, 70), dragNote(sam, id, -150, 160)]);

    const settledAt = Date.now();
    await expectEventually(
      `${alex.name} and ${sam.name} settle on one position`,
      async () => [await positionOf(alex, id), await positionOf(sam, id)] as const,
      {
        is: ([one, two]) =>
          one !== undefined && two !== undefined && one.left === two.left && one.top === two.top,
      },
    );
    // How long the two drags took to agree is reported by the wrapper above; the
    // number itself is not a pass/fail signal on one shared machine.
    console.log(`[settle] both drags agreed in ${String(Date.now() - settledAt)}ms`);

    expect(consoleErrorsOf(people)).toEqual([]);
  });

  // TC-25: one person is typing into a note while another deletes it.
  test('a note deleted while the other is typing is gone cleanly (TC-25)', async ({ browser }) => {
    const { people } = await openParticipants(browser, 2);
    const [alex, sam] = people as [Participant, Participant];

    const id = await createNote(alex, SPOT.x, SPOT.y, 'doomed');
    await stopEditing(alex);
    await expectChangeEventually(`${sam.name} has the note`, () => textOf(sam, id), 'doomed');

    await startEditing(sam, id);
    await type(sam, ' while I am in here');
    await deleteNote(alex, id);

    await expectEventually(
      `${sam.name} sees the note go away`,
      () => sam.note(id),
      { is: (note) => note === undefined },
    );
    // The editor that was open on it went with it: nothing is left mid-edit.
    await expect(sam.page.locator('textarea')).toHaveCount(0);
    await expect(alex.page.locator('textarea')).toHaveCount(0);

    // And no error dialog: no uncaught error on either screen.
    expect(consoleErrorsOf(people)).toEqual([]);
    await expect(sam.page.getByRole('alert')).toHaveCount(0);
  });
});

test.describe('full-capacity session', () => {
  // TC-26: every person the board is meant for, all editing at once.
  test('a board full of people all ends up with the same board (TC-26)', async ({ browser }) => {
    test.setTimeout(240_000);
    const { people } = await openParticipants(browser, MAX_CONCURRENT_EDITORS);

    // Each person looks at a different part of the board, so their double-clicks
    // land on empty space of their own. Where the camera is is not shared.
    const ids: string[][] = [];
    for (const [index, person] of people.entries()) {
      await setCamera(person.page, { x: -640 + index * 300, y: -400, zoom: 1 });
      ids[index] = [];
      for (let note = 0; note < NOTES_EACH; note += 1) {
        const id = await createNote(person, 120 + note * 230, 400, `${person.name}${String(note)}`);
        await stopEditing(person);
        ids[index]?.push(id);
      }
    }

    // Every change reaches the next person (the last one's goes back to the
    // first), which is where the per-change latency is measured; that everyone
    // has everything at the end is the identical-snapshot check below.
    for (const [index, person] of people.entries()) {
      const other = people[(index + 1) % people.length] as Participant;
      for (const id of ids[index] ?? []) {
        await expectChangeEventually(
          `${other.name} sees ${person.name}'s note`,
          () => sharedFieldsOf(other, id),
          await sharedFieldsOf(person, id),
        );
      }
    }

    for (const [index, person] of people.entries()) {
      for (const [note, id] of (ids[index] ?? []).entries()) {
        await dragNote(person, id, 40 * (note + 1), -30 * (note + 1));
      }
    }

    for (const [index, person] of people.entries()) {
      const other = people[(index + 1) % people.length] as Participant;
      for (const [note, id] of (ids[index] ?? []).entries()) {
        await expectChangeEventually(
          `${other.name} sees ${person.name}'s note ${String(note + 1)} move`,
          () => positionOf(other, id),
          await positionOf(person, id),
        );
      }
    }

    const snapshots = await Promise.all(people.map((person) => person.snapshot()));
    const first = snapshots[0];
    for (const [index, snapshot] of snapshots.entries()) {
      expect(snapshot, `${people[index]?.name}'s board differs`).toBe(first);
    }
    expect(snapshots.length).toBe(MAX_CONCURRENT_EDITORS);

    expect(consoleErrorsOf(people)).toEqual([]);
  });
});

test.describe('flaky wi-fi', () => {
  // TC-27: one person loses the network, keeps working, and comes back to find
  // the board had kept going without them.
  //
  // The outage is done at the transport rather than with `context.setOffline(true)`,
  // because offline emulation is not something a browser applies to traffic on
  // loopback, and it never affects a socket that is already open: the person would
  // stay connected and the test would prove nothing. `goOffline` closes the live
  // socket and refuses every new connection to that board — which is what a dead
  // access point does, and leaves everybody else's traffic alone.
  test('a long outage costs nothing but the wait (TC-27)', async ({ browser }) => {
    test.setTimeout(CATCH_UP_TEST_OUTAGE_MS + 150_000);
    const { people } = await openParticipants(browser, 2, { outageSwitch: true });
    const [alex, sam] = people as [Participant, Participant];

    const outageStartedAt = Date.now();
    await goOffline(alex);

    // Both keep making notes: Alex's on a board they believe is fine, Sam's on
    // the one the rest of the room is seeing.
    const alexNotes: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      alexNotes.push(await createNote(alex, 200 + index * 230, 240, `offline ${String(index + 1)}`));
      await stopEditing(alex);
    }
    const samNotes: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      samNotes.push(await createNote(sam, 200 + index * 230, 560, `online ${String(index + 1)}`));
      await stopEditing(sam);
    }

    await expectEventually(
      `${alex.name} notices the connection is gone`,
      () => alex.badgeText(),
      { is: (text) => text === 'Reconnecting\u2026' },
    );

    // The outage lasts as long as the settings say a catch-up is tested over.
    const remaining = CATCH_UP_TEST_OUTAGE_MS - (Date.now() - outageStartedAt);
    if (remaining > 0) await sleep(remaining);

    await goOnline(alex);
    await expectEventually(
      `${alex.name} comes back and says it is connected`,
      () => alex.badgeText(),
      { is: (text) => text === 'Connected' },
    );
    // The green is a confirmation, not a status: it goes away by itself.
    await expect(alex.page.getByTestId('connection-status')).toBeHidden();

    // Nothing was lost on either side: six notes, both directions.
    for (const id of alexNotes) {
      await expectChangeEventually(
        `${sam.name} catches ${alex.name}'s note from the outage`,
        () => sharedFieldsOf(sam, id),
        await sharedFieldsOf(alex, id),
      );
    }
    for (const id of samNotes) {
      await expectChangeEventually(
        `${alex.name} catches ${sam.name}'s note from the outage`,
        () => sharedFieldsOf(alex, id),
        await sharedFieldsOf(sam, id),
      );
    }
    // The note that proved the connection at the start, three made while the
    // network was down, three made on the other side of it.
    for (const person of people) {
      expect((await person.notes()).size, ` is missing notes`).toBe(7);
    }

    // Nothing the board itself got wrong: the only console errors in the window
    // are the failed connections this scenario asked for.
    expect(consoleErrorsOf(people).filter((line) => !outageNoise(line))).toEqual([]);
  });
});

test('a selection stays on the screen it belongs to (TC-28)', async ({ browser }) => {
  const { people } = await openParticipants(browser, 2);
  const [alex, sam] = people as [Participant, Participant];

  const id = await createNote(alex, SPOT.x, SPOT.y, 'mine');
  await stopEditing(alex);
  await expectChangeEventually(`${sam.name} has the note`, () => textOf(sam, id), 'mine');

  await selectNote(alex, id);
  await startEditing(alex, id);

  // Alex's own screen: selected, with an editor open on it.
  const alexNote = await alex.note(id);
  expect(alexNote?.selected).toBe(true);
  expect(alexNote?.editing).toBe(true);
  await expect(alex.page.locator(`[data-testid="sticky-note"][data-id="${id}"]`)).toHaveCSS(
    'outline-style',
    'solid',
  );

  // Sam's screen has the note and nothing else: no outline, no caret, no editor.
  await expect(sam.page.locator(`[data-testid="sticky-note"][data-id="${id}"]`)).toHaveCSS(
    'outline-style',
    'none',
  );
  const samNote = await sam.note(id);
  expect(samNote?.selected).toBe(false);
  expect(samNote?.editing).toBe(false);
  await expect(sam.page.locator('textarea')).toHaveCount(0);

  // And it stays that way while Alex goes on working: the caret is not a shared
  // thing, so nothing about Sam's screen is Alex's selection.
  await type(alex, ' and typing');
  await stopEditing(alex);
  await expectChangeEventually(
    `${sam.name} sees the text`,
    () => textOf(sam, id),
    await textOf(alex, id),
  );
  const stillSam = await sam.note(id);
  expect(stillSam?.selected).toBe(false);
  expect(stillSam?.editing).toBe(false);

  expect(sharedOf(await sam.note(id))?.text).toContain('typing');
  expect(consoleErrorsOf(people)).toEqual([]);
});
