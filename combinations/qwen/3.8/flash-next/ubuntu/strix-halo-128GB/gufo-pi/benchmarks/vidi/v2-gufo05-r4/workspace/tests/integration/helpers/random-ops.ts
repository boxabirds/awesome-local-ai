/**
 * Seeded random board activity, for the convergence tests.
 *
 * A fixed seed produces the same sequence of operations, so a failure can always
 * be replayed — which is the only thing that makes a randomised test worth having.
 * The mix of operations is the one the design asks for: mostly typing, then moving,
 * and occasionally creating, recolouring and deleting.
 *
 * Everything goes through the real `src/shared/board-model.ts` mutators, so the
 * document the room merges is built exactly the way the app builds it.
 */

import * as Y from 'yjs';
import { createSticky, deleteObject, getStickyText, moveObject, setStickyColor } from '../../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../../src/shared/config';
// The generator lives in `tests/helpers/random.ts`, shared with the nightly browser
// soak, so a seed means the same run in either place.
import { createRandom } from '../../helpers/random';

/** The colours a note can be, read off the named settings. */
const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];
import type { TestClient } from './ws-client';

/** Words long enough that concurrent inserts overlap in interesting ways. */
const WORDS = [
  'pricing',
  'workflow',
  'onboarding',
  'customer',
  'follow-up',
  'timeline',
  'budget',
  'research',
  'decision',
  'handoff',
  'roadmap',
  'blocker'
];



/**
 * What the generator did, so a failure can be described rather than guessed at:
 * the seed, and one line per operation.
 */
export interface RandomRun {
  readonly seed: number;
  readonly log: readonly string[];
}

/**
 * Make `count` random changes spread over `clients`, each client acting on its own
 * document — the traffic of a real session squeezed into one synchronous burst,
 * which is where merging is hardest.
 */
export function applyRandomOps(clients: readonly TestClient[], seed: number, count: number): RandomRun {
  const random = createRandom(seed);
  const pick = <T>(items: readonly T[]): T | undefined =>
    items.length === 0 ? undefined : items[Math.floor(random() * items.length)];
  const log: string[] = [];

  for (let step = 0; step < count; step += 1) {
    const client = pick(clients);
    if (!client) break;
    const notes = client.snapshot();
    const note = pick(notes);
    const roll = random();

    // Typing first: if there is nothing to type into, create instead.
    if (roll < 0.4 && note) {
      const text = getStickyText(client.doc, note.id);
      if (text) {
        const word = `${pick(WORDS) ?? 'note'} `;
        const at = Math.floor(random() * (text.length + 1));
        // An origin that is not the client: the client's writer relays every
        // transaction that did not arrive through the room, exactly as the app's
        // local edits are relayed. (Passing the client would look like its own
        // remote update and never leave the document.)
        client.doc.transact(() => text.insert(at, word), 'typed-here');
        log.push(`type@${at} "${word.trim()}" note=${note.id}`);
        continue;
      }
    }
    if (roll < 0.7 && note) {
      const x = Math.round(random() * 2000) - 1000;
      const y = Math.round(random() * 2000) - 1000;
      moveObject(client.doc, note.id, x, y);
      log.push(`move note=${note.id} to ${x},${y}`);
      continue;
    }
    if (roll < 0.8) {
      const id = createSticky(client.doc, { x: Math.round(random() * 800), y: Math.round(random() * 800) });
      log.push(`create note=${id}`);
      continue;
    }
    if (roll < 0.9 && note) {
      const color = pick(COLORS);
      if (color) setStickyColor(client.doc, note.id, color);
      log.push(`recolour note=${note.id} ${color}`);
      continue;
    }
    if (note) {
      deleteObject(client.doc, note.id);
      log.push(`delete note=${note.id}`);
      continue;
    }
    // Nothing to work on yet: make something.
    createSticky(client.doc, { x: 0, y: 0 });
    log.push('create note (board was empty)');
  }

  return { seed, log };
}

/** The shared text of a note, for typing at a document level. */
export function textOf(client: TestClient, noteId: string): Y.Text | undefined {
  return getStickyText(client.doc, noteId);
}
