// Story 3, task 8: live collaboration e2e (TC-22..TC-28).
//
// Two real browser contexts (Alex and Sam) on the same board id. Every
// "Sam sees it" assertion is bounded by the live update latency budget
// (PRD live.latency): expectWithin measures from the moment the sender's
// DOM changed.

import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  CATCH_UP_TEST_OUTAGE_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../src/shared/config';
import {
  badge,
  closeParticipant,
  connectionState,
  expectWithin,
  newBoard,
  openParticipant,
  RECONNECT_SETTLE_MS,
  type Participant,
} from './participants';

// --- small UI operation helpers -------------------------------------------

const note = (page: Page, id?: string) =>
  id === undefined
    ? page.locator('.sticky-note')
    : page.locator(`.sticky-note[data-note-id="${id}"]`);

async function noteText(page: Page, id: string): Promise<string> {
  return note(page, id).locator('.sticky-note__text').innerText();
}

/** Double-click empty board space, type `text`, Escape. Returns the note id. */
async function createNote(
  page: Page,
  at: { x: number; y: number },
  text = '',
): Promise<string> {
  await page.locator('[data-testid="board-viewport"]').dblclick({ position: at });
  if (text !== '') await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  const id = await page
    .locator('.sticky-note[data-selected]')
    .getAttribute('data-note-id');
  expect(id, 'created note should be selected after Escape').not.toBeNull();
  return id as string;
}

async function selectNote(page: Page, id: string): Promise<void> {
  const box = await note(page, id).boundingBox();
  await page.mouse.click(box!.x + 12, box!.y + 12);
  await expect(note(page, id)).toHaveAttribute('data-selected', '');
}

/** Double-click the note to edit, type, Escape. */
async function typeIntoNote(page: Page, id: string, text: string): Promise<void> {
  await note(page, id).dblclick();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

async function recolorNote(page: Page, id: string, color: string): Promise<void> {
  await selectNote(page, id);
  await page.locator(`.note-toolbar button[aria-label="${color} colour"]`).click();
}

async function deleteNote(page: Page, id: string): Promise<void> {
  await selectNote(page, id);
  await page.keyboard.press('Delete');
}

/** Drag the selected note by (dx, dy) screen px. */
async function dragNote(
  page: Page,
  id: string,
  dx: number,
  dy: number,
  steps = 8,
): Promise<void> {
  const box = await note(page, id).boundingBox();
  const sx = box!.x + box!.width / 2;
  const sy = box!.y + box!.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + dx, sy + dy, { steps });
  await page.mouse.up();
}

const SPOTS = [
  { x: 140, y: 140 },
  { x: 440, y: 140 },
  { x: 740, y: 140 },
  { x: 140, y: 420 },
  { x: 440, y: 420 },
  { x: 740, y: 420 },
];

async function openBoard(browser: Browser, baseURL: string): Promise<{
  boardId: string;
  alex: Participant;
  sam: Participant;
}> {
  const boardId = await newBoard(baseURL);
  const alex = await openParticipant(browser, boardId);
  const sam = await openParticipant(browser, boardId);
  return { boardId, alex, sam };
}

// --- tests ------------------------------------------------------------------

test('TC-22: create, move, recolor, type, delete — Sam sees each within budget', async ({
  browser,
  baseURL,
}) => {
  const { alex, sam } = await openBoard(browser, baseURL!);
  try {
    // 1. Create.
    const id = await createNote(alex.page, SPOTS[0], 'hello');
    await expectWithin(async () => sam.page.locator('.sticky-note').count(), 1);
    await expectWithin(() => noteText(sam.page, id), 'hello');

    // 2. Move.
    await dragNote(alex.page, id, 90, 50);
    const alexBox = (await note(alex.page, id).boundingBox())!;
    await expectWithin(async () => {
      const b = (await note(sam.page, id).boundingBox())!;
      return Math.abs(b.x - alexBox.x) < 2 && Math.abs(b.y - alexBox.y) < 2;
    }, true);

    // 3. Recolor.
    await recolorNote(alex.page, id, 'Pink');
    await expectWithin(
      async () => note(sam.page, id).getAttribute('data-color'),
      'pink',
    );

    // 4. Type more.
    await typeIntoNote(alex.page, id, ' world');
    await expectWithin(() => noteText(sam.page, id), 'hello world');

    // 5. Delete.
    await deleteNote(alex.page, id);
    await expectWithin(async () => sam.page.locator('.sticky-note').count(), 0);
  } finally {
    await closeParticipant(alex);
    await closeParticipant(sam);
  }
});

test('TC-23: concurrent typing in one note merges on both pages', async ({ browser, baseURL }) => {
  const { alex, sam } = await openBoard(browser, baseURL!);
  try {
    const id = await createNote(alex.page, SPOTS[1], 'green');
    await expectWithin(async () => sam.page.locator('.sticky-note').count(), 1);

    // Both enter edit mode (caret at the end) and type at the same time.
    await note(alex.page, id).dblclick();
    await note(sam.page, id).dblclick();
    await Promise.all([
      alex.page.keyboard.type('red'),
      sam.page.keyboard.type(' blue'),
    ]);
    await Promise.all([
      alex.page.keyboard.press('Escape'),
      sam.page.keyboard.press('Escape'),
    ]);

    // Both pages end up with the SAME text and lose no characters. (Assert
    // the character multiset, not word order: concurrent inserts at the same
    // position interleave per character in a CRDT — deterministically on both
    // pages, but not word-wise.) Poll: the final keystrokes still need a
    // round trip through the room.
    const charMultiset = (text: string): string => [...text].sort().join('');
    await expectWithin(
      async () => {
        const textAlex = await noteText(alex.page, id);
        const textSam = await noteText(sam.page, id);
        return textAlex === textSam && charMultiset(textAlex) === charMultiset('greenred blue');
      },
      true,
    );
  } finally {
    await closeParticipant(alex);
    await closeParticipant(sam);
  }
});

test('TC-24: concurrent drags of the same note settle to one position', async ({ browser, baseURL }) => {
  const { alex, sam } = await openBoard(browser, baseURL!);
  try {
    const id = await createNote(alex.page, SPOTS[2]);
    await expectWithin(async () => sam.page.locator('.sticky-note').count(), 1);

    // Both drag the same note to different places, at the same time.
    await Promise.all([
      dragNote(alex.page, id, 120, 40),
      dragNote(sam.page, id, -80, 160),
    ]);

    // The final position is one deterministic value (Yjs last-writer-wins):
    // both pages show the note at the same spot.
    await expectWithin(async () => {
      const a = (await note(alex.page, id).boundingBox())!;
      const s = (await note(sam.page, id).boundingBox())!;
      return Math.abs(a.x - s.x) < 2 && Math.abs(a.y - s.y) < 2;
    }, true);
  } finally {
    await closeParticipant(alex);
    await closeParticipant(sam);
  }
});

test('TC-25: late joiner catches up to existing notes', async ({ browser, baseURL }) => {
  const boardId = await newBoard(baseURL!);
  const alex = await openParticipant(browser, boardId);
  try {
    const ids: { id: string; text: string }[] = [];
    for (let i = 0; i < 3; i++) {
      const text = `note-${i}`;
      ids.push({ id: await createNote(alex.page, SPOTS[i], text), text });
    }
    expect(await alex.page.locator('.sticky-note').count()).toBe(3);

    // Sam joins after the fact.
    const sam = await openParticipant(browser, boardId);
    try {
      await expectWithin(async () => sam.page.locator('.sticky-note').count(), 3);
      for (const { id, text } of ids) {
        await expectWithin(() => noteText(sam.page, id), text);
      }
    } finally {
      await closeParticipant(sam);
    }
  } finally {
    await closeParticipant(alex);
  }
});

test('TC-26: late joiner sees text, colour and moved position', async ({ browser, baseURL }) => {
  const boardId = await newBoard(baseURL!);
  const alex = await openParticipant(browser, boardId);
  try {
    const id = await createNote(alex.page, SPOTS[3], 'moved');
    await typeIntoNote(alex.page, id, '-twice');
    await recolorNote(alex.page, id, 'Violet');
    await dragNote(alex.page, id, 140, 90);

    const sam = await openParticipant(browser, boardId);
    try {
      await expectWithin(async () => sam.page.locator('.sticky-note').count(), 1);
      await expectWithin(() => noteText(sam.page, id), 'moved-twice');
      await expectWithin(
        async () => note(sam.page, id).getAttribute('data-color'),
        'violet',
      );
      const alexBox = (await note(alex.page, id).boundingBox())!;
      await expectWithin(async () => {
        const b = (await note(sam.page, id).boundingBox())!;
        return Math.abs(b.x - alexBox.x) < 2 && Math.abs(b.y - alexBox.y) < 2;
      }, true);
    } finally {
      await closeParticipant(sam);
    }
  } finally {
    await closeParticipant(alex);
  }
});

test('TC-27: flaky Wi-Fi — offline edits catch up when the network returns', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const boardId = await newBoard(baseURL!);
  const alex = await openParticipant(browser, boardId);
  const sam = await openParticipant(browser, boardId);
  try {
    // Alex loses the network (flaky Wi-Fi): block NEW connections and drop
    // the socket that is already established (setOffline alone leaves the
    // loopback WebSocket alive in this environment).
    await alex.context.setOffline(true);
    await alex.page.evaluate(() => {
      const hook = (window as unknown as { __vidi6?: { forceDisconnect?(): void } }).__vidi6;
      hook?.forceDisconnect?.();
    });
    await expect(badge(alex.page)).toHaveText('Reconnecting…', { timeout: 15_000 });

    // While Alex is offline, both sides keep adding notes.
    for (let i = 0; i < 3; i++) {
      await createNote(alex.page, SPOTS[i], `alex-${i}`);
      await createNote(sam.page, SPOTS[3 + i], `sam-${i}`);
    }
    expect(await alex.page.locator('.sticky-note').count()).toBe(3);
    expect(await sam.page.locator('.sticky-note').count()).toBe(3);

    // The outage lasts CATCH_UP_TEST_OUTAGE_MS.
    await new Promise((resolve) => setTimeout(resolve, CATCH_UP_TEST_OUTAGE_MS));
    await alex.context.setOffline(false);
    // The Wi-Fi is back: allow (and trigger) reconnection.
    await alex.page.evaluate(() => {
      const hook = (window as unknown as { __vidi6?: { resumeConnection?(): void } }).__vidi6;
      hook?.resumeConnection?.();
    });

    // The provider reconnects (bounded by its max backoff) and both pages
    // converge to all six notes.
    await expect(alex.page.locator('.sticky-note')).toHaveCount(6, {
      timeout: RECONNECT_SETTLE_MS,
    });
    await expect(sam.page.locator('.sticky-note')).toHaveCount(6, {
      timeout: RECONNECT_SETTLE_MS,
    });
    for (let i = 0; i < 3; i++) {
      expect(await noteText(sam.page, (await findNoteId(sam.page, `alex-${i}`)))).toBe(`alex-${i}`);
      expect(await noteText(alex.page, (await findNoteId(alex.page, `sam-${i}`)))).toBe(`sam-${i}`);
    }

    // The badge confirms the recovery, then goes quiet.
    await expect(badge(alex.page)).toHaveText('Connected', {
      timeout: RECONNECT_SETTLE_MS,
    });
    await expect(badge(alex.page)).toHaveCount(0, {
      timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 4,
    });
    expect(await connectionState(alex.page)).toBe('connected');
  } finally {
    await closeParticipant(alex);
    await closeParticipant(sam);
  }
});

test('TC-28: selection and editing are local — never broadcast', async ({ browser, baseURL }) => {
  const { alex, sam } = await openBoard(browser, baseURL!);
  try {
    const id = await createNote(alex.page, SPOTS[4], 'select-me');
    await expectWithin(async () => sam.page.locator('.sticky-note').count(), 1);

    // Alex selects the note…
    await selectNote(alex.page, id);
    // …and starts editing it.
    await note(alex.page, id).dblclick();
    await expect(note(alex.page, id).locator('textarea')).toHaveCount(1);

    // Sam's board shows none of it: no selection, no open editor.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await sam.page.locator('.sticky-note[data-selected]').count()).toBe(0);
    expect(await sam.page.locator('.sticky-note textarea').count()).toBe(0);
    expect(await sam.page.locator('.note-toolbar').count()).toBe(0);
  } finally {
    await closeParticipant(alex);
    await closeParticipant(sam);
  }
});

/** Find a note id by its exact text (test helper). */
async function findNoteId(page: Page, text: string): Promise<string> {
  const ids = await page
    .locator('.sticky-note')
    .evaluateAll((els) =>
      els.map((el) => ({
        id: el.getAttribute('data-note-id'),
        text: el.querySelector('.sticky-note__text')?.textContent ?? '',
      })),
    );
  const match = ids.find((n) => n.text === text);
  expect(match, `note with text "${text}" not found`);
  return match!.id!;
}
