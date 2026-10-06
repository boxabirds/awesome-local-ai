import { expect, test, type Page } from "@playwright/test";
import * as notes from "./helpers/notes";
import {
  badgeLog,
  boardDomSnapshot,
  connectionStateOf,
  expectEventually,
  expectNoProblems,
  noteCount,
  openSession,
  reportLatencies,
  resetLatencies,
  socketCount,
  startBadgeRecorder,
  type BoardDomSnapshot,
  type Participant,
  type Session,
} from "./helpers/participants";
import { MAX_CONCURRENT_EDITORS, STICKY_COLORS, type StickyColor } from "../../src/shared/config";
import type { ConnectionState } from "../../src/client/sync/connection-state";

/**
 * Story 3, task 9 - the nightly e2e (TC-29, TC-30).
 *
 * These two are the long-running half of the `sync.client` contract: an idle
 * connection that must stay connected, and a board where everyone edits
 * continuously and still ends up agreeing. Both run for minutes, so they are
 * tagged `@nightly` and live behind `npm run test:e2e:nightly`.
 *
 * Latency is measured and printed, never asserted (design.md timing policy).
 */

const IDLE_MS = 45_000;
const SOAK_MS = 60_000;

/**
 * Where the soak's gestures are allowed to point.
 *
 * A note's toolbar is drawn *above* the note, so a note pushed off the top of the
 * board has no toolbar for the next gesture to click; and a click that lands on one
 * of the board's own floating panels — the tool panel on the left, the zoom controls
 * bottom right, the navigation hint along the bottom — never reaches the board
 * underneath. Both are true for a person as well as for this test, so notes are
 * created here and kept here: 200×200 notes centred inside this rectangle have room
 * for their toolbars and clickable centres.
 */
const GESTURE_ZONE = { x: 180, y: 170, width: 780, height: 530 };

/** Same generator as the integration fixture, so a soak failure is reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ["design", "ship", "budget", "spike", "review", "draft", "queue", "launch", "test", "action"];
const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

async function snapshotOf(page: Page): Promise<BoardDomSnapshot[]> {
  return boardDomSnapshot(page);
}

async function byId(page: Page, id: string): Promise<BoardDomSnapshot | undefined> {
  return (await snapshotOf(page)).find((note) => note.id === id);
}

test.describe("nightly: idle connection stability", () => {
  test("TC-29 @nightly an idle board keeps its connection for 45 seconds", async ({ browser }) => {
    test.setTimeout(180_000);
    resetLatencies();

    const session = await openSession(browser, ["Alex", "Sam"]);
    const [alex, sam] = session.participants;
    if (!alex || !sam) throw new Error("expected two participants");

    await startBadgeRecorder(alex.page);
    await startBadgeRecorder(sam.page);

    const socketsBefore = await Promise.all(
      session.participants.map((participant) => socketCount(participant.page)),
    );

    const samples: { waited: number; alex: ConnectionState | null; sam: ConnectionState | null }[] = [];
    for (let waited = 0; waited < IDLE_MS; waited += 3_000) {
      await sam.page.waitForTimeout(3_000);
      samples.push({
        waited,
        alex: await connectionStateOf(alex.page),
        sam: await connectionStateOf(sam.page),
      });
    }
    console.log(`[idle] connection state samples: ${JSON.stringify(samples)}`);

    // The badge never had anything to complain about...
    for (const participant of session.participants) {
      const log = await badgeLog(participant.page);
      expect(log, `${participant.name}'s badge`).not.toContain("Reconnecting…");
    }

    // ...the mapped state never left `connected`...
    expect(samples.map((sample) => sample.alex)).not.toContain("reconnecting");
    expect(samples.map((sample) => sample.sam)).not.toContain("reconnecting");
    expect(samples.every((sample) => sample.alex === "connected" && sample.sam === "connected")).toBe(true);

    // ...and no client needed a new socket while nobody was doing anything.
    const socketsAfter = await Promise.all(
      session.participants.map((participant) => socketCount(participant.page)),
    );
    expect(socketsAfter).toEqual(socketsBefore);

    // An idle board is still the same board.
    expect(await noteCount(alex.page)).toBe(0);
    expect(await noteCount(sam.page)).toBe(0);

    expectNoProblems(session.participants);
    await session.close();
  });
});

test.describe("nightly: capacity soak", () => {
  test(`TC-30 @nightly ${MAX_CONCURRENT_EDITORS} editors, 60 seconds of continuous edits, one board`, async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    resetLatencies();

    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, index) => `Editor ${index + 1}`);
    const session = await openSession(browser, names);

    // Logged so a failure can be replayed.
    const randoms = session.participants.map((participant, index) => {
      const seed = 0x5eed + index * 7919;
      console.log(`[soak] ${participant.name} seed=${seed}`);
      return seededRandom(seed);
    });

    const until = Date.now() + SOAK_MS;
    let operations = 0;

    while (Date.now() < until) {
      for (const [index, participant] of session.participants.entries()) {
        if (Date.now() >= until) break;
        const random = randoms[index]!;
        operations += 1;
        await runRandomOperation(participant, session, random, `op${operations}`);
      }
    }

    console.log(`[soak] ${operations} operations across ${session.participants.length} editors`);

    // Everything converged: every editor's board matches the first one.
    await expectEventually("all boards converge to the same state", () => snapshotsIdentical(session));

    const snapshots = await Promise.all(session.participants.map((p) => snapshotOf(p.page)));
    const expected = snapshots[0]!;
    for (const [index, snapshot] of snapshots.entries()) {
      expect(snapshot.map(publicView), `${session.participants[index]!.name}'s board`).toEqual(
        expected.map(publicView),
      );
    }

    // Teardown: closing a participant must not send anyone else into a reconnect.
    const survivor = session.participants[session.participants.length - 1]!;
    const socketsBefore = await socketCount(survivor.page);
    for (const participant of session.participants.slice(0, -1)) {
      await participant.context.close();
    }
    await survivor.page.waitForTimeout(10_000);
    expect(await socketCount(survivor.page)).toBe(socketsBefore);
    expect(await connectionStateOf(survivor.page)).toBe("connected");

    const summary = reportLatencies();
    expect(summary.count).toBeGreaterThan(0);

    expectNoProblems([survivor]);
    await survivor.context.close();
  });
});

/** Two screen positions count as the same if they are within a CSS pixel. */
function samePlace(a: BoardDomSnapshot, b: BoardDomSnapshot): boolean {
  return Math.abs(a.box.x - b.box.x) <= 1 && Math.abs(a.box.y - b.box.y) <= 1;
}

function publicView(note: BoardDomSnapshot) {
  return { id: note.id, x: note.box.x, y: note.box.y, text: note.text, color: note.color, z: note.z };
}

/** True when every editor's board shows exactly the same notes in the same places. */
async function snapshotsIdentical(session: Session): Promise<boolean> {
  const snapshots = await Promise.all(session.participants.map((participant) => snapshotOf(participant.page)));
  const first = snapshots[0]!;
  for (const snapshot of snapshots) {
    if (snapshot.length !== first.length) return false;
    for (const [position, note] of snapshot.entries()) {
      const expected = first[position]!;
      if (expected.id !== note.id) return false;
      if (expected.text !== note.text || expected.color !== note.color) return false;
      if (!samePlace(expected, note)) return false;
    }
  }
  return true;
}

/** One seeded edit through the real UI, then the wait for it to reach everyone. */
async function runRandomOperation(
  participant: Participant,
  session: Session,
  random: () => number,
  label: string,
): Promise<void> {
  const page = participant.page;
  const mine = await snapshotOf(page);
  const roll = random();
  // Always work on a topmost note: the click a person would make is unambiguous
  // when nothing is painted above the note being clicked.
  const topZ = mine.length === 0 ? 0 : Math.max(...mine.map((note) => note.z));
  const candidates = mine.filter((note) => note.z === topZ);
  const target = candidates.length === 0 ? undefined : candidates[Math.floor(random() * candidates.length)]!;

  if (target === undefined || roll < 0.1) {
    const at = await freePoint(page, random);
    const word = WORDS[Math.floor(random() * WORDS.length)]!;
    const id = await createNote(page, at, word);
    await waitForChange(participant, session, id, true, `${label} create`);
    return;
  }

  if (roll < 0.5) {
    const word = ` ${WORDS[Math.floor(random() * WORDS.length)]!}`;
    if (!(await selectAndEdit(page, target))) return;
    await page.keyboard.type(word);
    await notes.endEditing(page);
    await waitForChange(participant, session, target.id, true, `${label} type`);
    return;
  }

  if (roll < 0.8) {
    const centre = notes.centreOf(target);
    const dx = clamp(
      Math.round(random() * 240) - 120,
      GESTURE_ZONE.x - centre.x,
      GESTURE_ZONE.x + GESTURE_ZONE.width - centre.x,
    );
    const dy = clamp(
      Math.round(random() * 200) - 100,
      GESTURE_ZONE.y - centre.y,
      GESTURE_ZONE.y + GESTURE_ZONE.height - centre.y,
    );
    await notes.dragOnBoard(page, centre, dx, dy);
    await waitForChange(participant, session, target.id, true, `${label} move`);
    return;
  }

  if (roll < 0.9) {
    const color = COLOR_NAMES[Math.floor(random() * COLOR_NAMES.length)]!;
    if (!(await selectNote(page, target))) return;
    await page.getByTestId(`swatch-${color}`).click();
    await page.mouse.click(60, 700); // click empty board space to drop the selection
    await waitForChange(participant, session, target.id, true, `${label} recolour`);
    return;
  }

  if (!(await selectNote(page, target))) return;
  await page.getByTestId("note-delete").click();
  await waitForChange(participant, session, target.id, false, `${label} delete`);
}

/**
 * Waits until every other editor sees what this one just did to `id`, and logs
 * how long that took. `present: false` means the change was a deletion.
 */
async function waitForChange(
  actor: Participant,
  session: Session,
  id: string,
  present: boolean,
  label: string,
): Promise<void> {
  await expectEventually(label, async () => {
    const source = await byId(actor.page, id);
    if (present === false) {
      if (source !== undefined) return false;
    }
    for (const participant of session.participants) {
      if (participant === actor) continue;
      const note = await byId(participant.page, id);
      if (present === false) {
        if (note !== undefined) return false;
        continue;
      }
      if (!note || !source) return false;
      if (note.text !== source.text || note.color !== source.color) return false;
      if (!samePlace(note, source)) return false;
    }
    return true;
  });
}

/**
 * Selects `note` and reports whether its toolbar came up.
 *
 * Five editors are editing the same board at the same time: between the snapshot
 * this gesture was planned from and the click, another editor may have moved or
 * deleted that note. When the toolbar does not appear there is nothing here to
 * operate on, and the soak moves on to the next gesture instead of waiting for
 * buttons that are no longer on the page. The click uses the freshest box, not the
 * position the plan was made from.
 */
async function selectNote(page: Page, note: BoardDomSnapshot): Promise<boolean> {
  const current = await byId(page, note.id);
  if (!current) return false;
  await page.mouse.click(current.box.x + current.box.width / 2, current.box.y + current.box.height / 2);
  await notes.settle(page);
  return page
    .getByTestId("note-toolbar")
    .waitFor({ state: "visible", timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
}

async function selectAndEdit(page: Page, note: BoardDomSnapshot): Promise<boolean> {
  if (!(await selectNote(page, note))) return false;
  await page.keyboard.press("Enter");
  return page
    .getByTestId("sticky-note-input")
    .waitFor({ state: "visible", timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
}

function clamp(value: number, min: number, max: number): number {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Math.max(low, Math.min(high, value));
}

/** A board spot that is not covered by a note, so the double-click creates one. */
async function freePoint(page: Page, random: () => number): Promise<{ x: number; y: number }> {
  const notes = await snapshotOf(page);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const at = {
      x: GESTURE_ZONE.x + Math.round(random() * GESTURE_ZONE.width),
      y: GESTURE_ZONE.y + Math.round(random() * GESTURE_ZONE.height),
    };
    const covered = notes.some(
      (note) =>
        at.x >= note.box.x &&
        at.x <= note.box.x + note.box.width &&
        at.y >= note.box.y &&
        at.y <= note.box.y + note.box.height,
    );
    if (!covered) return at;
  }
  return { x: GESTURE_ZONE.x + 100, y: GESTURE_ZONE.y + 100 };
}

/** Double-click to create, type `text`, close the editor. Returns the note id. */
async function createNote(page: Page, at: { x: number; y: number }, text: string): Promise<string> {
  const before = new Set((await snapshotOf(page)).map((note) => note.id));
  await notes.createNoteByDoubleClick(page, at);
  await page.keyboard.type(text);
  await notes.endEditing(page);
  const created = (await snapshotOf(page)).find((note) => !before.has(note.id));
  if (!created) throw new Error("the new note is missing");
  return created.id;
}
