// Story 8 e2e: per-user undo / redo through the real sync provider (chromium).
//
// Each person is a separate browser context, so the only route between boards is
// the worker. Undo lives entirely in each tab (a Y.UndoManager over LOCAL_ORIGIN
// transactions), so the discriminating fact under test is: a person's Ctrl/Cmd+Z
// reverses ONLY their own work and never a colleague's, and the inverse of their
// own change still syncs to everyone. Screens are awaited until they agree, exactly
// as in the story 3 / story 7 suites. undo.controls (e2e).

import { expect, test } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  createFreshBoard,
  createParticipants,
  everyoneSeesNotes,
  waitForSameScreen,
  type Op,
  type Participant,
} from './helpers/participants';
import { noteBackground, seedNotesAtScreen } from './helpers/sticky';

const redoBtn = (p: Participant) => p.page.getByRole('button', { name: 'Redo' });

/** A button's disabled state as the DOM reports it (the story's source of truth). */
function isDisabled(p: Participant, which: 'undo' | 'redo'): Promise<boolean> {
  return p.page.$eval(`[data-testid="${which}-button"]`, (el) => (el as HTMLButtonElement).disabled);
}

function closeAll(people: readonly Participant[]): Promise<void[]> {
  return Promise.all(people.map((p) => p.close()));
}

test.describe('undo / redo (per-user)', () => {
  // TC-22: Mia deletes a cluster of notes by mistake; Raj keeps working; Mia undoes
  // her OWN mistake — the notes return with their text, colour and position on both
  // screens, Raj's note is untouched — then redoes, and only her own changes move.
  test('TC-22 recovers an accidental delete without touching a colleague', async ({
    browser,
    request,
  }) => {
    const [mia, raj] = await createParticipants(
      browser,
      await createFreshBoard(request),
      ['Mia', 'Raj'],
    );

    // Raj builds eight notes and decorates them, so they are his work in origin.
    const grid = [
      { x: 220, y: 160 },
      { x: 440, y: 160 },
      { x: 220, y: 320 },
      { x: 440, y: 320 },
      { x: 220, y: 480 },
      { x: 440, y: 480 },
      { x: 660, y: 160 },
      { x: 660, y: 320 },
    ];
    const ids = await seedNotesAtScreen(raj.page, grid);
    await everyoneSeesNotes([mia, raj], 8);
    await raj.applyOps([
      ...ids.map((_, i): Op => ({ kind: 'text', index: i, text: `note ${i}` })),
      { kind: 'color', index: 0, color: 'pink' },
    ]);
    await waitForSameScreen([mia, raj]);

    // Remember, from Mia's own screen, what the doomed notes looked like.
    const pos0 = await mia.notePos(ids[0]!);
    const color0 = await noteBackground(mia.page, ids[0]!);
    const text5 = await mia.noteText(ids[5]!);

    // Mia selects everything on her board and deletes it: one mistake, one step.
    await mia.page.keyboard.press('Control+a');
    await mia.page.keyboard.press('Delete');
    await everyoneSeesNotes([mia, raj], 0);

    // Raj adds a note of his own — not Mia's to undo.
    const rajNote = await raj.createNote('Raj added this');
    await everyoneSeesNotes([mia, raj], 1);

    // Mia presses Undo. Her delete reverses; Raj's note is left alone.
    await mia.page.keyboard.press('Control+z');
    await everyoneSeesNotes([mia, raj], 9);
    for (const p of [mia, raj]) {
      expect(await p.noteText(ids[5]!), 'text was not restored').toBe(text5);
      expect(await p.notePos(ids[0]!), 'position was not restored').toEqual(pos0);
      expect(await noteBackground(p.page, ids[0]!), 'colour was not restored').toBe(color0);
      expect(await p.ids(), "Raj's note must survive Mia's undo").toContain(rajNote);
    }
    // Mia had exactly the one mistake, so her undo history is now exhausted.
    expect(await isDisabled(mia, 'undo')).toBe(true);
    expect(await isDisabled(mia, 'redo')).toBe(false);
    expect([mia, raj].flatMap((p) => p.pageErrors)).toEqual([]);

    // Mia redoes: the eight she deleted go away again on both screens; Raj's stays.
    await redoBtn(mia).click();
    await everyoneSeesNotes([mia, raj], 1);
    for (const p of [mia, raj]) expect(await p.ids()).toEqual([rajNote]);
    expect(await isDisabled(mia, 'redo')).toBe(true);
    expect([mia, raj].flatMap((p) => p.pageErrors)).toEqual([]);

    await closeAll([mia, raj]);
  });

  // TC-23: Mia moves a note, Raj deletes it. Mia's undo now aims at something that
  // no longer exists: it is a harmless no-op (no error, no dialog, note stays gone),
  // and her undo history still works for a later change of her own.
  test('TC-23 does nothing when the thing I moved was deleted by someone else', async ({
    browser,
    request,
  }) => {
    const [mia, raj] = await createParticipants(
      browser,
      await createFreshBoard(request),
      ['Mia', 'Raj'],
    );

    const consoleErrors: string[] = [];
    mia.page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const note = await mia.createNote('mine');
    await everyoneSeesNotes([mia, raj], 1);

    // Mia moves it (her step); then Raj deletes it (his change, on both screens).
    await mia.dragNote(note, 240, 120);
    await raj.deleteNote(note);
    await everyoneSeesNotes([mia, raj], 0);

    // Mia undoes her move — the note is already gone, so nothing happens.
    await mia.page.keyboard.press('Control+z');
    await expect.poll(() => mia.ids()).toEqual([]);
    await expect.poll(() => raj.ids()).toEqual([]);
    expect(mia.pageErrors, 'undoing a move of a deleted note threw').toEqual([]);
    expect(consoleErrors, 'undoing a move of a deleted note logged a console error').toEqual(
      [],
    );
    expect([mia, raj].flatMap((p) => p.dialogs), 'an error dialog appeared').toEqual([]);

    // Her undo history still works: a later, single-step change of her own undoes.
    const later = await mia.createNote();
    await everyoneSeesNotes([mia, raj], 1);
    await mia.page.keyboard.press('Control+z');
    await everyoneSeesNotes([mia, raj], 0);
    expect(await mia.ids()).not.toContain(later);
    expect(mia.pageErrors).toEqual([]);

    await closeAll([mia, raj]);
  });

  // TC-24: everyone works at once. Each of MAX_CONCURRENT_EDITORS moves one note and
  // types in another, then undoes twice. A person's undo only ever reverts their own
  // two steps — a colleague's changes stay put while they undo — and once everyone has
  // undone their own work every screen converges on the same board again.
  test('TC-24 everyone undoing at once only ever reverts their own changes', async ({
    browser,
    request,
  }) => {
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `editor${i}`);
    const people = await createParticipants(browser, await createFreshBoard(request), names);
    const n = MAX_CONCURRENT_EDITORS;

    // Two notes per editor, spaced across the board. The notes start empty.
    const grid = Array.from({ length: 2 * n }, (_, i) => ({
      x: 150 + (i % 4) * 300,
      y: 150 + Math.floor(i / 4) * 320,
    }));
    const ids = await seedNotesAtScreen(people[0]!.page, grid);
    await everyoneSeesNotes(people, 2 * n);
    await waitForSameScreen(people);
    const baseline = await people[0]!.screen();

    // Each editor moves note i and types into note (n + i). Every change is someone's
    // own LOCAL_ORIGIN work, so every change is undoable — by its author only.
    const words = names.map((name) => `${name}-edit`);
    await Promise.all(
      people.map(async (p, i) => {
        await p.dragNote(ids[i]!, 70 + i * 12, 50 + i * 9);
        await p.typeIntoNote(ids[n + i]!, words[i]!);
      }),
    );
    await waitForSameScreen(people);

    const moved = await people[0]!.notePos(ids[0]!);
    const baseMoved = baseline.find((x) => x.id === ids[0]!)!;
    expect(Math.abs(moved.x - baseMoved.x)).toBeGreaterThan(1); // it really moved

    // Editor 0 starts undoing: their own changes revert, editor 1's do not.
    const editor0 = people[0]!;
    const editor1 = people[1]!;
    await editor0.page.keyboard.press('Control+z'); // undoes editor 0's own typing
    await expect.poll(() => editor0.noteText(ids[n]!)).toBe('');
    // ...while editor 1's text — a change editor 0 did not make — is still there.
    expect(await editor0.noteText(ids[n + 1]!)).toBe(words[1]);
    expect(await editor0.notePos(ids[1]!)).toEqual(await editor1.notePos(ids[1]!));

    // Now everyone undoes their own work. Each had exactly two steps (move, type);
    // a person with an empty stack gets a harmless no-op.
    await Promise.all(
      people.map(async (p) => {
        await p.page.keyboard.press('Control+z');
        await p.page.keyboard.press('Control+z');
      }),
    );

    // All screens converge back to the baseline: every author reverted only their
    // own changes, so collectively every change is gone and nobody overreached.
    const { screen } = await waitForSameScreen(people);
    expect(screen.map((s) => s.text).filter((t) => t !== '')).toEqual([]);
    for (const s of screen) {
      const was = baseline.find((b) => b.id === s.id)!;
      expect(Math.abs(s.x - was.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(s.y - was.y)).toBeLessThanOrEqual(2);
    }
    expect(people.flatMap((p) => p.pageErrors)).toEqual([]);

    await closeAll(people);
  });
});
