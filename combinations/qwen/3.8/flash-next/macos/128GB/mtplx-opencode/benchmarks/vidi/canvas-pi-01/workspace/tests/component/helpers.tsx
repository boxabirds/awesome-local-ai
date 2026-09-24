/**
 * Story 2 · shared jsdom test helpers for the sticky-note component tests.
 *
 * No layout in jsdom, so these build pointer events the way the real app's
 * handlers expect (React delegates `pointerdown`/`pointermove`/`pointerup` and
 * reads `clientX`/`clientY`/`pointerId`) and seed a real `Y.Doc` with notes so
 * each test starts from an exact prior state.
 */
import * as Y from 'yjs';
import { createSticky, initDoc } from '../../src/shared/board-model';
import type { StickyColor } from '../../src/shared/config';
import { DEFAULT_STICKY_COLOR } from '../../src/shared/config';

export interface SeedNote {
  id: string;
  /** World position of the note's centre. */
  centre: { x: number; y: number };
  color?: StickyColor;
  text?: string;
}

/** Build a `Y.Doc` (already `initDoc`-ed) and seed notes; return doc + ids. */
export function seedDoc(notes: SeedNote[] = []): { doc: Y.Doc; ids: string[] } {
  const doc = new Y.Doc();
  initDoc(doc);
  const ids: string[] = [];
  for (const note of notes) {
    const id = createSticky(doc, note.centre, note.color ?? DEFAULT_STICKY_COLOR);
    ids.push(id);
    if (note.text) {
      const ytext = doc.getMap<Y.Map<unknown>>('objects').get(id)?.get('text') as
        | Y.Text
        | undefined;
      if (ytext && note.text.length > 0) ytext.insert(0, note.text);
    }
  }
  return { doc, ids };
}

/** A pointer event that React's delegated pointer handlers will pick up. */
export function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  Object.defineProperty(event, 'isPrimary', { value: true });
  return event;
}

/** A double-click event. */
export function dblclick(x: number, y: number): MouseEvent {
  return new MouseEvent('dblclick', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
}

/** A plain window keydown for the App-level keyboard shortcuts. */
export function key(keyName: string): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: keyName,
    bubbles: true,
    cancelable: true,
  });
}