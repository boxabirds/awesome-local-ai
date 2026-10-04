/**
 * Live collaboration e2e (task 8): TC-22 to TC-28.
 *
 * Each participant is a separate browser context on the same `/b/<boardId>`, so
 * the only thing they share is the room on the server. Every wait for a remote
 * change uses E2E_EVENTUAL_TIMEOUT_MS and logs the measured latency against
 * LIVE_UPDATE_LATENCY_BUDGET_MS without asserting on it.
 */
import { expect, test } from '@playwright/test';

import {
  CATCH_UP_TEST_OUTAGE_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import { CATCH_UP_TEST_TIMEOUT_MS } from './helpers/participants';
import type { StickySnapshot } from '../../src/shared/board-model';
import {
  badge,
  badgeSightingsFor,
  boardKey,
  boardOf,
  closeParticipants,
  comeBackOnline,
  connectionLog,
  expectEventually,
  simulateOutage,
  createBoard,
  openParticipant,
  openParticipants,
  printLatencyReport,
  resetLatencySamples,
  sampleBadge,
  trackBadge,
  waitForBoardsEqual,
  type Participant,
} from './helpers/participants';
import {
  boxOf,
  centredCamera,
  createStickyByButton,
  dragBy,
  editor,
  note,
  notes,
  stopEditing,
} from './helpers/sticky-notes';
import { setCamera } from './helpers/board';

/** Type one character at a time through the page's own keyboard. */
async function typeIntoEditor(participant: Participant, text: string): Promise<void> {
  await editor(participant.page).focus();
  await participant.page.keyboard.type(text, { delay: 15 });
}

/** Create a note by double-clicking empty board space at a screen point. */
async function createNoteAt(
  participant: Participant,
  x: number,
  y: number,
  text: string,
): Promise<void> {
  await participant.page.mouse.dblclick(x, y);
  await editor(participant.page).waitFor({ state: 'visible' });
  await typeIntoEditor(participant, text);
  await stopEditing(participant.page);
}

/** Move the note at `index` by a screen-space drag. */
async function moveNote(participant: Participant, index: number, dx: number, dy: number) {
  const box = await boxOf(note(participant.page, index));
  await dragBy(participant.page, { x: box.cx, y: box.cy }, dx, dy);
}

/** Character multiset, so "contains every typed character" ignores ordering. */
function charCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  return counts;
}

function containsAllChars(actual: string, expected: string): boolean {
  const available = charCounts(actual);
  for (const [char, count] of charCounts(expected)) {
    if ((available.get(char) ?? 0) < count) return false;
  }
  return true;
}

const sameSpot = (a: StickySnapshot, b: StickySnapshot): boolean =>
  Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

test.beforeEach(() => {
  resetLatencySamples();
});

test.describe('live collaboration', () => {
  test('TC-22 create, move, recolour, type and delete all reach the other person', async ({
    browser,
    request,
  }) => {
    const [alex, sam] = await openParticipants(browser, await createBoard(request), ['Alex', 'Sam']);
    try {
      await createStickyByButton(alex.page);
      await typeIntoEditor(alex, 'retro item');
      await stopEditing(alex.page);
      await expectEventually(
        'TC-22 create and type',
        () => boardOf(sam),
        (b) => b.length === 1 && b[0].text === 'retro item',
      );

      const before = (await boardOf(alex))[0]!;
      await moveNote(alex, 0, 120, -60);
      await expectEventually(
        'TC-22 move',
        () => boardOf(sam),
        (b) =>
          b.length === 1 &&
          Math.abs(b[0].x - (before.x + 120)) < 1 &&
          Math.abs(b[0].y - (before.y - 60)) < 1,
      );

      await note(alex.page).click();
      await alex.page.getByRole('button', { name: 'Green colour' }).click();
      await expectEventually('TC-22 recolour', () => boardOf(sam), (b) => b[0]?.color === 'green');

      await alex.page.keyboard.press('Delete');
      await expectEventually('TC-22 delete', () => boardOf(sam), (b) => b.length === 0);
      await expect(notes(sam.page)).toHaveCount(0);

      expect([...alex.consoleErrors, ...sam.consoleErrors]).toEqual([]);
    } finally {
      await closeParticipants([alex, sam]);
      printLatencyReport('TC-22');
    }
  });

  test('TC-23 both type into one note at the same time: identical text holding every character', async ({
    browser,
    request,
  }) => {
    const [alex, sam] = await openParticipants(browser, await createBoard(request), ['Alex', 'Sam']);
    try {
      await createStickyByButton(alex.page);
      await typeIntoEditor(alex, 'shared');
      await stopEditing(alex.page);
      await expectEventually('TC-23 base text', () => boardOf(sam), (b) => b[0]?.text === 'shared');

      const alexText = 'Alex-typed-this-';
      const samText = 'Sam-typed-that-';

      await note(alex.page).dblclick();
      await note(sam.page).dblclick();
      await editor(alex.page).waitFor({ state: 'visible' });
      await editor(sam.page).waitFor({ state: 'visible' });
      await Promise.all([typeIntoEditor(alex, alexText), typeIntoEditor(sam, samText)]);

      // The documents must end up identical and hold everything that was typed.
      await expectEventually(
        'TC-23 converged text',
        async () => ({ alexBoard: await boardOf(alex), samBoard: await boardOf(sam) }),
        ({ alexBoard, samBoard }) => {
          const a = alexBoard[0]?.text ?? '';
          const b = samBoard[0]?.text ?? '';
          return (
            a === b &&
            a.includes('shared') &&
            containsAllChars(a, alexText) &&
            containsAllChars(a, samText)
          );
        },
      );

      const finalText = (await boardOf(alex))[0]!.text;
      expect((await boardOf(sam))[0]!.text).toBe(finalText);

      await stopEditing(alex.page);
      await stopEditing(sam.page);
      expect([...alex.consoleErrors, ...sam.consoleErrors]).toEqual([]);
    } finally {
      await closeParticipants([alex, sam]);
      printLatencyReport('TC-23');
    }
  });

  test('TC-24 both drag the same note at the same time: one shared settled position', async ({
    browser,
    request,
  }) => {
    const [alex, sam] = await openParticipants(browser, await createBoard(request), ['Alex', 'Sam']);
    try {
      await createStickyByButton(alex.page);
      await stopEditing(alex.page);
      await expectEventually('TC-24 note visible', () => boardOf(sam), (b) => b.length === 1);
      const start = (await boardOf(alex))[0]!;

      const alexBox = await boxOf(note(alex.page));
      const samBox = await boxOf(note(sam.page));
      await Promise.all([
        dragBy(alex.page, { x: alexBox.cx, y: alexBox.cy }, 150, 40),
        dragBy(sam.page, { x: samBox.cx, y: samBox.cy }, -150, -40),
      ]);

      // Last writer wins per field, so the result may be a mix of both drags —
      // what matters is that both people end up looking at the same one place.
      await waitForBoardsEqual([alex, sam], 'TC-24 settle');
      const settled = (await boardOf(alex))[0]!;
      expect(sameSpot(settled, (await boardOf(sam))[0]!)).toBe(true);
      expect(sameSpot(settled, start)).toBe(false);
      expect([...alex.consoleErrors, ...sam.consoleErrors]).toEqual([]);
    } finally {
      await closeParticipants([alex, sam]);
      printLatencyReport('TC-24');
    }
  });

  test('TC-25 deleting a note someone else is editing closes their editor', async ({
    browser,
    request,
  }) => {
    const [alex, sam] = await openParticipants(browser, await createBoard(request), ['Alex', 'Sam']);
    try {
      await createStickyByButton(alex.page);
      await typeIntoEditor(alex, 'up for debate');
      await stopEditing(alex.page);
      await expectEventually('TC-25 note visible', () => boardOf(sam), (b) => b.length === 1);

      await note(sam.page).dblclick();
      await editor(sam.page).waitFor({ state: 'visible' });
      await typeIntoEditor(sam, ' (typing)');

      await note(alex.page).click();
      await alex.page.keyboard.press('Delete');

      await expect(notes(sam.page)).toHaveCount(0);
      await expect(editor(sam.page)).toHaveCount(0);
      await expectEventually(
        'TC-25 empty on both boards',
        async () => [(await boardOf(alex)).length, (await boardOf(sam)).length] as const,
        ([a, s]) => a === 0 && s === 0,
      );
      expect([...alex.consoleErrors, ...sam.consoleErrors]).toEqual([]);
    } finally {
      await closeParticipants([alex, sam]);
    }
  });

  test('TC-26 every editor of a full board sees every other editor change', async ({
    browser,
    request,
  }) => {
    const boardId = await createBoard(request);
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `Editor${i + 1}`);
    const participants = await openParticipants(browser, boardId, names);
    try {
      // Zoom out so a grid of notes fits on screen without overlapping.
      for (const participant of participants) {
        await setCamera(participant.page, centredCamera(0.4));
      }
      const perEditor = 5;
      // Editor i takes column i; note j takes row j.
      const columnX = (i: number) => 240 + i * 170;
      const rowY = (j: number) => 140 + j * 150;

      for (const [i, participant] of participants.entries()) {
        for (let j = 0; j < perEditor; j += 1) {
          await createNoteAt(participant, columnX(i), rowY(j), `${participant.name}-${j + 1}`);
          await expectEventually(
            `TC-26 ${participant.name} note ${j + 1} created`,
            () => boardOf(participant),
            (b) => b.some((n) => n.text === `${participant.name}-${j + 1}`),
          );
        }
      }
      for (const participant of participants) {
        for (let j = 0; j < perEditor; j += 1) {
          const text = `${participant.name}-${j + 1}`;
          // Locate our own note by its text: other editors may have changed the
          // order underneath us.
          const index = (await boardOf(participant)).findIndex((n) => n.text === text);
          expect(index, `${text} missing on ${participant.name}`).toBeGreaterThanOrEqual(0);
          await moveNote(participant, index, 25, -20);
        }
      }

      const expected = participants.length * perEditor;
      await waitForBoardsEqual(participants, `TC-26 ${expected} notes converge`);
      for (const participant of participants) {
        const board = await boardOf(participant);
        expect(board).toHaveLength(expected);
        await expect(notes(participant.page)).toHaveCount(expected);
        // Every other editor's text is visible here.
        for (const other of participants) {
          for (let j = 1; j <= perEditor; j += 1) {
            expect(board.some((n) => n.text === `${other.name}-${j}`)).toBe(true);
          }
        }
      }
      const keys = await Promise.all(participants.map((p) => boardOf(p).then(boardKey)));
      expect(new Set(keys).size).toBe(1);
      expect(participants.flatMap((p) => p.consoleErrors)).toEqual([]);
    } finally {
      await closeParticipants(participants);
      printLatencyReport('TC-26');
    }
  });

  test('TC-27 edits made while the connection is down catch up on reconnect', async ({
    browser,
    request,
  }) => {
    // The outage itself lasts CATCH_UP_TEST_OUTAGE_MS, so this one is slow by design.
    test.setTimeout(CATCH_UP_TEST_TIMEOUT_MS);
    const boardId = await createBoard(request);
    // Alex's socket runs through the harness so the outage can be forced.
    const alex = await openParticipant(browser, 'Alex', boardId, { controllableLink: true });
    const sam = await openParticipant(browser, 'Sam', boardId);
    try {
      // Alex's Wi-Fi goes out: no new connections, and the live one dies.
      trackBadge(alex);
      await simulateOutage(alex);
      await expectEventually(
        'TC-27 outage badge',
        () => sampleBadge(alex),
        (text) => text === 'Reconnecting…',
      );
      // Amber, and the board underneath is still fully usable.
      await expect(badge(alex)).toHaveClass(/connection-status--reconnecting/);

      // Alex keeps working, entirely locally.
      await createNoteAt(alex, 300, 300, 'written offline');
      expect((await boardOf(alex)).length).toBe(1);

      // The outage lasts CATCH_UP_TEST_OUTAGE_MS; Sam keeps working meanwhile.
      const outage = new Promise((resolve) => setTimeout(resolve, CATCH_UP_TEST_OUTAGE_MS));
      for (let j = 0; j < 3; j += 1) {
        await createNoteAt(sam, 400, 200 + j * 220, `Sam note ${j + 1}`);
      }
      await outage;
      // Still reporting the outage after the whole CATCH_UP_TEST_OUTAGE_MS.
      expect(await sampleBadge(alex)).toBe('Reconnecting…');

      const backOnline = Date.now();
      await comeBackOnline(alex);

      // Everything Alex wrote offline arrives, and Sam's notes arrive at Alex's.
      await expectEventually(
        'TC-27 catch-up',
        async () => ({ alexBoard: await boardOf(alex), samBoard: await boardOf(sam) }),
        ({ alexBoard, samBoard }) =>
          alexBoard.length === 4 &&
          samBoard.length === 4 &&
          boardKey(alexBoard) === boardKey(samBoard) &&
          alexBoard.some((n) => n.text === 'written offline'),
      );
      reportCatchUp(Date.now() - backOnline);

      // The badge read "Reconnecting…" the whole time it was down; once the link
      // is back it turns green and then gets out of the way.
      await expectEventually(
        'TC-27 badge returns to normal',
        async () => {
          await sampleBadge(alex);
          return (await connectionLog(alex)).map((entry) => entry.state);
        },
        (states) =>
          states.includes('reconnecting') &&
          states.includes('confirmed') &&
          states[states.length - 1] === 'connected',
      );
      expect(badgeSightingsFor(alex)).toContain('Connected');

      // The outage itself is expected to make network noise; nothing else may.
      expect(
        alex.consoleErrors.filter((e) => !/ERR_INTERNET_DISCONNECTED|ERR_NETWORK|WebSocket/i.test(e)),
      ).toEqual([]);
      expect(sam.consoleErrors).toEqual([]);
    } finally {
      await closeParticipants([alex, sam]);
      printLatencyReport('TC-27');
    }
  });

  test('TC-28 selection and editing stay on their own screen', async ({ browser, request }) => {
    const [alex, sam] = await openParticipants(browser, await createBoard(request), ['Alex', 'Sam']);
    try {
      await createStickyByButton(alex.page);
      await stopEditing(alex.page);
      await expectEventually('TC-28 note visible', () => boardOf(sam), (b) => b.length === 1);

      await note(alex.page).click();
      await expect(note(alex.page)).toHaveAttribute('data-selected', 'true');
      await expect(note(sam.page)).not.toHaveAttribute('data-selected', 'true');
      await expect(editor(sam.page)).toHaveCount(0);

      await note(alex.page).dblclick();
      await typeIntoEditor(alex, 'draft');
      await expect(editor(alex.page)).toBeVisible();
      await expect(editor(sam.page)).toHaveCount(0);
      await expect(note(sam.page)).not.toHaveAttribute('data-selected', 'true');
      await expectEventually('TC-28 text arrives', () => boardOf(sam), (b) => b[0]?.text === 'draft');

      expect([...alex.consoleErrors, ...sam.consoleErrors]).toEqual([]);
    } finally {
      await closeParticipants([alex, sam]);
    }
  });
});

/** The reconnect-to-caught-up time is reported against the budget, not gated. */
function reportCatchUp(ms: number): void {
  console.log(`[latency] TC-27 reconnect to fully caught up: ${ms}ms`);
}
