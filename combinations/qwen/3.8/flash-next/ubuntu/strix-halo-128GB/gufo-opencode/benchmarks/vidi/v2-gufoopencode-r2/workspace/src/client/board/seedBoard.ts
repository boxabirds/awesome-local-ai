// Test-only board seeding used by the persistence e2e specs (TC-19, TC-21).
// Generates real board-model mutations (so storage sees exactly what a human
// session would produce) with a deterministic PRNG, clustered layout, mixed
// colours and multi-line realistic text.

import * as Y from 'yjs';
import { createSticky, getStickyText, LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

const PHRASES = [
  'Ship the beta to the design partners on Thursday',
  'Weekly retro: what slowed us down most last sprint?',
  'Ask support for the top five complaints this month',
  'Onboarding feels long, but nobody says why',
  'Try pairing on the import pipeline for a week',
  'Cut the report wizard down to three steps',
  'The empty board needs a friendly starting point',
  'Follow up: who owns the export format decision?',
  'Autosave should never lose a note, ever',
  'Mobile view can wait; the shared link cannot',
  'Turn the incident timeline into a checklist',
  'Naming: boards or spaces? Decide before launch',
  'Latency spikes after 40 tabs were open, needs a repro',
  'Celebrate: first board survived an overnight restart',
  'Investigate: duplicate notes after flaky wifi reconnect',
  'Keep the toolbar under seven actions',
  'Write down why we removed the comment feature',
  'The color picker opens on the wrong side on tablets',
  'Test plan: two people, one board, ten minutes',
  'Collect quotes from the last five user interviews',
  'Prioritize: load speed beats pretty cursors',
  'Who checks the backup story before the demo?',
  'Move the archive question to next quarter',
  'Document the keyboard shortcuts somewhere visible',
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedBoard(doc: Y.Doc, count: number): void {
  const rand = mulberry32(0x5eed4);
  const colors = Object.keys(STICKY_COLORS) as StickyColor[];
  for (let i = 0; i < count; i += 1) {
    const col = i % 5;
    const row = Math.floor(i / 5);
    const x = -1400 + col * 250 + Math.floor(rand() * 70);
    const y = -900 + row * 170 + Math.floor(rand() * 50);
    const id = createSticky(doc, { x, y }, colors[Math.floor(rand() * colors.length)]) as string;
    const text = getStickyText(doc, id);
    if (text) {
      const phrase = PHRASES[Math.floor(rand() * PHRASES.length)];
      const body = i % 4 === 0 ? `${phrase}\n${PHRASES[Math.floor(rand() * PHRASES.length)]}` : phrase;
      doc.transact(() => text.insert(0, body), LOCAL_ORIGIN);
    }
  }
}
