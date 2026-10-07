import * as Y from 'yjs';
import {
  createSticky,
  getStickyText,
  initDoc,
  resizeObjects,
  setStickyColor,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { STICKY_COLORS, STICKY_SIZE_WORLD, type StickyColor } from '../../src/shared/config';

/**
 * Boards for the undo unit tests.
 *
 * The notes are put in place through the real model functions, but inside one
 * transaction whose origin is neither this tab's work nor a peer's change — the
 * way a board that was *already there* arrives (PRD undo.session_only). That is
 * what lets a test say "the history contains exactly the steps the user made".
 */

/** A note as a test asks for it (world position, colour, text, size). */
export interface NoteSpec {
  x: number;
  y: number;
  color?: StickyColor;
  text?: string;
  width?: number;
  height?: number;
}

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** A document with the board shape but nothing on it. */
export function emptyDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** Write `specs` as one untracked transaction and return the new note ids. */
export function seed(doc: Y.Doc, specs: readonly NoteSpec[]): string[] {
  const ids: string[] = [];
  doc.transact(() => {
    for (const spec of specs) {
      const width = spec.width ?? STICKY_SIZE_WORLD;
      const height = spec.height ?? STICKY_SIZE_WORLD;
      const id = createSticky(
        doc,
        { x: spec.x + width / 2, y: spec.y + height / 2 },
        spec.color ?? 'yellow',
      );
      if (!id) throw new Error('fixture note rejected by the model');
      if (spec.width != null || spec.height != null) {
        resizeObjects(doc, new Map([[id, { x: spec.x, y: spec.y, width, height }] as const]));
      }
      if (spec.color) setStickyColor(doc, id, spec.color);
      if (spec.text) getStickyText(doc, id)?.insert(0, spec.text);
      ids.push(id);
    }
  });
  return ids;
}

/**
 * The design's fixture board: twelve notes in varied colours and sizes, the first
 * eight sitting in one cluster (the notes an accidental Delete catches).
 */
export function retroSpecs(): NoteSpec[] {
  const specs: NoteSpec[] = [];
  // The cluster: 4 columns x 2 rows, sizes varying between 140 and 170 wide.
  const clusterX = [300, 480, 660, 840];
  const clusterY = [240, 420];
  for (let i = 0; i < 8; i++) {
    const width = 140 + (i % 4) * 10;
    specs.push({
      x: clusterX[i % 4]!,
      y: clusterY[Math.floor(i / 4)]!,
      color: COLOR_NAMES[i % COLOR_NAMES.length]!,
      text: `retro ${i + 1}`,
      width,
      height: width + 10,
    });
  }
  // Four notes away from the cluster, so a box around the cluster never reaches them.
  const others: Array<[number, number]> = [
    [1130, 240],
    [1130, 420],
    [300, 660],
    [1000, 660],
  ];
  others.forEach(([x, y], i) => {
    specs.push({
      x,
      y,
      color: COLOR_NAMES[(i + 3) % COLOR_NAMES.length]!,
      text: `apart ${i + 1}`,
      width: 200,
      height: 160,
    });
  });
  return specs;
}

/** The parts of a note an undo step has to bring back unchanged. */
export function noteShape(note: StickySnapshot): {
  x: number;
  y: number;
  color: string;
  text: string;
  width: number | undefined;
  height: number | undefined;
} {
  return {
    x: note.x,
    y: note.y,
    color: note.color,
    text: note.text,
    width: note.width,
    height: note.height,
  };
}
