/**
 * Test fixtures for board persistence tests.
 * Generates realistic boards via real board-model functions and Yjs updates.
 */

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '@shared/board-model';
import { initDoc, createSticky } from '@shared/board-model';
import type { StickyColor } from '@shared/config';
import { STICKY_COLORS, DEFAULT_STICKY_COLOR, PERSIST_TESTED_NOTES } from '@shared/config';
import { encodeStateAsUpdate, applyUpdate } from 'yjs';

const COLORS: StickyColor[] = Object.keys(STICKY_COLORS) as StickyColor[];
const TEXTS = [
  'Review the design document for inconsistencies',
  'Need to discuss API rate limits with backend team',
  'Add more unit tests for edge cases in validation',
  'Consider accessibility improvements for keyboard nav',
  'Performance profiling shows bottleneck in render loop',
  'User feedback says onboarding flow is confusing',
  'Database migration needs rolling update strategy',
  'Security audit findings from last quarter',
  'Design system tokens need updating for dark mode',
  'Load testing results show memory leak under sustained load',
  'Refactor auth middleware into shared library',
  'New feature request: export boards to PDF format',
  'CI pipeline needs faster dependency caching',
  'Mobile viewport issues on tablet rotation',
  'Implement optimistic UI for collaborative editing',
  'Analytics dashboard needs real-time data feed',
  'API documentation should include response schemas',
  'Consider switching message queue implementation',
  'A/B test results indicate preference for new layout',
  'Internationalization strings need review for Q2',
  'Error boundaries not catching all React errors',
  'WebSocket reconnection logic has race condition',
  'Caching strategy for static assets needs revision',
  'Monitoring alerts are too noisy in staging env',
  'Code coverage report dropped below threshold',
];

/** Generate a board with `count` sticky notes spread across the canvas. */
export function generateBoard(count: number): Uint8Array {
  const doc = new Y.Doc();
  initDoc(doc);

  for (let i = 0; i < count; i++) {
    const x = (i % 5) * 300 + Math.floor(Math.random() * 150);
    const y = Math.floor(i / 5) * 200 + Math.floor(Math.random() * 100);
    const color = COLORS[i % COLORS.length];
    const text = TEXTS[i % TEXTS.length];

    const id = createSticky(doc, { x, y }, color);
    // Set text
    const objects = doc.getMap('objects');
    const dm = objects.get(id) as any;
    if (dm && dm.get('text') instanceof Y.Text) {
      dm.get('text').insert(0, text.substring(0, Math.min(40, text.length)));
    }
  }

  return encodeStateAsUpdate(doc, [], undefined, true);
}

/** Generate a smaller board with exactly 25 notes for quick integration tests. */
export function generateBoard25(): Uint8Array {
  return generateBoard(25);
}

/** Generate a large board with PERSIST_TESTED_NOTES notes. */
export function generateLargeBoard(): Uint8Array {
  return generateBoard(PERSIST_TESTED_NOTES);
}

/** Apply an update to a fresh Y.Doc and return it. */
export function applyToFresh(update: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  applyUpdate(doc, update, undefined);
  return doc;
}
