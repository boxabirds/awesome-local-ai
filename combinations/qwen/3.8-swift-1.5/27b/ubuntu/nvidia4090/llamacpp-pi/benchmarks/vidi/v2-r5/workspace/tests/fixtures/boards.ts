// tests/fixtures/boards.ts
// Realistic board generators for persistence tests.
// Uses real board-model functions so bytes are real Yjs updates.

import * as Y from 'yjs';
import { createSticky, moveObject, getStickyText, initDoc } from '../../src/shared/board-model';
import type { StickyColor } from '../../src/shared/config';
import { PERSIST_TESTED_NOTES } from '../../src/shared/config';

const COLORS: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

const PHRASES = [
  'What did we do well?',
  'What could be better?',
  'Action item: follow up with client',
  'Great progress on the API layer',
  'Need to review the authentication flow',
  'The dashboard looks much cleaner now',
  'Let\'s ship this by Friday',
  'Blocker: waiting on design review',
  'Remember to update the changelog',
  'The new onboarding flow is working well',
  'We should add more test coverage here',
  'Performance is acceptable for now',
  'The mobile layout needs some work',
  'Great job everyone on the release',
  'TODO: fix the memory leak in worker',
  'The database migration went smoothly',
  'Need to document the new API endpoints',
  'User feedback has been very positive',
  'Let\'s schedule a retrospective for next week',
  'The caching layer is performing well',
  'We need to address the accessibility issues',
  'The new search feature is working great',
  'Remember to rotate the API keys',
  'The deployment pipeline is much faster now',
  'Let\'s pair on the hard bug tomorrow',
  'The error messages need to be clearer',
  'Good catch on that edge case',
  'The new component library is looking great',
  'We should consider adding dark mode',
  'The load times have improved significantly',
];

/**
 * Creates a 25-note retro board with mixed colours, multi-line texts, and overlapping stacking.
 */
export function createRetroBoard(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);

  for (let i = 0; i < 25; i++) {
    const x = (i % 5) * 220 + Math.floor(Math.random() * 20);
    const y = Math.floor(i / 5) * 220 + Math.floor(Math.random() * 20);
    const color = COLORS[i % COLORS.length];
    const id = createSticky(doc, { x, y }, color);

    // Add text (some multi-line)
    const text = getStickyText(doc, id)!;
    const phrase = PHRASES[i % PHRASES.length];
    if (i % 3 === 0) {
      text.insert(0, phrase + '\nSecond line of text');
    } else {
      text.insert(0, phrase);
    }

    // Some notes get moved (overlapping stacking)
    if (i % 4 === 0) {
      moveObject(doc, id, x + 10, y + 10);
    }
  }

  return doc;
}

/**
 * Creates a board with PERSIST_TESTED_NOTES notes with realistic text.
 */
export function createLargeBoard(count: number = PERSIST_TESTED_NOTES): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);

  for (let i = 0; i < count; i++) {
    // Layout in clusters of 20x20
    const cluster = Math.floor(i / 400);
    const inCluster = i % 400;
    const col = inCluster % 20;
    const row = Math.floor(inCluster / 20);
    const x = cluster * 5000 + col * 210;
    const y = row * 210;

    const color = COLORS[i % COLORS.length];
    const id = createSticky(doc, { x, y }, color);

    const text = getStickyText(doc, id)!;
    // Realistic 10-300 char phrases
    const base = PHRASES[i % PHRASES.length];
    if (i % 5 === 0) {
      text.insert(0, base + ' — additional context that makes this longer for testing purposes. ' + base);
    } else if (i % 3 === 0) {
      text.insert(0, base + ' (follow-up needed)');
    } else {
      text.insert(0, base);
    }
  }

  return doc;
}

/**
 * Generates a damaged (truncated) update by removing the last 10 bytes.
 */
export function makeDamagedUpdate(update: Uint8Array): Uint8Array {
  if (update.length <= 10) return new Uint8Array([0xFF, 0xFF, 0xFF]);
  return update.subarray(0, update.length - 10);
}

/**
 * Generates random bytes of the same length as the input.
 */
export function makeRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}
