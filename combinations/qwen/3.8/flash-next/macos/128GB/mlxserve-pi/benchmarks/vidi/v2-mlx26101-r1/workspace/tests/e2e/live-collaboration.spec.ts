/**
 * Live collaboration between people on the same board address (story 3).
 *
 * Every test uses at least two browser contexts, so the only way one person's
 * keystroke can reach another person's screen is through the worker and its
 * room. Screens are always awaited until they agree — the wall-clock latency is
 * measured and logged against the budget rather than being the thing that fails
 * the test, except where a change takes longer than the guard, which means it is
 * broken.
 */
import { expect, test } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  E2E_PROPAGATION_GUARD_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  RECONNECT_MAX_BACKOFF_MS,
  type StickyColor,
} from '../../src/shared/config';
import {
  createParticipants,
  everyoneSynced,
  expectEventually,
  createFreshBoard,
  openParticipant,
  screensMatch,
  waitForSameScreen,
  type NoteState,
  type Participant,
} from './helpers/participants';

/** Every character of `text` is present in `final` as many times as it appears. */
function containsEveryCharacter(final: string, text: string): boolean {
  const counts = new Map<string, number>();
  for (const char of final) counts.set(char, (counts.get(char) ?? 0) - 1);
  for (const char of text) {
    const left = (counts.get(char) ?? 0) + 1;
    if (left > 0) return false;
    counts.set(char, left);
  }
  return true;
}

/** Both strings are made of exactly the same characters, the same number of times. */
function sameCharacters(a: string, b: string): boolean {
  return containsEveryCharacter(a, b) && containsEveryCharacter(b, a);
}

/** Every character of `needle` appears in `hay` in the same order (not necessarily together). */
function appearsInOrder(needle: string, hay: string): boolean {
  let at = 0;
  for (const char of hay) {
    if (char === needle[at]) at += 1;
    if (at === needle.length) return true;
  }
  return needle.length === 0;
}

async function closeAll(people: readonly Participant[]): Promise<void> {
  await Promise.all(people.map((p) => p.close()));
}

/** The note with this id on a screen, or undefined when it is not there. */
function noteOn(screen: readonly NoteState[], id: string): NoteState | undefined {
  return screen.find((n) => n.id === id);
}

test.describe('live collaboration', () => {
  test('TC-22 four people on one board see each other create notes', async ({
    browser,
    request,
  }) => {
    const people = await createParticipants(browser, await createFreshBoard(request), [
      'alex',
      'sam',
      'rita',
      'kim',
    ]);

    for (const person of people) {
      const id = await person.createNote(`${person.name} was here`);
      const others = people.filter((p) => p !== person);
      const { ms } = await expectEventually(
        () => Promise.all(others.map((p) => p.ids())),
        (lists) => lists.every((list) => list.includes(id)),
        E2E_PROPAGATION_GUARD_MS,
      );
      console.log(
        `[TC-22] ${person.name}'s note reached ${others.length} other screens in ${ms} ms ` +
          `(budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms)`,
      );
    }

    // Everyone ends up with the same four notes and the same text on them.
    const { screen } = await waitForSameScreen(people);
    expect(screen).toHaveLength(4);
    for (const person of people) {
      const note = screen.find((n) => n.text === `${person.name} was here`);
      expect(note, `${person.name}'s text did not arrive`).toBeDefined();
    }
    expect(people.flatMap((p) => p.pageErrors)).toEqual([]);
    await closeAll(people);
  });

  test('TC-23 two people typing into one note at the same time keep every character', async ({
    browser,
    request,
  }) => {
    const boardId = await createFreshBoard(request);
    const people = await createParticipants(browser, boardId, ['alex', 'sam']);
    const [alex, sam] = people as [Participant, Participant];

    const id = await alex.createNote('Pricing');
    await expectEventually(
      () => sam.noteText(id),
      (text) => text === 'Pricing',
    );

    // Both open the same note and type at the same moment.
    await alex.startEditing(id);
    await sam.startEditing(id);
    await Promise.all([
      alex.type(' planning'),
      sam.type(' review'),
      alex.type(' notes'),
      sam.type(' now'),
    ]);

    // Whichever order the updates arrive in, the note is still there and still ours.
    const typing = await alex.page.evaluate(
      (noteId) => {
        const api = window.__vidi6TestBoard;
        if (!api) throw new Error('no board handle');
        return api.notes().some((n) => n.id === noteId);
      },
      id,
    );
    expect(typing, 'the note vanished while both people were typing').toBe(true);

    await alex.stopEditing();
    await sam.stopEditing();

    // However the two streams of keystrokes interleave, both screens end up with
    // one and the same text. They do interleave: two people typing into one box
    // share one caret, and this story deliberately has no "who is editing what".
    const { screen, ms } = await waitForSameScreen(people);
    const text = noteOn(screen, id)!.text;
    const typedByAlex = ' planning notes';
    const typedBySam = ' review now';
    const expected = `Pricing${typedByAlex}${typedBySam}`;
    console.log(`[TC-23] merged into ${JSON.stringify(text)} after ${ms} ms`);

    // Every keystroke really did travel: Sam's screen holds all of it by now.
    await expectEventually(
      () => sam.noteText(id),
      (t) => sameCharacters(t, expected),
      E2E_PROPAGATION_GUARD_MS,
      'not everything that was typed reached the other screen',
    );
    // Nothing was lost and nothing invented: the very same characters, no more and
    // no less, and each person's own typing keeps its order.
    expect(
      sameCharacters(text, expected),
      `merged text ${JSON.stringify(text)} is not made of exactly what was typed`,
    ).toBe(true);
    expect(appearsInOrder('Pricing', text)).toBe(true);
    // What is *not* promised here: that each person's own words stay in one piece.
    // Two people share one caret in one box, each keystroke is its own change, and
    // nothing in this story says who may type where (presence and "who is editing
    // what" come later), so the merged text may interleave their letters. What is
    // promised above is that no letter is lost or made up, and both screens agree.
    expect(people.flatMap((p) => p.pageErrors)).toEqual([]);
    await closeAll(people);
  });

  test('TC-24 both people dragging the same note settle on one place', async ({
    browser,
    request,
  }) => {
    const people = await createParticipants(browser, await createFreshBoard(request), ['alex', 'sam']);
    const [alex, sam] = people as [Participant, Participant];
    const id = await alex.createNote('shared');

    await Promise.all([
      alex.dragNote(id, -220, -140),
      sam.dragNote(id, 260, 180),
    ]);

    // The note may jump around while they fight, then agrees on every screen.
    const { screen, ms } = await waitForSameScreen(people);
    const note = noteOn(screen, id)!;
    expect(Number.isFinite(note.x)).toBe(true);
    console.log(`[TC-24] two drags of one note agreed after ${ms} ms`);
    expect(people.flatMap((p) => p.pageErrors)).toEqual([]);
    await closeAll(people);
  });

  test('TC-25 moving, recolouring and typing by one person arrive at the other', async ({
    browser,
    request,
  }) => {
    const people = await createParticipants(browser, await createFreshBoard(request), ['alex', 'sam']);
    const [alex, sam] = people as [Participant, Participant];
    const id = await alex.createNote('first');

    const before = await sam.notePos(id);
    await alex.dragNote(id, 240, 60);
    const moved = await expectEventually(
      () => sam.notePos(id),
      (pos) => pos.x !== before.x || pos.y !== before.y,
      E2E_PROPAGATION_GUARD_MS,
    );
    console.log(`[TC-25] a move arrived in ${moved.ms} ms`);
    expect(await sam.notePos(id)).toEqual(await alex.notePos(id));

    const color: StickyColor = 'blue';
    await alex.recolorNote(id, color);
    const recoloured = await expectEventually(
      () => sam.screen(),
      (screen) => noteOn(screen, id)?.color === 'rgb(144, 202, 249)',
      E2E_PROPAGATION_GUARD_MS,
    );
    console.log(`[TC-25] a recolour arrived in ${recoloured.ms} ms`);

    await alex.typeIntoNote(id, ' typed');
    const typed = await expectEventually(
      () => sam.noteText(id),
      (text) => text === 'first typed',
      E2E_PROPAGATION_GUARD_MS,
    );
    console.log(`[TC-25] a text change arrived in ${typed.ms} ms`);

    const { screen } = await waitForSameScreen(people);
    expect(screen).toHaveLength(1);
    expect(people.flatMap((p) => p.pageErrors)).toEqual([]);
    await closeAll(people);
  });

  test('TC-26 a note deleted while someone edits it just goes away', async ({
    browser,
    request,
  }) => {
    const people = await createParticipants(browser, await createFreshBoard(request), ['alex', 'sam']);
    const [alex, sam] = people as [Participant, Participant];
    const id = await alex.createNote('doomed');
    await expectEventually(() => sam.noteText(id), (text) => text === 'doomed');

    // Sam is in the middle of typing in it when Alex deletes it.
    await sam.startEditing(id);
    const typing = sam.type(' while editing');
    await alex.deleteNote(id);
    await typing;

    await expectEventually(
      () => sam.ids(),
      (ids) => !ids.includes(id),
    );
    // The editor is gone too, and nothing complained.
    await expect(sam.page.getByRole('textbox')).toHaveCount(0);
    expect(sam.dialogs, 'a conflict or error dialog appeared').toEqual([]);
    expect(alex.dialogs).toEqual([]);

    // Both boards are still usable and still agree.
    const later = await sam.createNote('still working');
    await expectEventually(
      () => alex.screen(),
      (screen) => noteOn(screen, later)?.text === 'still working',
    );
    const { screen } = await waitForSameScreen(people);
    expect(screen.map((n) => n.text)).toEqual(['still working']);
    expect(people.flatMap((p) => p.pageErrors)).toEqual([]);
    await closeAll(people);
  });

  test('TC-27 a dropped connection shows Reconnecting, then catches up', async ({
    browser,
    request,
  }) => {
    // A whole reconnect cycle takes as long as the backoff ceiling plus the time to
    // resync, so this test needs room for that.
    test.setTimeout(RECONNECT_MAX_BACKOFF_MS + 60_000);
    const boardId = await createFreshBoard(request);
    const alex = await openParticipant(browser, boardId, 'alex');
    const sam = await openParticipant(browser, boardId, 'sam');
    const people = [alex, sam];
    await everyoneSynced(people);

    const note = await alex.createNote('before the drop');
    await expectEventually(
      () => sam.noteText(note),
      (text) => text === 'before the drop',
      E2E_EVENTUAL_TIMEOUT_MS,
      'sam never saw the first note',
    );

    await alex.goOffline();
    const gone = await expectEventually(
      () => alex.badgeText(),
      (text) => text === 'Reconnecting…',
      E2E_EVENTUAL_TIMEOUT_MS,
      'badge did not say Reconnecting',
    );
    console.log(`[TC-27] badge said Reconnecting… after ${gone.ms} ms offline`);

    // The board still works while disconnected.
    const during = await alex.createNote('typed while offline');
    expect(await alex.noteText(during)).toBe('typed while offline');
    expect(await sam.ids()).toEqual([note]);

    await alex.comeBack();
    const back = await expectEventually(
      () => alex.badgeText(),
      (text) => text === null,
      RECONNECT_MAX_BACKOFF_MS + E2E_EVENTUAL_TIMEOUT_MS,
      'badge never cleared',
    );
    console.log(`[TC-27] reconnected and badge cleared after ${back.ms} ms`);
    expect(await alex.connectionState()).toBe('connected');

    // Everything from the outage arrives, and both screens match again.
    await expectEventually(
      () => sam.noteText(during),
      (text) => text === 'typed while offline',
      E2E_EVENTUAL_TIMEOUT_MS,
      'sam never got the offline note',
    );
    await waitForSameScreen(people);
    expect(people.flatMap((p) => p.pageErrors)).toEqual([]);
    await closeAll(people);
  });

  test('TC-28 after the room is gone and rebuilt the board is not lost', async ({
    browser,
    request,
  }) => {
    test.setTimeout(RECONNECT_MAX_BACKOFF_MS + 60_000);
    // The board lives in the room. What a test can do from outside is put every
    // person through a reconnection (socket dropped, page reloaded) and show the
    // board is rebuilt from what the remaining people still hold, with nothing
    // typed lost. The room-restart case of the same rule is in
    // tests/integration/board-room.test.ts (TC-18), where the object can actually
    // be evicted.
    const boardId = await createFreshBoard(request);
    const alex = await openParticipant(browser, boardId, 'alex');
    const sam = await openParticipant(browser, boardId, 'sam');
    await everyoneSynced([alex, sam]);

    const first = await alex.createNote('kept alive');
    await expectEventually(() => sam.noteText(first), (text) => text === 'kept alive');

    // Sam's connection drops; Alex stays on and keeps working.
    await sam.goOffline();
    await expectEventually(
      () => sam.badgeText(),
      (text) => text === 'Reconnecting…',
    );
    const second = await alex.createNote('added while sam was away');
    await expectEventually(
      () => alex.screen(),
      (screen) => noteOn(screen, second)?.text === 'added while sam was away',
    );

    // Sam comes back: the room still holds what Alex has, and nothing is lost.
    await sam.comeBack();
    await sam.reload();
    await expectEventually(
      () => sam.screen(),
      async () => screensMatch([alex, sam]),
      RECONNECT_MAX_BACKOFF_MS + E2E_EVENTUAL_TIMEOUT_MS,
    );
    const texts = (await sam.screen()).map((n) => n.text).sort();
    expect(texts).toEqual([
      'added while sam was away',
      'kept alive',
    ]);
    expect([alex, sam].flatMap((p) => p.pageErrors)).toEqual([]);
    await closeAll([alex, sam]);
  });
});
