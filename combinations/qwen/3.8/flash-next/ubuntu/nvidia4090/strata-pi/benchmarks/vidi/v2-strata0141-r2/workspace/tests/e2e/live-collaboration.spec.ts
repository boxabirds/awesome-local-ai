/**
 * Story 3 e2e: two or more real browsers on one board (`live.*`, design TC-22 to TC-28).
 *
 * Every participant is an isolated browser context — its own storage, its own
 * page, its own `Y.Doc` — and the only thing they share is the room behind
 * `/api/rooms/<boardId>`. Changes are made through the real UI (double click,
 * drag, type, toolbar) and asserted in the other participants' DOM.
 *
 * Latency is measured and printed for every change, against
 * LIVE_UPDATE_LATENCY_BUDGET_MS, but never asserted: the model, the browsers and
 * the Worker all run on this one machine, so wall-clock timing here is a report,
 * not a verdict. What *is* asserted is that a change arrives at all, within
 * E2E_EVENTUAL_TIMEOUT_MS.
 */
import { expect, test } from '@playwright/test';
import {
  MAX_CONCURRENT_EDITORS,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import { setBoardCamera, settle } from './helpers/board';
import {
  boardSnapshot,
  badgeText,
  boardsAgree,
  closeSession,
  connectionLog,
  createNote,
  deleteNote,
  deliver,
  dragNoteTo,
  editorCount,
  expectNoConsoleErrors,
  goOffline,
  goOnline,
  hasNote,
  measureUntil,
  moveNoteBy,
  noteCount,
  notePosition,
  noteText,
  OUTAGE_MS,
  openBoardTogether,
  person,
  openEditor,
  printLatencySummary,
  recolourNote,
  selectNote,
  snapshotJson,
  typeIntoNote,
  type Participant,
} from './helpers/participants';

const COLOR_NAMES = Object.keys(STICKY_COLORS);

/** Two participants agree on where a note is, to the pixel. */
async function positionsMatch(a: Participant, b: Participant, id: string): Promise<boolean> {
  const [first, second] = await Promise.all([notePosition(a.page, id), notePosition(b.page, id)]);
  if (first === null || second === null) {
    return false;
  }
  return Math.abs(first.x - second.x) <= 1 && Math.abs(first.y - second.y) <= 1;
}

async function everyOtherHas(everyone: Participant[], owner: Participant, id: string): Promise<boolean> {
  for (const participant of everyone) {
    if (participant === owner) {
      continue;
    }
    if (!(await hasNote(participant.page, id))) {
      return false;
    }
  }
  return true;
}

async function everyOtherSees(everyone: Participant[], owner: Participant, id: string): Promise<boolean> {
  for (const participant of everyone) {
    if (participant === owner) {
      continue;
    }
    if (!(await positionsMatch(participant, owner, id))) {
      return false;
    }
  }
  return true;
}

test.describe('two-person workshop (TC-22 to TC-25, TC-28)', () => {
  test('every kind of change one person makes appears on the other screen (TC-22)', async ({
    browser,
  }) => {
    const session = await openBoardTogether(browser, ['Alex', 'Sam']);
    const alex = person(session, 0);
    const sam = person(session, 1);

    try {
      let noteId = '';
      await deliver(
        'TC-22 create',
        async () => {
          noteId = await createNote(alex.page, { x: 420, y: 320 });
        },
        async () => await everyOtherHas(session.participants, alex, noteId),
      );

      const created = await notePosition(sam.page, noteId);
      if (created === null) {
        throw new Error('the note never landed on Sam\'s screen');
      }

      await deliver(
        'TC-22 move',
        () => moveNoteBy(alex.page, noteId, 180, 90),
        async () => await everyOtherSees(session.participants, alex, noteId),
      );

      const colour = COLOR_NAMES[COLOR_NAMES.length - 1] ?? 'yellow';
      await deliver(
        'TC-22 recolour',
        () => recolourNote(alex.page, noteId, colour),
        async () => {
          const notes = await boardSnapshot(sam.page);
          return notes.some((note) => note.id === noteId && note.color === colour);
        },
      );

      await deliver(
        'TC-22 typing',
        () => typeIntoNote(alex.page, noteId, 'written by Alex'),
        async () => (await noteText(sam.page, noteId)) === 'written by Alex',
      );

      await deliver(
        'TC-22 delete',
        () => deleteNote(alex.page, noteId),
        async () => !(await hasNote(sam.page, noteId)),
      );

      await expect.poll(async () => await snapshotJson(sam.page)).toBe(await snapshotJson(alex.page));
      expectNoConsoleErrors(alex, sam);
      printLatencySummary('TC-22');
    } finally {
      await closeSession(session);
    }
  });

  /**
 * Every character of `sources` is present in `text`, counting repeats. The two
 * runs may be interleaved; what may not happen is a character disappearing.
 */
function everyCharacterKept(text: string | null, sources: string[]): boolean {
  if (text === null) {
    return false;
  }
  const counts = new Map<string, number>();
  for (const character of text) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }
  for (const source of sources) {
    for (const character of source) {
      const available = counts.get(character) ?? 0;
      if (available === 0) {
        return false;
      }
      counts.set(character, available - 1);
    }
  }
  return true;
}

test('both typing into one note at the same time keeps every character (TC-23)', async ({
    browser,
  }) => {
    const session = await openBoardTogether(browser, ['Alex', 'Sam']);
    const alex = person(session, 0);
    const sam = person(session, 1);

    try {
      let noteId = '';
      await deliver(
        'TC-23 shared note',
        async () => {
          noteId = await createNote(alex.page, { x: 400, y: 300 });
        },
        async () => await everyOtherHas(session.participants, alex, noteId),
      );

      const typedByAlex = 'Alex was here first';
      const typedBySam = 'and Sam at the same time';

      // Both editors are open on the same note, and both type at the same time.
      const editorForAlex = await openEditor(alex.page, noteId);
      const editorForSam = await openEditor(sam.page, noteId);
      await Promise.all([
        editorForAlex.pressSequentially(typedByAlex, { delay: 25 }),
        editorForSam.pressSequentially(typedBySam, { delay: 25 }),
      ]);
      await alex.page.keyboard.press('Escape');
      await sam.page.keyboard.press('Escape');
      await settle(alex.page);
      await settle(sam.page);

      const startedAt = Date.now();
      await measureUntil(
        'TC-23 both texts merge',
        startedAt,
        async () => {
          const [mine, theirs] = await Promise.all([noteText(alex.page, noteId), noteText(sam.page, noteId)]);
          return mine !== null && mine === theirs;
        },
      );

      const text = await noteText(alex.page, noteId);
      expect(text, 'the two screens ended with different text').toEqual(await noteText(sam.page, noteId));
      // Two people typing into the same place merge character by character, so
      // the two runs may interleave — what must hold is that every character
      // survives and no character is invented.
      expect(everyCharacterKept(text, [typedByAlex, typedBySam]), 'a typed character was lost').toBe(true);
      expect(text?.length, 'the merge added or dropped characters').toBe(typedByAlex.length + typedBySam.length);

      // Typing into different places keeps those places, which is how a shared
      // note reads afterwards: one run at the start, one at the end.
      const seeded = 'green';
      let otherId = '';
      await deliver(
        'TC-23 note seeded with green',
        async () => {
          otherId = await createNote(alex.page, { x: 800, y: 300 });
          await typeIntoNote(alex.page, otherId, seeded);
        },
        async () => (await noteText(sam.page, otherId)) === seeded,
      );

      const startEditor = await openEditor(alex.page, otherId);
      const endEditor = await openEditor(sam.page, otherId);
      await startEditor.press('Home');
      await Promise.all([
        startEditor.pressSequentially('red ', { delay: 40 }),
        endEditor.pressSequentially(' blue', { delay: 40 }),
      ]);
      await alex.page.keyboard.press('Escape');
      await sam.page.keyboard.press('Escape');
      await settle(alex.page);
      await settle(sam.page);

      // Both screens have to have taken everything either person typed before
      // the merged text can be judged for where its pieces ended up.
      const expected = `red ${seeded} blue`;
      const mergeStarted = Date.now();
      await measureUntil(
        'TC-23 text typed at both ends reaches both screens',
        mergeStarted,
        async () => {
          const [mine, theirs] = await Promise.all([noteText(alex.page, otherId), noteText(sam.page, otherId)]);
          return mine !== null && mine === theirs && mine.length === expected.length;
        },
      );

      const merged = await noteText(alex.page, otherId);
      expect(merged, 'text typed at the start and at the end did not stay where it was typed').toBe(expected);
      expect(await noteText(sam.page, otherId)).toBe(merged);

      expectNoConsoleErrors(alex, sam);
      printLatencySummary('TC-23');
    } finally {
      await closeSession(session);
    }
  });

  test('both dragging the same note end with one position on both screens (TC-24)', async ({
    browser,
  }) => {
    const session = await openBoardTogether(browser, ['Alex', 'Sam']);
    const alex = person(session, 0);
    const sam = person(session, 1);

    try {
      let noteId = '';
      await deliver(
        'TC-24 shared note',
        async () => {
          noteId = await createNote(alex.page, { x: 480, y: 320 });
        },
        async () => await everyOtherHas(session.participants, alex, noteId),
      );

      const start = await notePosition(alex.page, noteId);
      if (start === null) {
        throw new Error('the note never landed');
      }

      // Simultaneously, to different places.
      await Promise.all([
        dragNoteTo(alex.page, noteId, { x: start.x + 260, y: start.y + 120 }),
        dragNoteTo(sam.page, noteId, { x: start.x - 220, y: start.y - 100 }),
      ]);

      const startedAt = Date.now();
      await measureUntil(
        'TC-24 both drags settle to one position',
        startedAt,
        async () => await everyOtherSees(session.participants, alex, noteId),
      );

      const final = await notePosition(alex.page, noteId);
      expect(final).not.toBeNull();
      expect(final, 'the note jumped back to where one person started').not.toEqual(start);

      expectNoConsoleErrors(alex, sam);
      printLatencySummary('TC-24');
    } finally {
      await closeSession(session);
    }
  });

  test('a note deleted by someone else disappears, editor and all, without an error (TC-25)', async ({
    browser,
  }) => {
    const session = await openBoardTogether(browser, ['Alex', 'Sam']);
    const alex = person(session, 0);
    const sam = person(session, 1);

    try {
      let noteId = '';
      await deliver(
        'TC-25 note Sam is working on',
        async () => {
          noteId = await createNote(sam.page, { x: 440, y: 320 });
        },
        async () => await everyOtherHas(session.participants, sam, noteId),
      );

      // Sam is mid-edit: the editor is open with unfinished text.
      const editor = await openEditor(sam.page, noteId);
      await editor.pressSequentially('half an idea, still typing');

      await deliver(
        'TC-25 Alex deletes it',
        () => deleteNote(alex.page, noteId),
        async () => !(await hasNote(sam.page, noteId)),
      );

      await expect(sam.page.getByTestId('sticky-note')).toHaveCount(0);
      await expect.poll(async () => await editorCount(sam.page)).toBe(0);
      // No error dialog either: nothing is announced to Sam.
      await expect(sam.page.locator('[role="alert"], [role="dialog"]')).toHaveCount(0);
      await expect.poll(async () => await snapshotJson(sam.page)).toBe(await snapshotJson(alex.page));

      expectNoConsoleErrors(sam, alex);
      printLatencySummary('TC-25');
    } finally {
      await closeSession(session);
    }
  });

  test('what one person selects and edits stays on their own screen (TC-28)', async ({
    browser,
  }) => {
    const session = await openBoardTogether(browser, ['Alex', 'Sam']);
    const alex = person(session, 0);
    const sam = person(session, 1);

    try {
      let noteId = '';
      await deliver(
        'TC-28 note',
        async () => {
          noteId = await createNote(alex.page, { x: 440, y: 320 });
        },
        async () => await everyOtherHas(session.participants, alex, noteId),
      );

      await selectNote(alex.page, noteId);
      await openEditor(alex.page, noteId);

      // Alex's own screen shows the selection and the editor.
      const alexNotes = await boardSnapshot(alex.page);
      const mine = alexNotes.find((note) => note.id === noteId);
      expect(mine?.selected).toBe(true);
      expect(mine?.editing).toBe(true);
      expect(await editorCount(alex.page)).toBe(1);

      // Sam sees the note, and nothing about Alex's interaction with it.
      const samNotes = await boardSnapshot(sam.page);
      const onSam = samNotes.find((note) => note.id === noteId);
      expect(onSam, 'the note never reached Sam').toBeDefined();
      expect(onSam?.selected, 'Alex\'s selection showed up on Sam\'s screen').toBe(false);
      expect(onSam?.editing, 'Alex\'s editor showed up on Sam\'s screen').toBe(false);
      expect(await editorCount(sam.page), 'an editor appeared on Sam\'s screen').toBe(0);
      expect(
        await sam.page.getByTestId('note-toolbar-anchor').count(),
        'a note toolbar appeared on Sam\'s screen',
      ).toBe(0);
      expect(
        await sam.page.locator('[data-testid="sticky-note"][data-selected="true"]').count(),
      ).toBe(0);

      expectNoConsoleErrors(alex, sam);
      printLatencySummary('TC-28');
    } finally {
      await closeSession(session);
    }
  });
});

test.describe('full-capacity session (TC-26)', () => {
  test(`${MAX_CONCURRENT_EDITORS} contexts each create 5 notes and move 5 notes`, async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_unused, index) => `editor-${index + 1}`);
    const session = await openBoardTogether(browser, names);

    try {
      // One shared camera so every screen paints the board at the same place,
      // and far enough out that each participant owns a row of notes.
      const camera = { x: 0, y: 0, zoom: 0.5 };
      const spacing = Math.round(STICKY_SIZE_WORLD * camera.zoom) + 40;
      for (const participant of session.participants) {
        await setBoardCamera(participant.page, camera);
        await settle(participant.page);
      }

      for (let row = 0; row < session.participants.length; row += 1) {
        const participant = person(session, row);
        const own: string[] = [];
        for (let column = 0; column < 5; column += 1) {
          const at = { x: 60 + column * spacing, y: 60 + row * spacing };
          await deliver(
            `TC-26 ${participant.name} create ${column + 1}`,
            async () => {
              own[column] = await createNote(participant.page, at);
            },
            async () => {
              const noteId = own[column];
              return noteId !== undefined && (await everyOtherHas(session.participants, participant, noteId));
            },
          );
        }

        for (let column = 0; column < 5; column += 1) {
          const noteId = own[column];
          if (noteId === undefined) {
            throw new Error(`${participant.name} never created note ${column + 1}`);
          }
          await deliver(
            `TC-26 ${participant.name} move ${column + 1}`,
            () => moveNoteBy(participant.page, noteId, 60, 24),
            async () => await everyOtherSees(session.participants, participant, noteId),
          );
        }
      }

      const lead = person(session, 0);
      await expect
        .poll(async () => await noteCount(lead.page), { timeout: 15_000 })
        .toBe(MAX_CONCURRENT_EDITORS * 5);

      const first = await snapshotJson(lead.page);
      for (const participant of session.participants.slice(1)) {
        await expect
          .poll(
            async () => await snapshotJson(participant.page),
            { timeout: 15_000, message: `${participant.name} ended with a different board` },
          )
          .toBe(first);
      }

      expect(await boardsAgree(...session.participants)).toBe(true);
      expectNoConsoleErrors(...session.participants);
      printLatencySummary('TC-26');
    } finally {
      await closeSession(session);
    }
  });
});

test.describe('flaky wi-fi (TC-27)', () => {
  // `browserContext.setOffline` is the outage the story names, and it is the
  // only way to cut a connection a browser has already opened. Chromium drops
  // an open websocket when a context goes offline; Firefox does not, so this
  // one runs where the outage is real. Everything else here runs in both.
  test('notes made while offline appear when the connection comes back', async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'only chromium drops an open websocket when a context goes offline');
    // The outage itself lasts CATCH_UP_TEST_OUTAGE_MS, so this test is longer
    // than the default timeout on purpose.
    test.setTimeout(OUTAGE_MS + 150_000);
    const session = await openBoardTogether(browser, ['Alex', 'Sam']);
    const alex = person(session, 0);
    const sam = person(session, 1);

    try {
      // The cut stays open until Alex's own page reports the loss, which is
      // never shorter than the outage the story names.
      const offlineSince = await goOffline(alex);
      expect(await badgeText(alex.page)).toBe('Reconnecting…');

      for (let index = 0; index < 3; index += 1) {
        await createNote(alex.page, { x: 200 + index * 240, y: 240 });
      }
      for (let index = 0; index < 3; index += 1) {
        await createNote(sam.page, { x: 200 + index * 240, y: 520 });
      }

      // Sam keeps working normally, and Alex's offline notes stay offline.
      await expect.poll(async () => await noteCount(sam.page), { timeout: 15_000 }).toBe(3);
      await expect.poll(async () => await noteCount(alex.page), { timeout: 15_000 }).toBe(3);
      expect(Date.now() - offlineSince).toBeGreaterThanOrEqual(OUTAGE_MS);

      await goOnline(alex);

      // The badge: Reconnecting…, then the Connected confirmation, in that order.
      const startedAt = Date.now();
      await measureUntil(
        'TC-27 catch-up confirmation shown',
        startedAt,
        async () => {
          const states = await connectionLog(alex.page);
          return states.lastIndexOf('confirmed') > states.lastIndexOf('reconnecting');
        },
      );
      const states = await connectionLog(alex.page);
      expect(states).toContain('reconnecting');
      expect(states.lastIndexOf('confirmed')).toBeGreaterThan(states.lastIndexOf('reconnecting'));
      expect(await badgeText(alex.page)).toBe('Connected');

      await deliver(
        'TC-27 offline notes reach Sam',
        async () => undefined,
        async () => (await noteCount(sam.page)) === 6,
      );
      await expect.poll(async () => await noteCount(alex.page), { timeout: 15_000 }).toBe(6);

      await expect.poll(async () => await snapshotJson(alex.page)).toBe(await snapshotJson(sam.page));
      printLatencySummary('TC-27');
    } finally {
      await closeSession(session);
    }
  });
});
