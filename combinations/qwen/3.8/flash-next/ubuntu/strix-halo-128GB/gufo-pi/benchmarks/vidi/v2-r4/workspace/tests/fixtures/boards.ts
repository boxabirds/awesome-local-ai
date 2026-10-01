/**
 * Board fixtures: generate boards using real board-model functions so that
 * updates are real Yjs update bytes.
 */
import * as Y from 'yjs';
import {
  createSticky,
  moveObject,
  getStickyText,
  initDoc,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model';
import type { StickyColor } from '../../src/shared/config';
import { PERSIST_TESTED_NOTES } from '../../src/shared/config';

const COLORS: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

const RETRO_TEXTS = [
  'What went well: shipped the editor beta two days early.',
  'Review turnaround took a full week.\nAction: pair junior reviewers.',
  'Documentation was sparse but the senior devs helped a lot.',
  'Sprint velocity improved by 15% after the refactor.',
  'Cross-team communication broke down during the migration.',
  'The retro format worked great for remote participants.',
  'Need to improve the build pipeline: 45 minutes is too slow.',
  'Pair programming sessions were the highlight this quarter.',
  'Customer feedback loop was tight and actionable.',
  'Tech debt paid down in the auth module felt great.',
  'Onboarding new hires took less than two weeks.',
  'The incident response was chaotic; need runbooks.',
  'Design review cadence should be weekly not biweekly.',
  'Feature flags saved us when the search index broke.',
  'The release train model is working but needs automation.',
  'Unit test coverage went from 40 to 70 percent.',
  'API versioning caused unnecessary complexity for clients.',
  'The team morale is high after the successful launch.',
  'Stakeholder meetings could be async with short recordings.',
  'Code review SLA should be 24 hours during working days.',
  'The infrastructure costs dropped after the autoscaling fix.',
  'Knowledge sharing sessions every Friday are valuable.',
  'Load testing revealed bottlenecks in the notification path.',
  'The new CI runner setup cut build times in half.',
  'Product discovery workshops generated three solid candidates.',
];

const PROSE_SENTENCES = [
  'The team gathered around the whiteboard to map out the quarter ahead.',
  'Sticky notes in bright colours covered every free inch of the wall.',
  'Each idea was written in marker large enough to read from the doorway.',
  'Related notes drifted together into clusters as the discussion evolved.',
  'Someone grouped three yellow notes under a heading called follow up.',
  'A violet note near the corner held a question nobody could answer yet.',
  'The facilitator counted the votes and circled the top three themes.',
  'Colour became a quiet language for ownership across the whole room.',
];

function buildPhrase(index: number): string {
  const minLen = 10;
  const maxLen = 300;
  const len = minLen + ((index * 47) % (maxLen - minLen));
  let text = '';
  let i = 0;
  while (text.length < len) {
    const sentence = PROSE_SENTENCES[i % PROSE_SENTENCES.length];
    text += text.length === 0 ? sentence : ` ${sentence}`;
    i++;
  }
  return text.slice(0, len);
}

/** Generate a 25-note retrospective board with mixed colours, multi-line texts and overlapping positions. */
export function generateRetroBoard(): { doc: Y.Doc; notes: readonly StickySnapshot[] } {
  const doc = new Y.Doc();
  initDoc(doc);
  const ids: string[] = [];

  for (let i = 0; i < 25; i++) {
    const x = (i % 5) * 250 - 500;
    const y = Math.floor(i / 5) * 250 - 250;
    const color = COLORS[i % COLORS.length];
    const id = createSticky(doc, { x, y }, color);
    ids.push(id);
    const ytext = getStickyText(doc, id);
    if (ytext) {
      ytext.insert(0, RETRO_TEXTS[i]);
    }
  }
  moveObject(doc, ids[7], -250, -250);
  moveObject(doc, ids[13], 0, -250);

  return { doc, notes: snapshot(doc) };
}

/** Generate a PERSIST_TESTED_NOTES-note board with realistic text in clusters. */
export function generateLargeBoard(): { doc: Y.Doc; notes: readonly StickySnapshot[] } {
  const doc = new Y.Doc();
  initDoc(doc);
  const cols = Math.ceil(Math.sqrt(PERSIST_TESTED_NOTES));

  for (let i = 0; i < PERSIST_TESTED_NOTES; i++) {
    const clusterX = Math.floor(i / 100) * 2000;
    const x = clusterX + (i % cols) * 250 - 125;
    const y = Math.floor(i / cols) * 250 - 500;
    const color = COLORS[i % COLORS.length];
    const id = createSticky(doc, { x, y }, color);
    const ytext = getStickyText(doc, id);
    if (ytext) {
      ytext.insert(0, buildPhrase(i));
    }
  }

  return { doc, notes: snapshot(doc) };
}

/** Create a doc with 25 retro notes and return both the doc and its captured updates. */
export function createRetroBoardWithUpdates(): { doc: Y.Doc; updates: Uint8Array[]; notes: readonly StickySnapshot[] } {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => {
    updates.push(update);
  });
  initDoc(doc);
  const ids: string[] = [];

  for (let i = 0; i < 25; i++) {
    const x = (i % 5) * 250 - 500;
    const y = Math.floor(i / 5) * 250 - 250;
    const color = COLORS[i % COLORS.length];
    const id = createSticky(doc, { x, y }, color);
    ids.push(id);
    const ytext = getStickyText(doc, id);
    if (ytext) {
      ytext.insert(0, RETRO_TEXTS[i]);
    }
  }
  moveObject(doc, ids[7], -250, -250);
  moveObject(doc, ids[13], 0, -250);

  return { doc, updates, notes: snapshot(doc) };
}

/** Create a doc with PERSIST_TESTED_NOTES notes and return captured updates. */
export function createLargeBoardWithUpdates(): { doc: Y.Doc; updates: Uint8Array[]; notes: readonly StickySnapshot[] } {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => {
    updates.push(update);
  });
  initDoc(doc);
  const cols = Math.ceil(Math.sqrt(PERSIST_TESTED_NOTES));

  for (let i = 0; i < PERSIST_TESTED_NOTES; i++) {
    const clusterX = Math.floor(i / 100) * 2000;
    const x = clusterX + (i % cols) * 250 - 125;
    const y = Math.floor(i / cols) * 250 - 500;
    const color = COLORS[i % COLORS.length];
    const id = createSticky(doc, { x, y }, color);
    const ytext = getStickyText(doc, id);
    if (ytext) {
      ytext.insert(0, buildPhrase(i));
    }
  }

  return { doc, updates, notes: snapshot(doc) };
}

/** A truncated update (last 10 bytes removed) for damage fixtures. */
export function truncateUpdate(update: Uint8Array): Uint8Array {
  return update.slice(0, update.length - 10);
}

/** Deterministic "random" bytes of the same length for damage fixtures. */
export function randomBytesOfLength(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = (i * 7 + 13) % 256;
  }
  return bytes;
}
