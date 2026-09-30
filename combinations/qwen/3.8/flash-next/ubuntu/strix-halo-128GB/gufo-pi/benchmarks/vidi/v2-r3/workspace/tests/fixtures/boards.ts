/**
 * Board fixtures for persistence tests.
 * Story 4: persistence.
 */
import * as Y from 'yjs';
import { initDoc, createSticky, moveObject, setStickyColor } from '../../src/shared/board-model';
import type { StickyColor } from '../../src/shared/config';
import { PERSIST_TESTED_NOTES } from '../../src/shared/config';

const COLORS: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

const RETRO_TEXTS = [
  'What went well: shipped the beta on time.',
  'What did not: the import tool kept timing out.',
  'Next: assign an owner for the migration runbook.',
  'Communication was great during the sprint.',
  'Need better test coverage on the API layer.',
  'The standup notes helped a lot this week.',
  'Deploy pipeline is much faster now.',
  'Documentation fell behind again.',
  'Pair programming sessions were very productive.',
  'We should automate the release checklist.',
  'Bug triage meeting saved us hours.',
  'New team member onboarded smoothly.',
  'Feature flags helped us ship incrementally.',
  'The retro action items from last week were completed.',
  'We need a clearer definition of done.',
  'Cross-team coordination improved significantly.',
  'The code review process is working well.',
  'Too many meetings this sprint.',
  'CI/CD pipeline was stable all week.',
  'Client feedback was overwhelmingly positive.',
  'We need to address the flaky tests.',
  'Sprint velocity increased by 15%.',
  'The new design system is a huge help.',
  'Technical debt is accumulating in the auth module.',
  'Great job on the incident response this week.',
];

/**
 * Create a 25-note retro board with mixed colours, multi-line text, and overlaps.
 * Returns a Y.Doc populated with the board.
 */
export function create25NoteBoard(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);

  for (let i = 0; i < 25; i++) {
    const x = (i % 5) * 220;
    const y = Math.floor(i / 5) * 220;
    const color = COLORS[i % COLORS.length];
    const id = createSticky(doc, { x, y }, color);
    if (id) {
      // Add multi-line text
      const textObj = (doc.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text;
      textObj.insert(0, RETRO_TEXTS[i]);
      // Overlap some notes by moving them slightly
      if (i % 3 === 0) {
        moveObject(doc, id, x + 10, y + 10);
      }
    }
  }

  return doc;
}

const PHRASES = [
  'Teams use sticky notes to capture one idea per note during a brainstorm session.',
  'After the silent writing round, everybody places their notes on the board for review.',
  'Related ideas are grouped together so themes become visible at a glance to everyone.',
  'Colour helps separate owners, topics and vote counts without needing extra labels.',
  'A duplicate note is removed as soon as the group agrees it adds nothing new.',
  'Long sentences must stay readable inside a small square of paper or pixels alike.',
  'The facilitator keeps the momentum by asking each person to explain their note.',
  'At the end the group votes on the themes they want to act on first next sprint.',
  'Sticky notes are most effective when one idea is captured per note without clutter.',
  'Digital boards allow simultaneous editing from multiple locations around the world.',
  'The ability to reorganise notes instantly transforms the brainstorming experience.',
  'Colour coding by theme helps the eye scan hundreds of notes very quickly indeed.',
  'Timed writing rounds ensure every voice is heard equally regardless of seniority.',
  'Dot voting provides a lightweight mechanism for prioritisation in large groups.',
  'Affinity mapping reveals natural groupings that emerge from the collection of notes.',
];

/**
 * Create a board with PERSIST_TESTED_NOTES (2000) notes with realistic text.
 */
export function createLargeBoard(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);

  for (let i = 0; i < PERSIST_TESTED_NOTES; i++) {
    const x = (i % 50) * 210;
    const y = Math.floor(i / 50) * 210;
    const color = COLORS[i % COLORS.length];
    const id = createSticky(doc, { x, y }, color);
    if (id) {
      const textObj = (doc.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text;
      // Assign varied-length realistic phrases
      const phrase = PHRASES[i % PHRASES.length];
      const suffix = ` [${i}]`;
      textObj.insert(0, phrase + suffix);
    }
  }

  return doc;
}

/**
 * Create damaged update bytes: truncate the last 10 bytes from a valid update.
 */
export function createTruncatedUpdate(doc: Y.Doc): Uint8Array {
  const update = Y.encodeStateAsUpdate(doc);
  return update.slice(0, Math.max(0, update.length - 10));
}

/**
 * Create random bytes of a given length (for damage simulation).
 */
export function createRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}
