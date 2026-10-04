/**
 * Seeded, reproducible editing for the capacity tests: each participant runs its own script of
 * random board operations and only ever touches the notes it created itself, which is the
 * "two writers, different notes" concurrency class. Determinism matters more than realism here:
 * when 5 participants x 200 operations do not converge, the same seed has to reproduce it.
 */

import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../../src/shared/board-model.js';
import { STICKY_COLORS, type StickyColor } from '../../../src/shared/config.js';
import type * as Y from 'yjs';

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

/** The random number generator the design asks for: small, seeded, identical everywhere. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One participant's script of operations against its own document. */
export class ScriptedEditor {
  /** Note ids this script created, in order. */
  readonly created: string[] = [];
  /** Note ids this script deleted, in order. */
  readonly deleted: string[] = [];

  private readonly random: () => number;
  private typed = 0;

  constructor(
    private readonly doc: Y.Doc,
    seed: number,
  ) {
    this.random = mulberry32(seed);
  }

  /** Notes it created and has not deleted. */
  get alive(): readonly string[] {
    return this.created.filter((id) => !this.deleted.includes(id));
  }

  /** Run `runs` operations. */
  run(runs: number): void {
    for (let index = 0; index < runs; index += 1) {
      this.step();
    }
  }

  /** One operation: create, move, recolour, type, or delete. */
  step(): void {
    const notes = this.alive;
    if (notes.length === 0 || this.random() < 0.3) {
      this.create();
      return;
    }
    const id = notes[Math.floor(this.random() * notes.length)] as string;
    const pick = this.random();
    if (pick < 0.5) {
      moveObject(this.doc, id, this.coordinate(), this.coordinate());
    } else if (pick < 0.7) {
      setStickyColor(this.doc, id, COLORS[Math.floor(this.random() * COLORS.length)] as StickyColor);
    } else if (pick < 0.9) {
      this.type(id);
    } else if (deleteObject(this.doc, id)) {
      this.deleted.push(id);
    }
  }

  private create(): void {
    const id = createSticky(this.doc, { x: this.coordinate(), y: this.coordinate() });
    if (id !== '') {
      this.created.push(id);
    }
  }

  private type(id: string): void {
    const text = getStickyText(this.doc, id);
    if (text !== undefined) {
      text.insert(text.length, `${(this.typed % 36).toString(36)}`);
      this.typed += 1;
    }
  }

  private coordinate(): number {
    return Math.floor(this.random() * 2000) - 1000;
  }
}
