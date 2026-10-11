import { expect, test } from '@playwright/test';
import {
  MAX_CONCURRENT_EDITORS,
  NIGHTLY_SOAK_MS,
  STICKY_COLORS,
  type StickyColor,
} from '../../src/shared/config';
import {
  assertQuietAfterLeavingBoard,
  boardsAgree,
  closeSession,
  createNote,
  deleteNote,
  expectNoConsoleErrors,
  measureUntil,
  moveNoteBy,
  openBoardTogether,
  person,
  printLatencySummary,
  recolourNote,
  snapshotJson,
  typeIntoNote,
  waitForConnected,
  type Participant,
} from '../e2e/helpers/participants';
import { setBoardCamera } from '../e2e/helpers/board';

/** Screen gap between two neighbouring note slots, at the camera zoom used here. */
const SOAK_ZOOM = 0.5;
const SLOT_GAP_X = 220;
const SLOT_GAP_Y = 160;
// Where the pointer double-clicks for the top-left slot. A note lands centred on
// that point, so this keeps every note clear of the board toolbar on the left.
const FIRST_SLOT_X = 300;
const FIRST_SLOT_Y = 90;
/** A note never drifts further than this from its slot, so slots never overlap. */
const DRIFT_X = 55;
// Vertical drift stays small so the toolbar above a note is never covered by the
// note in the row below it.
const DRIFT_Y = 10;
/** Notes one person keeps on the board at a time. */
const NOTES_PER_PERSON = 4;
const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];
const WORDS = ['capture', 'arrange', 'rethink', 'reframe', 'cluster', 'split', 'keep', 'drop'];

/** Deterministic random: the same edit script every run, so a failure repeats. */
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

/** What the page can see right now, for when an edit goes wrong. */
async function diagnostics(participant: Participant, mine: { id: string; slot: number }[]): Promise<string> {
  const boxes = await participant.page.evaluate((list: string[]) =>
    list.map((id: string) => {
      const el = document.querySelector<HTMLElement>(`[data-note-id=${JSON.stringify(id)}]`);
      if (el === null) {
        return `${id}: gone`;
      }
      const rect = el.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return `${id}: ${Math.round(rect.x)},${Math.round(rect.y)} hit=${hit?.getAttribute('data-note-id') ?? hit?.tagName ?? 'none'}`;
    }),
    ids(mine));
  return boxes.join(' | ');
}

function ids(mine: { id: string; slot: number }[]): string[] {
  return mine.map((note) => note.id);
}

type SoakOp = 'create' | 'move' | 'recolour' | 'type' | 'delete';
const OPS: SoakOp[] = ['create', 'move', 'recolour', 'type', 'delete'];

/**
 * TC-30 — capacity soak with a latency report.
 *
 * `MAX_CONCURRENT_EDITORS` screens edit the same board continuously for
 * `NIGHTLY_SOAK_MS` through the real UI. Every change is followed by a wait for
 * every other screen to show it, which is both the functional assertion (a
 * change that never arrives fails) and the measurement (how long it took, logged
 * against `LIVE_UPDATE_LATENCY_BUDGET_MS` and never asserted).
 */
test.describe('capacity soak (TC-30)', () => {
  test(`every change converges on ${MAX_CONCURRENT_EDITORS} screens during ${NIGHTLY_SOAK_MS / 1000}s of continuous editing`, async ({ browser }) => {
    test.setTimeout(NIGHTLY_SOAK_MS + 240_000);

    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, index) => `Editor ${index + 1}`);
    const session = await openBoardTogether(browser, names);
    const camera = { x: 0, y: 0, zoom: SOAK_ZOOM };
    for (const participant of session.participants) {
      await setBoardCamera(participant.page, camera);
      await waitForConnected(participant);
    }

    const rnd = seededRandom(0x5eed_3030);
    const pick = <T,>(values: readonly T[]): T => values[Math.floor(rnd() * values.length)] ?? values[0]!;
    /** Notes each person is responsible for, and the slot each one sits in. */
    const owned = new Map<Participant, { id: string; slot: number }[]>();
    /** How far each note has been dragged from its slot, to keep slots apart. */
    const drift = new Map<string, { x: number; y: number }>();

    const slotFor = (participantIndex: number, slot: number): { x: number; y: number } => ({
      x: FIRST_SLOT_X + (slot % NOTES_PER_PERSON) * SLOT_GAP_X,
      y: FIRST_SLOT_Y + participantIndex * SLOT_GAP_Y,
    });

    try {
      const started = Date.now();
      let round = 0;
      let changes = 0;

      while (Date.now() - started < NIGHTLY_SOAK_MS) {
        round += 1;
        for (const [index, participant] of session.participants.entries()) {
          const mine = owned.get(participant) ?? [];
          /** The first slot of this person's row that no note of theirs is using. */
          const freeSlot = (): number => {
            const used = new Set(mine.map((note) => note.slot));
            for (let slot = 0; slot < NOTES_PER_PERSON; slot += 1) {
              if (!used.has(slot)) {
                return slot;
              }
            }
            return -1;
          };
          // A person with no notes left can only make one, whatever the dice said.
          let op = mine.length === 0 ? 'create' : pick(OPS);
          if (op === 'create' && freeSlot() < 0) {
            // Their row is full: the oldest note goes first to make room.
            const oldest = mine.shift()!;
            drift.delete(oldest.id);
            const stamp = Date.now();
            await deleteNote(participant.page, oldest.id);
            await measureUntil(
              `TC-30 ${participant.name} delete (to free a slot) r${round}`,
              stamp,
              async () => await boardsAgree(...session.participants),
            );
            changes += 1;
          }

          if (process.env.VIDI6_SOAK_DIAGNOSTICS) {
            console.log(
              `[soak] about to ${op} for ${participant.name} r${round}`,
              await diagnostics(participant, mine),
            );
          }
          const stamp = Date.now();
          switch (op) {
            case 'create': {
              const slot = freeSlot();
              mine.push({ id: await createNote(participant.page, slotFor(index, slot)), slot });
              owned.set(participant, mine);
              break;
            }
            case 'move': {
              const id = pick(mine)!.id;
              const soFar = drift.get(id) ?? { x: 0, y: 0 };
              const dx = pick([-50, -25, 25, 50]);
              const dy = pick([-10, -5, 0, 5, 10]);
              if (Math.abs(soFar.x + dx) > DRIFT_X || Math.abs(soFar.y + dy) > DRIFT_Y) {
                // This drag would take the note out of its slot: nudge it back instead.
                const back = { x: -Math.sign(soFar.x) * 25, y: -Math.sign(soFar.y) * 10 };
                await moveNoteBy(participant.page, id, back.x, back.y);
                drift.set(id, { x: soFar.x + back.x, y: soFar.y + back.y });
              } else {
                await moveNoteBy(participant.page, id, dx, dy);
                drift.set(id, { x: soFar.x + dx, y: soFar.y + dy });
              }
              break;
            }
            case 'recolour': {
              await recolourNote(participant.page, pick(mine)!.id, pick(COLORS));
              break;
            }
            case 'type': {
              await typeIntoNote(participant.page, pick(mine)!.id, ` ${pick(WORDS)}-${round}`);
              break;
            }
            case 'delete': {
              const gone = mine.splice(Math.floor(rnd() * mine.length), 1)[0]!;
              drift.delete(gone.id);
              await deleteNote(participant.page, gone.id);
              break;
            }
          }
          changes += 1;
          await measureUntil(
            `TC-30 ${participant.name} ${op} r${round}`,
            stamp,
            async () => await boardsAgree(...session.participants),
          );
        }
      }

      // Every screen ends with the same board.
      await expect
        .poll(async () => await boardsAgree(...session.participants), { timeout: 30_000 })
        .toBe(true);
      const final = await snapshotJson(person(session, 0).page);
      for (const participant of session.participants) {
        expect(await snapshotJson(participant.page), `${participant.name} ended on a different board`).toBe(final);
      }

      console.info(`[soak] board agreement held through ${changes} changes over ${Date.now() - started}ms`);
      printLatencySummary(`TC-30 soak, ${MAX_CONCURRENT_EDITORS} screens, ${changes} changes`);
      expectNoConsoleErrors(...session.participants);
      await Promise.all(session.participants.map((participant) => assertQuietAfterLeavingBoard(participant)));
      console.info(`[soak] every screen went quiet after leaving the board`);
    } finally {
      await closeSession(session);
    }
  });
});
