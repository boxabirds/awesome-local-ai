/**
 * Story 3, end to end: edits made on one tab appear on another person's tab.
 *
 * Every participant here is a real browser context with a real socket to a real BoardRoom running
 * under `wrangler dev`; nothing about the sync path is stubbed. The story asks for propagation to
 * be waited for "eventually" (within `E2E_EVENTUAL_TIMEOUT_MS`) and for latency to be *logged*
 * against `LIVE_UPDATE_LATENCY_BUDGET_MS` rather than asserted, because a shared runner decides it.
 */
import { test, expect, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';

import {
  CATCH_UP_TEST_OUTAGE_MS,
  CONNECTED_CONFIRMATION_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import { STICKY_COLOR_ORDER, stickyColorLabel } from '../../src/client/objects/NoteToolbar';
import {
  doubleClickToCreate,
  dragToPoint,
  editorOf,
  getNotes,
  noteById,
  stopEditing,
  worldOfScreen,
} from './helpers/notes';
import {
  badgeState,
  badgeText,
  closeParticipants,
  connectionState,
  domSnapshot,
  expectConverged,
  LatencyLog,
  notesOf,
  openParticipants,
  personAt,
  type Participant,
} from './helpers/participants';

// Nothing in this file's UI steps takes longer than a moment, so an action that is still running
// after ten seconds is stuck, and should say so rather than quietly eat the test's whole timeout.
test.use({ actionTimeout: 10_000 });

/**
 * The two scenarios that are too slow for every commit, and only run through
 * `npm run test:e2e:nightly`. Their lengths come from the design's boundaries; they are not
 * application settings, so they live here rather than in the shared config.
 */
const IDLE_OBSERVATION_MS = 45_000;
// VIDI6_SOAK_MS shortens the soak while the soak itself is being worked on; the default is the
// length the design names
const CAPACITY_SOAK_MS = Number(process.env.VIDI6_SOAK_MS ?? 60_000);

/** A fixed seed makes a soak reproducible; VIDI6_SOAK_SEED runs it with a different one. */
const SOAK_SEED = Number(process.env.VIDI6_SOAK_SEED ?? 20_260_806);

/** mulberry32: small and deterministic, which is all that choosing the next nudge needs. */
function randomStream(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many notes one person keeps going during the soak: busy, and still room to spare. */
const NOTES_PER_PERSON = 5;

/** Where a soak note is made or moved to: a grid a little wider than a note, so nothing overlaps. */
const SOAK_SLOTS: readonly { x: number; y: number }[] = [
  { x: 160, y: 200 },
  { x: 380, y: 200 },
  { x: 600, y: 200 },
  { x: 820, y: 200 },
  { x: 160, y: 400 },
  { x: 380, y: 400 },
  { x: 600, y: 400 },
  { x: 820, y: 400 },
  { x: 160, y: 600 },
  { x: 380, y: 600 },
  { x: 600, y: 600 },
  { x: 820, y: 600 },
];

/** A note id, shortened for the log lines. */
function short(id: string | undefined): string {
  return (id ?? '').slice(0, 6);
}

/** The words the soak types, so the board fills up like a real one. */
const SOAK_WORDS = ['retry', 'ship it', 'blocked', 'follow up', 'nice one', 'spike', 'question'];

/** Clicks empty canvas, so nothing is selected any more. */
async function clearSelection(page: Page): Promise<void> {
  // the one spot in the viewport that holds no note, no toolbar and no chrome of the board
  await page.mouse.click(1_100, 200);
  await expect(page.locator('[data-testid="note-toolbar"]')).toHaveCount(0);
}

/** Puts each participant in their own part of the board, so a drag grabs the note it means to. */
async function spreadOut(participants: readonly Participant[]): Promise<void> {
  await Promise.all(
    participants.map(async (participant, index) => {
      await participant.page.evaluate(
        (x) => window.__vidi6?.setCamera({ x, y: 0, zoom: 1 }),
        -index * 3000,
      );
    }),
  );
}

/** `#aabbcc` as the browser reports it, so a swatch and a computed style can be compared. */
function cssColor(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

/**
 * Creates an empty note at a screen point and stops editing it.
 * Returns its id and the moment the click happened, which is when the change was made locally -
 * the number the propagation report is measured from.
 */
async function createEmptyNote(participant: Participant, at: { x: number; y: number }) {
  const before = await getNotes(participant.page);
  await doubleClickToCreate(participant.page, at);
  const changedAt = Date.now();
  await stopEditing(participant.page);
  const created = (await getNotes(participant.page)).find(
    (note) => !before.some((earlier) => earlier.id === note.id),
  );
  if (!created) throw new Error('the double-click did not create a note');
  return { id: created.id, changedAt };
}

/** Clicks a note without moving it: it becomes the selected note and its toolbar appears. */
async function selectNote(page: Page, noteId: string): Promise<void> {
  const box = await noteById(page, noteId).boundingBox();
  if (!box) throw new Error(`note ${noteId} is not on screen`);
  // the band under the top edge: the middle of a note is where its text is
  await page.mouse.click(box.x + box.width / 2, box.y + 16);
  await expect(page.locator('[data-testid="note-toolbar"]')).toBeVisible();
}

/** Puts the participant inside a note's text editor. */
async function openEditor(page: Page, noteId: string): Promise<void> {
  const box = await noteById(page, noteId).boundingBox();
  if (!box) throw new Error(`note ${noteId} is not on screen`);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(editorOf(page)).toBeVisible();
}

/** Types at the end of a note's text; resolves right after the last keystroke. */
async function typeIntoNote(page: Page, noteId: string, text: string): Promise<number> {
  await openEditor(page, noteId);
  await page.keyboard.type(text);
  return Date.now();
}

/**
 * Types, then leaves the note: the text is written to the board with every keystroke, so the
 * timestamp of the last one is taken before the way out. A note cannot be dragged while somebody
 * is typing in it, so anything that moves a note starts by leaving its editor.
 */
async function typeThenStop(page: Page, noteId: string, text: string): Promise<number> {
  const typedAt = await typeIntoNote(page, noteId, text);
  await stopEditing(page);
  return typedAt;
}

/** Drags a note by id so its centre lands on a screen point; resolves right after the release. */
async function dragNoteTo(page: Page, noteId: string, to: { x: number; y: number }): Promise<number> {
  const box = await noteById(page, noteId).boundingBox();
  if (!box) throw new Error(`note ${noteId} is not on screen`);
  await dragToPoint(page, { x: box.x + box.width / 2, y: box.y + 16 }, to);
  return Date.now();
}

async function backgroundOfNote(page: Page, noteId: string): Promise<string> {
  return noteById(page, noteId).evaluate((el) => getComputedStyle(el).backgroundColor);
}

/** A note's text as its owner's document holds it. */
async function textOfNote(participant: Participant, noteId: string): Promise<string | undefined> {
  return (await notesOf(participant)).find((note) => note.id === noteId)?.text;
}

test('TC-22 every kind of edit shows up on the other person screen', async ({ browser }) => {
  const participants = await openParticipants(browser, newBoardId(), 2);
  const [alex, sam] = participants;
  const latency = new LatencyLog();
  try {
    // create: Alex double-clicks empty board space
    let noteId = '';
    await latency.measure(
      'create',
      async () => {
        const created = await createEmptyNote(alex, { x: 520, y: 400 });
        noteId = created.id;
        return created.changedAt;
      },
      async () => noteId !== '' && (await notesOf(sam)).some((note) => note.id === noteId),
    );

    // text
    await latency.measure(
      'text',
      () => typeThenStop(alex.page, noteId, 'edited by Alex'),
      async () => (await textOfNote(sam, noteId))?.includes('edited by Alex') === true,
    );

    // move
    const xBefore = (await notesOf(sam)).find((note) => note.id === noteId)?.x ?? 0;
    await latency.measure(
      'move',
      () => dragNoteTo(alex.page, noteId, { x: 820, y: 600 }),
      async () => {
        const x = (await notesOf(sam)).find((note) => note.id === noteId)?.x;
        return x !== undefined && Math.abs(x - xBefore) > 50;
      },
    );

    // recolour
    const blue = cssColor(STICKY_COLORS.blue);
    await latency.measure(
      'recolour',
      async () => {
        await selectNote(alex.page, noteId);
        await alex.page.getByRole('button', { name: 'Blue colour' }).click();
        return Date.now();
      },
      async () => (await backgroundOfNote(sam.page, noteId)) === blue,
    );

    // delete
    await latency.measure(
      'delete',
      async () => {
        await selectNote(alex.page, noteId);
        await alex.page.getByRole('button', { name: 'Delete note' }).click();
        return Date.now();
      },
      async () => (await notesOf(sam)).find((note) => note.id === noteId) === undefined,
    );

    latency.report('TC-22 live update latency');
    await expectConverged(participants);
  } finally {
    await closeParticipants(participants);
  }
});

test('TC-23 two people typing in the same note keep every character', async ({ browser }) => {
  const participants = await openParticipants(browser, newBoardId(), 2);
  const [alex, sam] = participants;
  try {
    const { id: noteId } = await createEmptyNote(alex, { x: 620, y: 400 });
    await typeIntoNote(alex.page, noteId, 'start:');
    await stopEditing(alex.page);
    await expect
      .poll(() => textOfNote(sam, noteId), {
        message: 'Sam never saw the note and its text',
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      })
      .toBe('start:');

    // both get into the same note, then both type at the same time
    await openEditor(alex.page, noteId);
    await openEditor(sam.page, noteId);
    await Promise.all([
      alex.page.keyboard.type('AAAA', { delay: 25 }),
      sam.page.keyboard.type('BBBB', { delay: 25 }),
    ]);
    await stopEditing(alex.page);
    await stopEditing(sam.page);

    // every character either of them typed is on both screens, and the two screens agree
    const kept = (text: string, character: string) =>
      [...text].filter((seen) => seen === character).length;
    await expect
      .poll(
        async () => {
          const [alexText, samText] = await Promise.all([
            textOfNote(alex, noteId),
            textOfNote(sam, noteId),
          ]);
          return (
            alexText !== undefined &&
            alexText === samText &&
            alexText.startsWith('start:') &&
            kept(alexText, 'A') >= 4 &&
            kept(alexText, 'B') >= 4
          );
        },
        { message: 'the shared text never converged', timeout: E2E_EVENTUAL_TIMEOUT_MS },
      )
      .toBe(true);

    // the rendered text is that same text, on both screens
    for (const participant of participants) {
      const rendered = await noteById(participant.page, noteId)
        .locator('[data-testid="sticky-note-text"]')
        .textContent();
      expect(rendered).toBe(await textOfNote(participant, noteId));
    }
    await expectConverged(participants);
  } finally {
    await closeParticipants(participants);
  }
});

test('TC-24 two people dragging the same note settle on one place', async ({ browser }) => {
  const participants = await openParticipants(browser, newBoardId(), 2);
  const [alex, sam] = participants;
  try {
    const { id: noteId } = await createEmptyNote(alex, { x: 620, y: 400 });
    await expect
      .poll(async () => (await notesOf(sam)).some((note) => note.id === noteId), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      })
      .toBe(true);

    // both grab it at once and pull in different directions
    const started = Date.now();
    await Promise.all([
      dragNoteTo(alex.page, noteId, { x: 300, y: 200 }),
      dragNoteTo(sam.page, noteId, { x: 900, y: 600 }),
    ]);

    // whoever wins, they must end up with the note in the same place
    let settledMs = 0;
    await expect
      .poll(
        async () => {
          const [alexNote, samNote] = await Promise.all([notesOf(alex), notesOf(sam)]);
          const mine = alexNote.find((note) => note.id === noteId);
          const theirs = samNote.find((note) => note.id === noteId);
          const same = mine !== undefined && mine.x === theirs?.x && mine.y === theirs?.y;
          if (same && settledMs === 0) settledMs = Date.now() - started;
          return same;
        },
        { message: 'the dragged note never settled in one place', timeout: E2E_EVENTUAL_TIMEOUT_MS },
      )
      .toBe(true);
    // the story asks for the settle time to be reported, not asserted
    console.log(`TC-24 the note settled ${settledMs}ms after both of them let go`);

    await expectConverged(participants);
  } finally {
    await closeParticipants(participants);
  }
});

test('TC-25 a note that someone else deletes disappears, editor and all', async ({ browser }) => {
  const participants = await openParticipants(browser, newBoardId(), 2);
  const [alex, sam] = participants;
  const dialogs: string[] = [];
  sam.page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  try {
    const { id: noteId } = await createEmptyNote(alex, { x: 620, y: 400 });
    await expect
      .poll(async () => (await notesOf(sam)).some((note) => note.id === noteId), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      })
      .toBe(true);

    // Sam is inside the note, typing, when Alex throws it away
    await openEditor(sam.page, noteId);
    await sam.page.keyboard.type('typed while it was deleted');

    await selectNote(alex.page, noteId);
    await alex.page.getByRole('button', { name: 'Delete note' }).click();

    await expect
      .poll(async () => (await notesOf(sam)).length, { message: 'the note stayed for Sam' })
      .toBe(0);
    await expect(sam.page.locator('[data-note-editor]')).toHaveCount(0);
    await expect(sam.page.locator('[data-testid="sticky-note-input"]')).toHaveCount(0);

    // it stays gone, and nothing complained about it
    await sam.page.waitForTimeout(1000);
    expect(await notesOf(sam)).toHaveLength(0);
    expect(await notesOf(alex)).toHaveLength(0);
    expect(dialogs).toEqual([]);
    expect(sam.consoleErrors).toEqual([]);
    expect(alex.consoleErrors).toEqual([]);
    await expectConverged(participants);
  } finally {
    await closeParticipants(participants);
  }
});

test('TC-26 a full board of editors all ends up with the same board', async ({ browser }) => {
  const participants = await openParticipants(browser, newBoardId(), MAX_CONCURRENT_EDITORS);
  const latency = new LatencyLog();
  try {
    await spreadOut(participants);
    const notesPerPerson = 5;
    for (const [index, author] of participants.entries()) {
      const watcher = personAt(participants, (index + 1) % participants.length);

      // this person creates five notes
      const made: { id: string; text: string }[] = [];
      for (let note = 0; note < notesPerPerson; note += 1) {
        const text = `${author.name}-${note + 1}`;
        const created = await createEmptyNote(author, { x: 200 + note * 220, y: 320 });
        await latency.measure(
          `${author.name} creates ${text}`,
          async () => {
            await typeIntoNote(author.page, created.id, text);
            await stopEditing(author.page);
            return created.changedAt;
          },
          async () => (await notesOf(watcher)).some((candidate) => candidate.id === created.id),
        );
        made.push({ id: created.id, text });
      }

      // and moves those five notes
      for (const [note, moved] of made.entries()) {
        const xBefore = (await notesOf(watcher)).find((note) => note.id === moved.id)?.x;
        if (xBefore === undefined) continue;
        await latency.measure(
          `${author.name} moves ${moved.text}`,
          () => dragNoteTo(author.page, moved.id, { x: 220 + note * 220, y: 580 }),
          async () => {
            const seen = (await notesOf(watcher)).find((note) => note.id === moved.id);
            return seen !== undefined && Math.abs(seen.x - xBefore) > 10;
          },
        );
      }
    }

    // every change reached everybody: one board, the same on all screens
    await expectConverged(participants);
    for (const participant of participants) {
      expect(await notesOf(participant)).toHaveLength(notesPerPerson * MAX_CONCURRENT_EDITORS);
    }
    latency.report('TC-26 live update latency');
  } finally {
    await closeParticipants(participants);
  }
});

test('TC-27 a board that could not be reached catches up when it comes back', async ({ browser }) => {
  // the scenario is an outage of CATCH_UP_TEST_OUTAGE_MS: a tab has to notice it, both people
  // work through it, and the way back and the catch-up are waited for - the default timeout is
  // shorter than the outage itself
  test.setTimeout(CATCH_UP_TEST_OUTAGE_MS + 4 * E2E_EVENTUAL_TIMEOUT_MS);
  const participants = await openParticipants(browser, newBoardId(), 2);
  const [alex, sam] = participants;
  try {
    const outageStartedAt = Date.now();
    await alex.context.setOffline(true);

    // the tab notices on its own: its keepalive goes unanswered, so the connection is called lost
    // within CONNECTION_IDLE_TIMEOUT_MS instead of after y-websocket's own 30 seconds
    await expect
      .poll(() => badgeState(alex), {
        message: 'Alex was never told the connection was lost',
        timeout: 2 * E2E_EVENTUAL_TIMEOUT_MS,
      })
      .toBe('reconnecting');
    expect(await badgeText(alex)).toBe('Reconnecting…');
    console.log(
      `TC-27 the outage was noticed after ${Date.now() - outageStartedAt}ms ` +
        `(outage ${CATCH_UP_TEST_OUTAGE_MS}ms)`,
    );

    // both keep working: Sam reaches the room, Alex only their own screen
    const samNotes: string[] = [];
    for (let note = 0; note < 3; note += 1) {
      samNotes.push((await createEmptyNote(sam, { x: 260 + note * 230, y: 300 })).id);
    }
    for (let note = 0; note < 3; note += 1) {
      await createEmptyNote(alex, { x: 260 + note * 230, y: 600 });
    }
    expect(await notesOf(sam)).toHaveLength(3);

    // stay out for the outage the story names
    const remaining = CATCH_UP_TEST_OUTAGE_MS - (Date.now() - outageStartedAt);
    if (remaining > 0) await alex.page.waitForTimeout(remaining);

    await alex.context.setOffline(false);

    // the badge welcomes Alex back for CONNECTED_CONFIRMATION_MS...
    await expect
      .poll(() => badgeText(alex), {
        message: 'Alex never got the "Connected" confirmation',
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      })
      .toBe('Connected');
    // ...and then gets out of the way again
    await expect
      .poll(() => badgeState(alex), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toBeNull();

    // both boards hold all six notes, in both directions
    await expect
      .poll(async () => (await notesOf(alex)).length, {
        message: 'Alex did not catch up with the notes made while away',
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      })
      .toBe(6);
    await expect
      .poll(async () => (await notesOf(sam)).length, {
        message: 'Sam did not get the notes Alex made while away',
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      })
      .toBe(6);
    await expectConverged(participants);
    // the notes Sam made while Alex was out are the ones Alex was missing
    for (const noteId of samNotes) {
      expect((await notesOf(alex)).some((note) => note.id === noteId)).toBe(true);
    }
  } finally {
    await closeParticipants(participants);
  }
});

test('TC-28 selecting and typing in a note stays on your own screen', async ({ browser }) => {
  const participants = await openParticipants(browser, newBoardId(), 2);
  const [alex, sam] = participants;
  try {
    const { id: noteId } = await createEmptyNote(alex, { x: 620, y: 400 });
    await expect
      .poll(async () => (await notesOf(sam)).some((note) => note.id === noteId), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      })
      .toBe(true);

    // Alex selects the note and starts typing in it
    await selectNote(alex.page, noteId);
    await openEditor(alex.page, noteId);
    await alex.page.keyboard.type('...hello');
    await expect(
      alex.page.locator('[data-note-id]').first(),
      'Alex sees their note as selected',
    ).toHaveAttribute('data-selected', 'true');

    // Sam sees the text, but none of Alex's selection or editing
    await expect
      .poll(() => textOfNote(sam, noteId), {
        message: 'the text Alex typed did not reach Sam',
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      })
      .toContain('hello');
    await expect(sam.page.locator('[data-note-editor]')).toHaveCount(0);
    await expect(sam.page.locator('[data-testid="sticky-note-input"]')).toHaveCount(0);
    await expect(sam.page.locator('[data-testid="note-toolbar"]')).toHaveCount(0);
    await expect(sam.page.locator('[data-note-id]')).toHaveCount(1);
    await expect(
      sam.page.locator('[data-note-id]').first(),
      'Sam is shown somebody else selection',
    ).not.toHaveAttribute('data-selected');

    // Alex stops; still none of that state is Sam's
    await stopEditing(alex.page);
    await expect(sam.page.locator('[data-note-editor]')).toHaveCount(0);
    expect(await domSnapshot(sam)).not.toContain('selected');
    await expectConverged(participants);
  } finally {
    await closeParticipants(participants);
  }
});

// -- the nightly scenarios: too slow for every commit, run by `npm run test:e2e:nightly` ---------

test('TC-29 @nightly an idle board stays connected the whole time', async ({ browser }) => {
  test.setTimeout(IDLE_OBSERVATION_MS + 4 * E2E_EVENTUAL_TIMEOUT_MS);
  const participants = await openParticipants(browser, newBoardId(), 2);
  try {
    const [alex, sam] = participants;
    // both have been on the board long enough to show "Connected": from here on a badge would
    // mean the link was struggling, and nothing is supposed to be happening at all
    for (const participant of participants) {
      await expect
        .poll(() => badgeState(participant), {
          message: 'nobody reached "Connected"',
          timeout: CONNECTED_CONFIRMATION_MS + 5_000,
        })
        .toBeNull();
    }

    const deadline = Date.now() + IDLE_OBSERVATION_MS;
    let checks = 0;
    while (Date.now() < deadline) {
      for (const participant of participants) {
        const [state, badge] = await Promise.all([
          connectionState(participant),
          badgeText(participant),
        ]);
        expect(state, `${participant.name} left "connected" while nobody did anything`).toBe(
          'connected',
        );
        expect(badge, `${participant.name} showed "${badge}" while nobody did anything`).toBeNull();
        checks += 1;
      }
      await alex.page.waitForTimeout(1_000);
    }

    // and the connection that stayed up is still carrying work
    const created = await createEmptyNote(alex, { x: 640, y: 400 });
    await expect
      .poll(() => notesOf(sam).then((notes) => notes.some((note) => note.id === created.id)), {
        message: 'the note made after the idle period never arrived',
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      })
      .toBe(true);
    for (const participant of participants) expect(participant.consoleErrors).toEqual([]);
    console.log(
      `[vidi6] e2e: TC-29 idle for ${IDLE_OBSERVATION_MS}ms (${checks} state checks), ` +
        'still connected and still in sync',
    );
  } finally {
    await closeParticipants(participants);
  }
});

test('TC-30 @nightly everybody editing continuously converges on one board', async ({ browser }) => {
  test.setTimeout(CAPACITY_SOAK_MS + 8 * E2E_EVENTUAL_TIMEOUT_MS);
  const participants = await openParticipants(browser, newBoardId(), MAX_CONCURRENT_EDITORS);
  const latency = new LatencyLog();
  try {
    await spreadOut(participants);
    const random = randomStream(SOAK_SEED);
    const pick = <T>(items: readonly T[]): T => {
      const item = items[Math.floor(random() * items.length)];
      if (item === undefined) throw new Error('nothing to pick from');
      return item;
    };

    /**
     * A screen point where a note would sit on its own: the notes are picked by clicking, so a
     * note buried under another one cannot be worked on, and everyone's board would depend on
     * which of two overlapping notes the click happened to catch.
     */
    async function freeSpot(
      participant: Participant,
      except?: string,
    ): Promise<{ x: number; y: number } | undefined> {
      const notes = await notesOf(participant);
      const slots = [...SOAK_SLOTS];
      // shuffled, so the board does not fill up in the same shape every run
      for (let i = slots.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [slots[i], slots[j]] = [slots[j]!, slots[i]!];
      }
      for (const slot of slots) {
        const world = await worldOfScreen(participant.page, slot);
        const clear = notes.every(
          (note) =>
            note.id === except ||
            Math.abs(note.x - world.x) > STICKY_SIZE_WORLD ||
            Math.abs(note.y - world.y) > STICKY_SIZE_WORLD,
        );
        if (clear) return slot;
      }
      return undefined;
    }

    // the notes each person is working on, so an edit always targets something they made
    const owned = new Map<string, string[]>();
    for (const participant of participants) owned.set(participant.name, []);

    const deadline = Date.now() + CAPACITY_SOAK_MS;
    const loopStarted = Date.now();
    let round = 0;
    let created = 0;
    while (Date.now() < deadline) {
      const author = personAt(participants, round % participants.length);
      const watcher = personAt(participants, (round + 1) % participants.length);
      const mine = owned.get(author.name) ?? [];
      // creating is only interesting while there is room on their part of the board, and every
      // other edit needs a note to work on
      const kind = pick(
        mine.length === 0
          ? (['create'] as const)
          : mine.length < NOTES_PER_PERSON
            ? (['create', 'move', 'text', 'recolour', 'delete'] as const)
            : (['move', 'text', 'recolour', 'delete'] as const),
      );
      const target = mine.length === 0 ? undefined : pick(mine);
      // a board in sync is a board where the watcher sees exactly what the author sees
      const inSync = async () =>
        JSON.stringify(await notesOf(author)) === JSON.stringify(await notesOf(watcher));
      const before = JSON.stringify(await notesOf(author));
      round += 1;

      await latency.measure(
        `${author.name} ${kind} ${short(target)}`,
        async () => {
          switch (kind) {
            case 'create': {
              const spot = await freeSpot(author);
              if (!spot) return;
              const note = await createEmptyNote(author, spot);
              if (note.id) {
                mine.push(note.id);
                created += 1;
              }
              break;
            }
            case 'move': {
              if (!target) return;
              const spot = await freeSpot(author, target);
              if (!spot) return;
              await dragNoteTo(author.page, target, spot);
              break;
            }
            case 'text': {
              if (!target) return;
              await typeThenStop(author.page, target, ` ${pick(SOAK_WORDS)}`);
              break;
            }
            case 'recolour': {
              if (!target) return;
              await selectNote(author.page, target);
              await author.page
                .getByRole('button', { name: stickyColorLabel(pick(STICKY_COLOR_ORDER)) })
                .click();
              break;
            }
            case 'delete': {
              if (!target) return;
              await selectNote(author.page, target);
              await author.page.getByRole('button', { name: 'Delete note' }).click();
              owned.set(
                author.name,
                mine.filter((id) => id !== target),
              );
              break;
            }
          }
        },
        // an edit that could not be made (no room, nothing to edit) is not a change that failed
        // to arrive: the two boards already match, which is what this waits for
        async () => (JSON.stringify(await notesOf(author)) === before ? true : inSync()),
      );

      // whatever that person had open is closed again before somebody else works - including the
      // selection, because the toolbar of a selected note lies over the note below it
      await author.page.keyboard.press('Escape');
      await clearSelection(author.page);
      if (round % 10 === 0) {
        console.log(
          `[vidi6] e2e: TC-30 ${round} edits in ${(Date.now() - loopStarted) / 1000}s`,
        );
      }
    }

    console.log('[vidi6] e2e: TC-30 soak over, waiting for everybody to agree');
    // everyone ends on the same board, which is what the soak is really asserting
    await expectConverged(participants);
    latency.report(`TC-30 soak with ${MAX_CONCURRENT_EDITORS} people (seed ${SOAK_SEED})`);
    console.log(
      `[vidi6] e2e: TC-30 ${round} edits by ${participants.length} people over ` +
        `${CAPACITY_SOAK_MS}ms, ${created} notes made`,
    );
    // the soak has to have actually soaked: a run that did nothing would converge trivially
    expect(round).toBeGreaterThan(10);
    for (const participant of participants) expect(participant.consoleErrors).toEqual([]);
  } finally {
    await closeParticipants(participants);
  }
});
