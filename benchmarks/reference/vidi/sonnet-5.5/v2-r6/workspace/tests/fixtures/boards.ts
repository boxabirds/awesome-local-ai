import * as Y from 'yjs';
import {
  bringToFront, createSticky, getStickyText, initDoc, moveObject, setStickyColor,
} from '../../src/shared/board-model';
import { PERSIST_TESTED_NOTES, STICKY_COLORS, type StickyColor } from '../../src/shared/config';
import { LONG_TEXT, RETRO_TEXT, SHORT_TEXT } from './texts';

const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

export interface GeneratedBoard {
  doc: Y.Doc;
  /** Every Yjs update the generator produced, in order (what a room would append as log rows). */
  updates: Uint8Array[];
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function recording(): GeneratedBoard {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (u: Uint8Array) => updates.push(u));
  initDoc(doc);
  return { doc, updates };
}

/** 25-note retro board: mixed colours, multi-line texts, overlapping notes and restacking. */
export function retroBoard(): GeneratedBoard {
  const board = recording();
  const { doc } = board;
  const texts = [SHORT_TEXT, RETRO_TEXT, LONG_TEXT.slice(0, 200), ''];
  const ids: string[] = [];
  for (let i = 0; i < 25; i++) {
    // 5 columns, 140px apart: notes are 200px wide so neighbours overlap.
    const id = createSticky(doc, { x: (i % 5) * 140, y: Math.floor(i / 5) * 140 }, COLORS[i % COLORS.length]) as string;
    ids.push(id);
    const text = texts[i % texts.length];
    if (text) getStickyText(doc, id)!.insert(0, text);
  }
  moveObject(doc, ids[3], 1234, -567);
  setStickyColor(doc, ids[4], 'violet');
  bringToFront(doc, ids[0]);
  return board;
}

const PHRASES = [
  'Customers keep asking for a dark mode', 'Release checklist is out of date',
  'Pairing on the flaky test really helped', 'We need an owner for the on-call rota',
  'Great demo from the design team this sprint', 'Build times doubled after the dependency bump',
  'Can we write down the onboarding steps once and keep them current?',
  'The retro format felt stale; try a sailboat next time',
];

/** A board of `count` notes with realistic 10-300 character English text, laid out in clusters. */
export function bigBoard(count: number = PERSIST_TESTED_NOTES): GeneratedBoard {
  const board = recording();
  const rand = lcg(42);
  const clusters = 12;
  for (let i = 0; i < count; i++) {
    const c = i % clusters;
    const cx = (c % 4) * 1200;
    const cy = Math.floor(c / 4) * 1200;
    const id = createSticky(board.doc, {
      x: cx + Math.floor(rand() * 900), y: cy + Math.floor(rand() * 900),
    }, COLORS[Math.floor(rand() * COLORS.length)]) as string;
    let text = PHRASES[Math.floor(rand() * PHRASES.length)];
    const target = 10 + Math.floor(rand() * 290);
    while (text.length < target) text += `. ${PHRASES[Math.floor(rand() * PHRASES.length)]}`;
    getStickyText(board.doc, id)!.insert(0, text.slice(0, target));
  }
  return board;
}

/** Damaged-bytes fixtures. */
export const truncated = (b: Uint8Array): Uint8Array => b.slice(0, Math.max(0, b.length - 10));
export function randomBytes(length: number, seed = 7): Uint8Array {
  const rand = lcg(seed);
  return Uint8Array.from({ length }, () => Math.floor(rand() * 256));
}

export interface PlacedNote { x: number; y: number; text?: string }

/** A board with notes whose top-left corners are exactly the given points (the model's createSticky takes a centre). */
export function boardWithNotes(notes: PlacedNote[]): GeneratedBoard {
  const board = recording();
  for (const n of notes) {
    const id = createSticky(board.doc, { x: n.x + 100, y: n.y + 100 }) as string;
    if (n.text) getStickyText(board.doc, id)!.insert(0, n.text);
  }
  return board;
}

/**
 * 20-note retro board in two clusters: a 3x2 cluster at the top left (gaps of 60), one lone note to its
 * right that a moved cluster lands on, and 13 more notes (cluster two) far below the first screen.
 */
export function selectionRetroBoard(): GeneratedBoard {
  const texts = [SHORT_TEXT, RETRO_TEXT, 'Pairing helped a lot', 'Flaky tests'];
  const notes: PlacedNote[] = [];
  for (let i = 0; i < 6; i++) notes.push({ x: 100 + (i % 3) * 260, y: 100 + Math.floor(i / 3) * 260, text: texts[i % texts.length] });
  notes.push({ x: 1000, y: 100, text: 'Release checklist' });
  for (let i = 0; i < 13; i++) notes.push({ x: 100 + (i % 5) * 260, y: 1400 + Math.floor(i / 5) * 260, text: texts[i % texts.length] });
  return boardWithNotes(notes);
}
