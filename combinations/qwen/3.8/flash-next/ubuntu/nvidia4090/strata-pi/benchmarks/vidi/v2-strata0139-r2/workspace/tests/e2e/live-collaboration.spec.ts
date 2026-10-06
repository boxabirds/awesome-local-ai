import { expect, test, type Browser, type Page } from "@playwright/test";
import * as notes from "./helpers/notes";
import { boardBox } from "./helpers/board";
import { STICKY_COLORS, MAX_CONCURRENT_EDITORS, CATCH_UP_TEST_OUTAGE_MS } from "../../src/shared/config";
import {
  badgeLog,
  boardDomSnapshot,
  closeSockets,
  connectionStateOf,
  expectEventually,
  expectNoProblems,
  noteCount,
  openSession,
  reportLatencies,
  resetLatencies,
  startBadgeRecorder,
  waitUntilConnected,
  type BoardDomSnapshot,
  type Participant,
  type Session,
} from "./helpers/participants";

/**
 * Story 3, task 8 - live collaboration in real browsers (TC-22 to TC-28).
 *
 * Run against `wrangler dev` serving the built client: the board the two
 * people are looking at is the board the Durable Object holds, and every change
 * travels over a real WebSocket. Nothing here talks to the app other than
 * through the same gestures a person uses.
 */

interface Pair {
  session: Session;
  alex: Participant;
  sam: Participant;
}

async function twoPeople(browser: Browser): Promise<Pair> {
  const session = await openSession(browser, ["Alex", "Sam"]);
  const [alex, sam] = session.participants;
  if (!alex || !sam) throw new Error("expected two participants");
  return { session, alex, sam };
}

async function snapshotOf(page: Page): Promise<BoardDomSnapshot[]> {
  return boardDomSnapshot(page);
}

/** The parts of a board everyone else has to see: everything except what is private. */
function sharedStateOf(snapshot: BoardDomSnapshot[]): Array<Omit<BoardDomSnapshot, "selected" | "editing">> {
  return snapshot.map(({ selected: _selected, editing: _editing, ...shared }) => shared);
}

async function findByLabel(page: Page, label: string): Promise<BoardDomSnapshot | undefined> {
  return (await snapshotOf(page)).find((note) => note.text === label);
}

/**
 * Double-click to create, type `label`, close the editor. Returns the note id.
 *
 * The double-click is retried from an empty corner when it produces nothing: in
 * the full-capacity session (TC-26) notes are deliberately packed close together,
 * and a floating toolbar or a neighbouring note can swallow the gesture. Retrying
 * the gesture is what a person would do; what the test still asserts is a note
 * created at that point.
 */
async function createNote(page: Page, at: { x: number; y: number }, label: string): Promise<string> {
  const before = new Set((await snapshotOf(page)).map((note) => note.id));
  await doubleClickToCreate(page, at);
  await page.keyboard.type(label);
  await notes.endEditing(page);
  const created = (await snapshotOf(page)).find((note) => !before.has(note.id));
  if (!created) throw new Error("the new note is missing");
  return created.id;
}

async function doubleClickToCreate(page: Page, at: { x: number; y: number }): Promise<void> {
  const box = await boardBox(page);
  const corner = { x: box.x + 12, y: box.y + box.height - 12 };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.mouse.dblclick(at.x, at.y);
    const editor = page.getByTestId("sticky-note-input");
    if (await editor.waitFor({ state: "visible", timeout: 2_000 }).then(() => true).catch(() => false)) {
      await notes.settle(page);
      return;
    }
    // Nothing opened: clear whatever was under the pointer, then try the point again.
    await page.mouse.click(corner.x, corner.y);
    await notes.settle(page);
  }
  await notes.createNoteByDoubleClick(page, at);
}

async function noteCentreOf(page: Page, id: string): Promise<{ x: number; y: number }> {
  const note = (await snapshotOf(page)).find((entry) => entry.id === id);
  if (!note) throw new Error(`note ${id} is not on ${page.url()}`);
  return { x: note.box.x + note.box.width / 2, y: note.box.y + note.box.height / 2 };
}

async function selectNote(page: Page, id: string): Promise<void> {
  const centre = await noteCentreOf(page, id);
  await page.mouse.click(centre.x, centre.y);
  await notes.settle(page);
}

/** How the browsers report a WebSocket they could not open — the outage's own symptom. */
const OUTAGE_CONSOLE_NOISE = [/WebSocket connection to/, /can.t establish a connection/, /ERR_INTERNET_DISCONNECTED/];

test.beforeEach(() => {
  resetLatencies();
});

test.afterEach(() => {
  reportLatencies();
});

test.describe("workflow: two-person workshop", () => {
  test("TC-22 every kind of change reaches the other person", async ({ browser }) => {
    const { session, alex, sam } = await twoPeople(browser);

    // ---- create ----
    const place = { x: 420, y: 340 };
    const id = await createNote(alex.page, place, "Design review");
    await expectEventually("create reaches Sam", async () => {
      const seen = await snapshotOf(sam.page);
      return seen.length === 1 && seen[0]!.text === "Design review";
    });
    let samNote = (await snapshotOf(sam.page))[0]!;
    let alexNote = (await snapshotOf(alex.page))[0]!;
    expect(samNote.id).toBe(id);
    expect(samNote.text).toBe("Design review");
    expect([samNote.box.x, samNote.box.y]).toEqual([alexNote.box.x, alexNote.box.y]);

    // ---- move ----
    const centre = notes.centreOf(alexNote);
    await notes.dragOnBoard(alex.page, centre, 180, -120);
    await expectEventually("move reaches Sam", async () => {
      const mine = await snapshotOf(alex.page);
      const theirs = await snapshotOf(sam.page);
      return (
        mine[0]!.box.x === theirs[0]!.box.x &&
        mine[0]!.box.y === theirs[0]!.box.y &&
        theirs[0]!.box.y < place.y
      );
    });

    // ---- recolour ----
    await selectNote(alex.page, id);
    await alex.page.getByTestId("swatch-pink").click();
    await expectEventually("recolour reaches Sam", async () => {
      const note = await findByLabel(sam.page, "Design review");
      return note?.color === notes.rgbOf(STICKY_COLORS.pink);
    });

    // ---- text insert ----
    await selectNote(alex.page, id);
    await alex.page.keyboard.press("Enter");
    await alex.page.keyboard.type(" + live");
    await notes.endEditing(alex.page);
    await expectEventually("typing reaches Sam", async () => {
      const note = await findByLabel(sam.page, "Design review + live");
      return note !== undefined;
    });

    // ---- delete ----
    await selectNote(alex.page, id);
    await alex.page.getByTestId("note-delete").click();
    await expectEventually("delete reaches Sam", async () => (await noteCount(sam.page)) === 0);

    expect(await noteCount(alex.page)).toBe(0);
    expectNoProblems(session.participants);
    await session.close();
  });

  test("TC-23 both people typing into one note keeps every character", async ({ browser }) => {
    const { session, alex, sam } = await twoPeople(browser);

    const id = await createNote(alex.page, { x: 500, y: 400 }, "green");
    await expectEventually("the note reaches Sam", async () => (await findByLabel(sam.page, "green")) !== undefined);

    // Both open the same note and type at the same time.
    await selectNote(alex.page, id);
    await alex.page.keyboard.press("Enter");
    const samCentre = await noteCentreOf(sam.page, id);
    await sam.page.mouse.dblclick(samCentre.x, samCentre.y);
    await expect(sam.page.getByTestId("sticky-note-input")).toBeVisible();

    await Promise.all([alex.page.keyboard.type("red "), sam.page.keyboard.type("blue")]);

    let alexText = "";
    let samText = "";
    await expectEventually(
      "both pages agree on the merged text",
      async () => {
        alexText = (await snapshotOf(alex.page))[0]!.text;
        samText = await sam.page.evaluate(() => {
          const editor = document.querySelector<HTMLTextAreaElement>("[data-testid='sticky-note-input']");
          const displayed = document.querySelector("[data-testid='sticky-note-text']");
          return editor ? editor.value : (displayed?.textContent ?? "");
        });
        return alexText === samText && alexText.includes("red") && alexText.includes("blue");
      },
      8_000,
    );

    expect(alexText).toBe(samText);
    // Nothing was lost: every character each person typed is still there.
    for (const fragment of ["red", "blue", "green"]) expect(alexText).toContain(fragment);

    await session.close();
  });

  test("TC-24 both people dragging the same note settle on one position", async ({ browser }) => {
    const { session, alex, sam } = await twoPeople(browser);

    const id = await createNote(alex.page, { x: 480, y: 380 }, "shared");
    await expectEventually("the note reaches Sam", async () => (await findByLabel(sam.page, "shared")) !== undefined);

    const fromAlex = await noteCentreOf(alex.page, id);
    const fromSam = await noteCentreOf(sam.page, id);

    await Promise.all([
      notes.dragOnBoard(alex.page, fromAlex, 260, 40),
      notes.dragOnBoard(sam.page, fromSam, -120, 200),
    ]);

    // The two screens may pass through different intermediate positions, but
    // they end on the same one. How long that takes is a measurement.
    let position: { x: number; y: number } | null = null;
    await expectEventually(
      "concurrent drags converge to one position",
      async () => {
        const mine = (await snapshotOf(alex.page))[0]!;
        const theirs = (await snapshotOf(sam.page))[0]!;
        position = { x: theirs.box.x, y: theirs.box.y };
        return mine.box.x === theirs.box.x && mine.box.y === theirs.box.y;
      },
      8_000,
    );

    expect(position).not.toBeNull();
    const finalAlex = (await snapshotOf(alex.page))[0]!;
    const finalSam = (await snapshotOf(sam.page))[0]!;
    expect([finalAlex.box.x, finalAlex.box.y]).toEqual([finalSam.box.x, finalSam.box.y]);

    expectNoProblems(session.participants);
    await session.close();
  });

  test("TC-25 a note deleted while someone is typing in it disappears everywhere", async ({ browser }) => {
    const { session, alex, sam } = await twoPeople(browser);

    const id = await createNote(alex.page, { x: 460, y: 360 }, "meeting notes");
    await expectEventually("the note reaches Sam", async () => (await findByLabel(sam.page, "meeting notes")) !== undefined);

    // Sam is typing in it.
    const samCentre = await noteCentreOf(sam.page, id);
    await sam.page.mouse.dblclick(samCentre.x, samCentre.y);
    await expect(sam.page.getByTestId("sticky-note-input")).toBeVisible();
    await sam.page.keyboard.type(" action items");

    // Alex deletes it.
    await selectNote(alex.page, id);
    await alex.page.getByTestId("note-delete").click();

    await expectEventually("the delete reaches Sam", async () => (await noteCount(sam.page)) === 0);
    await expect(sam.page.getByTestId("sticky-note-input")).toHaveCount(0);
    await expect(sam.page.getByTestId("note-toolbar")).toHaveCount(0);

    // It does not come back.
    await sam.page.waitForTimeout(600);
    expect(await noteCount(sam.page)).toBe(0);
    expect(await noteCount(alex.page)).toBe(0);

    expectNoProblems(session.participants);
    await session.close();
  });

  test("TC-28 selecting and editing is private to the person doing it", async ({ browser }) => {
    const { session, alex, sam } = await twoPeople(browser);

    const id = await createNote(alex.page, { x: 440, y: 360 }, "private draft");
    await expectEventually("the note reaches Sam", async () => (await findByLabel(sam.page, "private draft")) !== undefined);
    await expectEventually("the whole note reaches Sam", async () => {
      const seen = await snapshotOf(sam.page);
      return seen.length === 1 && seen[0]!.text === "private draft";
    });

    await selectNote(alex.page, id);
    await alex.page.keyboard.press("Enter");
    await expect(alex.page.getByTestId("sticky-note-input")).toBeVisible();
    await alex.page.keyboard.type(" typing here");

    // The privacy half, checked while Alex is mid-edit: Sam's screen shows no
    // selection and no editor for what Alex is doing.
    await expect.poll(async () => {
      const seen = await snapshotOf(sam.page);
      return (
        seen.length === 1 &&
        seen[0]!.selected === false &&
        seen[0]!.editing === false &&
        (await sam.page.getByTestId("sticky-note-input").count()) === 0 &&
        (await sam.page.getByTestId("note-toolbar").count()) === 0
      );
    }, { timeout: 10_000 }).toBe(true);

    // The sharing half: what Alex typed is on Sam's board once the edit is closed.
    // Text is written keystroke by keystroke, so this is waited for rather than
    // read once — one read can catch a half-typed note.
    await notes.endEditing(alex.page);
    await expectEventually("the typed text reaches Sam", async () => {
      const seen = await snapshotOf(sam.page);
      return seen.length === 1 && seen[0]!.text === "private draft typing here";
    });
    const samNotes = await snapshotOf(sam.page);
    expect(samNotes).toHaveLength(1);
    expect(samNotes[0]!.text).toBe("private draft typing here");
    expect(samNotes[0]!.selected).toBe(false);
    expect(samNotes[0]!.editing).toBe(false);

    expectNoProblems(session.participants);
    await session.close();
  });
});

test.describe("workflow: full-capacity session", () => {
  test(`TC-26 ${MAX_CONCURRENT_EDITORS} participants each create 5 notes and move 5 notes`, async ({ browser }) => {
    test.setTimeout(240_000);

    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, index) => `Editor ${index + 1}`);
    const session = await openSession(browser, names);

    // One column per editor, one row per note.
    // Columns are 200 apart (the notes tile side by side) and rows 145 apart
    // (they overlap a little). Every click points at a spot that belongs to that
    // note alone, and the whole grid stays clear of the board's own floating
    // panels — the tool panel on the left, the zoom controls bottom right, the
    // navigation hint along the bottom. A double-click on one of those panels
    // creates nothing, and they are part of the board a person clicks on.

    const column = (editorIndex: number) => 220 + 200 * editorIndex;
    const row = (index: number) => 130 + 145 * index;

    const labels = new Set<string>();
    for (const [participantIndex, participant] of session.participants.entries()) {
      for (let index = 0; index < MAX_CONCURRENT_EDITORS; index += 1) {
        const label = `${participant.name}-${index + 1}`;
        labels.add(label);
        const at = { x: column(participantIndex), y: row(index) };
        await createNote(participant.page, at, label);

        // Every other participant sees the new note.
        await expectEventually(`"${label}" seen by all others`, async () => {
          for (const other of session.participants) {
            if (other === participant) continue;
            if ((await findByLabel(other.page, label)) === undefined) return false;
          }
          return true;
        });
      }
    }

    // Each participant moves its own five notes.
    for (const participant of session.participants) {
      for (let index = 0; index < MAX_CONCURRENT_EDITORS; index += 1) {
        const label = `${participant.name}-${index + 1}`;
        const note = await findByLabel(participant.page, label);
        if (!note) throw new Error(`${label} is missing on ${participant.name}'s board`);
        await notes.dragOnBoard(participant.page, notes.centreOf(note), 20 + 6 * index, -20 - 5 * index);

        await expectEventually(`move of "${label}" seen by all others`, async () => {
          const mine = await findByLabel(participant.page, label);
          if (!mine) return false;
          for (const other of session.participants) {
            if (other === participant) continue;
            const theirs = await findByLabel(other.page, label);
            if (!theirs || theirs.box.x !== mine.box.x || theirs.box.y !== mine.box.y) return false;
          }
          return true;
        });
      }
    }

    await expectEventually("every board shows the same number of notes", async () => {
      const counts = await Promise.all(session.participants.map((participant) => noteCount(participant.page)));
      return counts.every((count) => count === labels.size);
    });

    // Every board shows the same notes in the same places. Selection and editing
    // are private to the person doing them (TC-28), so they are left out of what
    // the boards have to agree on — each of these five people last touched a
    // different note.
    const snapshots = await Promise.all(
      session.participants.map(async (participant) => sharedStateOf(await snapshotOf(participant.page))),
    );
    const expected = snapshots[0]!;
    for (const [index, snapshot] of snapshots.entries()) {
      expect(snapshot, `${session.participants[index]!.name}'s board`).toEqual(expected);
    }

    expectNoProblems(session.participants);
    await session.close();
  });
});

test.describe("workflow: flaky wi-fi", () => {
  test("TC-27 an outage with the page open: edits are kept and catch up", async ({ browser }) => {
    test.setTimeout(180_000);

    const { session, alex, sam } = await twoPeople(browser);
    await startBadgeRecorder(alex.page);

    // The outage, built the way it looks from inside the board: the socket the
    // board is using goes down, and every reconnect attempt is refused until the
    // outage ends. (`setOffline` alone does not do this — Chromium's offline
    // emulation covers HTTP and leaves an established WebSocket running, which
    // is why the badge used to sit at "Connected" through the whole outage.)
    let outageOpen = true;
    await alex.page.routeWebSocket("**/api/rooms/**", (ws) => {
      if (outageOpen) ws.close();
      else ws.connectToServer();
    });
    await alex.context.setOffline(true);
    await closeSockets(alex.page);

    await expectEventually("Alex sees Reconnecting", async () => (await connectionStateOf(alex.page)) === "reconnecting");

    // The board stays usable while Alex is offline.
    for (let index = 0; index < 3; index += 1) {
      await createNote(alex.page, { x: 220 + 200 * index, y: 150 }, `offline ${index + 1}`);
    }
    for (let index = 0; index < 3; index += 1) {
      await createNote(sam.page, { x: 220 + 200 * index, y: 480 }, `online ${index + 1}`);
    }

    // The outage lasts CATCH_UP_TEST_OUTAGE_MS in total.
    const outageStart = Date.now();
    await sam.page.waitForTimeout(Math.max(0, CATCH_UP_TEST_OUTAGE_MS - 4_000));

    // The outage ends: the next reconnect attempt is proxied to the real server.
    outageOpen = false;
    await alex.context.setOffline(false);
    await waitUntilConnected(alex, 60_000);

    await expectEventually("Alex sees the notes he missed", async () => (await noteCount(alex.page)) === 6);
    await expectEventually("Sam sees what Alex typed offline", async () => (await noteCount(sam.page)) === 6);
    for (const label of ["offline 1", "offline 2", "offline 3", "online 1", "online 2", "online 3"]) {
      expect(await findByLabel(alex.page, label), `Alex should see ${label}`).toBeDefined();
      expect(await findByLabel(sam.page, label), `Sam should see ${label}`).toBeDefined();
    }

    // What the badge said during the whole episode, in order.
    const log = await badgeLog(alex.page);
    const firstReconnecting = log.indexOf("Reconnecting…");
    const connectedAfter = log.indexOf("Connected", firstReconnecting + 1);
    expect(firstReconnecting).toBeGreaterThanOrEqual(0);
    expect(connectedAfter).toBeGreaterThan(firstReconnecting);
    expect(log[log.length - 1]).toBeNull(); // and then the badge hid itself

    expect(Date.now() - outageStart).toBeGreaterThanOrEqual(CATCH_UP_TEST_OUTAGE_MS - 4_000);
    // The refused sockets are the outage itself: each browser logs every attempt
    // it could not complete, in its own words.
    expectNoProblems(session.participants, OUTAGE_CONSOLE_NOISE);
    await session.close();
  });
});
