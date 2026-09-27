// Story 3 e2e: live collaboration through real browsers and the real
// `wrangler dev` server path (spec: sync.client, tasks 8).
//
// Each test opens isolated Playwright contexts on the same /b/<boardId>; every
// context is a genuine y-websocket client of the BoardRoom Durable Object, so
// edits flow through the server. Delivery is asserted within
// LIVE_UPDATE_LATENCY_BUDGET_MS.

import { expect, test } from '@playwright/test';
import { CATCH_UP_TEST_OUTAGE_MS } from '../../src/shared/config';
import {
  closeParticipant,
  createNote,
  deleteSelected,
  dragNote,
  expectWithin,
  freshBoardId,
  noteColor,
  noteCount,
  noteTexts,
  notes,
  openParticipant,
  selectNote,
  setNoteColor,
  typeInNote,
  type Participant,
} from './helpers/participants';

/** Screen box of the first note (position assertions compare these). */
async function firstNoteBox(p: Participant) {
  const box = (await notes(p.page).first().boundingBox()) ?? undefined;
  if (box === undefined) throw new Error('no note bounding box');
  return box;
}

async function sameBox(a: Awaited<ReturnType<typeof firstNoteBox>>, b: Awaited<ReturnType<typeof firstNoteBox>>, tol = 2) {
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
}

/** Collect console errors on a page (for the "no console error" assertions). */
async function captureConsoleErrors(p: Participant): Promise<string[]> {
  const errors: string[] = [];
  p.page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

test.describe('Two-person workshop', () => {
  test('TC-22: create / move / recolour / type / delete are each seen by the other', async ({
    browser,
  }) => {
    const boardId = freshBoardId();
    const alex = await openParticipant(browser, boardId);
    const sam = await openParticipant(browser, boardId);
    try {
      // Create.
      await createNote(alex.page);
      await expectWithin(() => noteCount(sam.page), { message: 'Sam sees the created note' });
      expect(await noteCount(sam.page)).toBe(1);

      // Commit Alex's edit, then move.
      await alex.page.mouse.click(10, 10);
      const before = await firstNoteBox(alex);
      await dragNote(alex.page, 0, 120, 60);
      const afterAlex = await firstNoteBox(alex);
      expect(afterAlex.x).not.toBeCloseTo(before.x, -2);
      await expectWithin(async () => sameBox(afterAlex, await firstNoteBox(sam)), {
        message: 'Sam sees the moved note',
      });

      // Recolour.
      await selectNote(alex.page, 0);
      await setNoteColor(alex.page, 'blue');
      const alexColor = await noteColor(alex.page, 0);
      await expectWithin(async () => (await noteColor(sam.page, 0)) === alexColor, {
        message: 'Sam sees the recoloured note',
      });

      // Type.
      await typeInNote(alex.page, 0, 'hello sam');
      await expectWithin(async () => (await noteTexts(sam.page)).includes('hello sam'), {
        message: 'Sam sees the typed text',
      });

      // Delete.
      await selectNote(alex.page, 0);
      await deleteSelected(alex.page);
      await expectWithin(async () => (await noteCount(sam.page)) === 0, {
        timeout: 2000,
        message: 'Sam sees the note deleted',
      });
    } finally {
      await closeParticipant(alex);
      await closeParticipant(sam);
    }
  });

  test('TC-23: simultaneous typing into one note merges on both pages', async ({
    browser,
  }) => {
    const boardId = freshBoardId();
    const alex = await openParticipant(browser, boardId);
    const sam = await openParticipant(browser, boardId);
    try {
      await createNote(alex.page);
      await expectWithin(() => noteCount(sam.page), { message: 'Sam sees the note' });

      const alexText = 'ALX';
      const samText = 'SMT';
      // Type into the same note at the same time.
      await Promise.all([
        typeInNote(alex.page, 0, alexText),
        typeInNote(sam.page, 0, samText),
      ]);

      // Both pages converge to the same merged text that contains every
      // typed character. Poll: the write-before-broadcast room relays each
      // update after a storage write, so the peer applies it a beat later.
      await expectWithin(async () => {
        const [alexFinal, samFinal] = await Promise.all([
          noteTexts(alex.page),
          noteTexts(sam.page),
        ]);
        if (alexFinal[0] !== samFinal[0]) return false;
        // Every typed character is present.
        return (alexText + samText).split('').every((ch) => alexFinal[0].includes(ch));
      }, { message: 'both pages show the merged note text' });
    } finally {
      await closeParticipant(alex);
      await closeParticipant(sam);
    }
  });

  test('TC-24: simultaneous drags of the same note settle to one position', async ({
    browser,
  }) => {
    const boardId = freshBoardId();
    const alex = await openParticipant(browser, boardId);
    const sam = await openParticipant(browser, boardId);
    try {
      await createNote(alex.page);
      await expectWithin(() => noteCount(sam.page), { message: 'Sam sees the note' });
      await alex.page.mouse.click(10, 10);

      // Both drag the same note by different offsets at the same time.
      await Promise.all([
        dragNote(alex.page, 0, 140, 40),
        dragNote(sam.page, 0, -60, 90),
      ]);

      // Last-writer-wins: both pages settle to the same position.
      await expectWithin(async () => sameBox(await firstNoteBox(alex), await firstNoteBox(sam)), {
        message: 'both pages show the same settled position',
      });
    } finally {
      await closeParticipant(alex);
      await closeParticipant(sam);
    }
  });

  test('TC-25: a delete wins over a concurrent edit; no console errors', async ({
    browser,
  }) => {
    const boardId = freshBoardId();
    const alex = await openParticipant(browser, boardId);
    const sam = await openParticipant(browser, boardId);
    try {
      await createNote(alex.page);
      // Commit Alex's edit so the note is selectable (not in editing state).
      await alex.page.mouse.click(10, 10);
      await expectWithin(() => noteCount(sam.page), { message: 'Sam sees the note' });
      const samErrors = await captureConsoleErrors(sam);

      // Sam starts editing the note; Alex selects and deletes it.
      await notes(sam.page).first().dblclick();
      await selectNote(alex.page, 0);
      await deleteSelected(alex.page);

      // Sam's note and editor disappear.
      await expectWithin(async () => (await noteCount(sam.page)) === 0, {
        timeout: 2000,
        message: "Sam's note is gone",
      });
      await expect(sam.page.locator('[data-testid="sticky-editor"]')).toHaveCount(0);

      // Give any async error a moment to surface, then assert none.
      await new Promise((r) => setTimeout(r, 500));
      expect(samErrors).toEqual([]);
    } finally {
      await closeParticipant(alex);
      await closeParticipant(sam);
    }
  });
});

test.describe('Full-capacity session', () => {
  test('TC-26: every change at MAX_CONCURRENT_EDITORS is seen by all, snapshots identical', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const boardId = freshBoardId();
    const count = 5; // MAX_CONCURRENT_EDITORS
    const participants: Participant[] = [];
    for (let i = 0; i < count; i++) {
      participants.push(await openParticipant(browser, boardId));
    }
    try {
      // Each participant creates 5 notes (→ 25 total, all synced).
      for (const p of participants) {
        for (let n = 0; n < 5; n++) {
          await createNote(p.page);
          await p.page.mouse.click(10, 10);
        }
      }
      // Everyone ends up with all 25 notes.
      for (const p of participants) {
        await expectWithin(async () => (await noteCount(p.page)) === 25, {
          timeout: 3000,
          message: 'all 25 notes visible',
        });
      }
      // Each participant moves 5 of its notes; all positions converge.
      for (const p of participants) {
        for (let n = 0; n < 5; n++) {
          await dragNote(p.page, n, 30 * (n + 1), 20 * (n + 1));
        }
      }
      // Final DOM snapshots identical: same multiset of note positions. Poll
      // for convergence: 5 peers × 5 drags each flow through the
      // write-before-broadcast room, so positions settle a beat after the last
      // drag is committed.
      await expectWithin(async () => {
        const signatures = await Promise.all(
          participants.map(async (p) => {
            const boxes = await p.page
              .locator('[data-testid="sticky-note"]')
              .evaluateAll((els) =>
                els
                  .map((el) => {
                    const r = el.getBoundingClientRect();
                    return `${Math.round(r.x)}x${Math.round(r.y)}`;
                  })
                  .sort(),
              );
            return boxes.join('|');
          }),
        );
        return new Set(signatures).size === 1;
      }, { timeout: 5000, message: 'all snapshots identical' });
    } finally {
      for (const p of participants) await closeParticipant(p);
    }
  });
});

test.describe('Flaky Wi-Fi', () => {
  test('TC-27: offline edits catch up; badge Reconnecting → Connected; both show 6', async ({
    browser,
  }) => {
    test.setTimeout(CATCH_UP_TEST_OUTAGE_MS + 60_000);
    const boardId = freshBoardId();
    const alex = await openParticipant(browser, boardId);
    const sam = await openParticipant(browser, boardId);
    try {
      // Alex drops offline.
      await alex.context.setOffline(true);
      // Both add 3 notes while Alex is offline.
      for (let i = 0; i < 3; i++) {
        await createNote(alex.page);
        await alex.page.mouse.click(10, 10);
      }
      for (let i = 0; i < 3; i++) {
        await createNote(sam.page);
        await sam.page.mouse.click(10, 10);
      }
      // The badge shows "Reconnecting…" while offline. The browser does not
      // reliably fire WebSocket close on network loss, so the provider only
      // notices via its 30 s no-message watchdog; allow time for that.
      await expect(alex.page.getByText('Reconnecting…')).toBeVisible({ timeout: 40_000 });

      // Stay offline for the configured outage, then come back.
      await new Promise((r) => setTimeout(r, CATCH_UP_TEST_OUTAGE_MS));
      await alex.context.setOffline(false);

      // Badge goes to "Connected" (green) then hides.
      await expect(alex.page.getByText('Connected')).toBeVisible({
        timeout: 15_000,
      });
      await expect(alex.page.locator('[data-testid="connection-status"]')).toHaveCount(0, {
        timeout: 15_000,
      });

      // Both pages converge on all 6 notes.
      await expectWithin(async () => (await noteCount(alex.page)) === 6, {
        timeout: 5000,
        message: 'Alex sees all 6 notes',
      });
      await expectWithin(async () => (await noteCount(sam.page)) === 6, {
        timeout: 5000,
        message: 'Sam sees all 6 notes',
      });
    } finally {
      await alex.context.setOffline(false);
      await closeParticipant(alex);
      await closeParticipant(sam);
    }
  });
});

test.describe('Selection is local', () => {
  test('TC-28: selecting/editing a note is not visible to the other peer', async ({
    browser,
  }) => {
    const boardId = freshBoardId();
    const alex = await openParticipant(browser, boardId);
    const sam = await openParticipant(browser, boardId);
    try {
      await createNote(alex.page);
      await expectWithin(() => noteCount(sam.page), { message: 'Sam sees the note' });

      // Alex selects and starts editing the note.
      await selectNote(alex.page, 0);
      await notes(alex.page).first().dblclick();
      await expect(alex.page.locator('[data-testid="sticky-editor"]')).toHaveCount(1);

      // Sam's page: no selection outline and no editor.
      await expect(sam.page.locator('[data-testid="sticky-note"][data-selected]')).toHaveCount(0);
      await expect(sam.page.locator('[data-testid="sticky-editor"]')).toHaveCount(0);
    } finally {
      await closeParticipant(alex);
      await closeParticipant(sam);
    }
  });
});


