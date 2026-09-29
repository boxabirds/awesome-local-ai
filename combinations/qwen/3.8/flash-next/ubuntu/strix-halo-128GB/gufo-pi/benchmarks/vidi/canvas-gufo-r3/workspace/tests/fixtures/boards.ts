import * as Y from 'yjs';
import { createSticky, moveObject, setStickyColor, getStickyText, initDoc } from '@shared/board-model';
import { StickyColor } from '@shared/config';

const COLORS: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

const RETRO_TEXTS = [
  'What went well this sprint?',
  'Areas for improvement',
  'Team communication was great!\nEspecially the daily standups.',
  'Need more time for code reviews',
  'The new CI pipeline saved us hours.\nReally happy with the auto-deploy setup.',
  'Documentation is lacking',
  'Cross-team collaboration improved a lot',
  'Technical debt is piling up\nWe should allocate 20% to paying it down',
  'Love the new pairing sessions',
  'Meeting overload — too many sync calls',
  'The retro format worked well this time',
  'More autonomy for sub-teams please',
  'Sprint planning feels more realistic now',
  'Need clearer acceptance criteria on stories',
  'The bug bash was super productive!\nFound 15 critical issues in 2 hours.',
  'Onboarding docs need updating for new hires',
  'Our test coverage went up 12%',
  'More direct feedback culture needed',
  'Infrastructure improvements were the highlight',
  'Scope creep in sprint 23 caused stress',
  'The team is really clicking now',
  'Want more mob programming sessions',
  'Release process is smoother after automation',
  'Need to address the flaky test suite ASAP',
  'Great progress on the refactor! Really proud of how the team came together to tackle the legacy modules.',
];

/**
 * Generate a 25-note retro board with mixed colours, multi-line texts, and overlapping positions.
 */
export function seed25Notes(doc: Y.Doc): void {
  initDoc(doc);
  for (let i = 0; i < 25; i++) {
    const x = (i % 5) * 250 + (i % 3) * 30; // overlapping positions
    const y = Math.floor(i / 5) * 280 + (i % 2) * 40;
    const color = COLORS[i % COLORS.length];
    const id = createSticky(doc, { x, y }, color);
    const ytext = getStickyText(doc, id);
    if (ytext) {
      doc.transact(() => ytext.insert(0, RETRO_TEXTS[i]));
    }
  }
}

const PHRASES = [
  'Consider the implications of distributed systems design.',
  'The quick brown fox jumps over the lazy dog near the riverbank.',
  'Functional programming emphasizes immutability and pure functions for reliability.',
  'Type systems catch entire classes of bugs at compile time rather than runtime.',
  'The observer pattern decouples notification from handling logic effectively.',
  'Database indexes trade write performance for dramatically improved read speed.',
  'Network latency fundamentally shapes how we must architect modern services.',
  'Event sourcing provides a complete audit trail of all state changes.',
  'Cache invalidation remains one of the two hardest problems in computer science.',
  'Microservice boundaries should align with bounded contexts from domain-driven design.',
  'The CAP theorem states that distributed systems cannot simultaneously guarantee consistency, availability, and partition tolerance.',
  'Progressive enhancement ensures basic functionality works without JavaScript while providing enhanced experiences for those with it enabled.',
  'Memory-mapped files allow operating systems to page data in and out transparently, enabling processing of files larger than available RAM.',
  'Backpressure mechanisms prevent downstream components from being overwhelmed when upstream producers generate data faster than consumers can process it.',
  'The saga pattern manages distributed transactions across multiple services by breaking them into a sequence of local transactions.',
  'Chaos engineering intentionally introduces failures into production systems to build confidence in their ability to withstand turbulent conditions.',
  'Formal verification methods can mathematically prove the correctness of algorithms and systems, though the cost and expertise required limits adoption in practice.',
  'Consistent hashing minimizes remapping when nodes are added or removed from a distributed hash table.',
  'The lambda calculus provides a formal framework for understanding computation through function abstraction and application.',
  'Zero-copy networking techniques reduce CPU overhead by eliminating redundant data transfers between kernel and user space.',
];

/**
 * Generate a PERSIST_TESTED_NOTES board with realistic text.
 */
export function seedLargeBoard(doc: Y.Doc, count: number): void {
  initDoc(doc);
  for (let i = 0; i < count; i++) {
    // Cluster layout: 10 columns
    const col = i % 10;
    const row = Math.floor(i / 10);
    const x = col * 260 + (i % 7) * 15;
    const y = row * 260 + (i % 3) * 20;
    const color = COLORS[i % COLORS.length];
    const id = createSticky(doc, { x, y }, color);
    const ytext = getStickyText(doc, id);
    if (ytext) {
      // Use realistic phrases, cycle through them
      const text = PHRASES[i % PHRASES.length];
      doc.transact(() => ytext.insert(0, text));
    }
  }
}

/**
 * Produce damaged bytes: truncated update (last 10 bytes removed) or random bytes.
 */
export function damagedBytes(truncate: boolean): Uint8Array {
  if (truncate) {
    // Create a valid update then truncate it
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 10, y: 10 });
    const bytes = Y.encodeStateAsUpdate(doc);
    return bytes.slice(0, Math.max(0, bytes.length - 10));
  }
  // Random bytes of similar length
  const len = 80 + Math.floor(Math.random() * 40);
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}
