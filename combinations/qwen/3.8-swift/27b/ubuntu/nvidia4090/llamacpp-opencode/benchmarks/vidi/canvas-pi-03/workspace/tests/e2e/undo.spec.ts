/**
 * Story 8 e2e — undo.controls (TC-22 to TC-24): real multi-user browsers
 * prove that undo/redo only ever reverses the LOCAL person's changes while
 * remote changes stay intact, and that five simultaneous editors each undo
 * their own work concurrently.
 */
import { test, expect } from '@playwright/test';
import { openParticipants, type Participant, moveNote, deleteNote, createNote, typeInNote, noteById, BUDGET } from './helpers/participants';
import { getNotes } from './helpers/board';
import { MAX_CONCURRENT_EDITORS } from 'src/shared/config';

/** Seed `count` notes through the test hook (one transaction burst per note). */
async function seed(p: Participant, count: number): Promise<string[]> {
  return p.page.evaluate((n) => (window as any).__vidi6.seedNotes(n), count);
}

/** The ids of all notes on the board. */
async function ids(p: Participant): Promise<string[]> {
  return (await getNotes(p.page)).map((n) => n.id);
}

test.describe('undo.controls (e2e)', () => {
  test('TC-22: Mia deletes 8, Raj adds a note, Mia Ctrl+Z → 8 back on both, Raj note remains; Redo removes 8 again', async ({ browser }) => {
    const [mia, raj] = await openParticipants(browser, 2);
    const seeded = await seed(mia, 8);
    // All eight are visible to both before the delete.
    await expect.poll(() => ids(raj)).toHaveLength(8);

    // Mia selects all eight and deletes them (one undo step on her side).
    const c = await getNotes(mia.page);
    const first = c[0];
    // Select the first note, then Ctrl+A selects the whole board.
    await mia.page.mouse.click(512, 384);
    await mia.page.keyboard.press('Control+a');
    await mia.page.keyboard.press('Delete');
    await expect.poll(() => ids(mia)).toHaveLength(0);
    await expect.poll(() => ids(raj)).toHaveLength(0);

    // Raj adds his own note — a remote change for Mia.
    const rajX = 200;
    await createNote(raj.page, rajX, 200, 'raj note');
    // Poll on the text (not just the count): the note's map entry and its
    // Y.Text content are separate updates in flight.
    await expect.poll(
      async () => (await getNotes(mia.page)).find((n) => n.text === 'raj note'),
    ).toBeTruthy();
    const rajNote = (await getNotes(mia.page)).find((n) => n.text === 'raj note')!;
    expect(rajNote.text).toBe('raj note');

    // Mia undoes: her eight come back on BOTH screens, Raj's note remains.
    await mia.page.keyboard.press('Control+z');
    await expect.poll(async () => {
      const m = await ids(mia);
      const r = await ids(raj);
      return m.length === 9 && r.length === 9 && m.every((id) => r.includes(id));
    }).toBe(true);
    // Exactly the seeded eight + Raj's note.
    const mIds = new Set(await ids(mia));
    expect(seeded.every((id) => mIds.has(id))).toBe(true);
    expect(mIds.has(rajNote.id)).toBe(true);

    // Mia redoes: the eight are gone again on both, Raj's note still there.
    await mia.page.keyboard.press('Control+Shift+z');
    await expect.poll(async () => {
      const m = await getNotes(mia.page);
      const r = await getNotes(raj.page);
      return (
        m.length === 1 && r.length === 1 &&
        m[0].id === rajNote.id && r[0].id === rajNote.id
      );
    }).toBe(true);
    expect(await noteById(mia.page, first.id)).toBeUndefined();
    expect(await noteById(raj.page, first.id)).toBeUndefined();

    await mia.context.close();
    await raj.context.close();
  });

  test('TC-23: Mia moves a note, Raj deletes it, Mia undoes → no error, note absent on both', async ({ browser }) => {
    const [mia, raj] = await openParticipants(browser, 2);
    // Seed the two notes as separate steps (a boundary between them, like the
    // real app's one-note-per-creation boundaries).
    const seeded = await mia.page.evaluate(() => {
      const w = window as any;
      const out = [...w.__vidi6.seedNotes(1)];
      w.__vidi6.undo.boundary();
      out.push(...w.__vidi6.seedNotes(1, 1));
      return out;
    });
    const [victim, bystander] = seeded;
    await expect.poll(() => ids(raj)).toHaveLength(2);

    // Mia moves the victim…
    await moveNote(mia.page, victim, 60, 40);
    const moved = await noteById(mia.page, victim);
    expect(moved).not.toBeUndefined();

    // …and Raj deletes it (remotely for Mia).
    await deleteNote(raj.page, victim);
    await expect.poll(() => noteById(mia.page, victim)).toBeUndefined();

    // Mia undoes: the move's inverse targets a deleted note. No error, the
    // note stays deleted, and the bystander note is untouched on both sides.
    const consoleErrors: string[] = [];
    mia.page.on('pageerror', (e) => consoleErrors.push(String(e)));
    await mia.page.keyboard.press('Control+z');
    await expect.poll(() => noteById(mia.page, victim)).toBeUndefined();
    await expect.poll(() => noteById(raj.page, victim)).toBeUndefined();

    const bystanderMia = await noteById(mia.page, bystander);
    const bystanderRaj = await noteById(raj.page, bystander);
    expect(bystanderMia).not.toBeUndefined();
    expect(bystanderRaj).not.toBeUndefined();
    expect(bystanderMia!.x).toBe(bystanderRaj!.x);
    expect(consoleErrors).toHaveLength(0);

    // Mia's history is still usable: the no-op consumed only the move step, so
    // she can still undo her older create step (which removes the bystander on
    // both screens — the victim is already gone).
    expect(await noteById(mia.page, bystander)).not.toBeUndefined();
    await mia.page.keyboard.press('Control+z');
    await expect.poll(() => noteById(mia.page, bystander)).toBeUndefined();
    await expect.poll(() => noteById(raj.page, bystander)).toBeUndefined();
    // …and redoing brings it back (the victim stays gone — it was deleted by
    // Raj, not by this step).
    await mia.page.keyboard.press('Control+Shift+z');
    await expect.poll(() => noteById(mia.page, bystander)).not.toBeUndefined();
    await expect.poll(() => noteById(raj.page, victim)).toBeUndefined();

    await mia.context.close();
    await raj.context.close();
  });

  test('TC-24: five editors each make and undo their own changes concurrently → identical final boards', async ({ browser }) => {
    const ps = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
    const seeded = await seed(ps[0], 3);
    await expect.poll(() => ids(ps[MAX_CONCURRENT_EDITORS - 1])).toHaveLength(3);

    // Each editor creates (at a distinct spot), moves and types in their own
    // note — all concurrently.
    await Promise.all(
      ps.map(async (p, i) => {
        const x = 120 + i * 230;
        await createNote(p.page, x, 160, `p${i}`);
        const mine = (await getNotes(p.page)).find((n) => n.text === `p${i}`)!;
        expect(mine).not.toBeUndefined();
        await moveNote(p.page, mine.id, 40, 20);
        await typeInNote(p.page, mine.id, `-${i}`);
      }),
    );

    // Everyone sees everyone's work: 3 seeded + 5 personal notes.
    for (const p of ps) {
      await expect
        .poll(() => getNotes(p.page))
        .toHaveLength(8, { timeout: BUDGET * ps.length * 4 });
    }

    // Everyone undoes their own changes concurrently: Ctrl+Z until their own
    // note is gone (create + typed text + move + typed suffix = 4 steps;
    // each typing burst can split into extra steps under heavy load, so a
    // bounded loop keeps it exact). The cap can never reach the seeded
    // notes' step: on the seeding editor those sit below the create step.
    await Promise.all(
      ps.map(async (p, i) => {
        const mine = (await getNotes(p.page)).find((n) => n.text.startsWith(`p${i}`));
        const id = mine!.id;
        for (let k = 0; k < 8; k++) {
          await p.page.keyboard.press('Control+z');
          const gone = await p.page.evaluate((nid) => {
            return !(window as any).__vidi6.doc.getMap('objects').has(nid);
          }, id);
          if (gone) break;
        }
      }),
    );

    // Let all five pages converge on the undos (five-way convergence under
    // parallel-browser load is slower than the single-update budget; this
    // asserts a convergence property, not a latency bound), then compare:
    // identical final boards — exactly the three seeded notes, everywhere.
    await expect
      .poll(async () => {
        const all = await Promise.all(ps.map((q) => ids(q).then((a) => [...a].sort())));
        return all.every((a) => a.length === 3);
      })
      .toBe(true, { timeout: BUDGET * ps.length * 4 });
    const finals = await Promise.all(ps.map((p) => ids(p).then((a) => [...a].sort())));
    for (let i = 1; i < finals.length; i++) {
      expect(finals[i]).toEqual(finals[0]);
    }
    expect(finals[0]).toEqual([...seeded].sort());
    // Each editor's own note is gone on their own screen.
    for (const p of ps) {
      const texts = (await getNotes(p.page)).map((n) => n.text);
      expect(texts.some((t) => /^p\d+$/.test(t))).toBe(false);
    }

    for (const p of ps) await p.context.close();
  });
});
