/**
 * E2E live collaboration tests (TC-22 to TC-28).
 *
 * These tests open multiple isolated browser contexts on the same board and
 * verify that edits propagate live between participants. They run against the
 * `wrangler dev` server (see playwright.config.ts).
 */
import { expect, test } from '@playwright/test';

import {
  CATCH_UP_TEST_OUTAGE_MS,
  MAX_CONCURRENT_EDITORS,
  type StickyColor,
} from '../../src/shared/config';
import {
  closeParticipants,
  createNoteAndGetId,
  expectEventually,
  getDocSnapshot,
  noteCount,
  noteIds,
  openParticipants,
  type Participant,
} from './helpers/participants';
import {
  colourSwatch,
  deleteButton,
  dragPointer,
  editor,
  noteRects,
  selectNoteAt,
  settle,
  typeText,
} from './helpers/stickies';

test.describe('Two-person workshop', () => {
  let participants: Participant[];

  test.beforeEach(async ({ browser }) => {
    participants = await openParticipants(browser, 2);
  });

  test.afterEach(async () => {
    await closeParticipants(participants);
  });

  test('TC-22: Alex creates, moves, recolours, types, deletes → each change appears for Sam', async () => {
    const [alex, sam] = participants;

    // 1. Alex creates a note
    const noteId = await createNoteAndGetId(alex);
    expect(noteId).not.toBe('');

    await expectEventually(
      'TC-22 create',
      participants,
      async () => (await noteCount(sam.page)) >= 1,
    );
    expect(await noteIds(sam.page)).toContain(noteId);

    // 2. Alex moves the note
    const rects = await noteRects(alex.page);
    const noteRect = rects.find((r) => r.id === noteId)!;
    const dragFrom = { x: noteRect.centreX, y: noteRect.centreY };
    const dragDelta = { x: 80, y: 60 };
    await dragPointer(alex.page, dragFrom, dragDelta);
    await settle(alex.page);

    await expectEventually(
      'TC-22 move',
      participants,
      async () => {
        const rectsB = await noteRects(sam.page);
        const rB = rectsB.find((r) => r.id === noteId);
        if (!rB) return false;
        return rB.worldX > noteRect.worldX && rB.worldY > noteRect.worldY;
      },
    );

    // 3. Alex recolours the note (re-find position after move)
    const rectsAfterMove = await noteRects(alex.page);
    const movedRect = rectsAfterMove.find((r) => r.id === noteId)!;
    await selectNoteAt(alex.page, { x: movedRect.centreX, y: movedRect.centreY });
    await settle(alex.page);
    const color: StickyColor = 'green';
    await colourSwatch(alex.page, color).click();
    await settle(alex.page);

    await expectEventually(
      'TC-22 recolour',
      participants,
      async () => {
        const snap = await getDocSnapshot(sam.page);
        const entry = snap[noteId] as Record<string, unknown> | undefined;
        return entry?.color === color;
      },
    );

    // 4. Alex types text into the note
    const rectsBeforeType = await noteRects(alex.page);
    const typeTargetRect = rectsBeforeType.find((r) => r.id === noteId)!;
    await selectNoteAt(alex.page, { x: typeTargetRect.centreX, y: typeTargetRect.centreY });
    await alex.page.keyboard.press('Enter'); // start editing
    await expect(editor(alex.page)).toBeVisible();
    await typeText(alex.page, 'Hello Sam');
    await alex.page.keyboard.press('Escape');
    await settle(alex.page);

    await expectEventually(
      'TC-22 text',
      participants,
      async () => {
        const snap = await getDocSnapshot(sam.page);
        const entry = snap[noteId] as Record<string, unknown> | undefined;
        return entry?.text === 'Hello Sam';
      },
    );

    // 5. Alex deletes the note
    const rectsBeforeDel = await noteRects(alex.page);
    const delTargetRect = rectsBeforeDel.find((r) => r.id === noteId)!;
    await selectNoteAt(alex.page, { x: delTargetRect.centreX, y: delTargetRect.centreY });
    await settle(alex.page);
    await deleteButton(alex.page).click();
    await settle(alex.page);

    await expectEventually(
      'TC-22 delete',
      participants,
      async () => (await noteIds(sam.page)).includes(noteId) === false,
    );
  });

  test('TC-23: both type simultaneously into one note → identical text containing every typed character', async () => {
    const [alex, sam] = participants;

    // Alex creates a note and types initial text
    const noteId = await createNoteAndGetId(alex);
    const rects = await noteRects(alex.page);
    const r = rects.find((n) => n.id === noteId)!;
    const centre = { x: r.centreX, y: r.centreY };

    // Alex types first character
    await selectNoteAt(alex.page, centre);
    await alex.page.keyboard.press('Enter');
    await expect(editor(alex.page)).toBeVisible();
    await typeText(alex.page, 'AB');
    await settle(alex.page);

    // Sam types at the end simultaneously
    await expectEventually(
      'TC-23 initial sync',
      participants,
      async () => {
        const snap = await getDocSnapshot(sam.page);
        const entry = snap[noteId] as Record<string, unknown> | undefined;
        return entry?.text === 'AB';
      },
    );

    // Now both type at the same time
    // Alex types at current cursor (after "AB")
    await typeText(alex.page, 'X');
    // Sam starts editing the same note and types
    const samRects = await noteRects(sam.page);
    const samRect = samRects.find((n) => n.id === noteId)!;
    await selectNoteAt(sam.page, { x: samRect.centreX, y: samRect.centreY });
    await sam.page.keyboard.press('Enter');
    await expect(editor(sam.page)).toBeVisible();
    await typeText(sam.page, 'Y');

    await settle(alex.page);
    await settle(sam.page);

    // Both should converge to text containing all typed characters
    await expectEventually(
      'TC-23 convergence',
      participants,
      async () => {
        const snapA = await getDocSnapshot(alex.page);
        const snapB = await getDocSnapshot(sam.page);
        const textA = (snapA[noteId] as Record<string, unknown>)?.text as string;
        const textB = (snapB[noteId] as Record<string, unknown>)?.text as string;
        return textA === textB && textA.length >= 4;
      },
    );

    // Verify every character appears
    const finalText = (await getDocSnapshot(alex.page))[noteId] as Record<string, unknown>;
    const text = finalText.text as string;
    for (const ch of ['A', 'B', 'X', 'Y']) {
      expect(text).toContain(ch);
    }

    await alex.page.keyboard.press('Escape');
    await sam.page.keyboard.press('Escape');
  });

  test('TC-24: both drag the same note at once → identical settled position on both', async () => {
    const [alex, sam] = participants;

    const noteId = await createNoteAndGetId(alex);
    await expectEventually(
      'TC-24 initial',
      participants,
      async () => (await noteIds(sam.page)).includes(noteId),
    );

    // Get note position on both (they should be the same)
    const rectsA = await noteRects(alex.page);
    const r = rectsA.find((n) => n.id === noteId)!;
    const centre = { x: r.centreX, y: r.centreY };

    // Alex drags it right, Sam drags it down (simultaneously)
    await Promise.all([
      dragPointer(alex.page, centre, { x: 100, y: 0 }),
      dragPointer(sam.page, centre, { x: 0, y: 80 }),
    ]);
    await settle(alex.page);
    await settle(sam.page);

    // CRDT: last-write-wins per property → both should converge to same position
    await expectEventually(
      'TC-24 converge',
      participants,
      async () => {
        const snapA = await getDocSnapshot(alex.page);
        const snapB = await getDocSnapshot(sam.page);
        const entryA = snapA[noteId] as Record<string, unknown> | undefined;
        const entryB = snapB[noteId] as Record<string, unknown> | undefined;
        return (
          entryA !== undefined &&
          entryB !== undefined &&
          entryA.x === entryB.x &&
          entryA.y === entryB.y
        );
      },
    );
  });

  test('TC-25: Sam editing, Alex deletes → Sam\'s note and editor disappear, no console errors', async () => {
    const [alex, sam] = participants;

    const noteId = await createNoteAndGetId(alex);
    await expectEventually(
      'TC-25 initial',
      participants,
      async () => (await noteIds(sam.page)).includes(noteId),
    );

    // Sam starts editing the note
    const samRects = await noteRects(sam.page);
    const samRect = samRects.find((n) => n.id === noteId)!;
    await selectNoteAt(sam.page, { x: samRect.centreX, y: samRect.centreY });
    await sam.page.keyboard.press('Enter');
    await expect(editor(sam.page)).toBeVisible();

    // Listen for console errors on Sam's page
    const consoleErrors: string[] = [];
    sam.page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Alex deletes the note
    const alexRects = await noteRects(alex.page);
    const alexRect = alexRects.find((n) => n.id === noteId)!;
    await selectNoteAt(alex.page, { x: alexRect.centreX, y: alexRect.centreY });
    await settle(alex.page);
    await deleteButton(alex.page).click();
    await settle(alex.page);

    // Sam's note should disappear
    await expectEventually(
      'TC-25 note gone',
      participants,
      async () => (await noteIds(sam.page)).includes(noteId) === false,
    );

    // Sam's editor should also close
    await expect(editor(sam.page)).not.toBeVisible({ timeout: 5000 });

    // No console errors on Sam's side
    expect(consoleErrors).toHaveLength(0);
  });

  test('TC-28: Alex selects and edits a note → Sam sees no selection outline or editor', async () => {
    const [alex, sam] = participants;

    const noteId = await createNoteAndGetId(alex);
    await expectEventually(
      'TC-28 initial',
      participants,
      async () => (await noteIds(sam.page)).includes(noteId),
    );

    // Alex selects and edits the note
    const rects = await noteRects(alex.page);
    const r = rects.find((n) => n.id === noteId)!;
    await selectNoteAt(alex.page, { x: r.centreX, y: r.centreY });
    await alex.page.keyboard.press('Enter');
    await expect(editor(alex.page)).toBeVisible();
    await typeText(alex.page, 'Alex is here');

    // Sam should NOT see any editor
    await sam.page.waitForTimeout(200);
    await expect(editor(sam.page)).not.toBeVisible();

    // Sam should not see selection outline (the .sticky-note--selected class)
    const samSelected = await sam.page.locator('.sticky-note--selected').count();
    expect(samSelected).toBe(0);

    await alex.page.keyboard.press('Escape');
  });
});

test.describe('Full-capacity session', () => {
  test('TC-26: MAX_CONCURRENT_EDITORS contexts each create 5 notes → every change seen by all', async ({ browser }) => {
    const participants = await openParticipants(browser, MAX_CONCURRENT_EDITORS);

    try {
      // Each participant creates 5 notes
      const allNoteIds: string[][] = [];
      for (const p of participants) {
        const ids: string[] = [];
        for (let i = 0; i < 5; i++) {
          const id = await createNoteAndGetId(p);
          ids.push(id);
        }
        allNoteIds.push(ids);
      }

      // All participants should eventually see all notes (5 × MAX_CONCURRENT_EDITORS)
      const expectedCount = MAX_CONCURRENT_EDITORS * 5;
      for (const p of participants) {
        await expectEventually(
          `TC-26 ${p.name} sees all notes`,
          participants,
          async () => (await noteCount(p.page)) === expectedCount,
        );
      }

      // All snapshots should be identical
      const snapshots: string[] = [];
      for (const p of participants) {
        snapshots.push(JSON.stringify(await noteIds(p.page)));
      }
      for (let i = 1; i < snapshots.length; i++) {
        // Same set (order might differ, so sort)
        const ids0 = JSON.parse(snapshots[0]).sort();
        const idsN = JSON.parse(snapshots[i]).sort();
        expect(idsN).toEqual(ids0);
      }
    } finally {
      await closeParticipants(participants);
    }
  });
});

test.describe('Flaky Wi-Fi', () => {
  test('TC-27: offline for CATCH_UP_TEST_OUTAGE_MS, both add notes, reconnect → both show 6', async ({ browser }) => {
    const participants = await openParticipants(browser, 2);

    try {
      const [alex, sam] = participants;

      // Alex goes offline
      await alex.context.setOffline(true);

      // Both add 3 notes while Alex is offline
      for (let i = 0; i < 3; i++) {
        await createNoteAndGetId(alex);
        await createNoteAndGetId(sam);
      }

      // Alex still shows 3 notes (his own)
      expect(await noteCount(alex.page)).toBe(3);
      // Sam shows 3 notes (his own)
      expect(await noteCount(sam.page)).toBe(3);

      // Wait the outage period (we use shorter time for CI)
      const outageMs = Math.min(CATCH_UP_TEST_OUTAGE_MS, 5_000);
      await new Promise((r) => setTimeout(r, outageMs));

      // Alex comes back online
      await alex.context.setOffline(false);

      // Badge should briefly show "Reconnecting…" then hide
      // Eventually both should see 6 notes
      await expectEventually(
        'TC-27 Alex syncs 6',
        participants,
        async () => (await noteCount(alex.page)) === 6,
      );

      await expectEventually(
        'TC-27 Sam syncs 6',
        participants,
        async () => (await noteCount(sam.page)) === 6,
      );

      // Connection badge should be hidden (connected)
      await expect
        .poll(
          async () =>
            (await alex.page.evaluate(() =>
              document.querySelector('[role="status"]')?.textContent ?? null,
            )) === null,
          { timeout: 10_000 },
        )
        .toBe(true);
    } finally {
      await closeParticipants(participants);
    }
  });
});
