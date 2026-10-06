import { expect, test, type Page } from "@playwright/test";
import * as Y from "yjs";
import { createSticky, getStickyText, initDoc, resizeObjects } from "../../src/shared/board-model";
import { MAX_CONCURRENT_EDITORS, type StickyColor } from "../../src/shared/config";
import { E2E_PORT } from "./helpers/api";
import * as notes from "./helpers/notes";
import * as selection from "./helpers/selection";
import { withInputLock } from "./helpers/input-lock";
import {
  expectEventually,
  expectNoProblems,
  hasNoteIds,
  openSession,
  type Participant,
  type Session,
} from "./helpers/participants";
import { seedBoard } from "./helpers/sync-client";

/**
 * Story 8, task 5 (TC-22 to TC-24) — undoing in a room with other people in it.
 *
 * Real browsers, the real sync provider, and a board written from the test
 * process through the same sync protocol a client speaks (the way story 4's
 * persistence tests seed one). That matters here: notes that arrive from the
 * room are *remote* to every participant, so nothing in anyone's history but
 * their own work, which is exactly what these cases then prove.
 *
 * Every assertion is made on what each browser rendered, and the board state is
 * compared in **world units** — the inline `left`/`top`/`width`/`height` a note
 * is painted with — so a camera can never make a wrong answer look right.
 */

/** One note the fixture places on the board. */
interface SeedNote {
  at: { x: number; y: number };
  color: StickyColor;
  text: string;
  size?: { width: number; height: number };
}

interface SeededBoard {
  /** Note ids in fixture order. */
  ids: string[];
  updates: Uint8Array[];
}

/** What one browser shows for one note, in world units. */
interface BoardEntry {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  text: string;
  color: string;
}

/** Builds a board with the real model functions and returns the updates to send it. */
function seedFixture(layout: readonly SeedNote[]): SeededBoard {
  const doc = new Y.Doc();
  initDoc(doc);
  const updates: Uint8Array[] = [Y.encodeStateAsUpdate(doc)];
  const ids: string[] = [];

  for (const item of layout) {
    const before = Y.encodeStateVector(doc);
    doc.transact(() => {
      const id = createSticky(doc, item.at, item.color);
      if (typeof id !== "string") throw new Error(`the fixture note at ${JSON.stringify(item.at)} was refused`);
      ids.push(id);
      if (item.text !== "") getStickyText(doc, id)?.insert(0, item.text);
    });
    updates.push(Y.encodeStateAsUpdate(doc, before));
  }

  const sizes = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const [index, item] of layout.entries()) {
    if (!item.size) continue;
    sizes.set(ids[index]!, { x: item.at.x - item.size.width / 2, y: item.at.y - item.size.height / 2, ...item.size });
  }
  if (sizes.size > 0) {
    const before = Y.encodeStateVector(doc);
    doc.transact(() => resizeObjects(doc, sizes));
    updates.push(Y.encodeStateAsUpdate(doc, before));
  }

  return { ids, updates };
}

/** The board as this browser painted it: world units straight out of the DOM. */
async function boardState(page: Page): Promise<Map<string, BoardEntry>> {
  const entries = await page.evaluate(() => {
    const out: BoardEntry[] = [];
    for (const node of Array.from(document.querySelectorAll<HTMLElement>("[data-testid='sticky-note']"))) {
      const style = node.style;
      const editor = node.querySelector("[data-testid='sticky-note-input']");
      const displayed = node.querySelector("[data-testid='sticky-note-text']");
      out.push({
        id: node.getAttribute("data-note-id") ?? "",
        // The note is positioned in board units, so these are comparable between
        // browsers whatever their cameras are.
        left: Number.parseFloat(style.left),
        top: Number.parseFloat(style.top),
        width: Number.parseFloat(style.width),
        height: Number.parseFloat(style.height),
        text: editor ? ((editor as HTMLTextAreaElement).value ?? "") : (displayed?.textContent ?? ""),
        color: window.getComputedStyle(node).backgroundColor,
      });
    }
    return out;
  });
  return new Map(entries.map((entry) => [entry.id, entry]));
}

async function undoWith(page: Page, times = 1): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await page.keyboard.press("Control+z");
    await notes.settle(page);
  }
}

async function typeInNote(page: Page, id: string, text: string): Promise<void> {
  // Opening the editor is a pointer gesture too, so it waits its turn at the mouse
  // (`helpers/input-lock`); the keystrokes themselves may overlap freely.
  await withInputLock(() => page.locator(`[data-note-id='${id}']`).dblclick());
  await expect(page.getByTestId("sticky-note-input")).toBeVisible();
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("sticky-note-input")).toHaveCount(0);
  await notes.settle(page);
}

function sameEntry(a: BoardEntry, b: BoardEntry): boolean {
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5 &&
    a.text === b.text &&
    a.color === b.color
  );
}

/** Eight notes in one cluster, four nowhere near it, in varied colours and sizes. */
const RETRO: SeedNote[] = [
  { at: { x: 150, y: 150 }, color: "yellow", text: "Shipped the onboarding flow" },
  { at: { x: 350, y: 150 }, color: "pink", text: "Blocked: the export API returns 500", size: { width: 260, height: 160 } },
  { at: { x: 550, y: 150 }, color: "blue", text: "Try smaller batches next sprint" },
  { at: { x: 150, y: 350 }, color: "green", text: "Ask support which questions come back" },
  { at: { x: 350, y: 350 }, color: "orange", text: "The empty board needs a hint", size: { width: 140, height: 120 } },
  { at: { x: 550, y: 350 }, color: "violet", text: "Investigate the drag lag" },
  { at: { x: 750, y: 150 }, color: "yellow", text: "Nobody noticed the new palette" },
  { at: { x: 750, y: 350 }, color: "blue", text: "Write down who decides the roadmap" },
  { at: { x: 1500, y: 150 }, color: "green", text: "Pair the new hire for two days" },
  { at: { x: 1650, y: 150 }, color: "pink", text: "Cut the meeting that only reports status" },
  { at: { x: 1500, y: 900 }, color: "orange", text: "Mobile: pinch zoom first" },
  { at: { x: 1650, y: 900 }, color: "violet", text: "Our own board got lost on restart" },
];

const VIEW_CENTRE = { x: 450, y: 250 };

test.describe("workflow: undo my own changes while colleagues work", () => {
  let session: Session | undefined;

  test.afterEach(async () => {
    await session?.close();
    session = undefined;
  });

  test("TC-22 recover an accidental delete while a colleague works", async ({ browser }) => {
    test.setTimeout(180_000);
    session = await openSession(browser, ["Mia", "Raj"]);
    const [mia, raj] = session.participants;

    const fixture = seedFixture(RETRO);
    const cluster = fixture.ids.slice(0, 8);
    const others = fixture.ids.slice(8);
    await seedBoard(E2E_PORT, session.boardId, fixture.updates);

    for (const participant of session.participants) {
      await selection.centreOn(participant.page, VIEW_CENTRE);
      await expectEventually(
        `${participant.name} sees the seeded board`,
        async () => (await notes.noteCount(participant.page)) === RETRO.length,
      );
    }

    // What the eight cluster notes look like before anything happens, so the
    // undo can be compared against all of it: text, colour, size, position.
    const before = await boardState(mia.page);
    expect(before.size).toBe(RETRO.length);

    // Mia box-selects the cluster and deletes it by mistake.
    await selection.marqueeAround(mia.page, cluster);
    expect(await selection.selectedIds(mia.page)).toHaveLength(8);
    await mia.page.keyboard.press("Delete");
    await notes.settle(mia.page);

    await expectEventually(
      "Mia's delete reaches Raj",
      async () => (await notes.noteCount(raj.page)) === 4,
    );
    expect(await notes.noteCount(mia.page)).toBe(4);

    // Raj keeps working while the board is in this state.
    const [rajNote] = await selection.createNotes(raj.page, [{ x: 1000, y: 500 }], () => "Raj was here");
    await expectEventually(
      "Raj's note reaches Mia",
      async () => await hasNoteIds(mia.page, [rajNote]),
    );

    // Mia gets her eight notes back with one Ctrl/Cmd+Z.
    await undoWith(mia.page, 1);

    await expectEventually(
      "the eight notes come back on Raj's screen",
      async () => await hasNoteIds(raj.page, cluster),
    );

    const restoredMia = await boardState(mia.page);
    const restoredRaj = await boardState(raj.page);
    expect(restoredMia.size).toBe(RETRO.length + 1);
    for (const id of cluster) {
      // Text, colour, size and position, on both screens.
      expect(sameEntry(restoredMia.get(id)!, before.get(id)!)).toBe(true);
      expect(sameEntry(restoredRaj.get(id)!, before.get(id)!)).toBe(true);
    }
    for (const id of others) {
      expect(sameEntry(restoredMia.get(id)!, before.get(id)!)).toBe(true);
    }
    // Raj's note is Mia's undo's business only in the sense that it is not.
    expect(restoredMia.get(rajNote)?.text).toBe("Raj was here");

    // Mia's own history is now empty: the one step she took is waiting in her
    // redo stack, and nothing else ever got there.
    const undo = mia.page.getByRole("button", { name: "Undo" });
    const redo = mia.page.getByRole("button", { name: "Redo" });
    await expect(undo).toBeDisabled();
    await expect(redo).toBeEnabled();
    // Raj's history is his own: he has a note of his own to undo.
    await expect(raj.page.getByRole("button", { name: "Undo" })).toBeEnabled();

    // Redo puts the mistake back on both screens. A redo is a change of her own,
    // so it is the next thing she can undo.
    await redo.click();
    await expectEventually(
      "the eight notes are gone again for Raj",
      async () => (await notes.noteCount(raj.page)) === 5,
    );
    expect(await notes.noteCount(mia.page)).toBe(5);
    expect(await hasNoteIds(mia.page, cluster)).toBe(false);
    await expect(undo).toBeEnabled();
    await expect(redo).toBeDisabled();

    // Undoing that brings the eight notes back, and her history is empty again:
    // the two buttons only ever move her own one step between their two stacks.
    await undo.click();
    await expectEventually(
      "the eight notes come back once more",
      async () => (await notes.noteCount(raj.page)) === RETRO.length + 1,
    );
    expect((await boardState(mia.page)).size).toBe(RETRO.length + 1);
    await expect(undo).toBeDisabled();

    expectNoProblems(session.participants);
  });

  test("TC-23 a colleague deleted my object: undo does not bring it back and does not break", async ({ browser }) => {
    test.setTimeout(180_000);
    session = await openSession(browser, ["Mia", "Raj"]);
    const [mia, raj] = session.participants;
    for (const participant of session.participants) {
      await selection.centreOn(participant.page, { x: 400, y: 300 });
    }

    const [mine] = await selection.createNotes(mia.page, [{ x: 300, y: 250 }], () => "mine");
    await expectEventually("Raj sees Mia's note", async () => await hasNoteIds(raj.page, [mine]));
    const whereItStarted = (await boardState(raj.page)).get(mine)!;

    await selection.dragObjectBy(mia.page, mine, { x: 90, y: 70 });
    await expectEventually("the move reaches Raj", async () => {
      const moved = (await boardState(raj.page)).get(mine);
      return moved !== undefined && Math.abs(moved.left - whereItStarted.left) > 1;
    });

    // Raj deletes the note Mia just moved.
    await selection.selectIds(raj.page, [mine]);
    await raj.page.keyboard.press("Delete");
    await notes.settle(raj.page);
    await expectEventually("the note is gone for Mia too", async () => (await notes.noteCount(mia.page)) === 0);

    // Mia undoes her move. It targets something that is no longer there: nothing
    // happens, on either screen, and nothing is thrown.
    await undoWith(mia.page, 1);
    expect(await notes.noteCount(mia.page)).toBe(0);
    expect(await notes.noteCount(raj.page)).toBe(0);
    expect(await hasNoteIds(mia.page, [mine])).toBe(false);
    expect(await hasNoteIds(raj.page, [mine])).toBe(false);

    // Her history is still hers to use: a new note, and one undo takes it away
    // for everyone.
    const [second] = await selection.createNotes(mia.page, [{ x: 700, y: 250 }], () => "");
    await expectEventually("Raj sees the new note", async () => await hasNoteIds(raj.page, [second]));
    await undoWith(mia.page, 1);
    await expectEventually("the new note is undone for Raj", async () => (await notes.noteCount(raj.page)) === 0);
    expect(await hasNoteIds(raj.page, [mine])).toBe(false);

    expectNoProblems(session.participants);
  });

  test("TC-24 everyone undoing at once: each person undoes their own work only", async ({ browser }) => {
    test.setTimeout(240_000);
    const count = MAX_CONCURRENT_EDITORS;
    const names = Array.from({ length: count }, (_unused, index) => `Editor ${index + 1}`);
    session = await openSession(browser, names);
    const editors = session.participants;

    // `count` notes to move and `count` notes to type in: nobody touches the same
    // note as anybody else.
    const layout: SeedNote[] = [];
    for (let index = 0; index < count; index += 1) {
      layout.push({ at: { x: 150 + index * 200, y: 150 }, color: "yellow", text: `move me ${index + 1}` });
    }
    for (let index = 0; index < count; index += 1) {
      layout.push({ at: { x: 150 + index * 200, y: 400 }, color: "blue", text: `type in me ${index + 1}` });
    }
    const fixture = seedFixture(layout);
    const toMove = fixture.ids.slice(0, count);
    const toType = fixture.ids.slice(count);

    await seedBoard(E2E_PORT, session.boardId, fixture.updates);
    for (const editor of editors) {
      await selection.centreOn(editor.page, { x: 500, y: 275 });
      await expectEventually(
        `${editor.name} sees the seeded board`,
        async () => (await notes.noteCount(editor.page)) === layout.length,
      );
    }
    // The baseline is what a browser actually painted, so the comparisons below
    // are between like things: colour and size as drawn, not as named in the model.
    const baseline = await boardState(editors[0].page);
    for (const editor of editors) {
      const state = await boardState(editor.page);
      expect(state.size).toBe(layout.length);
      for (const [id, entry] of state) expect(sameEntry(entry, baseline.get(id)!)).toBe(true);
    }

    // Everyone works at the same time: each moves one note and types in another.
    const typed = new Map<string, string>();
    const moved = new Map<string, { x: number; y: number }>();
    await Promise.all(
      editors.map(async (editor: Participant, index: number) => {
        const delta = { x: 30 + index * 12, y: 24 + index * 10 };
        // One page is pointed at at a time (`helpers/input-lock`), while the other
        // four editors keep typing and their updates keep arriving here.
        await withInputLock(() => selection.dragObjectBy(editor.page, toMove[index]!, delta));
        moved.set(toMove[index]!, delta);
        const text = `edited by ${editor.name}`;
        typed.set(toType[index]!, text);
        await typeInNote(editor.page, toType[index]!, text);
      }),
    );

    // Every change reached every screen, exactly: the premise of everything below
    // is that all `count` boards already agree.
    for (const editor of editors) {
      await expectEventually(`every change is on ${editor.name}'s screen`, async () => {
        const state = await boardState(editor.page);
        if (state.size !== layout.length) return false;
        return toType.every((id) => state.get(id)?.text === `${baseline.get(id)!.text}${typed.get(id)}`)
          && toMove.every((id) => {
            const entry = state.get(id);
            const delta = moved.get(id)!;
            return (
              entry !== undefined
              && Math.abs(entry.left - (baseline.get(id)!.left + delta.x)) < 0.5
              && Math.abs(entry.top - (baseline.get(id)!.top + delta.y)) < 0.5
            );
          });
      });
    }

    // One person undoes at a time, twice: their own typing and their own move.
    // Everyone still working keeps their work, and everyone already undone stays
    // undone.
    for (const [index, editor] of editors.entries()) {
      const movedId = toMove[index]!;
      const typedId = toType[index]!;

      await undoWith(editor.page, 2);

      const state = await boardState(editor.page);
      // Their own two steps, gone.
      expect(sameEntry(state.get(movedId)!, baseline.get(movedId)!)).toBe(true);
      expect(sameEntry(state.get(typedId)!, baseline.get(typedId)!)).toBe(true);

      // Everyone still working keeps their change on this screen: undoing here
      // did not reach into their move or their typing.
      for (let other = index + 1; other < editors.length; other += 1) {
        const movedEntry = state.get(toMove[other]!)!;
        const typedEntry = state.get(toType[other]!)!;
        expect(typedEntry.text, `${editors[other].name}'s typing was undone by ${editor.name}`).toBe(
          `${baseline.get(toType[other])!.text}${typed.get(toType[other])}`,
        );
        expect(
          Math.abs(movedEntry.left - (baseline.get(toMove[other])!.left + moved.get(toMove[other])!.x)),
          `${editors[other].name}'s move was undone by ${editor.name}`,
        ).toBeLessThan(0.5);
      }

      // And everyone who already undid is still undone here.
      for (let done = 0; done < index; done += 1) {
        expect(sameEntry(state.get(toMove[done])!, baseline.get(toMove[done])!)).toBe(true);
        expect(sameEntry(state.get(toType[done])!, baseline.get(toType[done])!)).toBe(true);
      }
    }

    // In the end every screen shows the same board: everyone's own work is undone,
    // and nothing was undone twice or by the wrong person.
    const boards = await Promise.all(editors.map((editor) => boardState(editor.page)));
    for (const [index, board] of boards.entries()) {
      expect(board.size, `${editors[index].name} has a different number of notes`).toBe(layout.length);
      for (const [id, entry] of board) {
        expect(sameEntry(entry, baseline.get(id)!), `${editors[index].name}: note ${id} differs`).toBe(true);
      }
    }
    for (const [index, editor] of editors.entries()) {
      await expect(editor.page.getByRole("button", { name: "Undo" }), `editor ${index}`).toBeDisabled();
    }

    expectNoProblems(session.participants);
  });
});
