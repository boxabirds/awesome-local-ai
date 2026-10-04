/**
 * Board fixtures for the persistence tests.
 *
 * Every board here is built with the real `board-model` mutations, so what the
 * tests hand to storage are the same Yjs update bytes the product produces —
 * nothing about a fixture board is synthetic.
 *
 *  - `retroBoard`: 25 notes of mixed colours, multi-line text and overlapping
 *    stacking order (the shape of a real retrospective, and the shape the
 *    reopen-after-everyone-left cases compare).
 *  - `largeBoard`: `PERSIST_TESTED_NOTES` notes of realistic English phrases
 *    (10–300 characters) laid out in clusters, for persist.large_board.
 *  - damaged bytes: a truncated update and same-length random bytes, the two
 *    ways a log row can go bad.
 *
 * Generation is seeded, so a failing run reproduces the same board.
 */

import * as Y from 'yjs';

import {
  createSticky,
  initDoc,
  moveObject,
  setStickyColor,
  getStickyText,
} from '../../src/shared/board-model';
import {
  PERSIST_TESTED_NOTES,
  STICKY_COLORS,
  STICKY_SIZE_WORLD,
  type StickyColor,
} from '../../src/shared/config';

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

/** mulberry32: a tiny deterministic PRNG, so a board can be reproduced by seed. */
export function seededGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length) % items.length] as T;
}

/** The retrospective board: 25 notes, mixed colours, multi-line, overlapping. */
const RETRO_PROMPTS: readonly (readonly string[])[] = [
  ['What went well', 'shipped the beta two days early'],
  ['What went well', 'the new onboarding cut support tickets by a third'],
  ['What went well', 'pairing on the sync layer\ncaught the echo bug before release'],
  ['What went well', 'docs weekend\nsomeone actually wrote them'],
  ['What went well', 'latency down to 40ms p95'],
  ['What to improve', 'standup runs long\nwe lose an hour a week'],
  ['What to improve', 'flaky e2e tests\nnobody trusts the red build'],
  ['What to improve', 'review turnaround is three days'],
  ['What to improve', 'the export job still needs a human'],
  ['What to improve', 'incident notes are scattered across four places'],
  ['Action', 'add a retry budget to the room relay'],
  ['Action', 'write the storage runbook\non-call needs it'],
  ['Action', 'move the nightly soak to a scheduled worker'],
  ['Action', 'trim the fixture data set'],
  ['Action', 'document the wire protocol'],
  ['Question', 'do we keep the broadcast channel?'],
  ['Question', 'who owns the export format\nafter the API freeze?'],
  ['Question', 'can we backfill the archived boards?'],
  ['Question', 'what happens to boards with no users?'],
  ['Shout-out', 'Rae for the recovery drill'],
  ['Shout-out', 'the whole team for the launch night'],
  ['Shout-out', 'Sam kept the dashboards honest'],
  ['Idea', 'templates for workshops'],
  ['Idea', 'a way to find a board from a note\nsearch by text'],
  ['Idea', 'offline edits that survive a closed tab'],
];

/**
 * A 25-note retrospective on `doc`: mixed colours, multi-line text, and rows
 * close enough together that neighbouring notes overlap (stacking order matters).
 * Returns the note ids in creation order.
 */
export function retroBoard(doc: Y.Doc, seed = 20_260_904): string[] {
  initDoc(doc);
  const random = seededGenerator(seed);
  const ids: string[] = [];
  // Each note is one mutation, so each is one Yjs update and (in the board's
  // storage) one log row - which is what the damaged-row cases damage.
  RETRO_PROMPTS.forEach((prompt, index) => {
    const column = index % 5;
    const row = Math.floor(index / 5);
    // 150 world units between rows of a 200-unit note: a 50-unit overlap, so
    // the note created later covers the one above it.
    const centre = { x: column * 260 - 520, y: row * 150 - 300 };
    const id = createSticky(doc, centre, pick(COLORS, random));
    const text = getStickyText(doc, id);
    if (text) text.insert(0, `${prompt[0]}: ${prompt[1]}`);
    ids.push(id);
    // Every third note gets nudged, so positions are not a clean grid.
    if (index % 3 === 0) moveObject(doc, id, centre.x - 120 + index, centre.y - 100 + index * 2);
  });
  // Two notes change colour after creation, so the final board is not what the
  // first pass wrote (a reopen has to show the last state, not the first).
  for (const id of [ids[3], ids[17]].filter(Boolean) as string[]) {
    setStickyColor(doc, id, 'violet');
  }
  return ids;
}

/* Realistic-ish English fragments, combined into notes of 10–300 characters. */
const OPENERS = [
  'The room relay holds every change until the write is durable',
  'Reopening the board the next morning shows every note where it was left',
  'Nobody pressed save and nothing was lost',
  'A note deleted by mistake should come back in the history view',
  'Workshop boards get reused by three teams across two time zones',
  'The export is missing the colours people spent an hour choosing',
  'Stacking order matters when notes are this close together',
  'Someone typed a novel into one sticky note again',
  'The board loaded in under a second even with the whole workshop on it',
  'A change that reached the other screen is a change that was written down',
];
const MIDDLES = [
  'and the on-call engineer only found out from the dashboard',
  'which is exactly what the runbook says to do first',
  'but only after the connection came back on its own',
  'so the follow-up action items stay with the note they came from',
  'while everyone else was already looking at a different board',
  'and the retry landed on top of someone else\u2019s edit',
  'because the storage layer keeps the log and the snapshot apart',
  'even though the service restarted twice in between',
];
const ENDINGS = [
  'Please write it down.',
  'Add it to the board before Friday.',
  'We agreed to try it for one sprint.',
  'Nobody volunteered, so it is mine.',
  'Carried over from last week.',
  'Discussed at the review, needs an owner.',
  'Left this here so it does not get lost.',
  '',
];

/** A note body between 10 and 300 characters, from the fragments above. */
function realisticText(random: () => number): string {
  let text = pick(OPENERS, random);
  if (random() < 0.7) text += ` ${pick(MIDDLES, random)}`;
  const ending = pick(ENDINGS, random);
  if (ending) text += ` ${ending}`;
  if (random() < 0.25) text += `\n${pick(OPENERS, random)}`;
  if (text.length > 300) text = text.slice(0, 297).trimEnd() + '\u2026';
  while (text.length < 10) text += ' note';
  return text;
}

/**
 * A board of `count` notes (default: the size the PRD tests opening against),
 * with realistic text, in clusters of a few dozen so it looks like people worked
 * in areas rather than filling a grid. Returns the note ids in creation order.
 */
export function largeBoard(
  doc: Y.Doc,
  count: number = PERSIST_TESTED_NOTES,
  seed = 20_260_905,
): string[] {
  initDoc(doc);
  const random = seededGenerator(seed);
  const ids: string[] = [];
  const clusters = Math.max(1, Math.round(count / 40));
  doc.transact(() => {
    for (let index = 0; index < count; index++) {
      const cluster = index % clusters;
      const clusterX = (cluster % 6) * 1600 - 4800;
      const clusterY = Math.floor(cluster / 6) * 1200 - 600;
      const x = clusterX + (index % 8) * (STICKY_SIZE_WORLD + 24) + Math.floor(random() * 40);
      const y = clusterY + Math.floor(index / 8) * (STICKY_SIZE_WORLD + 18) + Math.floor(random() * 30);
      const id = createSticky(doc, { x, y }, pick(COLORS, random));
      const text = getStickyText(doc, id);
      if (text) text.insert(0, realisticText(random));
      ids.push(id);
    }
  });
  return ids;
}

/** An update with its last 10 bytes removed: a row cut short on the way in. */
export function truncatedUpdate(update: Uint8Array): Uint8Array {
  return update.slice(0, Math.max(0, update.byteLength - 10));
}

/** Random bytes of the same length: a row whose content went to noise. */
export function randomBytesLike(update: Uint8Array, seed = 20_260_906): Uint8Array {
  const random = seededGenerator(seed);
  const bytes = new Uint8Array(update.byteLength);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(random() * 256);
  return bytes;
}
