// Selection keyboard commands (design `sel.keyboard`).
//
// The board owns these keys whenever no text is being edited: Ctrl/Cmd+A selects
// every object, Escape clears the selection, the arrows nudge it (without
// scrolling the page or panning the board) and Delete/Backspace removes it.
// Enter still opens the text editor of the one selected object that holds text.
//
// "No text is being edited" means either this client is editing an object, or the
// keypress started in a field (the note's editor textarea, or an input elsewhere
// on the page) — in both cases the keystroke belongs to the text, not the board.

import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model.ts';
import {
  NUDGE_STEP_WORLD,
  NUDGE_LARGE_STEP_WORLD,
} from '../../shared/config.ts';
import { registeredTypes, getObjectType } from '../objects/registry.tsx';
import type { Selection } from './useSelection.ts';

export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  /** False while the board could not be loaded: no key may change the doc. */
  canEdit: boolean;
}

const ARROWS = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
} as const;

/** Is the keystroke addressed to a text field rather than to the board? */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

/**
 * The board's window-level key handling. Mounted once; every value it acts on is
 * read through a ref so a handler registered before the first render can never
 * use a stale selection, snapshot or edit lock.
 */
export function useBoardKeys(opts: BoardKeysOptions): void {
  const docRef = useRef(opts.doc);
  docRef.current = opts.doc;
  const selRef = useRef(opts.selection);
  selRef.current = opts.selection;
  const snapshotRef = useRef(opts.snapshot);
  snapshotRef.current = opts.snapshot;
  const canEditRef = useRef(opts.canEdit);
  canEditRef.current = opts.canEdit;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const sel = selRef.current;
      const editing = sel.editingId !== null;
      // While text is being edited, or the caret is in a field, the board takes
      // nothing: no shortcut, no preventDefault.
      if (editing || isEditableTarget(e.target)) return;

      const meta = e.ctrlKey || e.metaKey;

      if (meta && (e.key === 'a' || e.key === 'A')) {
        // Select everything the board can render — and stop the browser from
        // selecting the page's text instead.
        e.preventDefault();
        sel.setMany(allObjectIds(snapshotRef.current, registeredTypes()), false);
        return;
      }

      if (e.key === 'Escape') {
        // An active marquee has already swallowed this key before it got here.
        sel.clear();
        return;
      }

      if (!canEditRef.current) return; // every key below changes the document

      if (e.key === 'Enter') {
        // Story 2's route into the editor: one selected object that holds text.
        if (sel.ids.size !== 1) return;
        const id = [...sel.ids][0]!;
        const obj = snapshotRef.current.find((o) => o.id === id);
        if (!obj || !getObjectType(obj.type)?.editableText) return;
        e.preventDefault();
        sel.startEdit(id);
        return;
      }

      const arrow = ARROWS[e.key as keyof typeof ARROWS];
      if (arrow && sel.ids.size > 0) {
        // The board owns the arrow keys while something is selected: no page
        // scroll and no board pan (sel.keyboard / e2e TC-34).
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const positions = new Map<string, { x: number; y: number }>();
        for (const o of snapshotRef.current) {
          if (!sel.ids.has(o.id)) continue;
          const r = objectBounds(o);
          positions.set(o.id, { x: r.x + arrow.x * step, y: r.y + arrow.y * step });
        }
        moveObjects(docRef.current, positions);
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        // The board owns these keys even with nothing selected: swallowing the key
        // deletes nothing, while letting it through would let a stray Backspace
        // walk the browser back out of the board.
        e.preventDefault();
        if (sel.ids.size === 0) return; // nothing to remove
        deleteObjects(docRef.current, [...sel.ids]);
        sel.clear();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
