/**
 * Fixtures — realistic board data generators for tests & e2e suites.
 */
import type { StickySnapshot } from '@/shared/board-model';

// ── Constants ────────────────────────────────────────────────────────

const PALETTE: StickySnapshot['color'][] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

// ── Helpers ──────────────────────────────────────────────────────────

/** Generate a random integer in [min, max]. */
export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Pick a random colour from the palette. */
export function randColor(): StickySnapshot['color'] {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

// ── Single sticky note ───────────────────────────────────────────────

interface NoteOpts {
  id?: string;
  text?: string;
  x?: number;
  y?: number;
  color?: StickySnapshot['color'];
  z?: number;
}

export function makeStickyNote(opts: NoteOpts = {}): Required<Pick<StickySnapshot, 'id' | 'text' | 'x' | 'y' | 'color' | 'z'>> {
  return {
    id: opts.id ?? crypto.randomUUID(),
    text: opts.text ?? `Sticky ${randInt(1, 999)}`,
    x: opts.x ?? randInt(60, 1140),
    y: opts.y ?? randInt(40, 760),
    color: opts.color ?? randColor(),
    z: opts.z ?? randInt(1, 100),
  };
}

// ── Board snapshot generator (≤20 notes) ─────────────────────────────

export function generateBoard(count: number = 5): StickySnapshot[] {
  const result: StickySnapshot[] = [];
  for (let i = 0; i < count; i++) {
    const note = makeStickyNote({ z: i });
    result.push({
      ...note,
      type: 'sticky' as const,
      createdAt: Date.now() - (count - i) * 1000,
    });
  }
  return result;
}

// ── Medium board (~25 notes, for component tests) ───────────────────

export function generateMediumBoard(): StickySnapshot[] {
  return generateBoard(25);
}

// ── Large board (PERSIST_TESTED_NOTES, for storage load-time test) ──

const PERSIST_TESTED_NOTES = parseInt(process.env.PERSIST_TESTED_NOTES || '2000', 10);

export function generateLargeBoard(count: number = PERSIST_TESTED_NOTES): StickySnapshot[] {
  return generateBoard(count);
}
