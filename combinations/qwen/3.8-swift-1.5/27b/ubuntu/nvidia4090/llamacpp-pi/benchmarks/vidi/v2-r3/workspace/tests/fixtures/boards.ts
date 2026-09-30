import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  moveObject,
  getStickyText,
  snapshot,
} from '../../src/shared/board-model';
import { type StickyColor, PERSIST_TESTED_NOTES } from '../../src/shared/config';

const COLORS: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

/**
 * Generate a realistic 25-note retro board with mixed colours, multi-line texts,
 * and overlapping stacking. Returns the Y.Doc.
 */
export function generateRetroBoard(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);

  const phrases = [
    'What went well?',
    'What could be\nbetter?',
    'Action items\nfor next sprint',
    'User feedback\nfrom interviews',
    'Technical debt\nto address',
    'Ideas for Q1',
    'Blockers\nand risks',
    'Wins to\ncelebrate',
    'Next steps',
    'Open questions\nfor the team',
    'Metrics that\nmattered',
    'Process\nimprovements',
    'Training\nneeds',
    'Stakeholder\nupdates',
    'Budget\nremaining',
    'Timeline\nadjustments',
    'Quality\nobservations',
    'Security\nconcerns',
    'Documentation\ngaps',
    'Onboarding\nfeedback',
    'Release\nhighlights',
    'Support\nticket trends',
    'Performance\nbottlenecks',
    'Accessibility\nnotes',
    'Team morale\ncheck-in',
  ];

  for (let i = 0; i < 25; i++) {
    const x = (i % 5) * 250 + (i * 37 % 50);
    const y = Math.floor(i / 5) * 250 + (i * 23 % 40);
    const color = COLORS[i % COLORS.length];
    const id = createSticky(doc, { x, y }, color) as string;
    const text = getStickyText(doc, id);
    if (text) text.insert(0, phrases[i]);
    // Add some overlapping stacking
    if (i > 0 && i % 3 === 0) {
      // Move to overlap with previous note
      const prev = snapshot(doc);
      if (prev.length > 1) {
        const p = prev[prev.length - 1];
        moveObject(doc, id, p.x + 20, p.y + 15);
      }
    }
  }

  return doc;
}

/**
 * Generate a board with PERSIST_TESTED_NOTES notes containing realistic English
 * phrases (10–300 chars) laid out in clusters.
 */
export function generateLargeBoard(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);

  const words = [
    'the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog',
    'sprint', 'planning', 'retrospective', 'backlog', 'story', 'point',
    'design', 'review', 'feedback', 'iteration', 'release', 'deploy',
    'test', 'coverage', 'refactor', 'optimize', 'monitor', 'deploy',
    'user', 'experience', 'interface', 'component', 'state', 'render',
    'data', 'model', 'schema', 'query', 'index', 'cache',
  ];

  for (let i = 0; i < PERSIST_TESTED_NOTES; i++) {
    // Cluster layout: groups of 20 in a grid
    const cluster = Math.floor(i / 20);
    const inCluster = i % 20;
    const clusterX = (cluster % 10) * 600;
    const clusterY = Math.floor(cluster / 10) * 600;
    const x = clusterX + (inCluster % 5) * 220;
    const y = clusterY + Math.floor(inCluster / 5) * 220;
    const color = COLORS[i % COLORS.length];

    const id = createSticky(doc, { x, y }, color) as string;
    const text = getStickyText(doc, id);
    if (text) {
      // Generate a realistic phrase of 10-300 chars
      const wordCount = 3 + (i % 15);
      let phrase = '';
      for (let w = 0; w < wordCount; w++) {
        if (w > 0) phrase += ' ';
        phrase += words[(i * 7 + w * 13) % words.length];
      }
      // Pad to at least 10 chars
      while (phrase.length < 10) phrase += ' data';
      // Cap at 300 chars
      if (phrase.length > 300) phrase = phrase.slice(0, 300);
      text.insert(0, phrase);
    }
  }

  return doc;
}

/**
 * Generate a damaged update: take a real update and truncate the last 10 bytes.
 */
export function generateDamagedUpdate(doc: Y.Doc, noteIndex: number = 0): Uint8Array {
  // Make a change to get a real update
  const notes = snapshot(doc);
  if (notes.length > noteIndex) {
    moveObject(doc, notes[noteIndex].id, notes[noteIndex].x + 1, notes[noteIndex].y + 1);
  }
  const update = Y.encodeStateAsUpdate(doc);
  // Truncate last 10 bytes
  if (update.length > 10) {
    return update.subarray(0, update.length - 10);
  }
  return update;
}

/**
 * Generate random bytes of the same length as a given update.
 */
export function generateRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}
